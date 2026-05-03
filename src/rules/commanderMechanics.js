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

// Build tribal-tag specs for a list of creature subtypes. Each tribe fires
// when oracle text references the subtype as a creature or spell — singular
// or plural, optional possessive forms. Critically, this matches ORACLE
// TEXT only; the type_line of the commander is irrelevant. A Human Warlock
// commander whose text doesn't say "Human" or "Warlock" gets NO tribal tag.
// Irregular plurals for Magic creature types. Most are regular (add s),
// but a few need explicit plurals.
const IRREGULAR_PLURALS = {
  elf: 'elves',
  dwarf: 'dwarves',
  werewolf: 'werewolves',
  octopus: 'octopuses',
  fungus: 'fungi',
}

function buildTribalTagSpecs(subtypes) {
  // Note: getOracleText() lowercases input, so all tribal patterns are
  // case-INSENSITIVE / lowercase. Word boundaries keep "elf" from
  // accidentally matching "self" or "elven".
  //
  // Tag uses the canonical English plural so cares-about-elves reads
  // naturally ("tribal_elves" not "tribal_elfs"). Patterns must accept
  // BOTH singular and plural forms because oracle text uses either.
  return subtypes.map(sub => {
    const s = sub.toLowerCase()
    const plural = IRREGULAR_PLURALS[s] ?? `${s}s`
    // Combined alternation matches singular OR plural in any pattern.
    const both = `(?:${s}|${plural})`
    return {
      tag: `tribal_${plural}`,
      patterns: [
        // Subtype followed by a card-type qualifier. Examples that match:
        //   "Dragons you control"  "search for ... Dragon cards"
        //   "Goblin creature"      "another Vampire spell"
        //   "Elves you control"    "Sliver creatures you control"
        new RegExp(`\\b${both}\\b\\s+(?:cards?|creatures?|spells?|tokens?|you control|enters)`, 'i'),
        // Possession: "Goblins you control", "Elves you control".
        new RegExp(`\\b${both}\\s+you\\s+control`, 'i'),
        // Cast trigger: "another Goblin spell", "Vampire spell you cast".
        new RegExp(`\\banother\\s+${s}\\s+spell`, 'i'),
        // We deliberately don't match the subtype alone — that would catch
        // flavor text and false positives.
      ],
    }
  })
}

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
    // Commander cares about opponents losing life (Sheoldred, Vito, etc.).
    // Distinct from "you pay X life" or "this deals damage to" — those are
    // life COSTS or direct damage. Lifeloss-cares means the commander has
    // a TRIGGER or ABILITY tied to opponents losing life, OR drains life
    // off opponents as part of its core text.
    tag: 'cares_about_lifeloss',
    patterns: [
      /whenever (?:an? |any )?opponent loses life/i,
      /whenever a player loses life/i,
      /(?:they|target opponent|target player|each opponent|each player) loses? \d+ life/i,
      /loses? life equal to/i,
    ],
  },
  {
    // Artifact-matters: archetype includes artifact creature/spell triggers,
    // sacrifice-an-artifact costs, return-artifact-from-graveyard. Note the
    // pattern requires "artifact" in a card-type context (not just being an
    // artifact creature in passing).
    tag: 'cares_about_artifacts',
    patterns: [
      /whenever (?:an? |another |you cast an? )?artifact/i,
      /sacrifice an artifact/i,
      /target artifact card/i,
      /artifact spells? (?:you cast )?cost/i,
      /artifacts you control/i,
    ],
  },
  {
    // Enchantment-matters: same pattern shape as artifacts.
    tag: 'cares_about_enchantments',
    patterns: [
      /whenever (?:an? |another |you cast an? )?enchantment/i,
      /sacrifice an enchantment/i,
      /target enchantment card/i,
      /enchantment spells? (?:you cast )?cost/i,
      /enchantments you control/i,
      /\bconstellation\b/i,
    ],
  },
  {
    // Lands-matter: landfall, additional lands per turn, return land from
    // graveyard, lands as anything other than mana sources.
    tag: 'cares_about_lands',
    patterns: [
      /\blandfall\b/i,
      /whenever a land enters/i,
      /target land card/i,
      /land cards? (?:from your graveyard|in your graveyard)/i,
      /play (?:an? )?additional lands?/i,
    ],
  },
  // Tribal "cares about" tags. A commander whose oracle text mentions a
  // creature type (e.g., "Dragons you control", "Goblin spell") cares
  // about that tribe — even if the commander itself isn't of that type.
  // Conversely, a commander that simply IS a Human Warlock but whose text
  // doesn't reference Humans or Warlocks does NOT get a tribal tag.
  // Type matched against oracle text only — never against the type_line.
  ...buildTribalTagSpecs([
    'dragon', 'goblin', 'vampire', 'zombie', 'elf', 'sliver',
    'human', 'angel', 'demon', 'dinosaur', 'merfolk', 'wizard',
    'warrior', 'soldier', 'knight', 'beast', 'spirit', 'cat',
  ]),
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
    // Discard-cares includes both TRIGGERS (whenever X discards) AND
    // commanders that USE discard as a cost or enable rummaging
    // (Lord Windgrace, Daretti, Olivia of Ovashia, etc.). The pattern
    // catches both because the same card-tag boost (wheels, looters)
    // applies — wheel effects refill hand for either purpose.
    tag: 'cares_about_discard',
    patterns: [
      /whenever .* discards?/i,
      /\bmadness\b/i,
      /each player discards/i,
      // Discard as a cost: "Discard a card, then draw a card" (rummaging),
      // "Discard up to two cards", etc. These are plus-ability costs on
      // planeswalkers or activated abilities.
      /discard a card/i,
      /discard up to (?:one|two|three|x|\d+) cards?/i,
      /\bsifting\b|\bcycling\b/i,
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
  cares_about_lifeloss:      ['lifegain', 'lifegain_payoff', 'sacrifice_payoff'],
  cares_about_etb:           ['etb_payoff', 'flicker', 'token_producer'],
  cares_about_mana:          ['mana_doubler'],
  cares_about_discard:       ['wheel'],
  cares_about_combat_phases: ['extra_combat', 'attack_payoff', 'token_producer'],
  cares_about_artifacts:     ['artifact_payoff', 'token_producer'],
  cares_about_enchantments:  ['enchantment_payoff'],
  cares_about_lands:         ['ramp', 'landfall_payoff'],
  // Tribal tags don't map to card tags directly — they layer on top of
  // the existing archetype detection in archetypeRules. Listed here for
  // completeness so they're recognized as "real" tags.
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
