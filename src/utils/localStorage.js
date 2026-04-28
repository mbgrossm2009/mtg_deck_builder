const KEY = 'selectedCommander'
const COLLECTION_KEY = 'cardCollection'
const DECKS_KEY = 'savedDecks'

// Custom error thrown when localStorage runs out of space.
// Most browsers throw a DOMException with name 'QuotaExceededError' or code 22,
// but the exact shape varies (Safari uses NS_ERROR_DOM_QUOTA_REACHED, Firefox
// uses NS_ERROR_DOM_QUOTA_REACHED, etc.). We normalize.
export class StorageQuotaError extends Error {
  constructor(action) {
    super(`Browser storage is full. Could not ${action}. Try removing some saved decks or shrinking your collection.`)
    this.name = 'StorageQuotaError'
    this.userMessage = this.message
  }
}

function isQuotaError(err) {
  if (!err) return false
  if (err.name === 'QuotaExceededError') return true
  if (err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if (err.code === 22 || err.code === 1014) return true
  return false
}

// Safe setItem wrapper. Throws StorageQuotaError on quota failure so callers
// can show a clear user-visible message instead of crashing the UI.
function setItemSafe(key, value, action = 'save') {
  try {
    localStorage.setItem(key, value)
  } catch (err) {
    if (isQuotaError(err)) {
      throw new StorageQuotaError(action)
    }
    throw err
  }
}

export function getSelectedCommander() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveSelectedCommander(card) {
  const data = {
    id:             card.id,
    name:           card.name,
    type_line:      card.type_line,
    oracle_text:    card.oracle_text    ?? '',
    mana_cost:      card.mana_cost      ?? '',
    cmc:            card.cmc            ?? 0,
    color_identity: card.color_identity ?? [],
    colors:         card.colors         ?? [],
    image_uris:     card.image_uris     ?? null,
    card_faces:     card.card_faces     ?? null,
    legalities:     card.legalities     ?? null,
  }
  setItemSafe(KEY, JSON.stringify(data), 'save your selected commander')
}

export function clearSelectedCommander() {
  localStorage.removeItem(KEY)
}

export function getCollection() {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addToCollection(card) {
  const collection = getCollection()
  if (collection.some(c => c.id === card.id)) return false
  const data = {
    id:             card.id,
    name:           card.name,
    type_line:      card.type_line,
    oracle_text:    card.oracle_text    ?? '',
    mana_cost:      card.mana_cost      ?? '',
    cmc:            card.cmc            ?? 0,
    color_identity: card.color_identity ?? [],
    colors:         card.colors         ?? [],
    image_uris:     card.image_uris     ?? null,
    card_faces:     card.card_faces     ?? null,
    legalities:     card.legalities     ?? null,
    rarity:         card.rarity         ?? null,
    addedAt:        new Date().toISOString(),
  }
  setItemSafe(COLLECTION_KEY, JSON.stringify([...collection, data]), 'add card to collection')
  return true
}

export function removeFromCollection(cardId) {
  const collection = getCollection().filter(c => c.id !== cardId)
  setItemSafe(COLLECTION_KEY, JSON.stringify(collection), 'remove card from collection')
}

// Drops every card flagged as not found on Scryfall.
// Returns the number removed so the UI can show feedback.
export function removeFailedCards() {
  const before = getCollection()
  const after = before.filter(c => !c.validationFailed)
  setItemSafe(COLLECTION_KEY, JSON.stringify(after), 'clean failed cards')
  return before.length - after.length
}

export function isInCollection(cardId) {
  return getCollection().some(c => c.id === cardId)
}

export function updateCollectionCard(cardId, updates) {
  const collection = getCollection()
  const idx = collection.findIndex(c => c.id === cardId)
  if (idx === -1) return
  collection[idx] = { ...collection[idx], ...updates }
  setItemSafe(COLLECTION_KEY, JSON.stringify(collection), 'update card')
}

// Single write — use this when updating many cards at once to avoid
// re-parsing/re-serializing the entire collection thousands of times.
export function saveCollection(cards) {
  setItemSafe(COLLECTION_KEY, JSON.stringify(cards), 'save collection')
}

export function clearCollection() {
  localStorage.removeItem(COLLECTION_KEY)
}

// Strips Scryfall response down to just the fields the app uses.
// Cuts ~70% of per-card storage (legalities has 25 keys, image_uris has 6 sizes).
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

export function getDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function getDeck(id) {
  return getDecks().find(d => d.id === id) ?? null
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

// Upsert by id. New decks get a generated id + createdAt; updatedAt is always refreshed.
// Returns the saved deck (with id/timestamps).
export function saveDeck({ id, name, commander, mainDeck }) {
  const decks = getDecks()
  const now = new Date().toISOString()
  const trimmedCards = (mainDeck ?? []).map(trimDeckCard)
  const trimmedCommander = commander ? {
    id:             commander.id,
    name:           commander.name,
    type_line:      commander.type_line   ?? '',
    mana_cost:      commander.mana_cost   ?? '',
    cmc:            commander.cmc         ?? 0,
    color_identity: commander.color_identity ?? [],
    colors:         commander.colors      ?? [],
    image_uris:     commander.image_uris  ?? null,
    card_faces:     commander.card_faces  ?? null,
  } : null

  const existingIdx = id ? decks.findIndex(d => d.id === id) : -1
  if (existingIdx !== -1) {
    const next = {
      ...decks[existingIdx],
      name,
      commander: trimmedCommander,
      mainDeck: trimmedCards,
      updatedAt: now,
    }
    decks[existingIdx] = next
    setItemSafe(DECKS_KEY, JSON.stringify(decks), 'save deck')
    return next
  }

  const newDeck = {
    id:        (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    commander: trimmedCommander,
    mainDeck:  trimmedCards,
    createdAt: now,
    updatedAt: now,
  }
  decks.push(newDeck)
  setItemSafe(DECKS_KEY, JSON.stringify(decks), 'save deck')
  return newDeck
}

export function deleteDeck(id) {
  const decks = getDecks().filter(d => d.id !== id)
  setItemSafe(DECKS_KEY, JSON.stringify(decks), 'save deck')
}

// TODO: Before inserting, validate each name against Scryfall /cards/named?exact=
// to enrich with full card data. needsValidation: true marks cards for later enrichment.
export function addImportedCardsToCollection(importedCards) {
  const collection = getCollection()
  let added = 0
  let updated = 0

  for (const card of importedCards) {
    const existingIdx = collection.findIndex(
      c => c.name.toLowerCase() === card.name.toLowerCase()
    )
    if (existingIdx !== -1) {
      collection[existingIdx].quantity = (collection[existingIdx].quantity ?? 1) + card.quantity
      updated++
    } else {
      collection.push({
        id:             'imported_' + card.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        name:           card.name,
        quantity:       card.quantity,
        needsValidation: true,
        addedAt:        new Date().toISOString(),
        type_line:      '',
        oracle_text:    '',
        mana_cost:      '',
        cmc:            0,
        color_identity: [],
        colors:         [],
        image_uris:     null,
        card_faces:     null,
        legalities:     null,
      })
      added++
    }
  }

  setItemSafe(COLLECTION_KEY, JSON.stringify(collection), 'import cards')
  return { added, updated }
}
