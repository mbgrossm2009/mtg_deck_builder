// LLM-backed deck suggestion service.
//
// ── SECURITY ─────────────────────────────────────────────────────────────────
// This file currently does NOT call any external API. When that changes,
// ALL real LLM calls MUST go through a backend/serverless endpoint owned by us:
//
//     frontend  →  POST /api/generate-deck  →  backend  →  OpenAI/Anthropic
//
// Reasons:
//   1. API keys must NEVER appear in frontend code or in any bundle shipped
//      to the browser. Vite envs prefixed with VITE_ are publicly readable.
//   2. A backend lets us rate-limit, log, and swap providers without redeploying
//      the SPA.
//   3. The backend can enforce request/response size caps and sanity-check
//      the JSON shape before it hits validateLLMDeckResponse.
//
// Until that backend exists, this module either returns a deterministic mock
// (DEV mode) or throws "LLM integration not connected yet" so callers must
// fall back to the heuristic generator.
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildDeckGenerationPrompt,
  buildPass1Prompt,
  buildPass2Prompt,
  buildCritiquePrompt,
  buildEvaluationPrompt,
  estimatePromptTokens,
} from './llmPromptBuilder'
import { clampEvalScore } from './evalScoreClamp'
import { getExecutionThresholdForBracket } from '../rules/commanderExecution'

// Bracket-scaled filler caps (kept in sync with deckValidator.js).
// Used by the eval score clamp to know when filler is "runaway."
const FILLER_CAP_BY_BRACKET = { 1: 12, 2: 9, 3: 6, 4: 3, 5: 1 }

// Toggle the mock on/off without editing call sites. The hybrid orchestrator
// reads this and falls back to the heuristic generator if the LLM is "down".
export const LLM_MODE = {
  DISABLED: 'disabled',     // throw — force heuristic fallback
  MOCK:     'mock',         // return a fake response for development
  LIVE:     'live',         // hit /api/llm (Vercel serverless → OpenAI)
}

// LIVE is the production default. If OPENAI_API_KEY isn't configured on the
// server, /api/llm returns a clear error and the orchestrator falls back to
// the heuristic generator. Override with setLLMMode() during development.
let currentMode = LLM_MODE.LIVE

export function setLLMMode(mode) { currentMode = mode }
export function getLLMMode() { return currentMode }

/**
 * generateDeckWithLLM — main entry point.
 *
 * @param {object} args
 * @param {object} args.commander         — full Scryfall card object for the commander
 * @param {Array}  args.legalCardPool     — pre-filtered legal candidates (already legality-checked,
 *                                          color-identity-checked, bracket-checked, and role-annotated)
 * @param {number} args.bracket           — 1..5
 * @param {object} args.deckRules         — { landTarget, targetCounts: {ramp, draw, removal, ...} }
 * @param {object} args.strategyContext   — { archetypes, primaryArchetypeId }
 *
 * @returns {Promise<{
 *   strategySummary: string,
 *   deck: Array<{name: string, role: string, reason: string}>,
 *   warnings: string[],
 *   excludedImportantCards: Array<{name: string, reason: string}>,
 *   bracketAnalysis: string,
 *   upgradeSuggestions: Array<{name: string, reason: string}>,
 *   _meta: { mode: string, promptTokens: number }
 * }>}
 */
export async function generateDeckWithLLM({
  commander,
  legalCardPool,
  bracket,
  deckRules = {},
  strategyContext = {},
  twoPass = false,
  onProgress,
}) {
  if (!commander) throw new Error('generateDeckWithLLM: commander is required')
  if (!Array.isArray(legalCardPool) || legalCardPool.length === 0) {
    throw new Error('generateDeckWithLLM: legalCardPool is empty — pre-filter produced no cards')
  }

  if (currentMode === LLM_MODE.DISABLED) {
    throw new Error('LLM integration not connected yet — set LLM_MODE to MOCK or LIVE.')
  }

  if (currentMode === LLM_MODE.LIVE) {
    if (twoPass) {
      // Pass 1 — strategy + core engine. Locking these first prevents the
      // model from drifting mid-build when it picks the remaining 80 cards.
      onProgress?.({ stage: 'pass1' })
      const pass1Prompt = buildPass1Prompt({ commander, legalCardPool, bracket, strategyContext })
      const pass1Tokens = estimatePromptTokens(pass1Prompt)
      const pass1Output = await callBackend(pass1Prompt)

      // Pass 2 — fill the rest of the 99 around the locked Pass 1 output.
      // Returns the same shape as the single-pass response, so the validator
      // and orchestrator handle it identically.
      onProgress?.({ stage: 'pass2' })
      const pass2Prompt = buildPass2Prompt({ commander, legalCardPool, bracket, deckRules, strategyContext, pass1Output })
      const pass2Tokens = estimatePromptTokens(pass2Prompt)
      const pass2Output = await callBackend(pass2Prompt)

      return {
        ...pass2Output,
        _meta: {
          mode: 'live',
          twoPass: true,
          promptTokens: pass1Tokens + pass2Tokens,
          pass1Output,
        },
      }
    }

    const prompt = buildDeckGenerationPrompt({ commander, legalCardPool, bracket, deckRules, strategyContext })
    const promptTokens = estimatePromptTokens(prompt)
    const out = await callBackend(prompt)
    return { ...out, _meta: { mode: 'live', promptTokens } }
  }

  // MOCK mode — return a deterministic, mostly-legal deck assembled from the
  // pre-filtered pool so the validator and orchestrator have realistic input
  // to work with during development. This is NOT a real strategy; it just
  // lets us exercise the full pipeline end-to-end without paying for tokens.
  const mockPrompt = buildDeckGenerationPrompt({ commander, legalCardPool, bracket, deckRules, strategyContext })
  return mockLLMResponse({ commander, legalCardPool, bracket, deckRules, promptTokens: estimatePromptTokens(mockPrompt) })
}

/**
 * critiqueDeck — Pass 3, after the deck is fully assembled.
 *
 * Sends the finished deck + remaining pool to the LLM and asks for a critique.
 * Response shape: { approved: bool, summary: string, swaps?: [{ out, in, reason }] }.
 *
 * Returns the raw LLM response — caller is responsible for validating swaps
 * against the actual deck and pool, then applying the valid ones.
 *
 * Returns null if the LLM is disabled or unreachable; caller should treat
 * that as "no swaps" rather than an error (the deck still ships).
 */
export async function critiqueDeck({
  commander,
  bracket,
  deck,
  availablePool,
  chosenStrategy,
  onProgress,
}) {
  if (currentMode === LLM_MODE.DISABLED) return null
  if (currentMode === LLM_MODE.MOCK) {
    // Mock returns "approved" so the existing mock pipeline keeps working.
    return { approved: true, summary: 'Mock critique — pass disabled in mock mode.', swaps: [] }
  }

  onProgress?.({ stage: 'critique' })
  const prompt = buildCritiquePrompt({ commander, bracket, deck, availablePool, chosenStrategy })
  try {
    const out = await callBackend(prompt)
    return { ...out, _meta: { promptTokens: estimatePromptTokens(prompt) } }
  } catch (err) {
    // Critique is best-effort. If it fails, ship the deck as-is.
    console.warn('[critique] pass failed, shipping deck without critique:', err?.message ?? err)
    return null
  }
}

/**
 * evaluateDeck — judge a finished deck. SEPARATE from critiqueDeck.
 *
 * Critique tries to FIX (proposes swaps). Evaluation just SCORES.
 * Used by the eval harness to grade many decks across many commanders.
 *
 * Returns: { score, summary, strengths[], weaknesses[], bracketFitNotes }
 * Returns null if the LLM is disabled or the call fails — callers should
 * treat null as "evaluation unavailable" not "deck is bad".
 */
export async function evaluateDeck({ commander, bracket, deck, criticalCardCounts, detectedWincons, executionScore, onProgress }) {
  if (currentMode === LLM_MODE.DISABLED) return null
  if (currentMode === LLM_MODE.MOCK) {
    return {
      score: 7,
      summary: 'Mock evaluation — pass disabled in mock mode.',
      strengths: ['Mock mode is deterministic for tests.'],
      weaknesses: ['No real judgment available.'],
      bracketFitNotes: 'Mock — bypassed real LLM.',
      _meta: { mode: 'mock' },
    }
  }

  onProgress?.({ stage: 'evaluate' })
  const prompt = buildEvaluationPrompt({ commander, bracket, deck, criticalCardCounts, detectedWincons, executionScore })
  try {
    const out = await callBackend(prompt)
    const withMeta = { ...out, _meta: { promptTokens: estimatePromptTokens(prompt) } }
    // Post-process: clamp the LLM's score down if the deck has severe
    // quality issues the model failed to weigh appropriately. The clamp
    // returns the same object when no clamp is needed (no false positives).
    const trueFiller = deck.filter(c => (c.roles ?? [])[0] === 'filler').length
    return clampEvalScore(withMeta, {
      bracket,
      fillerCount: trueFiller,
      fillerCap:   FILLER_CAP_BY_BRACKET[bracket],
      wincons:     criticalCardCounts?.wincons ?? 0,
      detectedWincons,
      executionScore:     executionScore?.score,
      executionThreshold: getExecutionThresholdForBracket(bracket),
    })
  } catch (err) {
    const msg = err?.message ?? String(err)
    console.warn('[evaluate] pass failed:', msg)
    // Return a structured failure object instead of null so the eval
    // harness JSON captures the specific error (rate limit, 504, etc.).
    // The eval-store's null-check still treats this as "failed" — the
    // shape just carries more info now.
    return {
      score: null,
      summary: `Eval call failed: ${msg}`,
      strengths: [],
      weaknesses: [],
      bracketFitNotes: '',
      _meta: { mode: 'error', error: msg },
    }
  }
}

// Parse OpenAI's "Please try again in Nms" / "Ns" hint from a 429 error
// body. Returns milliseconds to wait, capped at MAX_429_BACKOFF_MS so a
// pathological "try again in 5 minutes" doesn't hang an eval run.
//
// Examples of strings we expect to see:
//   "Please try again in 719ms"
//   "Please try again in 1.5s"
//   "Please try again in 30s"
const MAX_429_BACKOFF_MS = 10_000   // cap individual retry sleep at 10s
const DEFAULT_429_BACKOFF_MS = 2_000

export function parseRetryAfterMs(errorMessage) {
  if (typeof errorMessage !== 'string') return DEFAULT_429_BACKOFF_MS
  // Match "in 719ms" or "in 1.5s" or "in 30s"
  const msMatch = errorMessage.match(/try again in\s+(\d+(?:\.\d+)?)\s*ms/i)
  if (msMatch) {
    const ms = Number(msMatch[1])
    return Math.min(Math.max(ms, 200), MAX_429_BACKOFF_MS)
  }
  const sMatch = errorMessage.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (sMatch) {
    const ms = Number(sMatch[1]) * 1000
    return Math.min(Math.max(ms, 200), MAX_429_BACKOFF_MS)
  }
  return DEFAULT_429_BACKOFF_MS
}

// POSTs the prompt to /api/llm and returns the parsed JSON content. The
// serverless function attaches OPENAI_API_KEY (server-side) and forwards
// to OpenAI; the browser never sees the key.
//
// Retry policy:
//   - 504/502 (Vercel/OpenAI gateway timeouts) — retry once after 1.5s
//   - 429 (rate limit) — retry up to 2 times, each time waiting the
//     duration OpenAI's error body recommends ("try again in 719ms").
//     Capped at 10s per wait so a stuck eval run can't hang for minutes.
//   - Network errors (fetch threw) — retry once
//   - All other 4xx/5xx — bail (request is wrong; retry won't help)
async function callBackend(prompt) {
  let lastErr
  const MAX_ATTEMPTS = 3   // 1 initial + up to 2 retries (for 429 chains)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: prompt.system, user: prompt.user }),
      })

      if (res.ok) {
        const data = await res.json()
        if (!data?.content) throw new Error('LLM backend returned no content.')
        return data.content
      }

      // Parse error body for context
      let body = null
      try { body = await res.json() } catch { /* non-JSON */ }
      const errMsg = body?.error ?? `LLM backend returned ${res.status}`
      lastErr = new Error(errMsg)

      // 429 — token-per-minute rate limit. OpenAI tells us how long to wait.
      // Always retry within MAX_ATTEMPTS budget.
      if (res.status === 429 && attempt < MAX_ATTEMPTS - 1) {
        const waitMs = parseRetryAfterMs(errMsg)
        console.warn(`[LLM] 429 rate limit on attempt ${attempt + 1}, waiting ${waitMs}ms then retrying…`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }

      // 502/504 — Vercel/OpenAI gateway timeout. Retry ONCE only (first
      // attempt). A second retry rarely helps for genuine timeouts.
      if ((res.status === 502 || res.status === 504) && attempt === 0) {
        console.warn(`[LLM] ${res.status} on attempt 1, retrying once…`)
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      throw lastErr
    } catch (err) {
      lastErr = err
      // Network errors (fetch threw) — retry once
      if (attempt === 0 && err.message?.includes('fetch')) {
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr
}

function mockLLMResponse({ commander, legalCardPool, bracket, deckRules, promptTokens }) {
  // Group the pool by primary role so we can fake "the LLM picked balanced roles"
  const byRole = {}
  for (const c of legalCardPool) {
    const role = (c.roles ?? ['filler'])[0]
    if (!byRole[role]) byRole[role] = []
    byRole[role].push(c)
  }

  const targets = deckRules.targetCounts ?? {}
  const landTarget = deckRules.landTarget ?? 37
  const wantedByRole = {
    land:          landTarget,
    ramp:          targets.ramp ?? 10,
    draw:          targets.draw ?? 10,
    removal:       targets.removal ?? 9,
    wipe:          targets.wipe ?? 4,
    protection:    targets.protection ?? 3,
    win_condition: targets.win_condition ?? 2,
    tutor:         targets.tutor ?? 0,
    synergy:       targets.synergy ?? 20,
  }

  const picked = []
  const usedNames = new Set()
  for (const [role, want] of Object.entries(wantedByRole)) {
    const pool = (byRole[role] ?? []).filter(c => !usedNames.has(c.name))
    for (let i = 0; i < want && i < pool.length && picked.length < 99; i++) {
      picked.push({
        name: pool[i].name,
        role,
        reason: `Mock pick: ${role} slot from pre-filtered pool.`,
      })
      usedNames.add(pool[i].name)
    }
  }
  // Pad with filler / leftovers so we hit 99 if possible
  for (const card of legalCardPool) {
    if (picked.length >= 99) break
    if (usedNames.has(card.name)) continue
    picked.push({ name: card.name, role: 'filler', reason: 'Mock filler.' })
    usedNames.add(card.name)
  }

  // Intentionally inject 1 obviously-fake card name to make sure the validator
  // catches LLM hallucinations even in mock mode. The orchestrator should
  // surface this as a warning and replace it via the heuristic fallback.
  if (picked.length > 0) {
    picked[picked.length - 1] = {
      name: 'Definitely Not A Real Card',
      role: 'synergy',
      reason: 'Mock hallucination — should be caught by validator.',
    }
  }

  // Pick a few non-land cards to act as the "core engine" for the mock.
  const coreEngine = picked
    .filter(p => p.role !== 'land' && p.role !== 'filler')
    .slice(0, 15)
    .map(p => ({ name: p.name, reason: `Mock core engine pick (${p.role}).` }))

  const roleCount = (r) => picked.filter(p => p.role === r).length
  const totalNonLand = picked.length - roleCount('land')
  const synergyCount = roleCount('synergy') + roleCount('win_condition') + coreEngine.length
  const strategyDensity = totalNonLand > 0 ? Math.round((synergyCount / totalNonLand) * 100) : 0

  return {
    chosenStrategy: `Chosen Strategy: Mock plan around ${commander.name} — replace with a real LLM call to see an actual strategy commitment.`,
    strategySummary: {
      primaryStrategy: `Mock primary strategy built around ${commander.name} at bracket ${bracket}.`,
      secondaryStrategy: 'Mock secondary strategy — replace with a real LLM call.',
      winPlan: 'Mock win plan — assemble the engine, protect the commander, close out the game.',
    },
    coreEngine,
    deck: picked,
    deckStats: {
      lands: roleCount('land'),
      ramp: roleCount('ramp'),
      draw: roleCount('draw'),
      removal: roleCount('removal'),
      boardWipes: roleCount('wipe'),
      protection: roleCount('protection'),
      winConditions: roleCount('win_condition'),
      strategyDensityEstimate: strategyDensity,
    },
    weakIncludes: [],
    winConditionDetails: [
      {
        name: 'Mock win condition',
        howItWins: 'Mock plan — replace with a real LLM call to see actual win-condition validation.',
        requiredBoardState: 'N/A (mock)',
        estimatedTurnsToWin: 0,
        keySupportingCards: [],
      },
    ],
    warnings: ['This deck was generated by the mock LLM service. Replace with a real backend call to get strategy-aware suggestions.'],
    _meta: { mode: currentMode, promptTokens },
  }
}
