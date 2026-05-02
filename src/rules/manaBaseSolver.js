// Deterministic mana base solver. Replaces the "let the LLM (or scorer) pick
// lands" approach with a constraint-satisfaction pass that produces a balanced,
// untapped-leaning mana base before any LLM call runs.
//
// Inputs:
//   commander         — for color_identity
//   legalLands        — non-basic lands from the user's collection that pass
//                       legality + bracket + color identity. Already filtered.
//   targetLandCount   — typically 37 from targetLandCount(bracket)
//   bracket           — used to set the "premium-land floor" (B5 wants more
//                       premium fixing, B1 happily runs more basics)
//
// Output:
//   { lands: Card[], explanation: string[], stats: { sourcesPerColor, byTier } }
//
// Algorithm — greedy with color-deficit priority:
//   1. Compute target colored-source count per color (heuristic: 14 sources
//      per color in 1-2c, 12 in 3c, 10 in 4-5c).
//   2. Group user's lands by tier (premium > good > mid > weak).
//   3. Iterate through tiers from best to worst. Within each tier, sort lands
//      by how much they reduce the WORST color deficit. Pick lands until either:
//        (a) the land target is hit, OR
//        (b) every color is at least at floor AND the next-best land would
//            push us toward weak-tier picks (cap the non-basic count to
//            ~target - 8 to keep room for basics).
//   4. Fill remaining slots with basics, distributed proportional to the
//      remaining color deficit (so the deck still hits its color floors even
//      when the user has few non-basic lands).
//
// Importantly: this never picks a "weak" tier land if the basic count would
// be ≥ 8. A basic Mountain is strictly better than Izzet Guildgate when slots
// are available.

import { isBasicLand, getBasicLandsForCommander } from '../utils/cardHelpers'
import { landTier, landColorsProduced, landProducesColor } from './landQuality'

// How many sources of each color a deck wants for consistent mana. Numbers
// from Frank Karsten's land-source studies (compressed for Commander format).
function targetSourcesPerColor(commanderColors) {
  const n = commanderColors.length
  if (n <= 1) return 16   // mono-color: lots of basics anyway
  if (n === 2) return 14
  if (n === 3) return 12
  return 10                // 4–5 color: aim lower per-color, lean on triomes
}

// Min number of non-basic lands we want to keep to allow utility/wildcards.
// Below the LLM_POOL threshold the user's collection is small and we should
// use more of it; above we can be picky.
function targetNonBasicCount(bracket, totalLandCount) {
  // B1: ≤ 6 non-basics (mostly basics, simple fixing)
  // B2: ≤ 10
  // B3: ~ 18
  // B4: ~ 24
  // B5: ~ 30  (cEDH lists run very few basics)
  const map = { 1: 6, 2: 10, 3: 18, 4: 24, 5: 30 }
  return Math.min(map[bracket] ?? 18, totalLandCount - 4)  // always keep ≥4 basics
}

// Should this tier's lands be considered at this bracket? At low brackets we
// don't reach for fast lands or premium fixing because the deck doesn't need
// the speed AND the user usually doesn't own them anyway.
function shouldUseTier(tier, bracket) {
  if (bracket >= 3) return tier !== 'weak'                       // B3+ avoid weak entirely
  if (bracket === 2) return tier === 'good' || tier === 'mid'    // B2 prefers honest mid-tier fixing
  return tier === 'mid'                                           // B1 sticks to safe utility lands
}

export function solveManaBase({ commander, legalLands, targetLandCount = 37, bracket = 3 }) {
  const explanation = []
  const colorIdentity = commander?.color_identity ?? []
  const lands = legalLands.filter(c => !isBasicLand(c))

  // Edge case: colorless commander or empty identity → all basics (Wastes).
  if (colorIdentity.length === 0) {
    const basics = makeBasics(commander, targetLandCount)
    explanation.push(`Mana base: ${targetLandCount} basics (colorless commander).`)
    return { lands: basics, explanation, stats: { sourcesPerColor: {}, byTier: {} } }
  }

  // Per-color need
  const targetPerColor = targetSourcesPerColor(colorIdentity)
  const need = {}
  for (const c of colorIdentity) need[c] = targetPerColor

  // Group lands by tier; each tier sorted ascending by name for stable output.
  const byTier = { premium: [], good: [], mid: [], weak: [] }
  for (const card of lands) {
    const tier = landTier(card)
    byTier[tier].push(card)
  }
  for (const tier of Object.keys(byTier)) {
    byTier[tier].sort((a, b) => a.name.localeCompare(b.name))
  }

  // Greedy fill: walk tier order, picking lands that reduce the largest
  // remaining color deficit. Cap non-basic count by bracket.
  const picked = []
  const pickedNames = new Set()
  const nonBasicCap = targetNonBasicCount(bracket, targetLandCount)
  const sourcesPerColor = Object.fromEntries(colorIdentity.map(c => [c, 0]))

  for (const tier of ['premium', 'good', 'mid', 'weak']) {
    if (!shouldUseTier(tier, bracket)) continue

    const tierLands = byTier[tier].filter(c => !pickedNames.has(c.name))
    while (tierLands.length > 0 && picked.length < nonBasicCap && picked.length < targetLandCount) {
      // Find the most-deficient color
      const deficits = colorIdentity
        .map(c => ({ c, deficit: Math.max(0, need[c] - sourcesPerColor[c]) }))
        .sort((a, b) => b.deficit - a.deficit)
      const worstColor = deficits[0]

      // If every color is satisfied AND we've already got a base set of lands,
      // stop fetching from this tier — basics will fill the rest more cheaply.
      const allSatisfied = deficits.every(d => d.deficit === 0)
      const haveBase = picked.length >= Math.min(nonBasicCap - 4, targetLandCount - 8)
      if (allSatisfied && haveBase) break

      // Score each remaining land by how much it helps. A land that produces
      // the worst color is preferred; ties broken by total color contribution.
      let bestIdx = -1
      let bestScore = -Infinity
      for (let i = 0; i < tierLands.length; i++) {
        const land = tierLands[i]
        const colors = landColorsProduced(land)
        let s = 0
        if (colors.has(worstColor.c)) s += 100
        for (const c of colorIdentity) {
          if (colors.has(c) && need[c] > sourcesPerColor[c]) s += 10
        }
        // Prefer fewer-color lands when colors are abundant — keeps the deck
        // from being all 5-color "any-color" lands at the expense of focused fixing.
        s -= Math.max(0, colors.size - colorIdentity.length) * 5
        if (s > bestScore) { bestScore = s; bestIdx = i }
      }
      if (bestIdx === -1) break

      const chosen = tierLands.splice(bestIdx, 1)[0]
      picked.push(chosen)
      pickedNames.add(chosen.name)
      const colors = landColorsProduced(chosen)
      for (const c of colorIdentity) if (colors.has(c)) sourcesPerColor[c]++
    }

    if (picked.length >= nonBasicCap || picked.length >= targetLandCount) break
  }

  // Fill remainder with basics. Distribute proportional to remaining deficit
  // so the deck hits its color floors even with sparse non-basic lands.
  const basicSlots = targetLandCount - picked.length
  if (basicSlots > 0) {
    const basicNames = getBasicLandsForCommander(commander)
    const basics = distributeBasics(basicNames, colorIdentity, sourcesPerColor, need, basicSlots)
    picked.push(...basics)
    // Update source counts so stats reflect basics too.
    for (const b of basics) {
      const c = basicToColor(b.name)
      if (c && colorIdentity.includes(c)) sourcesPerColor[c]++
    }
  }

  const tierCounts = { premium: 0, good: 0, mid: 0, weak: 0, basic: 0 }
  for (const card of picked) {
    if (card.isBasicLand) tierCounts.basic++
    else tierCounts[landTier(card)]++
  }

  explanation.push(
    `Mana base solved: ${picked.length} lands ` +
    `(${tierCounts.premium}P / ${tierCounts.good}G / ${tierCounts.mid}M / ${tierCounts.weak}W / ${tierCounts.basic} basic).`
  )
  explanation.push(
    `Color sources: ${colorIdentity.map(c => `${c}=${sourcesPerColor[c]}`).join(', ')} ` +
    `(target ${targetPerColor} each).`
  )

  return {
    lands: picked,
    explanation,
    stats: { sourcesPerColor, byTier: tierCounts },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

const COLOR_TO_BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
const BASIC_TO_COLOR = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

function basicToColor(name) {
  return BASIC_TO_COLOR[name] ?? null
}

function distributeBasics(basicNames, colorIdentity, sourcesPerColor, need, slots) {
  // If the commander is colorless, basicNames will be ['Wastes']. Just dump.
  if (basicNames.length === 1 && basicNames[0] === 'Wastes') {
    return Array.from({ length: slots }, (_, i) => syntheticBasic('Wastes', i))
  }

  // Compute remaining color deficit. Distribute basics weighted by deficit.
  const deficits = colorIdentity.map(c => ({
    c,
    basic: COLOR_TO_BASIC[c],
    deficit: Math.max(1, need[c] - sourcesPerColor[c]),  // floor at 1 so even satisfied colors get one basic
  }))
  const totalDeficit = deficits.reduce((s, d) => s + d.deficit, 0)

  const counts = {}
  let assigned = 0
  for (const d of deficits) {
    counts[d.basic] = Math.floor((d.deficit / totalDeficit) * slots)
    assigned += counts[d.basic]
  }
  // Distribute remainder by largest fractional part.
  const remainders = deficits.map(d => ({
    basic: d.basic,
    rem: ((d.deficit / totalDeficit) * slots) - Math.floor((d.deficit / totalDeficit) * slots),
  })).sort((a, b) => b.rem - a.rem)
  let i = 0
  while (assigned < slots) {
    counts[remainders[i % remainders.length].basic]++
    assigned++
    i++
  }

  const out = []
  let idx = 0
  for (const [basicName, count] of Object.entries(counts)) {
    for (let n = 0; n < count; n++) out.push(syntheticBasic(basicName, idx++))
  }
  return out
}

function makeBasics(commander, count) {
  const basicNames = getBasicLandsForCommander(commander)
  return Array.from({ length: count }, (_, i) =>
    syntheticBasic(basicNames[i % basicNames.length], i)
  )
}

function syntheticBasic(name, idx) {
  return {
    id: `basic_${name.toLowerCase().replace(/\s/g, '_')}_${idx}`,
    name,
    type_line: 'Basic Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal' },
    image_uris: null,
    card_faces: null,
    isBasicLand: true,
    roles: ['land'],
    tags: [],
    quantity: 1,
  }
}
