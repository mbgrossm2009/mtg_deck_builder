import { getOracleText } from '../utils/cardHelpers'
import { scoreArchetypeFit, cardMatchesArchetype, isCompetingArchetypeAnchor } from './archetypeRules'
import { targetAvgCmc } from './bracketRules'
import { landTierScoreDelta } from './landQuality'
import { mechanicSynergyBonus } from './commanderMechanics'

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
  // Existing universal staples
  'Sol Ring', 'Arcane Signet', 'Cyclonic Rift', 'Swords to Plowshares',
  'Path to Exile', 'Cultivate', 'Kodama\'s Reach', 'Farseek',
  'Rhystic Study', 'Mystic Remora', 'Smothering Tithe', 'Sylvan Library',
  'Necropotence', 'Demonic Tutor', 'Vampiric Tutor', 'Counterspell',
  'Force of Will', 'Mana Drain', 'Teferi\'s Protection', 'Heroic Intervention',
  'Swan Song', 'Negate', 'Damnation', 'Wrath of God', 'Toxic Deluge',
  'Blasphemous Act', 'Windfall', 'Wheel of Fortune', 'Survival of the Fittest',
  'Craterhoof Behemoth', 'Triumph of the Hordes',
  // cEDH / B4+ optimized staples — were missing, which meant Mana Crypt could
  // lose its slot to a mid-tier synergy card at B5. Adding them lifts their
  // score so they win slots when the user owns them.
  'Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox', 'Mox Opal',
  'Mox Amber', 'Lotus Petal', 'Jeweled Lotus', 'Jeweled Amulet',
  'Dockside Extortionist', 'Grim Monolith', 'Ancient Tomb',
  // High-tier tutors
  'Imperial Seal', 'Mystical Tutor', 'Enlightened Tutor', 'Worldly Tutor',
  'Green Sun\'s Zenith', 'Chord of Calling', 'Birthing Pod',
  // Extra interaction
  'Force of Negation', 'Pact of Negation', 'Flusterstorm', 'Esper Sentinel',
  // Combo wincons
  'Thassa\'s Oracle', 'Demonic Consultation', 'Tainted Pact',
  'Laboratory Maniac', 'Jace, Wielder of Mysteries',
  'Aetherflux Reservoir', 'Underworld Breach',
  // Other top-tier value
  'Yawgmoth, Thran Physician', 'Opposition Agent', 'Drannith Magistrate',
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

  // CMC scoring — bracket-aware. Each bracket has a target average CMC
  // (see targetAvgCmc in bracketRules.js). Cards at or below the target
  // get a bonus; cards above it get a penalty that scales with how far
  // over they are. This means a 6-drop is acceptable at bracket 1
  // (target 4.0) but a serious negative at bracket 5 (target 2.0).
  //
  // Bonus is doubled when the running deck average is already above
  // target — the scorer "leans into the curve" as the deck fills,
  // preferring cheaper cards once the curve drifts heavy.
  const cmc = card.cmc ?? 0
  if (role !== 'win_condition' && role !== 'filler') {
    const target = targetAvgCmc(bracket)
    const overTargetBy = cmc - target

    let cmcDelta = 0
    if (overTargetBy <= -1.5)      cmcDelta = 7   // well below target — strong bonus
    else if (overTargetBy <= -0.5) cmcDelta = 5   // slightly below — small bonus
    else if (overTargetBy <= 0.5)  cmcDelta = 2   // on target — token bonus
    else if (overTargetBy <= 1.5)  cmcDelta = -2  // slightly over
    else if (overTargetBy <= 2.5)  cmcDelta = -5  // notably over
    else                            cmcDelta = -9  // way over (e.g. 7-drop in cEDH)

    // Amplify the penalty if the running deck average is already heavy.
    // runningCmcOverTarget is provided by deckGenerator while the deck fills.
    const runningOver = context.runningCmcOverTarget ?? 0
    if (runningOver > 0.3 && cmcDelta < 0) {
      cmcDelta = Math.round(cmcDelta * 1.5)  // -5 → -8, -9 → -14
    }

    if (cmcDelta !== 0) {
      score += cmcDelta
      log(`CMC ${cmc} vs target ${target.toFixed(1)}`, cmcDelta)
    }
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

    // Off-archetype synergy/filler penalty. When a primary is locked, cards
    // that fall into the synergy/filler bucket but don't fit the locked
    // archetype get pushed down so on-archetype picks win the slot. Universal
    // staples (lands/ramp/draw/removal/wipe/protection) are exempt — they're
    // commander-agnostic and matter regardless of strategy.
    if (context.primaryArchetypeId) {
      const UNIVERSAL_ROLES = new Set(['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'win_condition'])
      const cardRoles = card.roles ?? []
      const primaryRole = cardRoles[0] ?? 'filler'
      const isSynergyOrFiller = primaryRole === 'synergy' || primaryRole === 'filler'
      const isUniversal = cardRoles.some(r => UNIVERSAL_ROLES.has(r))
      if (isSynergyOrFiller && !isUniversal) {
        const primary = context.archetypes?.find(a => a.id === context.primaryArchetypeId)
        if (primary && !cardMatchesArchetype(card, primary)) {
          score -= 30
          log('Off-archetype synergy/filler (locked)', -30)
        }
      }
    }
  } else {
    const sharedWords = countSharedMeaningfulWords(getOracleText(commander), getOracleText(card))
    const delta = Math.min(sharedWords * 2, 10)
    if (delta > 0) { score += delta; log(`Keyword overlap (${sharedWords})`, delta) }
  }

  // Commander mechanic synergy — when the commander "cares about" a mechanic
  // (e.g., sacrifice, tokens, attacks), boost cards tagged with the
  // corresponding card-level mechanic (sac_outlet, token_producer, etc.).
  // This is more granular than archetype fit — captures specific ability
  // enablers the broad archetype matcher might miss.
  if (context.commanderTagBoosts?.size > 0) {
    const mechBonus = mechanicSynergyBonus(card, context.commanderTagBoosts)
    if (mechBonus > 0) { score += mechBonus; log('Commander mechanic synergy', mechBonus) }
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

// Land quality scoring is delegated to landQuality.js — single source of truth
// shared with manaBaseSolver.js and the LLM prompt builder.
const scoreLandQuality = landTierScoreDelta

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
