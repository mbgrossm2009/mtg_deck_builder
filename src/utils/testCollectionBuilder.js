// Builds a "test collection" from Scryfall's bulk oracle data.
//
// The 7500-mixed preset:
//   - Top 5000 by EDHREC rank (the format meta — staples + popular picks)
//   - Random 2500 from the rest, stratified by rarity so commons/uncommons
//     are represented proportionally to a real player's collection
//
// This gives the algorithm a realistic test surface: meta picks AND chaff,
// across all colors and rarities. The algorithm has to discriminate, not
// just rank already-good cards.
//
// Output cards match the shape `addImportedCardsToCollection` /
// `saveCollection` expect: name, type_line, oracle_text, mana_cost, cmc,
// colors, color_identity, legalities, rarity, isBasicLand, image_uris,
// card_faces, quantity.

import { fetchOracleCards } from './scryfallBulk'

// What share of the random sample comes from each rarity bucket. Roughly
// matches a typical collection's rarity distribution — commons and
// uncommons are everywhere; mythics are rare.
const RARITY_PROPORTIONS = {
  common:   0.40,
  uncommon: 0.30,
  rare:     0.22,
  mythic:   0.08,
}

const PRESETS = {
  '3000-staples': { topCount: 3000, sampleCount:    0 },
  '7500-mixed':   { topCount: 5000, sampleCount: 2500 },
  '10000-comprehensive': { topCount: 7000, sampleCount: 3000 },
}

/**
 * Build a test collection from Scryfall's oracle_cards bulk data.
 *
 * @param {object} opts
 * @param {keyof typeof PRESETS} [opts.preset='7500-mixed']
 * @param {(state: object) => void} [opts.onProgress]
 *   Called with progress updates. Stages from fetchOracleCards plus:
 *     'filtering' { eligibleCount } — after EDH-legality filter
 *     'sampling'  { topCount, sampleCount } — building the result
 *     'mapping'   { count } — converting Scryfall shape → app shape
 *     'done'      { count } — final
 *
 * @returns {Promise<Array>} Array of cards in the app's collection shape.
 */
export async function buildTestCollection({ preset = '7500-mixed', onProgress } = {}) {
  const config = PRESETS[preset]
  if (!config) {
    throw new Error(`Unknown test collection preset: ${preset}. Valid: ${Object.keys(PRESETS).join(', ')}`)
  }

  // 1. Fetch (or read from cache) every unique card on Scryfall
  const allCards = await fetchOracleCards({ onProgress })

  // 2. Filter to EDH-legal, English, non-token, non-emblem
  const eligible = allCards.filter(isEdhEligible)
  onProgress?.({ stage: 'filtering', eligibleCount: eligible.length })

  // 3a. Top N by EDHREC rank
  const ranked = eligible
    .filter(c => typeof c.edhrec_rank === 'number')
    .sort((a, b) => a.edhrec_rank - b.edhrec_rank)
  const topPicks = ranked.slice(0, config.topCount)
  const topNames = new Set(topPicks.map(c => c.name.toLowerCase()))

  // 3b. Stratified random sample from the remainder
  const remainder = eligible.filter(c => !topNames.has(c.name.toLowerCase()))
  const samplePicks = config.sampleCount > 0
    ? stratifiedSample(remainder, config.sampleCount, RARITY_PROPORTIONS)
    : []

  onProgress?.({ stage: 'sampling', topCount: topPicks.length, sampleCount: samplePicks.length })

  // 4. Convert Scryfall shape → app collection shape
  const combined = [...topPicks, ...samplePicks]
  const mapped = combined.map(toCollectionCard)
  onProgress?.({ stage: 'mapping', count: mapped.length })

  // 5. Add a generous count of basic lands so the mana base solver always
  // has supply. Without this, a freshly-imported test collection might
  // have zero or one of each basic, starving the solver.
  const basics = makeBasicLandPool()
  const final = [...mapped, ...basics]

  onProgress?.({ stage: 'done', count: final.length })
  return final
}

// ─── helpers ───────────────────────────────────────────────────────────────

function isEdhEligible(card) {
  if (!card?.name) return false
  // Commander legal (banned/restricted dropped)
  if (card.legalities?.commander !== 'legal') return false
  // Skip non-card layouts
  const layout = card.layout ?? ''
  if (layout === 'token') return false
  if (layout === 'emblem') return false
  if (layout === 'art_series') return false
  if (layout === 'double_faced_token') return false
  if (layout === 'scheme') return false
  if (layout === 'planar') return false
  if (layout === 'vanguard') return false
  // English-only — oracle_cards is mostly English but be defensive
  if (card.lang && card.lang !== 'en') return false
  return true
}

function stratifiedSample(cards, totalWanted, proportions) {
  const byRarity = { common: [], uncommon: [], rare: [], mythic: [] }
  for (const c of cards) {
    const r = (c.rarity ?? 'common').toLowerCase()
    if (byRarity[r]) byRarity[r].push(c)
  }

  const result = []
  for (const [rarity, prop] of Object.entries(proportions)) {
    const wanted = Math.floor(totalWanted * prop)
    const pool   = byRarity[rarity] ?? []
    const picked = pickRandom(pool, wanted)
    result.push(...picked)
  }
  // Top up with random commons if rounding shorted us
  if (result.length < totalWanted) {
    const remaining = totalWanted - result.length
    const seen = new Set(result.map(c => c.name.toLowerCase()))
    const extras = (byRarity.common ?? []).filter(c => !seen.has(c.name.toLowerCase()))
    result.push(...pickRandom(extras, remaining))
  }
  return result
}

// Reservoir-style sampling — pick `n` random items from `arr` without replacement.
function pickRandom(arr, n) {
  if (n >= arr.length) return arr.slice()
  const copy = arr.slice()
  // Fisher-Yates partial shuffle, only `n` swaps needed
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function toCollectionCard(scryfall) {
  const typeLine = scryfall.type_line ?? ''
  return {
    id:             scryfall.id,
    name:           scryfall.name,
    type_line:      typeLine,
    oracle_text:    scryfall.oracle_text ?? '',
    mana_cost:      scryfall.mana_cost ?? '',
    cmc:            scryfall.cmc ?? 0,
    colors:         scryfall.colors ?? [],
    color_identity: scryfall.color_identity ?? [],
    legalities:     scryfall.legalities ?? { commander: 'legal' },
    rarity:         scryfall.rarity ?? 'common',
    isBasicLand:    typeLine.includes('Basic Land'),
    image_uris:     scryfall.image_uris ?? null,
    card_faces:     scryfall.card_faces ?? null,
    quantity:       1,
  }
}

// Synthetic basic-land entries so the mana base solver always has plenty
// to draw from. Each gets a unique id so they look like distinct
// collection entries (collection table is keyed on id).
function makeBasicLandPool() {
  const basics = [
    { name: 'Plains',   color_identity: ['W'] },
    { name: 'Island',   color_identity: ['U'] },
    { name: 'Swamp',    color_identity: ['B'] },
    { name: 'Mountain', color_identity: ['R'] },
    { name: 'Forest',   color_identity: ['G'] },
  ]
  const out = []
  // 30 of each = 150 basics. Plenty for any 5-color deck.
  for (const b of basics) {
    for (let i = 0; i < 30; i++) {
      out.push({
        id:             `test-basic-${b.name.toLowerCase()}-${i}`,
        name:           b.name,
        type_line:      `Basic Land — ${b.name}`,
        oracle_text:    `({T}: Add {${b.color_identity[0]}}.)`,
        mana_cost:      '',
        cmc:            0,
        colors:         b.color_identity,
        color_identity: b.color_identity,
        legalities:     { commander: 'legal' },
        rarity:         'common',
        isBasicLand:    true,
        image_uris:     null,
        card_faces:     null,
        quantity:       1,
      })
    }
  }
  return out
}
