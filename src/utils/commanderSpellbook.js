// Lazy fetch of Commander Spellbook combos for the user's collection.
// Caches results keyed by collection signature + commander id, with TTL.
//
// Endpoint: POST https://backend.commanderspellbook.com/find-my-combos/
// Body: { commanders: [{ name }], main: [{ name, quantity }] }
// Response shape (paginated, but the "results" object holds the categorized combos):
//   { results: { included: [...], includedByChangingCommanders: [...], ... } }
// Each combo entry has:
//   uses: [{ card: { name } }, ...]
//   produces: [{ feature: { name } }]
//   bracketTag: { id: 'casual' | 'cedh' | ... }  (optional)
//
// The Spellbook API is best-effort. CORS and connectivity vary by deployment;
// failures are logged and we fall back to the hardcoded combo list.

const ENDPOINT = 'https://backend.commanderspellbook.com/find-my-combos/'
const CACHE_KEY = 'commanderSpellbookCache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage full or disabled — non-fatal
  }
}

// Stable signature so we don't refetch on identical input. Order-independent.
function signature(commander, cards) {
  const cmdr = commander?.id ?? commander?.name ?? ''
  const names = cards.map(c => c.name.toLowerCase()).sort().join('|')
  // Cheap djb2-style hash — collisions are tolerable for cache keys.
  let h = 5381
  const s = cmdr + ':' + names
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h.toString(36)
}

function bracketIdToNumber(tag) {
  // Commander Spellbook tags vary by snapshot; map best-effort.
  switch ((tag ?? '').toLowerCase()) {
    case 'precon':
    case 'casual':
      return 2
    case 'upgraded':
      return 3
    case 'optimized':
    case 'high power':
      return 4
    case 'cedh':
    case 'competitive':
      return 5
    default:
      return 4
  }
}

function normalizeSpellbookEntry(entry) {
  const cards = (entry?.uses ?? []).map(u => u?.card?.name).filter(Boolean)
  if (cards.length === 0) return null
  const produces = (entry?.produces ?? []).map(p => p?.feature?.name).filter(Boolean)
  const description = produces.length > 0
    ? produces.join(' + ')
    : 'Combo from Commander Spellbook.'
  return {
    cards,
    description,
    minimumBracket: bracketIdToNumber(entry?.bracketTag?.id ?? entry?.legality?.bracketTag),
    source: 'commanderSpellbook',
  }
}

// Fetches combos from Commander Spellbook for the given commander+collection.
// Returns an array of internal combo objects (cards/description/minimumBracket).
// Best-effort: returns [] on failure, hits the cache aggressively.
export async function fetchSpellbookCombos(commander, collection) {
  if (!commander || !collection || collection.length === 0) return []

  const sig = signature(commander, collection)
  const cache = readCache()
  const hit = cache[sig]
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.combos
  }

  const body = {
    commanders: [{ name: commander.name }],
    main: collection.map(c => ({ name: c.name, quantity: c.quantity ?? 1 })),
  }

  let combos = []
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Spellbook ${res.status}`)
    const json = await res.json()
    const results = json?.results ?? {}

    // Spellbook returns several buckets; "included" is the one that actually fits the deck as-is.
    // Other buckets (almostIncluded etc.) are skipped to avoid false positives.
    const raw = [
      ...(Array.isArray(results.included) ? results.included : []),
    ]
    combos = raw.map(normalizeSpellbookEntry).filter(Boolean)
  } catch (err) {
    // Network / CORS / shape-change failure — degrade quietly to hardcoded list.
    console.warn('[commanderSpellbook] fetch failed, using hardcoded combos only:', err?.message ?? err)
    combos = []
  }

  // Cache even empty results so we don't hammer the API on repeated regen clicks.
  cache[sig] = { fetchedAt: Date.now(), combos }
  writeCache(cache)
  return combos
}

export function clearSpellbookCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* noop */ }
}
