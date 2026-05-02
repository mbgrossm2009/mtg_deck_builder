// Scryfall bulk data fetcher with IndexedDB cache.
//
// Why IndexedDB and not localStorage: Scryfall's oracle_cards bulk file is
// ~16-20 MB JSON, and localStorage's per-origin quota is typically 5-10 MB.
// IndexedDB has no practical limit and is async (won't block the main thread
// during the write).
//
// What we fetch: oracle_cards (one entry per unique card name; ~30k entries).
// We don't need default_cards (~140 MB, every printing) since the algorithm
// only cares about card NAMES — printing variants are equivalent.
//
// Cache TTL: 1 week. Scryfall releases bulk dumps daily so a week is fresh
// enough for our use; users won't be downloading 20 MB on every test run.

const BULK_DATA_API = 'https://api.scryfall.com/bulk-data'
const DB_NAME       = 'deckify-scryfall-cache'
const STORE_NAME    = 'bulk'
const CACHE_KEY     = 'oracle-cards-v1'
const CACHE_TTL_MS  = 7 * 24 * 60 * 60 * 1000  // 1 week

// Open (or create) the IndexedDB instance. Resolves with the open db handle.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })
}

async function getCached() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req   = store.get(CACHE_KEY)
      req.onerror   = () => reject(req.error)
      req.onsuccess = () => resolve(req.result?.value ?? null)
    })
  } catch {
    return null   // IndexedDB unavailable (e.g. private browsing); caller falls through to fetch
  }
}

async function setCached(value) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req   = store.put({ key: CACHE_KEY, value })
      req.onerror   = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch {
    // Quota exceeded or storage disabled — degrade silently. Next call re-fetches.
  }
}

// Clear the cache. Useful for forcing a fresh download.
export async function clearScryfallBulkCache() {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req   = store.delete(CACHE_KEY)
      req.onerror   = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch { /* noop */ }
}

/**
 * Fetch Scryfall's oracle_cards bulk data. Cached in IndexedDB for 1 week.
 *
 * @param {object} opts
 * @param {(state: { stage: string, [k: string]: any }) => void} [opts.onProgress]
 *   Called with progress updates. Stages:
 *     'cached'      → returned cached data (no network call)
 *     'manifest'    → fetching the bulk-data manifest
 *     'downloading' → fetching the actual JSON ({ size } in bytes)
 *     'parsing'     → JSON.parse over the response
 *     'caching'     → writing to IndexedDB
 *     'done'        → final, with { count } cards loaded
 *
 * @returns {Promise<Array>} Array of Scryfall card objects.
 */
export async function fetchOracleCards({ onProgress } = {}) {
  // Try cache first
  const cached = await getCached()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    onProgress?.({ stage: 'cached', count: cached.cards.length })
    onProgress?.({ stage: 'done',   count: cached.cards.length })
    return cached.cards
  }

  // Get the bulk-data manifest to find the current oracle_cards download URL
  onProgress?.({ stage: 'manifest' })
  const manifestRes = await fetch(BULK_DATA_API)
  if (!manifestRes.ok) {
    throw new Error(`Scryfall bulk manifest returned ${manifestRes.status}`)
  }
  const manifest = await manifestRes.json()
  const oracleEntry = (manifest?.data ?? []).find(d => d?.type === 'oracle_cards')
  if (!oracleEntry?.download_uri) {
    throw new Error('Scryfall manifest missing oracle_cards entry')
  }

  // Download the bulk file
  onProgress?.({ stage: 'downloading', size: oracleEntry.size })
  const cardsRes = await fetch(oracleEntry.download_uri)
  if (!cardsRes.ok) {
    throw new Error(`Scryfall bulk download returned ${cardsRes.status}`)
  }

  // Parse — JSON.parse is fast even on 20MB strings
  onProgress?.({ stage: 'parsing' })
  const cards = await cardsRes.json()
  if (!Array.isArray(cards)) {
    throw new Error('Scryfall bulk data was not an array')
  }

  // Cache for next time
  onProgress?.({ stage: 'caching' })
  await setCached({ fetchedAt: Date.now(), cards })

  onProgress?.({ stage: 'done', count: cards.length })
  return cards
}
