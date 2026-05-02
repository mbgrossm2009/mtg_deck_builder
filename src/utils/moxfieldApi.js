// Client-side adapter for Moxfield deck-aggregation data.
//
// Calls the /api/moxfield serverless function (which proxies Moxfield's API)
// and returns frequency data: { decksAnalyzed, totalDecksFound, cards: [{ name,
// frequency, decks }] }. Frequency is 0..1 — what fraction of analyzed decks
// included this card.
//
// Caches in localStorage with a 1-week TTL so repeat generations for the same
// commander don't re-hit Moxfield. Failures degrade silently — the rest of
// the generator still works without Moxfield data.

const CACHE_KEY = 'moxfieldCache'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 1 week

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* noop */ }
}

export async function fetchMoxfieldConsensus(commander) {
  if (!commander?.name) return { decksAnalyzed: 0, totalDecksFound: 0, cards: [] }

  const key = commander.name.toLowerCase()
  const cache = readCache()
  const hit = cache[key]
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data
  }

  let data = { decksAnalyzed: 0, totalDecksFound: 0, cards: [] }
  try {
    const res = await fetch('/api/moxfield', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commander: commander.name }),
    })
    if (res.ok) {
      const json = await res.json()
      // Server returns { decksAnalyzed, totalDecksFound, cards, error?, cached? }.
      // Only cache successful aggregations (decksAnalyzed > 0).
      if (json?.decksAnalyzed > 0) {
        data = { decksAnalyzed: json.decksAnalyzed, totalDecksFound: json.totalDecksFound, cards: json.cards }
      }
    }
  } catch (err) {
    console.warn('[moxfield] fetch failed, generator will run without Moxfield data:', err?.message ?? err)
  }

  cache[key] = { fetchedAt: Date.now(), data }
  writeCache(cache)
  return data
}

export function clearMoxfieldCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* noop */ }
}
