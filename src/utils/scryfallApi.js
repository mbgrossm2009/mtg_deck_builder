const BASE_URL = 'https://api.scryfall.com'

export async function searchCards(query) {
  const res = await fetch(`${BASE_URL}/cards/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error('Scryfall search failed')
  return res.json()
}

export async function getCardByName(name) {
  const exact = await fetch(`${BASE_URL}/cards/named?exact=${encodeURIComponent(name)}`)
  if (exact.ok) return exact.json()
  // Fall back to fuzzy matching so minor name variations still resolve
  const fuzzy = await fetch(`${BASE_URL}/cards/named?fuzzy=${encodeURIComponent(name)}`)
  if (!fuzzy.ok) throw new Error('Card not found')
  return fuzzy.json()
}

// Fetches up to 75 cards per request using the /cards/collection endpoint.
// Optionally falls back to fuzzy matching for cards the batch couldn't find.
//
// Options:
//   onBatchDone — called with byLookupName after the batch pass, before fuzzy.
//                 Use this to save partial progress to localStorage.
//   onProgress  — called with { processed, total, phase } after each chunk and
//                 each fuzzy lookup. phase is 'batch' | 'fuzzy'. Use this to
//                 drive a progress bar in the UI.
//   maxFuzzy    — cap on fuzzy lookups (default 100). Prevents thousands of
//                 sequential API calls when a collection has many bad names.
//
// Returns { byLookupName, notFound, fuzzyResolved, fuzzySkipped }
export async function getCardsByNames(names, { onBatchDone, onProgress, maxFuzzy = 100 } = {}) {
  const CHUNK = 75
  const byLookupName = {}
  const batchNotFound = []
  const fuzzyResolved = []
  const notFound = []

  const reportProgress = (processed, total, phase) => {
    if (onProgress) {
      try { onProgress({ processed, total, phase }) } catch { /* never let UI callbacks break the fetch */ }
    }
  }

  // First pass: batch exact-name lookup
  for (let i = 0; i < names.length; i += CHUNK) {
    if (i > 0) await new Promise(r => setTimeout(r, 100))
    const chunk = names.slice(i, i + CHUNK)
    const res = await fetch(`${BASE_URL}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map(n => ({ name: n })) }),
    })
    if (!res.ok) throw new Error(`Scryfall collection fetch failed: ${res.status}`)
    const data = await res.json()

    const byCanonical = {}
    for (const card of (data.data ?? [])) {
      byCanonical[card.name.toLowerCase()] = card
      if (card.card_faces) {
        for (const face of card.card_faces) {
          if (face.name) byCanonical[face.name.toLowerCase()] = card
        }
      }
    }

    for (const name of chunk) {
      const card = byCanonical[name.toLowerCase()]
      if (card) byLookupName[name.toLowerCase()] = card
      else      batchNotFound.push(name)
    }

    reportProgress(Math.min(i + CHUNK, names.length), names.length, 'batch')
  }

  // Save partial progress before slow fuzzy pass
  if (onBatchDone) onBatchDone(byLookupName)

  // Second pass: fuzzy fallback for typos (capped to avoid hammering the API)
  const fuzzyTargets = batchNotFound.slice(0, maxFuzzy)
  const fuzzySkipped = batchNotFound.slice(maxFuzzy)

  for (let i = 0; i < fuzzyTargets.length; i++) {
    const name = fuzzyTargets[i]
    await new Promise(r => setTimeout(r, 110))
    try {
      const res = await fetch(`${BASE_URL}/cards/named?fuzzy=${encodeURIComponent(name)}`)
      if (res.ok) {
        const card = await res.json()
        byLookupName[name.toLowerCase()] = card
        if (card.name.toLowerCase() !== name.toLowerCase()) {
          fuzzyResolved.push({ input: name, resolved: card.name })
        }
      } else {
        notFound.push(name)
      }
    } catch {
      notFound.push(name)
    }
    reportProgress(i + 1, fuzzyTargets.length, 'fuzzy')
  }

  notFound.push(...fuzzySkipped)
  return { byLookupName, notFound, fuzzyResolved, fuzzySkipped: fuzzySkipped.length }
}

// Searches for legal commanders matching the given name query
export async function searchCommanders(query) {
  const q = encodeURIComponent(`is:commander ${query}`)
  const res = await fetch(`${BASE_URL}/cards/search?q=${q}`)
  // 404 = no results, not a real error
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`)
  const data = await res.json()
  return data.data ?? []
}

// Returns the best available image URL, handling double-faced cards
export function getCardImage(card) {
  if (card.image_uris?.normal)                    return card.image_uris.normal
  if (card.image_uris?.small)                     return card.image_uris.small
  if (card.card_faces?.[0]?.image_uris?.normal)   return card.card_faces[0].image_uris.normal
  if (card.card_faces?.[0]?.image_uris?.small)    return card.card_faces[0].image_uris.small
  return null
}

// Small thumbnail (~30KB) — use for grid views to avoid memory blowup at scale
export function getCardImageSmall(card) {
  if (card.image_uris?.small)                     return card.image_uris.small
  if (card.card_faces?.[0]?.image_uris?.small)    return card.card_faces[0].image_uris.small
  if (card.image_uris?.normal)                    return card.image_uris.normal
  if (card.card_faces?.[0]?.image_uris?.normal)   return card.card_faces[0].image_uris.normal
  return null
}
