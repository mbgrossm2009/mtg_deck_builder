// Loads the signed-in user's data into dataStore on auth change.
//
// Sequence:
//   1. AuthProvider establishes session, sets user.
//   2. This effect fires, kicks off parallel fetches of profile, collection, decks.
//   3. dataStore.setState({ ...rows, ready: true }) — components that subscribe
//      via useDataStore re-render with real data.
//   4. On sign-out, dataStore.reset() wipes memory so nothing leaks across users.

import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import * as dataStore from '../lib/dataStore'
import { useAuth } from './AuthContext'
import { getTestCollectionFlag, buildTestCollection } from '../utils/testCollectionBuilder'

export function DataProvider({ children }) {
  const { user, loading: authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      // Visitor or just-signed-out user — clear any leftover state.
      dataStore.reset()
      return
    }

    let cancelled = false

    async function load() {
      // Mark not-ready first so RequireAuth shows its spinner if we're slow.
      dataStore.setState({ userId: user.id, ready: false })

      try {
        const [profileRes, collectionRes, decksRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('selected_commander_data')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('collections')
            .select('*')
            .eq('user_id', user.id),
          supabase
            .from('decks')
            .select('*')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false }),
        ])

        if (cancelled) return

        if (profileRes.error)    console.warn('profiles load error:',    profileRes.error)
        if (collectionRes.error) console.warn('collections load error:', collectionRes.error)
        if (decksRes.error)      console.warn('decks load error:',       decksRes.error)

        dataStore.setState({
          userId:     user.id,
          commander:  profileRes.data?.selected_commander_data ?? null,
          collection: (collectionRes.data ?? []).map(rowToCollectionCard),
          decks:      (decksRes.data      ?? []).map(rowToDeck),
          ready:      true,
        })

        // If the user had the test collection active before reload, rebuild
        // it now from the cached Scryfall bulk data and replace the
        // collection. Fast (~3s) because Scryfall data is in IndexedDB.
        // Without this, hard reloads kill the test collection.
        const testFlag = getTestCollectionFlag()
        if (testFlag?.preset) {
          try {
            console.log('[DataContext] Test collection mode active — rebuilding from cache…')
            const cards = await buildTestCollection({ preset: testFlag.preset })
            if (!cancelled) {
              dataStore.setState(s => ({ ...s, collection: cards }))
              console.log(`[DataContext] Test collection restored: ${cards.length} cards`)
            }
          } catch (err) {
            console.warn('[DataContext] Failed to rebuild test collection:', err?.message ?? err)
            // Leave the user with their real Supabase collection — better than
            // an empty collection. They can manually re-load the test collection.
          }
        }
      } catch (err) {
        if (cancelled) return
        console.error('DataProvider: failed to load user data', err)
        // Still mark ready so the UI doesn't hang on a spinner forever.
        dataStore.setState({ ready: true })
      }
    }

    load()
    return () => { cancelled = true }
  }, [user, authLoading])

  return children
}

// Translate a `collections` row back into the shape the app's existing code
// expects. The JSONB `data` column holds the full trimmed Scryfall card; the
// row columns hold per-user metadata (quantity, validation flags).
function rowToCollectionCard(row) {
  const data = row.data ?? {}
  return {
    ...data,
    id:               row.card_id,
    quantity:         row.quantity,
    needsValidation:  row.needs_validation,
    validationFailed: row.validation_failed,
    addedAt:          row.added_at,
  }
}

function rowToDeck(row) {
  return {
    id:        row.id,
    name:      row.name,
    commander: row.commander_data,
    mainDeck:  row.main_deck,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// The hook for reading the store lives next to the store itself:
//   import { useDataStore } from '../lib/dataStore'
