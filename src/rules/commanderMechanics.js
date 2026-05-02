// Commander mechanic-tag extraction and card-tag mapping.
//
// Why this exists: detectArchetypes (in archetypeRules.js) captures the
// broad strategic shape of a commander (tribal:dragon, aristocrats,
// spellslinger). This module captures a finer signal — which specific
// MECHANIC TAGS the commander cares about, derived from oracle text.
//
// A commander that says "Whenever a creature dies" cares about
// `cares_about_sacrifice`. Cards tagged `sac_outlet` or `sacrifice_payoff`
// (in cardRoles.js) get a synergy bonus when scored. This is more
// surgical than archetype matching, which is broad-pattern.
//
// Layered ON TOP OF archetypes — both signals stack. A card that
// matches BOTH the aristocrats archetype AND has the sac_outlet tag
// gets archetype fit + mechanic synergy bonus.

import { getOracleText } from '../utils/cardHelpers'

// Patterns that detect what a commander "cares about." Each tag fires
// when ANY pattern matches the commander's oracle text. Tags layer —
// a multi-faceted commander like Niv-Mizzet Parun fires multiple.
const COMMANDER_MECHANIC_PATTERNS = [
  {
    tag: 'cares_about_sacrifice',
    patterns: [
      /\bsacrifice\b/i,
      /whenever (?:another )?creature (?:you control )?dies/i,
      /when .* is put into .* graveyard from the battlefield/i,
    ],
  },
  {
    tag: 'cares_about_tokens',
    patterns: [
      /\btoken\b/i,
      /create [^.]*token/i,
      /whenever a (?:nontoken )?(?:creature )?token/i,
    ],
  },
  {
    tag: 'cares_about_draw',
    patterns: [
      /whenever you draw a card/i,
      /draw [^.]*additional/i,
      /each opponent draws/i,
      /whenever a player draws/i,
    ],
  },
  {
    tag: 'cares_about_spells',
    patterns: [
      // "Whenever you cast an instant or sorcery spell" — drop the trailing
      // "spell" requirement so we match the typespec regardless of phrasing.
      /whenever you cast (?:an? )?(?:instant|sorcery|noncreature)/i,
      /whenever a player casts an? (?:instant|sorcery|noncreature)/i,
      /storm/i,
      /prowess/i,
    ],
  },
  {
    tag: 'cares_about_attacks',
    patterns: [
      // Allow arbitrary text between "Whenever" and "attacks" so phrasings
      // like "Whenever Najeela attacks" or "Whenever a Warrior you control
      // attacks" both match. [^.]* avoids crossing sentence boundaries.
      /whenever [^.]*\battacks\b/i,
      /whenever you attack/i,
      /whenever [^.]*deals combat damage/i,
    ],
  },
  {
    tag: 'cares_about_counters',
    patterns: [
      /\+1\/\+1 counter/i,
      /-1\/-1 counter/i,
      /\bproliferate\b/i,
      /whenever .* counter is put on/i,
    ],
  },
  {
    tag: 'cares_about_graveyard',
    patterns: [
      /from your graveyard/i,
      /from a graveyard/i,
      /\bmill\b/i,
      /return .* graveyard to .* (?:hand|battlefield)/i,
      /each player .* graveyard/i,
    ],
  },
  {
    tag: 'cares_about_lifegain',
    patterns: [
      /whenever you gain life/i,
      /you gain (\d+|x) life/i,
      /\blifelink\b/i,
    ],
  },
  {
    tag: 'cares_about_etb',
    patterns: [
      /whenever (?:another )?(?:nontoken )?(?:creature|permanent) (?:you control )?enters/i,
      /when .* enters .* under your control/i,
      /\bblink\b|\bflicker\b/i,
    ],
  },
  {
    tag: 'cares_about_mana',
    patterns: [
      /add .* mana/i,
      /additional .* land/i,
      /play .* additional land/i,
      /lands you control/i,
    ],
  },
  {
    tag: 'cares_about_discard',
    patterns: [
      /whenever .* discards?/i,
      /\bmadness\b/i,
      /each player discards/i,
    ],
  },
  {
    tag: 'cares_about_combat_phases',
    patterns: [
      /additional combat phase/i,
      /untap all (?:attacking )?creatures/i,
      /extra combat/i,
    ],
  },
]

// Map a commander mechanic tag to the card mechanic tags (from cardRoles.js)
// that produce/enable that mechanic. When a commander has X, cards tagged
// with the mapped values get a synergy bonus.
const COMMANDER_TAG_TO_CARD_TAGS = {
  cares_about_sacrifice:     ['sac_outlet', 'sacrifice_payoff', 'token_producer', 'recursion'],
  cares_about_tokens:        ['token_producer', 'token_doubler', 'attack_payoff', 'mass_pump'],
  cares_about_draw:          ['wheel', 'lifegain_payoff'],
  cares_about_spells:        ['storm_enabler', 'copy_effect', 'wheel'],
  cares_about_attacks:       ['attack_payoff', 'extra_combat', 'mass_pump', 'token_producer'],
  cares_about_counters:      ['counters_payoff', 'counters_doubler', 'proliferate'],
  cares_about_graveyard:     ['recursion', 'sacrifice_payoff', 'mill', 'graveyard_hate'],
  cares_about_lifegain:      ['lifegain', 'lifegain_payoff'],
  cares_about_etb:           ['etb_payoff', 'flicker', 'token_producer'],
  cares_about_mana:          ['mana_doubler'],
  cares_about_discard:       ['wheel'],
  cares_about_combat_phases: ['extra_combat', 'attack_payoff', 'token_producer'],
}

// Bonus per matching card-tag → commander-tag pair, capped to prevent
// runaway scoring on multi-mechanic cards (e.g., Korvold has 3+ tags;
// every Goblin token producer would otherwise get +45+).
const PER_TAG_MATCH_BONUS = 8
const MAX_MECHANIC_BONUS  = 24

export function extractCommanderMechanicTags(commander) {
  if (!commander) return []
  const text = getOracleText(commander)
  if (!text) return []

  const tags = []
  for (const { tag, patterns } of COMMANDER_MECHANIC_PATTERNS) {
    if (patterns.some(p => p.test(text))) tags.push(tag)
  }
  return tags
}

// Returns a Set<cardTag> of which card-level mechanic tags should get a
// boost, given the commander's mechanic tags. Computed once per
// generation and stored on scoringContext.
export function commanderToCardTagBoosts(commanderTags) {
  const boosted = new Set()
  for (const t of commanderTags) {
    const cardTags = COMMANDER_TAG_TO_CARD_TAGS[t] ?? []
    for (const ct of cardTags) boosted.add(ct)
  }
  return boosted
}

// Score bonus for a single card. Sums PER_TAG_MATCH_BONUS for each card
// tag that's in the boosted set; caps at MAX_MECHANIC_BONUS to prevent
// runaway scoring. Returns 0 when there's no match or no boosted set.
export function mechanicSynergyBonus(card, boostedCardTags) {
  if (!boostedCardTags || boostedCardTags.size === 0) return 0
  const cardTags = card?.tags ?? []
  if (cardTags.length === 0) return 0
  let bonus = 0
  for (const t of cardTags) {
    if (boostedCardTags.has(t)) bonus += PER_TAG_MATCH_BONUS
  }
  return Math.min(bonus, MAX_MECHANIC_BONUS)
}
