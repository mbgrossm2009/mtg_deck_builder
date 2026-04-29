import { useSyncExternalStore } from 'react'

// In-memory mirror of the signed-in user's Supabase data.
//
// Why this exists: the rest of the app calls sync functions like
// `getCollection()` and `getSelectedCommander()` from render and from event
// handlers, expecting them to return immediately. Supabase queries are async,
// so we hydrate this store once on sign-in (in DataContext.jsx) and serve
// every read from memory. Mutations write to Supabase AND update this store.
//
// React components subscribe via `useDataStore` (in contexts/DataContext.jsx)
// using useSyncExternalStore — when state changes here, every subscriber
// re-renders.

let state = {
  userId:     null,
  collection: [],
  commander:  null,
  decks:      [],
  ready:      false,
}

const listeners = new Set()

export function getState() {
  return state
}

// `next` may be a partial object (merged) or a function that takes prev state.
export function setState(next) {
  state = typeof next === 'function'
    ? next(state)
    : { ...state, ...next }
  listeners.forEach(fn => fn())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Called on sign-out to wipe everything from memory.
export function reset() {
  state = { userId: null, collection: [], commander: null, decks: [], ready: false }
  listeners.forEach(fn => fn())
}

// Hook for components that want to re-render whenever the store changes.
// Lives here (next to the store) rather than in DataContext so React Fast
// Refresh doesn't complain about non-component exports in the provider file.
export function useDataStore() {
  return useSyncExternalStore(subscribe, getState)
}
