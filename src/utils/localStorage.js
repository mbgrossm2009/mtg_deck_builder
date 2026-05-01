// Storage layer.
//
// Historically backed by browser localStorage; now backed by Supabase. The
// file name is kept so existing imports don't have to change. Reads come from
// the in-memory dataStore (hydrated by DataContext on sign-in). Writes are
// optimistic: update dataStore immediately for instant UI feedback, then
// persist to Supabase in the background. Failures are logged to the console;
// for the polish phase we'll add toast feedback + retry queueing.
//
// The single async exception is `addImportedCardsToCollection`. A 10k-card
// import is a real round-trip we shouldn't fire-and-forget — callers await it.

import { supabase } from '../lib/supabase'
import * as dataStore from '../lib/dataStore'
import { notify } from '../lib/toast'

// Surface a storage failure to the user via toast AND log to console for
// debugging. Single helper so every error path looks the same.
function reportSupabaseError(action, error) {
  console.error(`${action} failed:`, error)
  notify(`Couldn't ${action} — try again or refresh.`, 'error')
}

// Kept for back-compat with any callers that still catch it. localStorage's
// quota constraint is gone, but if Supabase ever returns a quota-style error
// in the future we can re-throw this.
export class StorageQuotaError extends Error {
  constructor(action) {
    super(`Could not ${action}.`)
    this.name = 'StorageQuotaError'
    this.userMessage = this.message
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SHAPE HELPERS
// ─────────────────────────────────────────────────────────────────────────

// Strips Scryfall response down to just the fields the app uses. Big wins:
// legalities goes from 25 keys to 1, image_uris from 6 sizes to 2.
export function trimScryfallCard(data) {
  return {
    name:           data.name,
    type_line:      data.type_line   ?? '',
    oracle_text:    data.oracle_text ?? '',
    mana_cost:      data.mana_cost   ?? '',
    cmc:            data.cmc         ?? 0,
    color_identity: data.color_identity ?? [],
    colors:         data.colors         ?? [],
    image_uris:     data.image_uris ? {
      small:  data.image_uris.small,
      normal: data.image_uris.normal,
    } : null,
    card_faces: data.card_faces ? data.card_faces.map(f => ({
      name:        f.name,
      type_line:   f.type_line,
      oracle_text: f.oracle_text,
      mana_cost:   f.mana_cost,
      image_uris:  f.image_uris ? {
        small:  f.image_uris.small,
        normal: f.image_uris.normal,
      } : null,
    })) : null,
    legalities: data.legalities ? { commander: data.legalities.commander } : null,
    rarity:     data.rarity ?? null,
  }
}

function trimCommander(card) {
  return {
    id:             card.id,
    name:           card.name,
    type_line:      card.type_line   ?? '',
    oracle_text:    card.oracle_text ?? '',
    mana_cost:      card.mana_cost   ?? '',
    cmc:            card.cmc         ?? 0,
    color_identity: card.color_identity ?? [],
    colors:         card.colors      ?? [],
    image_uris:     card.image_uris  ?? null,
    card_faces:     card.card_faces  ?? null,
    legalities:     card.legalities  ?? null,
  }
}

function trimCollectionCard(card) {
  return {
    id:             card.id,
    name:           card.name,
    type_line:      card.type_line   ?? '',
    oracle_text:    card.oracle_text ?? '',
    mana_cost:      card.mana_cost   ?? '',
    cmc:            card.cmc         ?? 0,
    color_identity: card.color_identity ?? [],
    colors:         card.colors      ?? [],
    image_uris:     card.image_uris  ?? null,
    card_faces:     card.card_faces  ?? null,
    legalities:     card.legalities  ?? null,
    rarity:         card.rarity      ?? null,
  }
}

function trimDeckCard(card) {
  return {
    id:             card.id,
    name:           card.name,
    type_line:      card.type_line      ?? '',
    mana_cost:      card.mana_cost      ?? '',
    cmc:            card.cmc            ?? 0,
    color_identity: card.color_identity ?? [],
    colors:         card.colors         ?? [],
    image_uris:     card.image_uris     ?? null,
    card_faces:     card.card_faces     ?? null,
    roles:          card.roles          ?? [],
    tags:           card.tags           ?? [],
    quantity:       card.quantity       ?? 1,
  }
}

// Build the Supabase row payload for a collection card. The JSONB `data`
// column holds the trimmed Scryfall blob; the regular columns hold metadata
// the schema indexes (name) or that we filter on (validation flags).
function collectionRowFor(card, userId) {
  return {
    user_id:           userId,
    card_id:           card.id,
    name:              card.name,
    quantity:          card.quantity ?? 1,
    data:              trimCollectionCard(card),
    needs_validation:  card.needsValidation  ?? false,
    validation_failed: card.validationFailed ?? false,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SELECTED COMMANDER
// ─────────────────────────────────────────────────────────────────────────

export function getSelectedCommander() {
  return dataStore.getState().commander
}

export function saveSelectedCommander(card) {
  const trimmed = trimCommander(card)

  // Optimistic local update — the Commander page redraws instantly.
  dataStore.setState({ commander: trimmed })

  // Persist to profile in the background.
  const userId = dataStore.getState().userId
  if (!userId) return
  supabase
    .from('profiles')
    .update({
      selected_commander_id:   trimmed.id,
      selected_commander_data: trimmed,
    })
    .eq('id', userId)
    .then(({ error }) => {
      if (error) reportSupabaseError('save your commander', error)
    })
}

export function clearSelectedCommander() {
  dataStore.setState({ commander: null })

  const userId = dataStore.getState().userId
  if (!userId) return
  supabase
    .from('profiles')
    .update({ selected_commander_id: null, selected_commander_data: null })
    .eq('id', userId)
    .then(({ error }) => {
      if (error) reportSupabaseError('clear your commander', error)
    })
}

// ─────────────────────────────────────────────────────────────────────────
// COLLECTION
// ─────────────────────────────────────────────────────────────────────────

export function getCollection() {
  return dataStore.getState().collection
}

export function isInCollection(cardId) {
  return dataStore.getState().collection.some(c => c.id === cardId)
}

// Returns true if added, false if already present (mirrors original behavior
// so existing CommanderCard logic doesn't change).
export function addToCollection(card) {
  const state = dataStore.getState()
  if (state.collection.some(c => c.id === card.id)) return false

  const trimmed = {
    ...trimCollectionCard(card),
    quantity:        1,
    addedAt:         new Date().toISOString(),
    needsValidation: false,
    validationFailed: false,
  }

  // Optimistic local
  dataStore.setState(s => ({ ...s, collection: [...s.collection, trimmed] }))

  // Async persist
  const userId = state.userId
  if (userId) {
    supabase
      .from('collections')
      .insert(collectionRowFor(trimmed, userId))
      .then(({ error }) => {
        if (error) reportSupabaseError('add card to collection', error)
      })
  }

  return true
}

export function removeFromCollection(cardId) {
  dataStore.setState(s => ({
    ...s,
    collection: s.collection.filter(c => c.id !== cardId),
  }))

  const userId = dataStore.getState().userId
  if (!userId) return
  supabase
    .from('collections')
    .delete()
    .eq('user_id', userId)
    .eq('card_id', cardId)
    .then(({ error }) => {
      if (error) reportSupabaseError('remove card from collection', error)
    })
}

// Drop every card flagged as not found on Scryfall. Returns the count removed.
export function removeFailedCards() {
  const state = dataStore.getState()
  const failedIds = state.collection.filter(c => c.validationFailed).map(c => c.id)

  if (failedIds.length === 0) return 0

  dataStore.setState(s => ({
    ...s,
    collection: s.collection.filter(c => !c.validationFailed),
  }))

  if (state.userId) {
    supabase
      .from('collections')
      .delete()
      .eq('user_id', state.userId)
      .in('card_id', failedIds)
      .then(({ error }) => {
        if (error) reportSupabaseError('remove failed cards', error)
      })
  }

  return failedIds.length
}

export function updateCollectionCard(cardId, updates) {
  const state = dataStore.getState()
  const idx = state.collection.findIndex(c => c.id === cardId)
  if (idx === -1) return

  const next = { ...state.collection[idx], ...updates }
  dataStore.setState(s => ({
    ...s,
    collection: s.collection.map(c => (c.id === cardId ? next : c)),
  }))

  if (state.userId) {
    supabase
      .from('collections')
      .update({
        name:              next.name,
        quantity:          next.quantity ?? 1,
        data:              trimCollectionCard(next),
        needs_validation:  next.needsValidation  ?? false,
        validation_failed: next.validationFailed ?? false,
      })
      .eq('user_id', state.userId)
      .eq('card_id', cardId)
      .then(({ error }) => {
        if (error) reportSupabaseError('update card data', error)
      })
  }
}

// Replaces the entire collection with `cards`. Used by the validation pass
// after Scryfall enrichment — the function callers pass in the full updated
// array. We diff and upsert/delete to keep things efficient even at 10k cards.
export function saveCollection(cards) {
  const state = dataStore.getState()
  const prevById  = new Map(state.collection.map(c => [c.id, c]))
  const nextById  = new Map(cards.map(c => [c.id, c]))
  const toUpsert  = []
  const toDelete  = []

  for (const card of cards) {
    const prev = prevById.get(card.id)
    // Upsert anything new or whose data changed.
    if (!prev || JSON.stringify(prev) !== JSON.stringify(card)) {
      toUpsert.push(card)
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) toDelete.push(id)
  }

  // Optimistic local — replace fully. Subscribers re-render once.
  dataStore.setState(s => ({ ...s, collection: cards }))

  if (!state.userId) return

  // Persist deletes
  if (toDelete.length > 0) {
    supabase
      .from('collections')
      .delete()
      .eq('user_id', state.userId)
      .in('card_id', toDelete)
      .then(({ error }) => {
        if (error) reportSupabaseError('save collection (delete pass)', error)
      })
  }

  // Persist upserts in batches of 500 — Supabase recommends keeping payloads
  // under ~1MB; at ~1KB per card row, 500 keeps us comfortably under.
  for (let i = 0; i < toUpsert.length; i += 500) {
    const chunk = toUpsert.slice(i, i + 500).map(c => collectionRowFor(c, state.userId))
    supabase
      .from('collections')
      .upsert(chunk, { onConflict: 'user_id,card_id' })
      .then(({ error }) => {
        if (error) reportSupabaseError('save collection (upsert pass)', error)
      })
  }
}

export function clearCollection() {
  dataStore.setState(s => ({ ...s, collection: [] }))

  const userId = dataStore.getState().userId
  if (!userId) return
  supabase
    .from('collections')
    .delete()
    .eq('user_id', userId)
    .then(({ error }) => {
      if (error) reportSupabaseError('clear collection', error)
    })
}

// Bulk import — async because thousands of inserts shouldn't be fire-and-forget.
// Caller should await and show a loading state.
export async function addImportedCardsToCollection(importedCards) {
  const state = dataStore.getState()
  const collection = [...state.collection]
  let added = 0
  let updated = 0
  const updatedRows = []
  const newRows     = []

  for (const card of importedCards) {
    const existingIdx = collection.findIndex(
      c => c.name.toLowerCase() === card.name.toLowerCase()
    )
    if (existingIdx !== -1) {
      const next = {
        ...collection[existingIdx],
        quantity: (collection[existingIdx].quantity ?? 1) + card.quantity,
      }
      collection[existingIdx] = next
      updated++
      updatedRows.push(next)
    } else {
      const newCard = {
        id:               'imported_' + card.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        name:             card.name,
        quantity:         card.quantity,
        needsValidation:  true,
        validationFailed: false,
        addedAt:          new Date().toISOString(),
        type_line:        '',
        oracle_text:      '',
        mana_cost:        '',
        cmc:              0,
        color_identity:   [],
        colors:           [],
        image_uris:       null,
        card_faces:       null,
        legalities:       null,
      }
      collection.push(newCard)
      added++
      newRows.push(newCard)
    }
  }

  // Local update first — the Collection page renders the full set immediately
  // even while server inserts are still in flight.
  dataStore.setState(s => ({ ...s, collection }))

  if (state.userId) {
    const allRows = [...updatedRows, ...newRows].map(c => collectionRowFor(c, state.userId))
    // Batched upsert. Each batch is awaited so the user sees errors if storage
    // ever throws (e.g., RLS misconfig).
    for (let i = 0; i < allRows.length; i += 500) {
      const chunk = allRows.slice(i, i + 500)
      const { error } = await supabase
        .from('collections')
        .upsert(chunk, { onConflict: 'user_id,card_id' })
      if (error) {
        reportSupabaseError('import cards (batch)', error)
        throw new Error(error.message)
      }
    }
  }

  return { added, updated }
}

// ─────────────────────────────────────────────────────────────────────────
// DECKS
// ─────────────────────────────────────────────────────────────────────────

export function getDecks() {
  return dataStore.getState().decks
}

export function getDeck(id) {
  return dataStore.getState().decks.find(d => d.id === id) ?? null
}

// Upsert by id. New decks get a client-generated UUID + createdAt; updatedAt
// is always refreshed. Returns the saved deck (with id/timestamps) so callers
// can navigate to it without awaiting the server round-trip.
export function saveDeck({ id, name, commander, mainDeck }) {
  const state = dataStore.getState()
  const now = new Date().toISOString()
  const trimmedCards = (mainDeck ?? []).map(trimDeckCard)
  const trimmedCommander = commander ? trimCommander(commander) : null

  const isUpdate = !!id && state.decks.some(d => d.id === id)
  const deckId   = id ?? newUuid()

  const deck = isUpdate
    ? {
        ...state.decks.find(d => d.id === id),
        name,
        commander: trimmedCommander,
        mainDeck:  trimmedCards,
        updatedAt: now,
      }
    : {
        id:        deckId,
        name,
        commander: trimmedCommander,
        mainDeck:  trimmedCards,
        createdAt: now,
        updatedAt: now,
      }

  dataStore.setState(s => ({
    ...s,
    decks: isUpdate
      ? s.decks.map(d => (d.id === id ? deck : d))
      : [deck, ...s.decks],
  }))

  if (state.userId) {
    if (isUpdate) {
      supabase
        .from('decks')
        .update({
          name,
          commander_data: trimmedCommander,
          main_deck:      trimmedCards,
        })
        .eq('id', deckId)
        .eq('user_id', state.userId)
        .then(({ error }) => {
          if (error) reportSupabaseError('save deck', error)
        })
    } else {
      supabase
        .from('decks')
        .insert({
          id:             deckId,
          user_id:        state.userId,
          name,
          commander_data: trimmedCommander,
          main_deck:      trimmedCards,
        })
        .then(({ error }) => {
          if (error) reportSupabaseError('save deck', error)
        })
    }
  }

  return deck
}

export function deleteDeck(id) {
  dataStore.setState(s => ({
    ...s,
    decks: s.decks.filter(d => d.id !== id),
  }))

  const userId = dataStore.getState().userId
  if (!userId) return
  supabase
    .from('decks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .then(({ error }) => {
      if (error) reportSupabaseError('delete deck', error)
    })
}

// ─────────────────────────────────────────────────────────────────────────

function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
