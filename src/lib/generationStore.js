// Out-of-component state for deck generation.
//
// Why this exists: deck generation is a 90-120 second async operation. If it
// runs inside a React component (useState + useCallback), navigating away
// unmounts the component, the in-flight Promise is orphaned, and the result
// is lost. Worse: even a completed deck disappears the moment the user
// switches pages.
//
// This module owns the generation lifecycle:
//   - startGeneration() kicks off an async generator; the Promise lives here,
//     not in any component, so unmounting the page doesn't cancel it
//   - all state (status, stage, result, error) is mirrored to localStorage on
//     every change, so a completed result survives reloads and navigation
//   - useGenerationStore() exposes the live state to React components via
//     useSyncExternalStore, so any subscriber re-renders when state changes
//
// What it does NOT solve: if the user closes the browser tab entirely while
// generation is in flight, the OpenAI call continues server-side but there's
// no client to receive the result. That requires a job queue + webhook
// (out of scope for this fix).

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'deckify-last-generation'
// Persisted results are restored only if they're recent. Older results are
// stale (user probably wants a fresh start) and chew localStorage budget.
const RESULT_TTL_MS = 24 * 60 * 60 * 1000   // 24 hours

let state = {
  status: 'idle',           // 'idle' | 'generating' | 'done' | 'error'
  stage:  null,              // 'pass1' | 'pass2' | 'critique' | null (only during 'generating')
  result: null,              // the deck object returned by the generator
  error:  null,              // error message string (when status is 'error')
  bracket: null,             // captured at startGeneration time so the result has context
  primaryArchetype: null,
  // Token used to invalidate stale callbacks when a new generation starts
  // before an old one finishes. The promise itself doesn't get cancelled
  // (no AbortController in the generator), but its post-completion writes
  // to state are no-oped.
  inFlightToken: null,
}

const listeners = new Set()

function notify() {
  for (const fn of listeners) fn()
}

function persistDone() {
  try {
    if (state.status === 'done' && state.result && !state.result.error) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        result: state.result,
        bracket: state.bracket,
        primaryArchetype: state.primaryArchetype,
        savedAt: Date.now(),
      }))
    }
  } catch {
    // localStorage can throw on quota exceeded or in private browsing.
    // The result still lives in memory — we just lose the cross-reload survival.
  }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed?.result) return
    if (Date.now() - (parsed.savedAt ?? 0) > RESULT_TTL_MS) {
      // Stale — clear it so we don't restore.
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      return
    }
    state = {
      ...state,
      status: 'done',
      stage:  null,
      result: parsed.result,
      bracket: parsed.bracket ?? null,
      primaryArchetype: parsed.primaryArchetype ?? null,
    }
  } catch {
    // Bad JSON or unavailable storage — start clean.
  }
}

// Restore on module load so the very first useGenerationStore() call already
// has the persisted result if there is one.
loadPersisted()

function update(next) {
  state = { ...state, ...next }
  persistDone()
  notify()
}

export function getState() { return state }

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// React hook for components.
export function useGenerationStore() {
  return useSyncExternalStore(subscribe, getState)
}

// Kick off a generation. The generator is an async function that takes
// `{ onProgress }` and returns the result deck. Lives here (not in the
// component) so unmounting doesn't kill it.
//
// If a generation is already in flight, its callbacks are invalidated by
// bumping the token. The old Promise still resolves but its write becomes
// a no-op.
export function startGeneration({ bracket, primaryArchetype, generator }) {
  const token = Symbol('generation')
  update({
    status: 'generating',
    stage:  'pass1',
    result: null,
    error:  null,
    bracket,
    primaryArchetype,
    inFlightToken: token,
  })
  // Clear persisted result while generating — avoids a stale deck flashing
  // back if the user reloads mid-generation.
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }

  ;(async () => {
    try {
      const result = await generator({
        onProgress: ({ stage }) => {
          if (state.inFlightToken !== token) return  // stale generation
          update({ stage })
        },
      })
      if (state.inFlightToken !== token) return     // a newer generation started
      // Even successful generators can return { error: '...' } for partial failures.
      if (result?.error) {
        update({ status: 'error', stage: null, error: String(result.error), result: null })
      } else {
        update({ status: 'done', stage: null, result, error: null })
      }
    } catch (err) {
      if (state.inFlightToken !== token) return
      update({ status: 'error', stage: null, error: err?.message ?? String(err), result: null })
    }
  })()
}

// Explicit clear — used when the user navigates to a saved deck or starts
// fresh. The persisted result is wiped so the next page mount doesn't show
// a stale generation.
export function clearGeneration() {
  update({ status: 'idle', stage: null, result: null, error: null, inFlightToken: null, bracket: null, primaryArchetype: null })
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
}
