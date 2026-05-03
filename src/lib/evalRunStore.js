// Out-of-component state for the eval harness run loop.
//
// Same problem as generationStore (single deck): if the loop lives inside a
// React component, navigating away unmounts the component and any pending
// Promises become orphaned — their state writes go to a dead component, the
// run silently dies, and the user comes back to find no progress.
//
// Fix: the loop lives in a module-level singleton. Components subscribe via
// useSyncExternalStore. The Promise chain runs against the singleton's
// state, not the component's. Navigating away → component unmounts → store
// keeps running → component remounts → re-subscribes and sees current state.
//
// Anti-oscillation: a pause token invalidates the in-flight loop when a new
// run starts. Token mismatch → all writes from the old loop become no-ops.
//
// Persistence: every state change is mirrored to localStorage so a tab
// crash or reload doesn't lose results. Resuming reads from localStorage.

import { useSyncExternalStore } from 'react'
import { getSelectedCommander, saveSelectedCommander } from '../utils/localStorage'
import { generateDeckWithLLMAssist } from '../services/llmDeckOrchestrator'
import { evaluateDeck } from '../services/llmDeckService'

const STORAGE_KEY = 'deckify-eval-run-store'

let state = {
  status: 'idle',          // 'idle' | 'running' | 'paused' | 'done' | 'error'
  results: loadPersisted(),
  currentLabel: '',
  errorMsg: null,
  // Token to invalidate the in-flight loop when a new run starts. Set to a
  // fresh Symbol when run starts; the loop checks `state.runToken === token`
  // before each step to detect cancellation.
  runToken: null,
}
let pauseRequested = false

const listeners = new Set()

function notify() { for (const fn of listeners) fn() }

function update(next) {
  state = { ...state, ...next }
  if (state.results) persist(state.results)
  notify()
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function persist(results) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(results)) } catch { /* quota - ignore */ }
}
function clearPersisted() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
}

export function getState() { return state }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function useEvalRunStore() { return useSyncExternalStore(subscribe, getState) }

// Kick off a fresh run.
export function startEvalRun({ commanders, brackets }) {
  const token = Symbol('eval-run')
  pauseRequested = false

  const fresh = newRunResults(commanders, brackets)
  update({
    status: 'running',
    results: fresh,
    currentLabel: '',
    errorMsg: null,
    runToken: token,
  })

  runLoop(commanders, brackets, fresh, token)
}

// Resume a paused run. Picks up where it left off based on persisted results.
export function resumeEvalRun({ commanders, brackets }) {
  const token = Symbol('eval-run')
  pauseRequested = false
  const results = state.results
  if (!results) return startEvalRun({ commanders, brackets })

  update({
    status: 'running',
    currentLabel: '',
    errorMsg: null,
    runToken: token,
  })

  runLoop(commanders, brackets, results, token)
}

// Pause the in-flight loop. The check fires at every iteration boundary, so
// up to one in-flight deck-gen + eval will complete before the loop yields.
export function pauseEvalRun() {
  pauseRequested = true
  update({ status: 'paused' })
}

// Discard the run. Wipes persisted results.
export function resetEvalRun() {
  pauseRequested = true   // halts any in-flight loop
  update({ status: 'idle', results: null, currentLabel: '', errorMsg: null, runToken: null })
  clearPersisted()
}

// ─── the loop itself ─────────────────────────────────────────────────────

async function runLoop(commanders, brackets, results, token) {
  const originalCommander = getSelectedCommander()

  try {
    for (const cmdr of commanders) {
      if (state.runToken !== token || pauseRequested) break

      // Switch the selected commander for this batch (orchestrator reads
      // it from localStorage)
      saveSelectedCommander(cmdr)
      const cmdrEntry = results.commanders.find(c => c.name === cmdr.name)
      if (!cmdrEntry) continue

      for (const bracket of brackets) {
        if (state.runToken !== token || pauseRequested) break

        // Skip brackets we've already completed in a prior session
        if (cmdrEntry.brackets.find(b => b.bracket === bracket)) continue

        update({ currentLabel: `${cmdr.name} · Bracket ${bracket}` })

        let deckResult, evalResult
        try {
          deckResult = await generateDeckWithLLMAssist(bracket, null, { twoPass: true })
          if (deckResult?.error) throw new Error(deckResult.error)

          // Use the EFFECTIVE post-cap bracket for evaluation. If the user
          // requested B5 for a Krenko-class commander, the deck was actually
          // built at B4 — judging it against B5 standards is unfair and
          // produces score-6 outputs that read like "feels like a B4 deck"
          // (because it IS a B4 deck).
          const effectiveBracket = deckResult.bracketAnalysis?.targetBracket ?? bracket
          evalResult = await evaluateDeck({
            commander: cmdr,
            bracket: effectiveBracket,
            deck: deckResult.mainDeck,
            lensResults: deckResult.lensResults,
          })
        } catch (err) {
          if (state.runToken !== token) return
          cmdrEntry.brackets.push({
            bracket,
            error: String(err?.message ?? err),
            completedAt: new Date().toISOString(),
          })
          update({ results: { ...results } })
          continue
        }

        if (state.runToken !== token) return
        cmdrEntry.brackets.push({
          bracket,
          deckSize: deckResult.mainDeck.length,
          actualBracket: deckResult.bracketAnalysis?.actualBracket ?? null,
          warnings: (deckResult.warnings ?? [])
            .filter(w => w.severity === 'warning' || w.severity === 'error')
            .map(w => w.message),
          // Phase 8: orchestrator no longer returns these fields. Compute
          // from the deck for display in the eval-harness JSON. Helpers
          // remain exported (they're still used inside the orchestrator
          // and lenses).
          criticalCardCounts: (() => {
            // Phase 2.2: fold detected multi-card patterns into the
            // user-facing wincon count so eval JSON doesn't say
            // "wincons: 1" when the deck has a clear aristocrats engine.
            // Named wincons stay separate as `namedWincons` for any
            // consumer that wants the strict count; `wincons` becomes
            // "named wincons + detected patterns" for display.
            const counts = countCriticalCards(deckResult.mainDeck)
            const patterns = (deckResult.lensResults ?? [])
              .find(r => r.name === 'win_plan')?._raw?.detectedPatterns ?? []
            return {
              ...counts,
              namedWincons: counts.wincons,
              wincons: counts.wincons + patterns.length,
            }
          })(),
          detectedWincons: (deckResult.lensResults ?? [])
            .find(r => r.name === 'win_plan')?._raw?.detectedPatterns ?? [],
          evaluation: evalResult ?? {
            score: null,
            summary: 'Eval call failed',
            topStrength: '',
            strengths: [],
            weaknesses: [],
            bracketFitVerdict: null,
            bracketFitNotes: '',
          },
          completedAt: new Date().toISOString(),
        })
        update({ results: { ...results } })
      }
    }

    if (state.runToken === token) {
      results.completedAt = new Date().toISOString()
      update({
        results: { ...results },
        status: pauseRequested ? 'paused' : 'done',
        currentLabel: '',
      })
    }
  } catch (err) {
    if (state.runToken !== token) return
    update({ status: 'error', errorMsg: String(err?.message ?? err), currentLabel: '' })
  } finally {
    // Restore the user's original commander when the run ends, so going
    // back to /deck-builder after the run shows their normal commander.
    if (originalCommander && state.runToken === token) {
      saveSelectedCommander(originalCommander)
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function newRunResults(commanders, brackets) {
  return {
    runId: crypto.randomUUID?.() ?? `run-${Date.now()}`,
    startedAt: new Date().toISOString(),
    completedAt: null,
    plannedCommanders: commanders.map(c => c.name),
    plannedBrackets: brackets,
    commanders: commanders.map(c => ({
      name: c.name,
      colorIdentity: c.color_identity,
      brackets: [],
    })),
  }
}

function countCriticalCards(deck) {
  const tutors      = deck.filter(c => (c.tags ?? []).includes('tutor')).length
  const fastMana    = deck.filter(c => (c.tags ?? []).includes('fast_mana')).length
  const wincons     = deck.filter(c => (c.roles ?? []).includes('win_condition') ||
                                       (c.tags ?? []).includes('explosive_finisher')).length
  const interaction = deck.filter(c => (c.roles ?? []).includes('removal') ||
                                       (c.roles ?? []).includes('wipe')).length
  const ramp        = deck.filter(c => (c.roles ?? []).includes('ramp')).length
  return { tutors, fastMana, wincons, interaction, ramp }
}
