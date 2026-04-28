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

import { buildDeckGenerationPrompt, estimatePromptTokens } from './llmPromptBuilder'

// Toggle the mock on/off without editing call sites. The hybrid orchestrator
// reads this and falls back to the heuristic generator if the LLM is "down".
export const LLM_MODE = {
  DISABLED: 'disabled',     // throw — force heuristic fallback
  MOCK:     'mock',         // return a fake response for development
  LIVE:     'live',         // hit the real backend (not implemented)
}

// Default to MOCK during development so the AI Assisted toggle in the UI
// has *something* to render. Flip to DISABLED to test the fallback path.
let currentMode = LLM_MODE.MOCK

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
}) {
  if (!commander) throw new Error('generateDeckWithLLM: commander is required')
  if (!Array.isArray(legalCardPool) || legalCardPool.length === 0) {
    throw new Error('generateDeckWithLLM: legalCardPool is empty — pre-filter produced no cards')
  }

  const prompt = buildDeckGenerationPrompt({
    commander,
    legalCardPool,
    bracket,
    deckRules,
    strategyContext,
  })
  const promptTokens = estimatePromptTokens(prompt)

  if (currentMode === LLM_MODE.DISABLED) {
    throw new Error('LLM integration not connected yet — set LLM_MODE to MOCK or LIVE.')
  }

  if (currentMode === LLM_MODE.LIVE) {
    // Wired up later. The fetch must point at OUR backend, never directly at
    // OpenAI/Anthropic. The backend reads the key from a server-side secret
    // store, not from the browser.
    //
    //   const res = await fetch('/api/generate-deck', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify(prompt),
    //   })
    //   if (!res.ok) throw new Error(`LLM backend ${res.status}`)
    //   const data = await res.json()
    //   return { ...data, _meta: { mode: 'live', promptTokens } }
    throw new Error('LLM integration not connected yet — backend endpoint not implemented.')
  }

  // MOCK mode — return a deterministic, mostly-legal deck assembled from the
  // pre-filtered pool so the validator and orchestrator have realistic input
  // to work with during development. This is NOT a real strategy; it just
  // lets us exercise the full pipeline end-to-end without paying for tokens.
  return mockLLMResponse({ commander, legalCardPool, bracket, deckRules, promptTokens })
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
