// Lazy fetch of EDHREC's per-commander page JSON. Returns top cards and named
// themes for the commander, used by the scorer (top-cards bonus) and archetype
// detection (themes → archetype ids).
//
// Routes through our /api/edhrec serverless proxy because EDHREC returns 403
// for browser-origin direct fetches (anti-scraping policy). Server-side
// fetches with a stable User-Agent are honored. The proxy returns the same
// JSON shape the upstream endpoint does, plus a _cached/_error flag.
//
// Endpoint shape (defensive — EDHREC's response is sprawling and not perfectly stable):
//   GET https://json.edhrec.com/pages/commanders/<slug>.json
//   Response (relevant fields):
//     container.json_dict.cardlists: [{ tag, header, cardviews: [{ name, num_decks, ... }] }]
//     panels.tribelinks.themes: [{ value, count, href }]
//
// Data is cached in localStorage with a TTL; failures (CORS, 404, shape change)
// degrade silently — the rest of the generator still works without EDHREC data.

const CACHE_KEY = 'edhrecCache'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 1 week — top cards rarely shift fast

// Tags we care about from cardlists. EDHREC groups its top-cards by category;
// these are the buckets that contain "this commander actually runs this card".
const RELEVANT_LIST_TAGS = new Set([
  'topcards', 'highsynergycards', 'newcards',
  'creatures', 'instants', 'sorceries', 'utilityartifacts',
  'enchantments', 'planeswalkers', 'manaartifacts', 'lands',
])

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

// "Atraxa, Praetors' Voice" → "atraxa-praetors-voice"
// Strips apostrophes/commas, replaces spaces with dashes, lowercases.
export function commanderSlug(name) {
  return name
    .toLowerCase()
    .replace(/['',]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function defensivelyParse(json) {
  // EDHREC nests the useful payload deep. Wrap every traversal so unexpected
  // shape changes never throw — just degrade to empty results.
  const cardLists = json?.container?.json_dict?.cardlists ?? []
  const topCards = []
  const seen = new Set()
  for (const list of cardLists) {
    if (!RELEVANT_LIST_TAGS.has(list?.tag)) continue
    const cards = Array.isArray(list?.cardviews) ? list.cardviews : []
    for (const c of cards) {
      const name = c?.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      topCards.push({
        name,
        // num_decks is "how many decks run this", inclusion is "% of decks for this commander".
        // We use inclusion for scoring if present, else fall back to a normalized num_decks.
        inclusion: typeof c?.inclusion === 'number' ? c.inclusion : null,
        numDecks:  typeof c?.num_decks === 'number' ? c.num_decks : null,
        synergy:   typeof c?.synergy === 'number' ? c.synergy : null,
        listTag:   list.tag,
      })
    }
  }

  // Themes: EDHREC labels them in a few different places. Try a couple.
  const themes = []
  const themeSources = [
    json?.panels?.tribelinks?.themes,
    json?.panels?.tribelinks?.tribes,
    json?.themes,
  ]
  for (const src of themeSources) {
    if (!Array.isArray(src)) continue
    for (const t of src) {
      const value = t?.value ?? t?.name
      if (typeof value === 'string' && value.length > 0) themes.push(value)
    }
  }

  return { topCards, themes: [...new Set(themes)] }
}

export async function fetchEdhrecCommander(commander) {
  if (!commander?.name) return { topCards: [], themes: [] }

  const slug = commanderSlug(commander.name)
  const cache = readCache()
  const hit = cache[slug]
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data
  }

  let data = { topCards: [], themes: [] }
  try {
    // Route through our serverless proxy — direct browser fetches to EDHREC
    // get 403'd by their anti-scraping policy. The proxy passes through the
    // upstream JSON unchanged and adds _cached / _error metadata. If the
    // upstream itself returns a 4xx (404 for misspelled commander, etc.),
    // the proxy returns 200 with empty topCards/themes plus _error, so the
    // catch path below isn't triggered for that case.
    const res = await fetch(`/api/edhrec?slug=${encodeURIComponent(slug)}`)
    if (!res.ok) throw new Error(`Proxy ${res.status}`)
    const json = await res.json()
    if (json?._error) {
      console.warn('[edhrec] proxy returned error, no data for', slug, json._error)
    }
    data = defensivelyParse(json)
  } catch (err) {
    console.warn('[edhrec] fetch failed, generator will run without EDHREC data:', err?.message ?? err)
  }

  cache[slug] = { fetchedAt: Date.now(), data }
  writeCache(cache)
  return data
}

export function clearEdhrecCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* noop */ }
}
