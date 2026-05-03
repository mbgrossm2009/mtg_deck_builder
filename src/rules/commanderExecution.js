// Commander execution score.
//
// Measures: of the deck's non-land, non-universal-staple slots, what
// fraction actually advance the commander's plan? A high score means
// most slots are doing commander-specific work. A low score means the
// deck looks like generic goodstuff that ignores its commander.
//
// Why this exists: the previous filler counting + role tagging measures
// "does this card have a recognized role" but not "is this card on-plan
// for THIS commander." Two decks can have identical role counts and one
// is well-built around its commander while the other ignores it.
//
// A card counts as execution-relevant if any of:
//   1. It has the 'synergy' role (cardRoles assigned it because of
//      keyword overlap with the commander's oracle text).
//   2. It carries a mechanic tag in the commander's boost set
//      (commanderToCardTagBoosts — e.g., a `sac_outlet` tag in a Korvold
//      deck which boosts sac/sacrifice_payoff/token_producer/recursion).
//   3. It's tagged with a tribal_<type> matching a tribal commander.
//   4. It's an anchor card for one of the commander's detected archetypes
//      (passed in via `anchorNames` — the orchestrator already builds
//      this set from archetypeRules.anchorNamesFor).
//
// Cards EXCLUDED from both numerator and denominator:
//   - Lands (don't count toward execution either way)
//   - Universal staples (Sol Ring class — they're correctly included
//     in nearly every deck regardless of commander, so counting them
//     against execution would penalize good decks)
//
// Thresholds DECREASE at higher brackets, not increase. cEDH decks
// legitimately have more universal staples (more tutors, fast mana,
// free counters), so a "high execution" threshold at B5 would
// incorrectly flag tightly-tuned cEDH lists.

import { commanderToCardTagBoosts } from './commanderMechanics'

// Universal staples — cards good in nearly every deck regardless of
// commander. Excluding these from the execution-score denominator means
// "slots the deck COULD have used for commander-specific work" — not
// counting Sol Ring against you for being in the deck.
//
// We don't enumerate every staple here — the orchestrator's bracket-
// staples list and the eval prompt have richer lists. This is the
// minimal set that's universally true across all colors/strategies.
const UNIVERSAL_STAPLE_NAMES = new Set([
  'sol ring',
  'arcane signet',
  'command tower',
  'mind stone',
  'fellwar stone',
  'thought vessel',
  'wayfarer\'s bauble',
  'mana crypt',
  'mana vault',
  'mox diamond',
  'chrome mox',
  'mox opal',
  'mox amber',
  'lotus petal',
  'jeweled lotus',
  'lightning greaves',
  'swiftfoot boots',
  'skullclamp',
  'sensei\'s divining top',
  'solemn simulacrum',
  'burnished hart',
  'reliquary tower',
])

const BRACKET_THRESHOLDS = {
  1: 0.20,
  2: 0.30,
  3: 0.40,
  4: 0.40,
  5: 0.30,
}

/**
 * Compute the commander execution score for a finished deck.
 *
 * @param {object} args
 * @param {Array}  args.deck         — final mainDeck (99 cards)
 * @param {object} args.commander    — commander card
 * @param {Array}  args.mechanicTags — output of extractCommanderMechanicTags
 * @param {Set}    args.anchorNames  — set of archetype anchor names (lowercased)
 * @returns {{
 *   score: number,           // 0-1 fraction
 *   relevant: number,        // count of execution-relevant cards
 *   considered: number,      // denominator (non-land non-staple cards)
 *   ofWhich: { synergy: number, mechanicTag: number, tribal: number, anchor: number }
 * }}
 */
export function computeCommanderExecutionScore({ deck, commander, mechanicTags = [], anchorNames = new Set() }) {
  const tagBoosts = commanderToCardTagBoosts(mechanicTags)
  const tribalTags = new Set(
    mechanicTags
      .filter(t => t.startsWith('tribal_'))
      .map(t => `tribal_${t.replace(/^tribal_/, '').replace(/s$/, '')}`)  // tribal_dragons → tribal_dragon (matches cardRoles)
  )
  // cardRoles tags tribal as `tribal_<singular>` e.g. tribal_dragon. Our
  // commander mechanic tags use plural `tribal_dragons`. Build both forms.
  const tribalTagsAlt = new Set(
    mechanicTags.filter(t => t.startsWith('tribal_'))
  )

  let considered = 0
  const ofWhich = { synergy: 0, mechanicTag: 0, tribal: 0, anchor: 0 }
  let relevant = 0

  for (const card of deck) {
    const tl = (card.type_line ?? '').toLowerCase()
    if (tl.includes('land')) continue

    const lowerName = (card.name ?? '').toLowerCase()
    if (UNIVERSAL_STAPLE_NAMES.has(lowerName)) continue

    considered++

    const roles = card.roles ?? []
    const tags  = card.tags ?? []

    let isRelevant = false
    if (roles.includes('synergy'))                            { ofWhich.synergy++;     isRelevant = true }
    if (tags.some(t => tagBoosts.has(t)))                     { ofWhich.mechanicTag++; isRelevant = true }
    if (tags.some(t => tribalTags.has(t) || tribalTagsAlt.has(t))) {
                                                                ofWhich.tribal++;      isRelevant = true
    }
    if (anchorNames.has(lowerName))                           { ofWhich.anchor++;      isRelevant = true }

    if (isRelevant) relevant++
  }

  const score = considered > 0 ? relevant / considered : 0
  return { score, relevant, considered, ofWhich }
}

/**
 * Returns the bracket-appropriate execution threshold.
 * @param {number} bracket 1-5
 * @returns {number} 0-1 fraction
 */
export function getExecutionThresholdForBracket(bracket) {
  return BRACKET_THRESHOLDS[bracket] ?? 0.40
}

/**
 * Returns true if the score meets the bracket threshold.
 */
export function meetsExecutionThreshold(score, bracket) {
  return score >= getExecutionThresholdForBracket(bracket)
}

// Test-only — exposed so the universal-staples list can be inspected.
export const _internal = {
  UNIVERSAL_STAPLE_NAMES,
  BRACKET_THRESHOLDS,
}
