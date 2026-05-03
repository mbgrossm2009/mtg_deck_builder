import { getOracleText, isLand, isBasicLand } from '../utils/cardHelpers'
import { GAME_CHANGERS_SET } from '../data/gameChangers'

// Hardcoded fast mana — anything here is tagged 'fast_mana' regardless of oracle text
const FAST_MANA = new Set([
  'Sol Ring', 'Mana Crypt', 'Mana Vault', 'Grim Monolith', 'Chrome Mox',
  'Mox Diamond', 'Mox Opal', 'Jeweled Lotus', 'Lotus Petal', 'Mox Amber',
  'Arcane Signet', 'Fellwar Stone', 'Mind Stone', 'Thought Vessel',
  'Dockside Extortionist',
])

// Cards that explicitly close games — Craterhoof effects, mass evasion, alt-wincons.
// Hardcoded because "explosive finisher" is a judgment call that regex can't reliably make.
// Anything here gets the 'explosive_finisher' tag, which the LLM is told to prioritize.
const EXPLOSIVE_FINISHERS = new Set([
  // Mass-pump finishers
  'Craterhoof Behemoth', 'Overwhelming Stampede', 'Pathbreaker Ibex',
  'Overrun', 'End-Raze Forerunners', 'Triumph of the Hordes',
  'Beastmaster Ascension', 'Akroma\'s Will', 'Coat of Arms',
  // Alt-wincons / explosive plays
  'Insurrection', 'Torment of Hailfire', 'Exsanguinate', 'Debt to the Deathless',
  'Approach of the Second Sun', 'Aetherflux Reservoir', 'Thassa\'s Oracle',
  'Laboratory Maniac', 'Jace, Wielder of Mysteries', 'Felidar Sovereign',
  'Test of Endurance', 'Biorhythm', 'Expropriate', 'Genesis Wave',
  // Mass evasion finishers
  'Finale of Devastation', 'Last March of the Ents', 'Tooth and Nail',
])

// Cards that specifically protect the commander (or any single key creature).
// Distinct from the 'protection' role bucket — those include all hexproof/indestructible
// effects. This narrower tag is for the staples a deck reaches for to keep its commander
// alive: targeted protection equipment, repeatable shrouds, and the cheap save-the-board
// instants. The LLM is told to include ≥3 of these when the deck depends on the commander.
const COMMANDER_PROTECTION = new Set([
  'Lightning Greaves', 'Swiftfoot Boots', 'Champion\'s Helm', 'Whispersilk Cloak',
  'Mother of Runes', 'Giver of Runes', 'Selfless Spirit', 'Selfless Savior',
  'Heroic Intervention', 'Teferi\'s Protection', 'Flawless Maneuver',
  'Lazotep Plating', 'Wrap in Vigor', 'Eerie Interlude', 'Ghostway',
  'Boros Charm', 'Tamiyo\'s Safekeeping', 'Sigarda\'s Aid',
  'Asceticism', 'Privileged Position', 'Sterling Grove',
])

const TUTORS = new Set([
  'Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Enlightened Tutor',
  'Mystical Tutor', 'Worldly Tutor', 'Grim Tutor', 'Diabolic Tutor',
  'Cruel Tutor', 'Beseech the Queen', 'Birthing Pod', 'Survival of the Fittest',
  'Fauna Shaman', 'Chord of Calling', 'Green Sun\'s Zenith', 'Firemind\'s Foresight',
  'Fabricate', 'Reshape', 'Transmute Artifact', 'Whir of Invention',
  'Tainted Pact', 'Lim-Dul\'s Vault', 'Gamble', 'Personal Tutor',
  'Idyllic Tutor', 'Sterling Grove', 'Wargate', 'Prize Pig',
  'Buried Alive', 'Entomb', 'Reanimate',
])

// Cards whose single-card presence represents a real win plan. Audited
// 2026-05-03 after eval data showed Sorin BW decks counting 10 wincons,
// which inflated the appearance of "multiple win conditions" while
// detectedWincons remained empty. The pruning removed:
//   - Exquisite Blood / Sanguine Bond — these are COMBO HALVES, not
//     single-card wincons. Sanguine Bond also serves as the life-drain
//     engine payoff (handled via detectMultiCardWincons), so it still
//     contributes to a detected pattern.
//   - Heliod's Intervention — it's removal+lifegain, not a wincon.
//   - Consuming Aberration — a body that grows from mill, not a closer
//     (becomes a wincon only with combat-damage payoffs).
// Added Triskaidekaphile (alt-win on draw count, real B3+ closer).
const WIN_CONDITIONS = new Set([
  // Library-out alt-wincons
  'Thassa\'s Oracle', 'Laboratory Maniac', 'Jace, Wielder of Mysteries',
  // Storm-tier closers
  'Aetherflux Reservoir',
  // X-spell finishers
  'Insurrection', 'Torment of Hailfire', 'Debt to the Deathless',
  // 7th-cast / approach-style alt-wins
  'Approach of the Second Sun',
  // Mass-pump finishers
  'Craterhoof Behemoth', 'Triumph of the Hordes', 'Biorhythm',
  // Damage-on-draw closers
  'Psychosis Crawler', 'Triskaidekaphile',
  // Mill-payoff closers
  'Altar of the Brood',
  // Alt-wincons (upkeep/condition checks)
  'Revel in Riches', 'Mechanized Production',
  'Felidar Sovereign', 'Test of Endurance', 'Darksteel Reactor',
  'Mayael\'s Aria', 'Azor\'s Elocutors',
])

// `extras` lets the generator pass through:
//   anchorNames        — Set<string> of curated archetype anchor names. Match → synergy role.
//   commanderTypes     — array of lowercased creature subtypes from the commander's type_line.
//                        Used as bonus synergy keywords (e.g. Koma is a Serpent → 'serpent' counts).
//   commanderTagBoosts — Set<string> of card-level mechanic tags that the commander
//                        cares about (computed via commanderToCardTagBoosts). When a
//                        card carries any of these tags, it gets the synergy role even
//                        when keyword overlap fails. Critical for lifegain commanders
//                        (Sorin/Daxos) where Sanguine Bond / Cliffhaven Vampire have
//                        no SYNERGY_KEYWORDS overlap with the commander's text but
//                        clearly enable the deck's plan via the lifegain_payoff tag.
export function assignRoles(card, commander, extras = {}) {
  const text = getOracleText(card)
  const type = (card.type_line ?? '').toLowerCase()
  const name = card.name

  const roles = []
  const tags = []

  if (isBasicLand(card)) { roles.push('land'); return { roles, tags } }
  if (isLand(card))       { roles.push('land'); return { roles, tags } }

  if (FAST_MANA.has(name))             tags.push('fast_mana')
  if (GAME_CHANGERS_SET.has(name))     tags.push('game_changer')
  if (TUTORS.has(name))                tags.push('tutor')
  if (EXPLOSIVE_FINISHERS.has(name))   tags.push('explosive_finisher')
  if (COMMANDER_PROTECTION.has(name))  tags.push('commander_protection')
  if (WIN_CONDITIONS.has(name)) roles.push('win_condition')

  // Regex-based tutor detection — catches non-land tutors that aren't in the
  // hardcoded TUTORS set. Critical for bracket gating: an untagged tutor sneaks
  // past the bracket 1-2 filter, defeating the whole bracket system.
  //
  // Important: land tutors (Cultivate, Farseek, etc.) are NOT included here —
  // they're tagged as 'ramp' separately. We only match patterns that target
  // non-land card types, or generic "search your library for a card" without
  // a "land" qualifier.
  if (!tags.includes('tutor') && (
    // Type-specific tutors. Also matches "search their library" for cards like
    // Pattern of Rebirth where the effect grants a tutor to the controller of an
    // enchanted creature (which is usually you).
    /search (?:your|their) library for an? (?:creature|instant|sorcery|enchantment|artifact|planeswalker|legendary) card/.test(text) ||
    // Tribal tutors — "search your library for a Goblin/Elf/Faerie creature card"
    /search (?:your|their) library for an? [a-z]+ creature card/.test(text) ||
    // Mana-value tutors (Chord of Calling, Wargate, Birthing Pod, Eldritch Evolution)
    /search your library for an? [^.]*card with (?:converted )?mana (?:value|cost)/.test(text) ||
    // Nonland tutors (Sterling Grove, Wargate)
    /search your library for an? (?:nonland|non-land) card/.test(text) ||
    // Demonic-Tutor-class: search for "a card" then to hand or top of library.
    // Excludes land tutors by requiring the destination to NOT be the battlefield-as-land.
    /search your library for a card[^.]*put (?:it|that card) (?:into your hand|on top of your library)/.test(text) ||
    // Cheat-into-play tutors (Tooth and Nail, Defense of the Heart, Natural Order)
    // "Search your library for X creature cards, put them onto the battlefield" —
    // creature-card-onto-battlefield is unambiguously a tutor (lands go to play differently).
    /search your library for (?:up to )?(?:two|three|four|x) creature cards/.test(text)
  )) {
    tags.push('tutor')
  }

  // Regex-based win con detection — picks up finishers our hardcoded list misses.
  // Anything that literally says you win the game, or makes each opponent lose
  // the game / their library / their life total, is a win con regardless of name.
  if (
    /you win the game/.test(text) ||
    /each opponent loses the game/.test(text) ||
    /target opponent loses the game/.test(text) ||
    /any number of target players? loses the game/.test(text)
  ) {
    if (!roles.includes('win_condition')) roles.push('win_condition')
  }

  // Ramp
  if (
    /add \{/.test(text) ||
    /search your library for (?:a |up to (?:one|two) )?(?:basic )?lands?/.test(text) ||
    /an additional land/.test(text) ||
    /\btreasure\b/.test(text) && /create/.test(text) ||
    (type.includes('artifact') && /add \{/.test(text)) ||
    FAST_MANA.has(name)
  ) {
    if (!isLand(card)) roles.push('ramp')
  }

  // Draw
  if (
    /draw (?:a card|(?:two|three|four|x) cards|cards)/.test(text) ||
    /draws? (?:a card|(?:two|three) cards)/.test(text)
  ) {
    roles.push('draw')
  }

  // Removal
  if (
    /destroy target/.test(text) ||
    /exile target/.test(text) ||
    /return target .+ to (?:its owner's|their owner's) hand/.test(text) ||
    /counter target/.test(text) ||
    /-\d+\/-\d+/.test(text) ||
    /deals \d+ damage to target/.test(text)
  ) {
    roles.push('removal')
  }

  // Board wipes
  if (
    /destroy all/.test(text) ||
    /exile all/.test(text) ||
    /each creature gets -/.test(text) ||
    /return all/.test(text) ||
    /deals \d+ damage to each/.test(text) ||
    /all creatures get -/.test(text)
  ) {
    roles.push('wipe')
  }

  // Protection — keyword-protection / immunity effects only.
  // Counterspells live in 'removal' instead; conflating them as protection means
  // the 3 protection slots get stolen by counters and actual creature-protection
  // (Lightning Greaves, Swiftfoot Boots) loses the bucket.
  if (
    /\bhexproof\b/.test(text) ||
    /\bindestructible\b/.test(text) ||
    /\bshroud\b/.test(text) ||
    /can't be countered/.test(text) ||
    /protection from/.test(text)
  ) {
    roles.push('protection')
  }

  // Synergy — keyword overlap with commander oracle text + commander creature subtypes.
  // Threshold is 1: even a single shared theme keyword (e.g. 'token' between Koma and
  // Doubling Season) is enough to be considered synergistic. Anchor cards from the
  // detected archetypes also auto-promote here.
  const commanderText = getOracleText(commander)
  const extraKeywords = (extras.commanderTypes ?? []).filter(Boolean)
  const commanderKeywords = [...extractKeywords(commanderText), ...extraKeywords]
  const cardKeywords = [...extractKeywords(text), ...extraKeywords.filter(k => text.includes(k))]
  const overlap = commanderKeywords.filter(k => cardKeywords.includes(k))
  if (overlap.length >= 1) roles.push('synergy')
  else if (extras.anchorNames?.has?.(name)) roles.push('synergy')

  // Tutor tag adds tutor role
  if (tags.includes('tutor')) roles.push('tutor')

  // Mechanic tags — granular signal for the LLM. Without these, most cards
  // come out as just [synergy] or [filler], which gives the model no way to
  // tell a token producer from a counterspell. Patterns are lowercased oracle
  // text matches, so anchors like 'create' / 'sacrifice' / 'whenever' are reliable.
  for (const rule of MECHANIC_TAG_RULES) {
    if (rule.patterns.some(p => p.test(text))) tags.push(rule.tag)
  }

  // Tag-based synergy promotion. A card whose mechanic tags match the
  // commander's cares_about_X mapping (commanderTagBoosts) is on-plan
  // even if its oracle text shares no keywords with the commander's.
  // Without this, a Sorin (lifelink commander) deck tags Sanguine Bond
  // as `lifegain_payoff` but assigns it `filler` because the SYNERGY_KEYWORDS
  // list doesn't include 'life' or 'gain' — pushing genuine on-plan
  // payoffs into the filler bucket.
  if (!roles.includes('synergy') && extras.commanderTagBoosts && extras.commanderTagBoosts.size > 0) {
    for (const t of tags) {
      if (extras.commanderTagBoosts.has(t)) {
        roles.push('synergy')
        break
      }
    }
  }

  // Tribal anchor — if the card is a creature whose type line includes one of
  // the commander's creature subtypes, tag it. Tribal decks live or die by
  // having enough on-tribe bodies, so this is high-signal.
  for (const t of (extras.commanderTypes ?? [])) {
    if (t && type.includes('creature') && type.includes(t)) {
      tags.push(`tribal_${t}`)
      break
    }
  }

  // Filler is a SLOT-BUCKET tag added to EVERY non-land card so the
  // deckGenerator's slot-fill (deckGenerator.js fillRole 'filler') has a
  // catch-all bucket. Without this, a synergy-tagged card that loses the
  // (target-capped) synergy bucket has no way to land in the deck — even
  // if it has a massive EDHREC bonus. With filler as a backstop, any
  // high-scoring leftover competes for the open slots.
  //
  // Important: filler is the LAST role pushed. Code that counts "true
  // filler" (cards with no meaningful role) checks `roles[0] === 'filler'`
  // — see countRoles in deckValidator.js. Counting cards that *contain*
  // the filler tag would inflate to nearly every non-land card.
  if (!roles.includes('land') && !roles.includes('filler')) roles.push('filler')
  if (roles.length === 0) roles.push('filler')

  return { roles, tags }
}

// Mechanic detectors — each rule maps oracle-text patterns to a single tag.
// Order doesn't matter; a card can earn multiple tags. Patterns operate on
// the lowercased oracle text returned by getOracleText().
const MECHANIC_TAG_RULES = [
  {
    tag: 'token_producer',
    patterns: [
      /create (?:a|an|two|three|four|five|six|seven|x|that many|any number of) [^.]*\btokens?\b/,
      /put (?:a|an|two|three|four|x) [^.]*\btokens? .* onto the battlefield/,
      /populate/,
    ],
  },
  {
    tag: 'token_doubler',
    // Replacement effects on token creation (Anointed Procession / Parallel Lives /
    // Doubling Season / Mondrak / Adrix and Nev). Different strategic value than a
    // raw token producer — these are anchors, not engines.
    patterns: [
      /twice that many [^.]*\btokens?\b/,
      /if (?:an effect would create|one or more tokens would be created)/,
    ],
  },
  {
    tag: 'sac_outlet',
    // Activated-ability sacrifice cost: usually appears as "..., sacrifice X:" or
    // "{T}, sacrifice X:". The colon is the giveaway that it's a cost line.
    patterns: [
      /sacrifice (?:a|an|another|two|three) (?:creature|artifact|enchantment|permanent|land|token)[^:]*:/,
    ],
  },
  {
    tag: 'sacrifice_payoff',
    patterns: [
      // "whenever <name> or another creature dies" / "whenever another creature dies"
      // Match the death trigger anywhere in the text rather than locking to "whenever a/another"
      // immediately — Blood Artist, Zulaport Cutthroat, etc. all use the "X or another" form.
      /another creature [^.]*dies/,
      /whenever (?:a|another|one or more) (?:creature|permanent)s? (?:you control )?dies?/,
      /whenever (?:you|a player) sacrifices?/,
      /whenever (?:a|another) creature (?:you control )?is put into a graveyard from the battlefield/,
    ],
  },
  {
    tag: 'recursion',
    patterns: [
      /return target [^.]* from (?:your|a) graveyard to (?:your hand|the battlefield)/,
      /put target [^.]* from (?:your|a) graveyard onto the battlefield/,
      /\breanimate\b/,
    ],
  },
  {
    tag: 'graveyard_hate',
    patterns: [
      /exile target [^.]* from (?:a|target) graveyard/,
      /exile (?:all cards|target opponent's graveyard|each opponent's graveyard)/,
      /exile target player's graveyard/,
    ],
  },
  {
    tag: 'counters_payoff',
    patterns: [
      /\+1\/\+1 counter/,
      /whenever .* (?:gets?|has) a \+1\/\+1 counter put on it/,
      /for each \+1\/\+1 counter on/,
    ],
  },
  {
    tag: 'counters_doubler',
    // Doubling Season, Hardened Scales, Branching Evolution, Innkeeper's Talent.
    patterns: [
      /twice that many [^.]*counters?/,
      /that many plus one [^.]*counters? are put on/,
    ],
  },
  {
    tag: 'proliferate',
    patterns: [/\bproliferate\b/],
  },
  {
    tag: 'flicker',
    patterns: [
      /exile target [^.]*creature[^.]*\. (?:return|then return)/,
      /exile target [^.]* you control,? then return/,
      /\bflicker\b/,
    ],
  },
  {
    tag: 'etb_payoff',
    patterns: [
      /whenever (?:a|another) creature enters (?:the battlefield )?(?:under your control)?/,
      /whenever a (?:nontoken )?creature you control enters/,
    ],
  },
  {
    tag: 'lifegain',
    patterns: [
      /you gain \d+ life/,
      /gain \d+ life/,
      /\blifelink\b/,
    ],
  },
  {
    tag: 'lifegain_payoff',
    patterns: [
      /whenever you gain life/,
    ],
  },
  {
    tag: 'theft',
    patterns: [
      /gain control of target/,
      /gain control of (?:all|each)/,
      /until end of turn, gain control of/,
    ],
  },
  {
    tag: 'copy_effect',
    patterns: [
      /copy target (?:instant|sorcery|spell|activated ability|triggered ability)/,
      /create a token that's a copy/,
    ],
  },
  {
    tag: 'extra_combat',
    patterns: [
      /additional combat phase/,
      /untap all creatures you control\. after this main phase/,
    ],
  },
  {
    tag: 'extra_turn',
    patterns: [
      /take an extra turn after this one/,
      /additional turn after this one/,
    ],
  },
  {
    tag: 'mill',
    patterns: [
      /puts? the top \d+ cards? of (?:their|that player's|target player's) library into (?:their|that player's|its owner's) graveyard/,
      /\bmills?\b \d+/,
      /target player mills?/,
    ],
  },
  {
    tag: 'attack_payoff',
    patterns: [
      /whenever (?:one or more )?creatures? (?:you control )?attacks?/,
      /whenever you attack/,
    ],
  },
  {
    tag: 'voltron_equip',
    patterns: [
      /equipped creature gets \+\d+\/\+\d+/,
      /enchanted creature gets \+\d+\/\+\d+/,
    ],
  },
  {
    tag: 'mana_doubler',
    patterns: [
      /if you would (?:add|tap) (?:a|one or more) mana[^.]*, (?:add|tap) twice that much/,
      /whenever a land you control is tapped for mana, add an additional/,
    ],
  },
  {
    tag: 'untap',
    patterns: [
      /untap target (?:permanent|creature|artifact|land)/,
      /untap all (?:creatures|artifacts|lands) you control/,
    ],
  },
  {
    tag: 'wheel',
    patterns: [
      /each player discards their hand,? then draws (?:seven|that many) cards/,
      /draw (?:seven|four) cards/,
    ],
  },
  {
    tag: 'storm_enabler',
    patterns: [/\bstorm\b/, /add (?:two|three) mana of any one color/],
  },
  {
    // Tribal lords — anthem effects keyed off a creature subtype. Critical for
    // tribal decks AND for "everything is every type" commanders (Omo, Maskwood Nexus,
    // Arcane Adaptation) where every lord becomes a global anthem.
    tag: 'tribal_lord',
    patterns: [
      // "Other Goblins you control get +1/+1"
      /\bother [a-z]+s? you control get \+\d+\/\+\d+/,
      // "Goblin creatures you control get +1/+1" / "Elves you control get +1/+1"
      /\b[a-z]+ creatures? you control get \+\d+\/\+\d+/,
      // Generic anthem like "Creatures you control get +1/+1" — also a lord pattern
      /\bcreatures you control get \+\d+\/\+\d+/,
    ],
  },
  {
    // Mass-pump finishers caught by text. Picks up Craterhoof-likes regardless of
    // whether they're in the hardcoded EXPLOSIVE_FINISHERS list. Patterns handle
    // both clause orders ("get +X and gain trample" / "gain trample and get +X")
    // and +X/+X variable pumps.
    tag: 'mass_pump',
    patterns: [
      /creatures you control get \+[\dx]+\/\+[\dx]+ and gain (?:trample|haste)/,
      /creatures you control gain (?:trample|haste)[^.]*\bget \+[\dx]+\/\+[\dx]+/,
      /creatures you control gain trample and get \+[\dx]+\/\+[\dx]+/,
      /until end of turn, creatures you control [^.]*\+[\dx]+\/\+[\dx]+/,
    ],
  },
  {
    // Explosive finisher — pattern-based fallback that catches cards which
    // explicitly close the game by text. The hardcoded EXPLOSIVE_FINISHERS set
    // covers the staples that don't fit a pattern (Coat of Arms, Beastmaster
    // Ascension); these patterns catch the broader category in user collections.
    tag: 'explosive_finisher',
    patterns: [
      // "you win the game" / "each opponent loses the game" — alt-wincons
      /you win the game/,
      /each opponent loses the game/,
      // Mass damage / mass life loss to all opponents
      /deals \d+ damage to each opponent/,
      /each opponent loses \d+ life for each/,
      /each opponent loses x life/,
      // "Each opponent loses N life" style finishers (Torment of Hailfire, Anvil of Bogardan)
      /each opponent loses \d+ life unless/,
      /each opponent loses \d+ life\b/,
      // Storm-tier multi-spell finishers
      /this spell costs \{[\dxw]+\} less to cast for each/,
      // Big X-spells that close games
      /search your library for (?:up to )?(?:two|x|that many) creature cards?[^.]*put them onto the battlefield/,
      // Genesis Wave / Mind's Desire / Tooth-and-Nail-likes — "put X permanents from library onto the battlefield".
      // Use [\s\S] instead of [^.] because the effect commonly spans a period
      // ("reveal the top x cards. you may put any number of nonland permanent cards...").
      /reveal the top x cards[\s\S]*?put any number of nonland permanent cards/,
      // Mass evasion / mass haste finishers — turn the corner
      /creatures you control gain (?:haste|flying|trample) and (?:get|have)/,
      /creatures you control have (?:trample|haste|flying)[^.]*\+[\dx]+\/\+[\dx]+/,
      // Reset-button finishers
      /destroy all creatures\. (?:return|put)/,
      // Doubling effects on damage
      /if a source you control would deal damage[^.]*deals (?:double|twice) that damage/,
      // "Deals N damage to any target" with high N — Aetherflux-like finisher activations
      /deals (?:50|40|30|25|20) damage to any target/,
    ],
  },
  {
    // Commander protection — pattern-based fallback. Hardcoded COMMANDER_PROTECTION
    // covers the staples that don't fit a pattern (Lightning Greaves, the cycle of
    // boots/helms); these patterns catch the broader category. Covers protection
    // equipment, single-target instant protection, mass protection, and phase-out.
    tag: 'commander_protection',
    patterns: [
      // Equipment that grants protection — keyword can appear after other keywords
      // ("equipped creature has haste AND shroud"), so allow text in between.
      /equipped creature (?:has|gains?) [^.]*\b(?:hexproof|shroud|indestructible|protection from)/,
      // Single-target protection (Mother of Runes, Tamiyo's Safekeeping, Boros Charm)
      /target creature you control gains? (?:hexproof|shroud|indestructible|protection from)/,
      /target (?:creature|permanent) gains? (?:hexproof|shroud|indestructible|protection from)[^.]*until end of turn/,
      // Mass protection (Heroic Intervention, Flawless Maneuver, Akroma's Will)
      /(?:permanents|creatures) you control gain (?:hexproof|indestructible|shroud)/,
      /(?:permanents|creatures) you control (?:phase out|gain protection from)/,
      // Teferi's Protection-style — looser pattern, "permanents you control... phase out"
      /permanents you control[^.]*phase out/,
      // Phase-out / blink protection (single target)
      /target (?:creature|permanent) you control phases out/,
      // Sacrifice-prevention / death-prevention
      /if a (?:creature|permanent) you control would (?:die|be destroyed), exile it instead/,
      /prevent all damage that would be dealt to (?:creatures you control|target creature you control|you and permanents you control)/,
      // Worship / Platinum Angel-style — can't lose / damage reduces to 1
      /you can't lose the game/,
      /damage that would reduce your life total to less than 1 reduces it to 1 instead/,
    ],
  },
]

const SYNERGY_KEYWORDS = [
  'counter', 'token', 'sacrifice', 'graveyard', 'enchantment', 'artifact',
  'creature', 'land', 'instant', 'sorcery', 'planeswalker', '+1/+1', '-1/-1',
  'flying', 'trample', 'lifelink', 'deathtouch', 'haste', 'vigilance',
  'proliferate', 'voltron', 'aura', 'equipment', 'tribal', 'zombie',
  'vampire', 'elf', 'goblin', 'dragon', 'angel', 'human', 'soldier',
  'reanimate', 'discard', 'wheel', 'storm', 'copy', 'flicker', 'blink',
  'exile', 'commander', 'legend', 'historic',
]

function extractKeywords(text) {
  return SYNERGY_KEYWORDS.filter(k => text.includes(k))
}
