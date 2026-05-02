// Land quality classification — single source of truth shared by:
//   - deckScorer.js (scoring)
//   - manaBaseSolver.js (deterministic mana-base construction)
//   - llmPromptBuilder.js (surfaces tier as an explicit tag to the LLM)
//
// Four tiers:
//   premium — fetches, shocks, original duals, fast lands, triomes, key utility lands
//   good    — pain lands, check lands, filter lands, untapped multi-color
//   mid     — tapped lands that bring real value (scry, draw, recursion, search)
//   weak    — gates, gain lands, tri-lands, bounce lands, vanilla tapped utility
//
// Basic lands aren't tiered by this module — the mana base solver handles them
// separately based on color demand.

import { getOracleText } from '../utils/cardHelpers'

// Curated premium list. These are universally strong lands across formats —
// fetches, original duals, shocks, fast lands, plus a handful of utility lands
// that meaningfully shape gameplay (Strip Mine, Bojuka Bog, Field of the Dead,
// Boseiju cycle, etc).
const PREMIUM_LANDS = new Set([
  // Fetchlands
  'Polluted Delta', 'Flooded Strand', 'Bloodstained Mire', 'Wooded Foothills',
  'Windswept Heath', 'Marsh Flats', 'Misty Rainforest', 'Scalding Tarn',
  'Verdant Catacombs', 'Arid Mesa', 'Prismatic Vista', 'Fabled Passage',
  'Evolving Wilds', 'Terramorphic Expanse',
  // Original duals
  'Underground Sea', 'Tundra', 'Volcanic Island', 'Tropical Island', 'Bayou',
  'Badlands', 'Plateau', 'Savannah', 'Scrubland', 'Taiga',
  // Shocks
  'Watery Grave', 'Hallowed Fountain', 'Steam Vents', 'Overgrown Tomb',
  'Sacred Foundry', 'Temple Garden', 'Stomping Ground', 'Breeding Pool',
  'Godless Shrine', 'Blood Crypt',
  // Fast lands
  'Darkslick Shores', 'Seachrome Coast', 'Blackcleave Cliffs', 'Botanical Sanctum',
  'Concealed Courtyard', 'Inspiring Vantage', 'Spirebluff Canal', 'Copperline Gorge',
  'Razorverge Thicket', 'Blooming Marsh',
  // Strong utility / fixing
  'Mana Confluence', 'City of Brass', 'Reflecting Pool', 'Forbidden Orchard',
  'Ancient Tomb', 'Gaea\'s Cradle', 'Cabal Coffers', 'Bojuka Bog',
  'Strip Mine', 'Wasteland', 'Field of the Dead', 'Maze of Ith',
  'Boseiju, Who Endures', 'Otawara, Soaring City', 'Eiganjo, Seat of the Empire',
  'Takenuma, Abandoned Mire', 'Sokenzan, Crucible of Defiance',
])

// Triome cycle — three-color untapped-cycling lands. Always premium.
const TRIOMES = new Set([
  'Indatha Triome', 'Ketria Triome', 'Raugrin Triome', 'Savai Triome', 'Zagoth Triome',
  'Spara\'s Headquarters', 'Raffine\'s Tower', 'Xander\'s Lounge', 'Ziatora\'s Proving Ground',
  'Jetmir\'s Garden',
])

// Pain lands — untapped fixing at the cost of 1 life. Strong but not premium.
const PAIN_LANDS = new Set([
  'Adarkar Wastes', 'Underground River', 'Sulfurous Springs', 'Karplusan Forest',
  'Brushland', 'Battlefield Forge', 'Caves of Koilos', 'Llanowar Wastes',
  'Yavimaya Coast', 'Shivan Reef',
])

// Check lands — untapped if you have certain basics. Conditional but reliable.
const CHECK_LANDS = new Set([
  'Glacial Fortress', 'Drowned Catacomb', 'Dragonskull Summit', 'Rootbound Crag',
  'Sunpetal Grove', 'Hinterland Harbor', 'Isolated Chapel', 'Clifftop Retreat',
  'Sulfur Falls', 'Woodland Cemetery',
])

// Filter lands — tap to filter mana. Strong fixing but require a setup tap.
const FILTER_LANDS = new Set([
  'Mystic Gate', 'Sunken Ruins', 'Graven Cairns', 'Fire-Lit Thicket',
  'Wooded Bastion', 'Fetid Heath', 'Cascade Bluffs', 'Twilight Mire',
  'Rugged Prairie', 'Flooded Grove',
])

// Surveil lands (Murders at Karlov Manor) — ETB tapped but draw or scry.
const SURVEIL_LANDS = new Set([
  'Meticulous Archive', 'Underground Mortuary', 'Commercial District',
  'Hedge Maze', 'Lush Portico', 'Shadowy Backstreet', 'Raucous Theater',
  'Thundering Falls', 'Undercity Sewers', 'Elegant Parlor',
])

// Cards that ETB tapped without compensation. Hard penalty.
const WEAK_LAND_NAMES = new Set([
  'Crossroads Village', 'Hidden Grotto', 'Glimmerpost', 'Stalking Stones',
  'Cave of Temptation', 'Helvault', 'Seafloor Debris', 'Svyelunite Temple',
  'Tainted Isle', 'Warped Landscape', 'Terrain Generator', 'Temple of the False God',
  'Urza\'s Tower', 'Urza\'s Mine', 'Urza\'s Power Plant',
])

// Tier ordering — lower index = better.
export const TIER_ORDER = ['premium', 'good', 'mid', 'weak']

export function landTier(card) {
  const name = card.name
  if (PREMIUM_LANDS.has(name)) return 'premium'
  if (TRIOMES.has(name))       return 'premium'
  if (WEAK_LAND_NAMES.has(name)) return 'weak'

  if (PAIN_LANDS.has(name) || CHECK_LANDS.has(name) || FILTER_LANDS.has(name)) {
    return 'good'
  }
  if (SURVEIL_LANDS.has(name)) return 'mid'

  // Pattern-based tier detection for everything not in the curated lists.
  // These catch entire categories (gates, gain lands, tri-lands, bounce lands)
  // that the named sets above would have to enumerate one-by-one.
  const nameLower = name.toLowerCase()
  const text = getOracleText(card).toLowerCase()

  // ETB-tapped detection. Handles both the legacy wording ("enters the
  // battlefield tapped") and the 2024 simplification ("enters tapped").
  // Anchored on "enters" + any non-period chars (or none) + "tapped".
  const etbTapped = /enters[^.]*tapped/.test(text)

  // Always-tapped "junk" categories — explicit weak.
  if (/\bguildgate\b/.test(nameLower)) return 'weak'                                // Ravnica gates
  if (/\bpanorama\b/.test(nameLower)) return 'weak'                                 // Alara panoramas
  if (etbTapped && /you gain 1 life/.test(text)) return 'weak'                      // gain lands ("X Refuge")
  if (/return .* land you control to .* hand/.test(text)) return 'weak'             // bounce / Karoo lands
  // Tri-lands (always tapped, three colors)
  if (etbTapped && /add \{[wubrg]\}, \{[wubrg]\}, or \{[wubrg]\}/.test(text)) return 'weak'

  // Tapped lands with real compensating effect → mid.
  if (etbTapped && /(draw|scry|search|discover|cycling)/.test(text)) return 'mid'

  // Tapped lands with creation/token effect → mid (Sacred Peaks, etc.)
  if (etbTapped && /create/.test(text)) return 'mid'

  // Generic ETB-tapped without payoff → weak.
  if (etbTapped) return 'weak'

  // Untapped multi-color or any-color → good.
  if (/add \{[wubrg]\}.*\{[wubrg]\}|add (?:one mana|mana) of any color/.test(text)) return 'good'

  // Untapped single-color → mid (e.g., Forest variants that aren't basic).
  return 'mid'
}

// Score delta a tier contributes to a card's overall scorer score. Used by
// deckScorer.scoreLandQuality so the scoring stays consistent with the solver.
const TIER_SCORE_DELTA = {
  premium: 25,
  good:    12,
  mid:     0,
  weak:    -22,
}

export function landTierScoreDelta(card) {
  return TIER_SCORE_DELTA[landTier(card)] ?? 0
}

// Returns the colors a land can produce. Best-effort regex on oracle text —
// not a full mana parser. Returns Set<'W'|'U'|'B'|'R'|'G'>.
// Used by the solver to know which colors each land contributes to.
export function landColorsProduced(card) {
  const colors = new Set()
  const text = getOracleText(card).toLowerCase()

  // Direct mana symbols in oracle text
  if (/\{w\}/.test(text)) colors.add('W')
  if (/\{u\}/.test(text)) colors.add('U')
  if (/\{b\}/.test(text)) colors.add('B')
  if (/\{r\}/.test(text)) colors.add('R')
  if (/\{g\}/.test(text)) colors.add('G')

  // "any color" producers — credit all five (for solver purposes).
  if (/add (?:one mana|mana) of any color/.test(text) || /add one mana of any color/.test(text)) {
    colors.add('W'); colors.add('U'); colors.add('B'); colors.add('R'); colors.add('G')
  }

  // Color identity fallback — if oracle text didn't yield anything but the
  // card has a color identity, trust that. Catches lands with sparse text.
  if (colors.size === 0 && Array.isArray(card.color_identity)) {
    for (const c of card.color_identity) colors.add(c)
  }

  return colors
}

// Convenience for the solver: does this land produce the given color?
export function landProducesColor(card, color) {
  return landColorsProduced(card).has(color)
}
