import { getOracleText } from '../utils/cardHelpers'
import { scoreArchetypeFit, cardMatchesArchetype, isCompetingArchetypeAnchor } from './archetypeRules'

// Cards that are explicitly weak/joke/limited-only and almost never belong in
// a Commander deck. We hard-penalize these so they sink to the bottom of any
// bucket they land in — even filler should pick a different card first.
const DEADWEIGHT = new Set([
  'Vizzerdrix', 'Thallid', 'Psychic Venom', 'Fishing Pole', 'Razor Boomerang',
  'Storm Crow', 'One With Nothing', 'Wood Elemental', 'Wall of Wood',
  'Sorrow\'s Path', 'Sewers of Estark', 'Chimney Imp', 'Goblin Tutor',
  'Index', 'Mudhole', 'Stone Rain', 'Lava Spike', 'Shock', 'Lightning Strike',
  'Pacifism', 'Naturalize', 'Disenchant', 'Cancel', 'Mind Rot',
  'Unsummon', 'Healing Salve', // joke / strictly-worse list — extend as you find more
])

const POWER_CARDS = new Set([
  'Sol Ring', 'Arcane Signet', 'Cyclonic Rift', 'Swords to Plowshares',
  'Path to Exile', 'Cultivate', 'Kodama\'s Reach', 'Farseek',
  'Rhystic Study', 'Mystic Remora', 'Smothering Tithe', 'Sylvan Library',
  'Necropotence', 'Demonic Tutor', 'Vampiric Tutor', 'Counterspell',
  'Force of Will', 'Mana Drain', 'Teferi\'s Protection', 'Heroic Intervention',
  'Swan Song', 'Negate', 'Damnation', 'Wrath of God', 'Toxic Deluge',
  'Blasphemous Act', 'Windfall', 'Wheel of Fortune', 'Survival of the Fittest',
  'Craterhoof Behemoth', 'Triumph of the Hordes',
])

// `context` carries the parts of state the scorer needs across calls:
//   archetypes        — output of detectArchetypes(commander)
//   combos            — full list of combos active for this run (hardcoded ∪ Spellbook)
//   pickedNames       — Set<lowercased name> of cards already in the deck (commander included)
//   breakdowns        — optional Map<"cardName:role", [[reason, delta], ...]>; if present,
//                       scoreCard logs each delta. Used by the diagnostics panel.
// All keys optional — if missing, scoring degrades to the older role/CMC/keyword logic.
export function scoreCard(card, role, commander, bracket, context = {}) {
  const log = context.breakdowns
    ? makeLogger(context.breakdowns, card.name, role)
    : noopLog
  let score = 0

  // Base role fitness
  const roles = card.roles ?? []
  if (roles[0] === role)             { score += 20; log('Primary role match', 20) }
  else if (roles.includes(role))     { score += 10; log('Secondary role', 10) }

  // Land quality
  if (roles.includes('land') && !card.isBasicLand) {
    const delta = scoreLandQuality(card)
    if (delta !== 0) { score += delta; log('Land quality', delta) }
  }

  if (POWER_CARDS.has(card.name)) { score += 8;  log('Power-card list', 8) }
  if (DEADWEIGHT.has(card.name)) { score -= 60; log('Deadweight list', -60) }

  if (!POWER_CARDS.has(card.name) && !(card.roles ?? []).includes('land')) {
    const r = (card.rarity ?? '').toLowerCase()
    if (r === 'common')        { score -= 6; log('Rarity (common)',   -6) }
    else if (r === 'uncommon') { score -= 2; log('Rarity (uncommon)', -2) }
    else if (r === 'mythic')   { score += 2; log('Rarity (mythic)',    2) }
  }

  const cmc = card.cmc ?? 0
  if (role !== 'win_condition' && role !== 'filler') {
    if (cmc <= 2)      { score += 6; log(`CMC ${cmc} (cheap)`,  6) }
    else if (cmc <= 3) { score += 3; log(`CMC ${cmc}`,          3) }
    else if (cmc >= 7) { score -= 6; log(`CMC ${cmc} (heavy)`, -6) }
    else if (cmc >= 5) { score -= 3; log(`CMC ${cmc} (high)`,  -3) }
  }

  const flexBonus = Math.min(roles.length - 1, 3) * 3
  if (flexBonus > 0) { score += flexBonus; log(`Multi-role (${roles.length})`, flexBonus) }

  // Archetype fit. When primary is set, secondary archetypes contribute zero —
  // the deck commits hard to one lane.
  if (context.archetypes?.length) {
    const archScore = scoreArchetypeFit(card, context.archetypes, context.primaryArchetypeId)
    if (archScore !== 0) {
      score += archScore
      const tag = context.primaryArchetypeId ? `Archetype fit (primary: ${context.primaryArchetypeId})` : 'Archetype fit'
      log(tag, archScore)
    }

    // Penalty for cards that anchor a competing archetype (Vito in Aristocrats Ertai).
    // Big enough to actually drop them out of contention even with EDHREC bonus.
    if (context.primaryArchetypeId && isCompetingArchetypeAnchor(card, context.primaryArchetypeId, context.archetypes)) {
      score -= 30
      log('Competing-archetype anchor', -30)
    }
  } else {
    const sharedWords = countSharedMeaningfulWords(getOracleText(commander), getOracleText(card))
    const delta = Math.min(sharedWords * 2, 10)
    if (delta > 0) { score += delta; log(`Keyword overlap (${sharedWords})`, delta) }
  }

  // EDHREC bonus — primary signal but archetype-aware when a primary is locked.
  // Cards in universal roles (lands/ramp/draw/removal/wipe/protection) keep full
  // EDHREC weight because they're commander-agnostic staples. Synergy/filler/
  // win-condition cards must FIT the primary archetype to get full bonus —
  // otherwise their EDHREC weight is halved so off-lane EDHREC suggestions
  // don't dominate the deck.
  if (context.edhrecRank?.has?.(card.name)) {
    const rank = context.edhrecRank.get(card.name)
    const total = context.edhrecRankTotal ?? rank
    const percentile = 1 - (rank / Math.max(total, 1))
    let delta = Math.max(30, Math.round(200 * percentile))

    if (context.primaryArchetypeId) {
      const UNIVERSAL_ROLES = new Set(['land', 'ramp', 'draw', 'removal', 'wipe', 'protection'])
      const cardRoles = card.roles ?? []
      const isUniversal = cardRoles.some(r => UNIVERSAL_ROLES.has(r))
      if (!isUniversal) {
        const primary = context.archetypes?.find(a => a.id === context.primaryArchetypeId)
        const fits = cardMatchesArchetype(card, primary)
        if (!fits) {
          delta = Math.round(delta * 0.5)
          log(`EDHREC rank ${rank}/${total} (off-lane, halved)`, delta)
        } else {
          log(`EDHREC rank ${rank}/${total}`, delta)
        }
      } else {
        log(`EDHREC rank ${rank}/${total}`, delta)
      }
    } else {
      log(`EDHREC rank ${rank}/${total}`, delta)
    }
    score += delta
  }

  // Combo signals
  if (context.combos?.length) {
    const lowerName = card.name.toLowerCase()
    const picked = context.pickedNames ?? new Set()
    const commanderLower = commander.name.toLowerCase()

    let comboBonus = 0
    let completesCombo = false
    let comboNotes = []
    for (const combo of context.combos) {
      const cardsLower = combo.cards.map(c => c.toLowerCase())
      if (!cardsLower.includes(lowerName)) continue
      const others = cardsLower.filter(c => c !== lowerName)
      const haveOthers = others.filter(c => picked.has(c) || c === commanderLower).length
      const isCompleter = others.length > 0 && haveOthers === others.length
      if (haveOthers === 0 && (combo.minimumBracket ?? 4) > bracket + 1) continue
      if (cardsLower.includes(commanderLower)) comboBonus += 8
      if (isCompleter) {
        completesCombo = true
        comboBonus += 40
        comboNotes.push(`completes: ${combo.cards.join(' + ')}`)
      } else if (haveOthers > 0) {
        comboBonus += 6 * haveOthers
        comboNotes.push(`partial (${haveOthers}/${cardsLower.length}): ${combo.cards.join(' + ')}`)
      } else {
        comboBonus += 1
      }
    }
    const capped = Math.min(comboBonus, completesCombo ? 80 : 30)
    if (capped !== 0) {
      score += capped
      const reason = comboNotes.length > 0 ? `Combo (${comboNotes[0]})` : 'Combo (in known list)'
      log(reason, capped)
    }
  }

  // Vanilla / no-payoff penalty
  const isLandCard = (card.roles ?? []).includes('land')
  const isProtected = POWER_CARDS.has(card.name) || context.edhrecRank?.has?.(card.name)
  if (!isLandCard && !isProtected && hasNoMeaningfulText(card)) {
    score -= 25
    log('Vanilla / no-payoff text', -25)
  }

  // Bracket fit adjustments
  const tags = card.tags ?? []
  if (bracket <= 2 && tags.includes('fast_mana') && !isSafeRock(card.name)) { score -= 20; log('Fast mana at low bracket', -20) }
  if (bracket <= 1 && tags.includes('game_changer'))                        { score -= 20; log('Game changer at bracket 1', -20) }
  if (bracket >= 4 && tags.includes('tutor'))                               { score += 5;  log('Tutor at high bracket',     5) }
  if (bracket >= 4 && tags.includes('fast_mana'))                           { score += 5;  log('Fast mana at high bracket', 5) }

  return score
}

function makeLogger(map, name, role) {
  // Reset on each scoring pass — we want only the most recent breakdown,
  // not the cumulative log across all 10 re-score passes.
  const key = `${name}:${role}`
  const arr = []
  map.set(key, arr)
  return (reason, delta) => arr.push([reason, delta])
}
function noopLog() { /* breakdown not requested */ }

// Patterns that indicate a card actually does something. If none of these match
// the oracle text, the card is essentially vanilla (just stats / a body) and
// gets penalized so it loses to actual payoffs in the same role bucket.
const MEANINGFUL_TEXT_PATTERNS = [
  /draw|cantrip|scry/, /destroy|exile|counter target|return target/,
  /create .* token|put .* counter/,
  /search your library|tutor/, /add \{|treasure/, /protection|hexproof|indestructible|shroud/,
  /flying|trample|menace|deathtouch|lifelink|haste|vigilance|reach|first strike|double strike/,
  /unblockable|can't be blocked/, /ninjutsu|prowess|evolve|adapt|outlast|landfall/,
  /whenever|when .* enters|when .* dies|at the beginning/,
  /sacrifice|reanimate|return .* graveyard/, /equip|enchant/,
  /opponent|each player|target player/, /storm|cascade|delve|flashback|escape|madness/,
  /\+1\/\+1|-1\/-1/, /life/, /\bcopy\b|\bclone\b/, /pay \{/,
]
function hasNoMeaningfulText(card) {
  const text = getOracleText(card)
  if (!text) return true
  for (const re of MEANINGFUL_TEXT_PATTERNS) if (re.test(text)) return false
  return true
}

function isSafeRock(name) {
  return ['Sol Ring', 'Arcane Signet', 'Fellwar Stone', 'Mind Stone', 'Thought Vessel'].includes(name)
}

// Land quality scoring. Returns a delta to add to the base land score.
// Curated lists pluck out the fetch / dual / fast / shock / utility tiers so
// the land bucket fills with mana-fixing first and only takes utility lands
// when the strong fixing is exhausted.
const PREMIUM_LANDS = new Set([
  // Fetchlands
  'Polluted Delta', 'Flooded Strand', 'Bloodstained Mire', 'Wooded Foothills',
  'Windswept Heath', 'Marsh Flats', 'Misty Rainforest', 'Scalding Tarn',
  'Verdant Catacombs', 'Arid Mesa', 'Prismatic Vista', 'Fabled Passage',
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
  // Surveil/check/horizon lands and other premium
  'Mana Confluence', 'City of Brass', 'Reflecting Pool', 'Forbidden Orchard',
  'Ancient Tomb', 'Gaea\'s Cradle', 'Cabal Coffers', 'Bojuka Bog',
  'Strip Mine', 'Wasteland', 'Field of the Dead', 'Maze of Ith',
  'Boseiju, Who Endures', 'Otawara, Soaring City', 'Eiganjo, Seat of the Empire',
  'Takenuma, Abandoned Mire', 'Sokenzan, Crucible of Defiance',
])

// Lands that ETB tapped with no payoff, or that fix only marginally. Penalized so
// they only get picked when nothing better remains.
const WEAK_LANDS = new Set([
  'Crossroads Village', 'Hidden Grotto', 'Glimmerpost', 'Stalking Stones',
  'Cave of Temptation', 'Daily Bugle Building', 'News Helicopter', 'Foul Roads',
  'Helvault', 'Seafloor Debris', 'Svyelunite Temple', 'Tainted Isle',
  'Warped Landscape', 'Terrain Generator', 'Temple of the False God',
  'Urza\'s Tower', 'Urza\'s Mine', 'Urza\'s Power Plant',
])

function scoreLandQuality(card) {
  const name = card.name
  if (PREMIUM_LANDS.has(name)) return 25
  if (WEAK_LANDS.has(name))    return -25
  const text = getOracleText(card)
  // Heuristic: lands that explicitly say "enters tapped" with no compensating draw/scry/return effect → small penalty
  if (/enters .* tapped/.test(text) && !/(draw|scry|search|create)/.test(text)) return -8
  // Tutoring up duals (e.g. Farseek-style lands), ETB-untapped multicolor lands → small bonus
  if (/add \{[wubrg]\}.*\{[wubrg]\}|any color/.test(text)) return 12
  return 0
}

const MEANINGFUL_WORDS = [
  'counter', 'token', 'sacrifice', 'graveyard', 'enchantment', 'artifact',
  'flying', 'trample', 'lifelink', 'deathtouch', 'proliferate', 'aura',
  'equipment', 'zombie', 'vampire', 'elf', 'goblin', 'dragon', 'angel',
  'reanimate', 'discard', 'wheel', 'storm', 'copy', 'flicker', 'blink',
  '+1/+1', '-1/-1', 'commander', 'legend',
]

function countSharedMeaningfulWords(a, b) {
  return MEANINGFUL_WORDS.filter(w => a.includes(w) && b.includes(w)).length
}
