// Server-side proxy to Moxfield's public API.
//
// Purpose: pull the top community decks for a given commander, aggregate the
// cards across them, and return frequency data ("this card appears in 4 of 5
// decks"). The orchestrator merges this with EDHREC inclusion data to build
// a stronger deck skeleton.
//
// Why a serverless function and not a direct browser call: Moxfield's API
// rejects browser-origin requests (CORS) and we want a single User-Agent to
// stay on their good side. The server also fetches deck pages in parallel,
// which is much faster than serial client fetches.
//
// Endpoint shape — all URLs as observed; defensive against shape changes:
//   Search:      GET https://api2.moxfield.com/v2/decks/search?fmt=commander&commanderName=<name>&pageSize=10&sortType=views&sortDirection=Descending
//   Deck detail: GET https://api2.moxfield.com/v3/decks/all/<publicId>
//
// Both endpoints sometimes change shape; every traversal is wrapped in
// optional chaining so unexpected shapes degrade to "no data" rather than
// throwing.

export const config = {
  // Search + N parallel deck fetches can take 5-15s on cold paths.
  maxDuration: 30,
}

const SEARCH_URL = 'https://api2.moxfield.com/v2/decks/search'
const DECK_URL   = 'https://api2.moxfield.com/v3/decks/all'

// How many top decks to aggregate. More = better consensus signal but more
// upstream calls. 10 is a good balance — enough that 3-of-10 frequency is
// still meaningful, few enough to fetch in 2 batches of 5.
const DECKS_TO_ANALYZE = 10
const PARALLEL_BATCH   = 5

const HEADERS = {
  Accept:        'application/json',
  // Moxfield community asks proxies to identify themselves so they can reach
  // out about issues. Replace this with your own contact if you fork.
  'User-Agent':  'Deckify/1.0 (https://deckify.app, contact via GitHub)',
}

// Module-level memoization. Survives across calls on a warm Vercel instance,
// gets wiped on cold start. TTL: 24h. Keyed on commander slug.
const CACHE = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { commander } = req.body ?? {}
  if (!commander || typeof commander !== 'string') {
    return res.status(400).json({ error: 'Request body must include a commander name string.' })
  }

  const cacheKey = commander.toLowerCase()
  const cached = CACHE.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, cached: true })
  }

  try {
    const data = await aggregateDecks(commander)
    CACHE.set(cacheKey, { fetchedAt: Date.now(), data })
    return res.status(200).json({ ...data, cached: false })
  } catch (err) {
    // Best-effort — return a structured empty result so the client can degrade
    // gracefully rather than treating the whole flow as broken.
    return res.status(200).json({
      decksAnalyzed: 0,
      totalDecksFound: 0,
      cards: [],
      error: `Moxfield aggregation failed: ${err?.message ?? String(err)}`,
    })
  }
}

async function aggregateDecks(commander) {
  // 1. Search for top decks
  const searchUrl = new URL(SEARCH_URL)
  searchUrl.searchParams.set('fmt', 'commander')
  searchUrl.searchParams.set('commanderName', commander)
  searchUrl.searchParams.set('pageSize', String(DECKS_TO_ANALYZE))
  searchUrl.searchParams.set('pageNumber', '1')
  searchUrl.searchParams.set('sortType', 'views')         // most-viewed → reliable proxy for "good"
  searchUrl.searchParams.set('sortDirection', 'Descending')
  searchUrl.searchParams.set('includePinned', 'false')

  const searchRes = await fetch(searchUrl.toString(), { headers: HEADERS })
  if (!searchRes.ok) {
    throw new Error(`Search returned ${searchRes.status}`)
  }
  const search = await searchRes.json()

  // Defensive: response shape varies between API versions. Try common paths.
  const deckList = search?.data ?? search?.decks ?? []
  if (!Array.isArray(deckList) || deckList.length === 0) {
    return { decksAnalyzed: 0, totalDecksFound: 0, cards: [] }
  }

  const deckIds = deckList
    .map(d => d?.publicId ?? d?.id)
    .filter(Boolean)
    .slice(0, DECKS_TO_ANALYZE)

  if (deckIds.length === 0) {
    return { decksAnalyzed: 0, totalDecksFound: 0, cards: [] }
  }

  // 2. Fetch each deck in parallel batches.
  const decks = []
  for (let i = 0; i < deckIds.length; i += PARALLEL_BATCH) {
    const batch = deckIds.slice(i, i + PARALLEL_BATCH)
    const results = await Promise.allSettled(batch.map(id => fetchDeck(id)))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) decks.push(r.value)
    }
  }

  if (decks.length === 0) {
    return { decksAnalyzed: 0, totalDecksFound: deckList.length, cards: [] }
  }

  // 3. Count card frequency across the fetched decks.
  const cardCounts = new Map()
  for (const deck of decks) {
    const seen = new Set()
    for (const name of deck.cardNames) {
      const k = name.toLowerCase()
      if (seen.has(k)) continue        // count each card once per deck
      seen.add(k)
      cardCounts.set(k, (cardCounts.get(k) ?? 0) + 1)
    }
  }

  // 4. Convert to a sorted array. Frequency = count / decksAnalyzed (0..1).
  const cards = []
  // Use the cased name from the first deck that contained the card so output
  // matches how Scryfall/EDHREC name cards.
  const casedNames = new Map()
  for (const deck of decks) {
    for (const name of deck.cardNames) {
      const k = name.toLowerCase()
      if (!casedNames.has(k)) casedNames.set(k, name)
    }
  }
  for (const [k, count] of cardCounts.entries()) {
    cards.push({
      name:      casedNames.get(k) ?? k,
      frequency: count / decks.length,
      decks:     count,
    })
  }
  cards.sort((a, b) => b.frequency - a.frequency)

  return {
    decksAnalyzed:   decks.length,
    totalDecksFound: deckList.length,
    cards,
  }
}

async function fetchDeck(publicId) {
  try {
    const res = await fetch(`${DECK_URL}/${encodeURIComponent(publicId)}`, { headers: HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    return { id: publicId, cardNames: extractCardNames(data) }
  } catch {
    return null
  }
}

// Pull card names from the deck's mainboard. v3 uses { boards: { mainboard:
// { cards: { <id>: { card: { name } } } } } }; older shapes used a flat
// mainboard map. Try both, ignore commanders / sideboards / maybeboards.
function extractCardNames(deck) {
  const names = []

  // v3 shape
  const mainboard = deck?.boards?.mainboard?.cards
  if (mainboard && typeof mainboard === 'object') {
    for (const entry of Object.values(mainboard)) {
      const name = entry?.card?.name
      if (name) names.push(name)
    }
  }

  // v2 shape fallback
  const v2Mainboard = deck?.mainboard
  if (v2Mainboard && typeof v2Mainboard === 'object') {
    for (const entry of Object.values(v2Mainboard)) {
      const name = entry?.card?.name ?? entry?.name
      if (name) names.push(name)
    }
  }

  return names
}
