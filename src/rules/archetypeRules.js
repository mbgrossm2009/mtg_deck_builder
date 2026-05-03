import { getOracleText } from '../utils/cardHelpers'

// Each archetype has:
//   id              — short stable name
//   label           — pretty name for UI/explanation
//   commanderHints  → regexes / token tests against the commander's oracle text + type_line
//   cardSignals     → regex tests run on a candidate card's oracle text
//                     (multiple signals; more matches = stronger fit)
//   typeBoosts      — substrings of a candidate's type_line that count as a signal hit
//   anchors         — curated must-include cards (engine pieces, payoffs, near-staples).
//                     A name match here grants a large flat bonus (~50) on top of signals,
//                     pushing the card above generic filler regardless of role bucket.
const ARCHETYPES = [
  {
    id: 'tokens',
    label: 'Token Swarm',
    commanderHints: [/create .* token/, /populate/, /token.*you control/, /tokens? .* you control/],
    cardSignals: [
      /create .* token/, /populate/, /tokens? you control get/,
      /double.* tokens/, /twice that many .* tokens/, /additional .* token/,
      /whenever .* token/, /anthem|\+1\/\+1 .* creature you control/,
      /create one or more tokens/,
    ],
    typeBoosts: [],
    anchors: [
      'Doubling Season', 'Parallel Lives', 'Anointed Procession', 'Mondrak, Glory Dominus',
      'Adrix and Nev, Twincasters', 'Second Harvest', 'Cathars\' Crusade',
      'Intangible Virtue', 'Beastmaster Ascension', 'Craterhoof Behemoth',
      'Avenger of Zendikar', 'Rhys the Redeemed', 'Akroma\'s Will',
      'Coat of Arms', 'Purphoros, God of the Forge', 'Impact Tremors',
      'Divine Visitation', 'Ojer Taq, Deepest Foundation',
      'Smothering Tithe', 'Skullclamp', 'Reflections of Littjara',
    ],
  },
  {
    id: 'plus_one_counters',
    label: '+1/+1 Counters',
    commanderHints: [/\+1\/\+1 counter/, /proliferate/],
    cardSignals: [
      /\+1\/\+1 counter/, /proliferate/,
      /modular|adapt|evolve|mentor|outlast/,
      /double.* counters/, /twice that many .* counters/, /additional .* counter/,
      /puts? .* counters?/, /distribute .* counters/,
    ],
    typeBoosts: [],
    anchors: [
      'Doubling Season', 'Hardened Scales', 'Branching Evolution', 'Kalonian Hydra',
      'Cathars\' Crusade', 'The Ozolith', 'Inspiring Call', 'Conjurer\'s Mantle',
      'Ozolith, the Shattered Spire', 'Master Biomancer', 'Forgotten Ancient',
      'Innkeeper\'s Talent', 'Ivy Lane Denizen', 'Rishkar, Peema Renegade',
      'Beast Whisperer',
    ],
  },
  {
    // Counter manipulation that ISN'T +1/+1: Toxrill's slime counters, infect's -1/-1
    // counters, oil counters, depletion/charge counters, etc. The engine cards are
    // counter doublers (Vorinclex Monstrous Raider) and proliferators.
    id: 'counter_manipulation',
    label: 'Counter Manipulation',
    commanderHints: [
      /put .* counter on each/, /counter on each creature/,
      /-1\/-1 counter/, /\bslime counter|\boil counter|\binfect/,
      /proliferate/, /remove .* counter/, /move .* counter/,
    ],
    cardSignals: [
      /proliferate/, /-1\/-1 counter/, /counter on each/, /counter on .* creature/,
      /double .* counters/, /twice that many .* counters/, /additional .* counter/,
      /move .* counter/, /remove .* counter/, /\binfect\b|\btoxic\b/,
      /each .* with .* counter/, /each opponent .* counter/,
    ],
    typeBoosts: [],
    anchors: [
      // Counter doublers — work on slime, -1/-1, oil, every kind
      'Vorinclex, Monstrous Raider', 'Doubling Season',
      // Proliferate engines
      'Inexorable Tide', 'Atraxa, Praetors\' Voice', 'Karn\'s Bastion',
      'Contagion Engine', 'Contagion Clasp', 'Tezzeret\'s Gambit',
      'Flux Channeler', 'Evolution Sage', 'Roalesk, Apex Hybrid',
      'Pir, Imaginative Rascal',
      // -1/-1 / counter-removal payoffs (Toxrill-relevant)
      'Plague Engineer', 'Black Sun\'s Zenith', 'Necroskitter',
      'Hex Parasite', 'Crumbling Ashes', 'Quagmire Druid',
      // Counter-themed protection / draw
      'Inspiring Statuary', 'Plaguemaw Beast',
    ],
  },
  {
    id: 'lifegain',
    label: 'Lifegain',
    commanderHints: [/gain .* life/, /lifelink/, /whenever you gain life/],
    cardSignals: [
      /gain .* life/, /lifelink/, /whenever you gain life/,
      /life total/, /each opponent loses .* life/, /you gain that much life/,
    ],
    typeBoosts: [],
    anchors: [
      'Aetherflux Reservoir', 'Exquisite Blood', 'Sanguine Bond', 'Vito, Thorn of the Dusk Rose',
      'Heliod, Sun-Crowned', 'Cleric Class', 'Trudge Garden', 'Soul Warden',
      'Soul\'s Attendant', 'Defiant Bloodlord', 'Cliffhaven Vampire', 'Karlov of the Ghost Council',
      'Well of Lost Dreams', 'Bolas\'s Citadel', 'Felidar Sovereign',
    ],
  },
  {
    id: 'aristocrats',
    label: 'Aristocrats / Sacrifice',
    commanderHints: [
      // Older "creature/permanent" wording variants AND modern bare "enters"
      // (post-2022 Magic dropped "the battlefield" in most ETB triggers).
      // Korvold uses "sacrifice a permanent" not "creature" — match either.
      /sacrifice (?:another |an? )?(?:creature|permanent|token)/,
      /whenever you sacrifice/,
      /whenever .* dies/, /whenever a creature .* dies/,
      /enters the battlefield/, /when .* dies/,
      /\benters\b/,
    ],
    cardSignals: [
      /sacrifice .* creature/, /whenever .* dies/, /enters the battlefield/,
      /create .* creature token/, /\bblitz\b|\bafterlife\b|\bfabricate\b/,
      /each opponent loses .* life/, /sacrifice another/, /\bif you would lose life\b/,
    ],
    typeBoosts: [],
    anchors: [
      'Phyrexian Altar', 'Ashnod\'s Altar', 'Viscera Seer', 'Yawgmoth, Thran Physician',
      'Pitiless Plunderer', 'Blood Artist', 'Zulaport Cutthroat', 'Bastion of Remembrance',
      'Reassembling Skeleton', 'Gravecrawler', 'Mikaeus, the Unhallowed',
      'Dictate of Erebos', 'Grave Pact', 'Butcher of Malakir', 'Dark Prophecy',
      'Skullclamp', 'Goblin Bombardment', 'Carrion Feeder',
    ],
  },
  {
    id: 'graveyard',
    label: 'Graveyard / Reanimator',
    commanderHints: [
      /from your graveyard/, /return .* from .* graveyard/, /\bmill\b|mills/,
      /\bdredge\b|\bunearth\b|\bflashback\b|\bescape\b|\bdelve\b/, /exile .* graveyard/,
    ],
    cardSignals: [
      /from .* graveyard/, /return .* from .* graveyard/,
      /\bmill\b|put .* into .* graveyard/, /flashback|unearth|dredge|escape|delve/,
      /reanimate|enters the battlefield .* graveyard/, /whenever .* enters .* graveyard/,
    ],
    typeBoosts: [],
    anchors: [
      'Reanimate', 'Animate Dead', 'Necromancy', 'Entomb', 'Buried Alive', 'Victimize',
      'Sun Titan', 'Sheoldred, the Apocalypse', 'Meren of Clan Nel Toth',
      'The Gitrog Monster', 'Eternal Witness', 'Regrowth', 'Crucible of Worlds',
      'Underworld Breach', 'Living Death', 'Bone Miser', 'Karador, Ghost Chieftain',
    ],
  },
  {
    // Catch-all "you win the game / draw your library" combo finisher cluster.
    // These belong in any deck that's already running the consultation/pact half.
    id: 'thoracle_combo',
    label: 'Thoracle Combo Finisher',
    commanderHints: [
      // Tight: only fire for commanders that genuinely lean Thoracle-style.
      // Avoids over-triggering on "draws a card" which is too broad.
      /\bninjutsu\b/,
      /reveal the top card .* of your library/,
      /look at the top .* cards? of your library/,
      /draw .* cards? equal to/,
      /you may cast .* from the top of your library/,
    ],
    cardSignals: [
      /you win the game/, /reveal the top card .* of your library/,
      /pay \{u\}.*pay \{u\}|exile the top .* of your library/,
    ],
    typeBoosts: [],
    anchors: [
      'Thassa\'s Oracle', 'Laboratory Maniac', 'Jace, Wielder of Mysteries',
      'Demonic Consultation', 'Tainted Pact', 'Ad Nauseam', 'Doomsday',
      'Hermit Druid', 'Demonic Tutor', 'Vampiric Tutor', 'Mystical Tutor',
      'Imperial Seal', 'Personal Tutor', 'Enlightened Tutor',
      // Cheap blue cantrips + draw engines that fuel the line
      'Brainstorm', 'Ponder', 'Preordain', 'Consider', 'Gitaxian Probe',
      'Opt', 'Sleight of Hand', 'Mystic Remora', 'Rhystic Study',
      'Sensei\'s Divining Top', 'Scroll Rack', 'Necropotence',
      // Counter shells protect the combo
      'Force of Will', 'Force of Negation', 'Fierce Guardianship',
      'Pact of Negation', 'Flusterstorm', 'Counterspell',
    ],
  },
  {
    id: 'spellslinger',
    label: 'Spellslinger',
    commanderHints: [
      // "Whenever you cast an instant or sorcery" AND any-player variants
      // (Niv-Mizzet Parun: "Whenever a player casts an instant or sorcery
      // spell, you draw a card"). Match either subject.
      /whenever (?:you|a player) cast(?:s)? .* (instant|sorcery)/,
      /noncreature spell/, /prowess/, /storm count/, /magecraft/,
    ],
    cardSignals: [
      /whenever you cast .* (instant|sorcery)/, /noncreature spell/, /prowess/,
      /copy target .* spell/, /\bstorm\b|magecraft|surge/,
      /draw a card.* cast|cast .* draw a card/,
    ],
    typeBoosts: ['Instant', 'Sorcery'],
    anchors: [
      'Young Pyromancer', 'Murmuring Mystic', 'Talrand, Sky Summoner',
      'Snapcaster Mage', 'Archmage\'s Charm', 'Mizzix\'s Mastery',
      'Storm-Kiln Artist', 'Birgi, God of Storytelling', 'Guttersnipe',
      'Veyran, Voice of Duality', 'Thousand-Year Storm', 'Goldspan Dragon',
      'Past in Flames', 'Mizzix of the Izmagnus',
    ],
  },
  {
    id: 'voltron',
    label: 'Voltron / Equipment',
    commanderHints: [
      /equip|attach|enchant creature/,
      /whenever .* deals combat damage to a player/,
      /commander damage|first strike|double strike|trample|menace/,
    ],
    cardSignals: [
      /equip \{|attached creature|enchanted creature|attach to|aura you control/,
      /double strike|first strike|trample|menace|unblockable|can't be blocked/,
      /\+\d+\/\+\d+ and|gets \+\d+\/\+\d+/,
    ],
    typeBoosts: ['Equipment', 'Aura'],
    anchors: [
      'Sword of Feast and Famine', 'Sword of Fire and Ice', 'Sword of Hearth and Home',
      'Skullclamp', 'Lightning Greaves', 'Swiftfoot Boots', 'Shadowspear',
      'Colossus Hammer', 'Sigarda\'s Aid', 'Embercleave', 'Stoneforge Mystic',
      'Sigarda\'s Aid', 'Rogue\'s Passage', 'Helm of the Host', 'Umezawa\'s Jitte',
      'Maul of the Skyclaves', 'Grafted Exoskeleton',
    ],
  },
  {
    id: 'artifacts',
    label: 'Artifact Synergy',
    commanderHints: [/artifact/, /metalcraft|affinity|improvise/, /whenever .* artifact .* enters/],
    cardSignals: [
      /whenever .* artifact .* enters/, /artifact you control/,
      /metalcraft|affinity|improvise/, /create .* treasure|\btreasure token\b/,
      /artifact creature/,
    ],
    typeBoosts: ['Artifact'],
    anchors: [
      'Smothering Tithe', 'Dockside Extortionist', 'Goldspan Dragon',
      'Urza, Lord High Artificer', 'Saheeli, the Gifted', 'Padeem, Consul of Innovation',
      'Mystic Forge', 'Treasure Vault', 'Trash for Treasure', 'Daretti, Scrap Savant',
      'Krark-Clan Ironworks', 'Whir of Invention', 'Ashnod\'s Altar',
    ],
  },
  {
    id: 'enchantments',
    label: 'Enchantment Synergy',
    commanderHints: [/enchantment/, /constellation|aura|enchanted creature/],
    cardSignals: [
      /enchantment you control|whenever .* enchantment .* enters/,
      /constellation/,
      /aura you control|attached aura|enchanted creature/,
    ],
    typeBoosts: ['Enchantment'],
    anchors: [
      'Sterling Grove', 'Enchantress\'s Presence', 'Argothian Enchantress',
      'Eidolon of Blossoms', 'Setessan Champion', 'Sythis, Harvest\'s Hand',
      'Sanctum Weaver', 'Replenish', 'Estrid\'s Invocation', 'Sigil of the Empty Throne',
      'Greater Auramancy', 'Mesa Enchantress',
    ],
  },
  {
    id: 'lands_matter',
    label: 'Lands Matter',
    commanderHints: [/landfall/, /play an additional land/, /lands? you control/],
    cardSignals: [
      /landfall/, /play an additional land/, /lands? you control/,
      /search your library for .* land/, /\bcrucible\b|return .* land .* hand|fetch land/,
    ],
    typeBoosts: [],
    anchors: [
      'Crucible of Worlds', 'Lotus Cobra', 'Oracle of Mul Daya', 'Azusa, Lost but Seeking',
      'Tireless Tracker', 'Tireless Provisioner', 'Ramunap Excavator',
      'Field of the Dead', 'Avenger of Zendikar', 'Roaming Throne',
      'Cultivate', 'Kodama\'s Reach', 'Three Visits', 'Nature\'s Lore',
    ],
  },
  {
    id: 'blink',
    label: 'Blink / Flicker',
    commanderHints: [/exile .* return .* battlefield/, /flicker|blink/, /enters the battlefield/],
    cardSignals: [
      /exile .* return .* battlefield|until end of turn .* return/,
      /flicker|blink/, /whenever .* enters the battlefield/,
    ],
    typeBoosts: [],
    anchors: [
      'Conjurer\'s Closet', 'Eldrazi Displacer', 'Deadeye Navigator', 'Restoration Angel',
      'Felidar Guardian', 'Brago, King Eternal', 'Roon of the Hidden Realm',
      'Cloudshift', 'Ephemerate', 'Ghostly Flicker', 'Eerie Interlude',
      'Soulherder', 'Mistmeadow Witch', 'Yorion, Sky Nomad',
    ],
  },
  {
    id: 'mill',
    label: 'Mill',
    commanderHints: [/put.* top.* library .* graveyard|mill \d+|mills \d+/, /each opponent puts/, /target opponent puts/],
    cardSignals: [
      /put.*top.* library .* graveyard|\bmill \d+|mills \d+/,
      /each opponent puts the top/, /library into .* graveyard/,
    ],
    typeBoosts: [],
    anchors: [
      'Bruvac the Grandiloquent', 'Sphinx\'s Tutelage', 'Painter\'s Servant',
      'Grindstone', 'Altar of Dementia', 'Mesmeric Orb', 'Glimpse the Unthinkable',
      'Traumatize', 'Ashiok, Dream Render', 'Mind Funeral',
    ],
  },
  {
    id: 'wheels',
    label: 'Wheels / Discard',
    commanderHints: [/discard.* draw|each player .* discards .* draws/, /whenever .* discards/],
    cardSignals: [
      /each player .* discards .* draws|discard your hand .* draw/,
      /whenever .* discards/, /\bmadness\b|\bcycling\b|hellbent/, /opponents? discard/,
    ],
    typeBoosts: [],
    anchors: [
      'Wheel of Fortune', 'Windfall', 'Notion Thief', 'Waste Not', 'Narset, Parter of Veils',
      'Day\'s Undoing', 'Magus of the Wheel', 'Reforge the Soul', 'Wheel of Misfortune',
      'Geier Reach Sanitarium',
    ],
  },
  {
    id: 'superfriends',
    label: 'Superfriends',
    commanderHints: [/planeswalker/, /loyalty counter/, /proliferate/],
    cardSignals: [/planeswalker/, /loyalty counter/, /proliferate/, /each planeswalker/],
    typeBoosts: ['Planeswalker'],
    anchors: [
      'Doubling Season', 'The Chain Veil', 'Oath of Teferi', 'Atraxa, Praetors\' Voice',
      'Tezzeret\'s Gambit', 'Karn\'s Bastion', 'Inexorable Tide', 'Contagion Engine',
      'Deepglow Skate',
    ],
  },
  {
    id: 'group_hug_political',
    label: 'Group Hug / Politics',
    commanderHints: [/each player draws|each player gets|monarch|goad/, /vote/],
    cardSignals: [
      /each player draws|each opponent draws|monarch|\bgoad\b|\bvote\b/,
      /target opponent .* draws|target opponent .* gains/,
    ],
    typeBoosts: [],
    anchors: [
      'Howling Mine', 'Temple Bell', 'Rhystic Study', 'Mystic Remora', 'Smothering Tithe',
      'Phelddagrif', 'Selvala, Explorer Returned', 'Edric, Spymaster of Trest',
    ],
  },
  {
    id: 'storm',
    label: 'Storm / Spell Chain',
    commanderHints: [/storm/, /whenever you cast .* spell .* this turn/, /copy target .* spell/],
    cardSignals: [
      /\bstorm\b|magecraft/, /copy target .* spell/,
      /add \{[^}]*\}.*add \{[^}]*\}/, /untap.*lands?|untap .* artifact/,
    ],
    typeBoosts: [],
    anchors: [
      'Aetherflux Reservoir', 'Lion\'s Eye Diamond', 'Underworld Breach',
      'Brain Freeze', 'Tendrils of Agony', 'Past in Flames', 'Mind\'s Desire',
      'Birgi, God of Storytelling', 'Storm-Kiln Artist',
    ],
  },
  {
    id: 'turn_cycle',
    label: 'Turn-Cycle Triggers',
    // Commanders with on-upkeep / on-attack / on-each-turn triggers benefit hugely
    // from extra untap and extra-trigger effects (Seedborn Muse + Koma is the canonical case).
    commanderHints: [
      /at the beginning of (each|your) upkeep/,
      /at the beginning of each (?:player'?s )?(?:upkeep|combat|end step)/,
      /whenever .* enters or attacks/,
      /whenever .* attacks/,
      /at the beginning of combat on each/,
      /each (?:other )?player'?s turn/,
    ],
    cardSignals: [
      /untap .* during each other player'?s untap step/,
      /untap all .* you control/,
      /at the beginning of each .* upkeep/,
      /extra .* phase|additional .* combat/,
      /take an extra turn/,
    ],
    typeBoosts: [],
    anchors: [
      'Seedborn Muse', 'Awakening', 'Murkfiend Liege', 'Quest for Renewal',
      'Wilderness Reclamation', 'Prophet of Kruphix', 'Vorinclex, Voice of Hunger',
      'Sword of Feast and Famine', 'Bear Umbra', 'Earthcraft', 'Strionic Resonator',
      'Lithoform Engine', 'Rings of Brighthearth',
    ],
  },
  {
    id: 'evasive_combat',
    label: 'Cheap Evasive Creatures',
    // Same triggers as thoracle_combo + ninjas — these commanders also want
    // a high density of 1-2 cmc unblockable creatures.
    commanderHints: [
      /\bninjutsu\b/,
      /whenever .* deals combat damage to a player/,
      /reveal the top card .* of your library/,
    ],
    cardSignals: [
      /can't be blocked/, /unblockable/, /menace/, /flying/,
      /shadow/, /fear/, /intimidate/, /ninjutsu/,
    ],
    typeBoosts: [],
    anchors: [
      'Triton Shorestalker', 'Slither Blade', 'Tormented Soul', 'Mist-Cloaked Herald',
      'Spectral Sailor', 'Faerie Seer', 'Changeling Outcast', 'Invisible Stalker',
      'Gudul Lurker', 'Augur of Bolas', 'Baleful Strix', 'Ingenious Infiltrator',
      'Mistblade Shinobi', 'Walker of Secret Ways', 'Higure, the Still Wind',
      'Yuriko\'s Sensei', 'Thieves\' Tools', 'Throat Slitter',
    ],
  },
  {
    id: 'aggro_combat',
    label: 'Aggro / Combat',
    commanderHints: [
      /whenever .* attacks|whenever .* deals combat damage|combat damage to a player/,
      /haste|menace|trample|first strike/,
    ],
    cardSignals: [
      /whenever .* attacks|combat damage|extra combat phase/,
      /haste|menace|trample|first strike|double strike/,
      /can't be blocked|attack each combat/,
    ],
    typeBoosts: [],
    anchors: [
      'Aggravated Assault', 'Combat Celebrant', 'Helm of the Host',
      'Hellkite Charger', 'Sword of Feast and Famine', 'Bear Umbra',
      'Druids\' Repository', 'Berserkers\' Onslaught', 'Embercleave', 'Craterhoof Behemoth',
    ],
  },
]

// Type line categories that appear before the em-dash and are NOT creature subtypes.
// Anything after the em-dash that isn't in this set is treated as a tribal subtype
// candidate, so we don't need a hardcoded list of every tribe in Magic.
const NON_TRIBE_TYPES = new Set([
  'legendary', 'basic', 'snow', 'world', 'host', 'ongoing',
  'creature', 'land', 'artifact', 'enchantment', 'instant', 'sorcery',
  'planeswalker', 'tribal', 'battle', 'token',
])

// Pull creature subtypes out of "Legendary Creature — X Y Z" → ['x','y','z'].
// Returns [] if the type line has no em-dash or the post-dash word isn't a real subtype.
function extractSubtypes(typeLine) {
  if (!typeLine) return []
  // Both em-dash (—) and hyphen (--) variations show up across data sources
  const dashIdx = typeLine.search(/[—–-]/)
  if (dashIdx === -1) return []
  return typeLine.slice(dashIdx + 1).trim().toLowerCase().split(/\s+/)
    .filter(t => t && !NON_TRIBE_TYPES.has(t))
}

function tribalArchetype(tribe, strength) {
  return {
    id: `tribal_${tribe}`,
    label: `${tribe.charAt(0).toUpperCase() + tribe.slice(1)} Tribal`,
    strength,
    tribe,
  }
}

export function detectArchetypes(commander) {
  if (!commander) return []
  const text = getOracleText(commander)
  const typeLine = (commander.type_line ?? '').toLowerCase()

  const matches = []
  for (const arch of ARCHETYPES) {
    let hits = 0
    for (const re of arch.commanderHints) if (re.test(text)) hits++
    for (const sub of arch.typeBoosts) if (typeLine.includes(sub.toLowerCase())) hits++
    if (hits > 0) matches.push({ id: arch.id, label: arch.label, strength: hits })
  }

  // Tribal detection — only emit a tribe if (a) it's a creature subtype on the
  // commander's own type_line AND (b) the commander's oracle text references it.
  // Both conditions matter:
  //   (a) alone: too many false positives (every Human legendary becomes tribal)
  //   (b) alone: false positives on flavor/ability words (Firebending, Voltron)
  // Together they catch real tribal commanders (Sliver Overlord says "Sliver",
  // Krenko says "Goblin") without triggering on every legendary creature.
  const subtypes = extractSubtypes(commander.type_line ?? '')
  const oracleLower = (commander.oracle_text ?? '').toLowerCase()
  for (const sub of subtypes) {
    if (oracleLower.includes(sub)) {
      matches.push(tribalArchetype(sub, 2))
    }
  }

  // Keep top archetypes by strength; cap at 4 so scoring doesn't get diluted
  matches.sort((a, b) => b.strength - a.strength)
  return matches.slice(0, 4)
}

// Score how well a candidate card matches a set of archetypes. Returns a non-negative number;
// higher = better fit.
//
// `primaryId` (optional) — when set, the picker locks in a single strategy. Only the primary
// archetype contributes to score; secondary archetypes are zeroed out. This is what makes
// the "Primary Strategy" picker actually commit instead of nudging the result.
export function scoreArchetypeFit(card, archetypes, primaryId = null) {
  if (!archetypes || archetypes.length === 0) return 0
  const text = getOracleText(card)
  const typeLine = (card.type_line ?? '').toLowerCase()
  const cardName = card.name

  let total = 0
  for (const arch of archetypes) {
    // When a primary is locked, secondary archetypes contribute nothing.
    if (primaryId && arch.id !== primaryId) continue

    if (arch.tribe) {
      if (typeLine.includes(arch.tribe))                  total += 12
      else if (new RegExp(`\\b${arch.tribe}\\b`).test(text)) total += 6
      continue
    }
    const def = ARCHETYPES.find(a => a.id === arch.id)
    if (!def) continue

    // When primary is locked, weights are amplified so on-archetype cards
    // can outscore off-archetype EDHREC darlings in the synergy bucket.
    // Anchor: +50 → +75. Signal cap: 3 → 5 hits, 3 → 5 strength.
    const locked = !!primaryId
    const anchorBonus    = locked ? 75 : 50
    const hitsCap        = locked ? 5  : 3
    const strengthCap    = locked ? 5  : 3

    if (def.anchors?.some(name => name === cardName)) total += anchorBonus

    let hits = 0
    for (const re of def.cardSignals) if (re.test(text)) hits++
    for (const sub of def.typeBoosts) if (typeLine.includes(sub.toLowerCase())) hits++
    if (hits > 0) total += Math.min(hits, hitsCap) * 4 * Math.min(arch.strength, strengthCap)
  }
  return total
}

// Whether a card "fits" the given archetype — anchors it OR has any signal match.
// Used by the scorer to decide if a card belongs to the primary lane.
export function cardMatchesArchetype(card, archRef) {
  if (!archRef) return false
  if (archRef.tribe) {
    const typeLine = (card.type_line ?? '').toLowerCase()
    if (typeLine.includes(archRef.tribe)) return true
    return new RegExp(`\\b${archRef.tribe}\\b`).test(getOracleText(card))
  }
  const def = ARCHETYPES.find(a => a.id === archRef.id)
  if (!def) return false
  if (def.anchors?.some(name => name === card.name)) return true
  const text = getOracleText(card)
  const typeLine = (card.type_line ?? '').toLowerCase()
  for (const re of def.cardSignals) if (re.test(text)) return true
  for (const sub of def.typeBoosts) if (typeLine.includes(sub.toLowerCase())) return true
  return false
}

// Whether a card is a curated anchor of any NON-primary archetype.
// The scorer penalizes these when a primary is locked — Vito as a lifegain anchor
// should not be picked for an Aristocrats-primary Ertai deck.
export function isCompetingArchetypeAnchor(card, primaryId, archetypes) {
  if (!primaryId || !archetypes) return false
  for (const arch of archetypes) {
    if (arch.id === primaryId) continue
    if (arch.tribe) continue
    const def = ARCHETYPES.find(a => a.id === arch.id)
    if (def?.anchors?.some(name => name === card.name)) return true
  }
  return false
}

// Map EDHREC theme labels to our internal archetype ids. EDHREC themes are
// human-readable strings ("Counters Matter", "Lifegain") — we collapse them
// to the small set of archetype ids the scorer understands.
const EDHREC_THEME_MAP = [
  // Order matters — more-specific matches first
  { match: /-1\/-?1|infect|toxic|slime|oil counter|proliferate/i, id: 'counter_manipulation' },
  { match: /\+1\/?\+1|counters? matter/i,                          id: 'plus_one_counters' },
  { match: /lifegain|life gain/i,                   id: 'lifegain' },
  { match: /tokens?/i,                              id: 'tokens' },
  { match: /aristocrats?|sacrifice/i,               id: 'aristocrats' },
  { match: /graveyard|reanimat|mill/i,              id: 'graveyard' },
  { match: /spellslinger|instants? .* sorceries?|magecraft/i, id: 'spellslinger' },
  { match: /voltron|equipment/i,                    id: 'voltron' },
  { match: /artifacts?/i,                           id: 'artifacts' },
  { match: /enchantments?|auras?/i,                 id: 'enchantments' },
  { match: /lands? matter|landfall/i,               id: 'lands_matter' },
  { match: /blink|flicker/i,                        id: 'blink' },
  { match: /wheels?|discard/i,                      id: 'wheels' },
  { match: /superfriends|planeswalkers?/i,          id: 'superfriends' },
  { match: /group hug|politics?|monarch/i,          id: 'group_hug_political' },
  { match: /storm/i,                                id: 'storm' },
  { match: /aggro|combat damage|extra combat/i,     id: 'aggro_combat' },
  { match: /upkeep|extra turns?|untap/i,            id: 'turn_cycle' },
]

// Convert a list of EDHREC theme strings into a list of archetype objects we can
// merge with regex-detected archetypes. Strength is high (3) since EDHREC themes
// are real-world signals about the commander's actual play patterns.
export function themesToArchetypes(themes) {
  if (!Array.isArray(themes) || themes.length === 0) return []
  const found = new Map()
  for (const theme of themes) {
    for (const m of EDHREC_THEME_MAP) {
      if (m.match.test(theme)) {
        const def = ARCHETYPES.find(a => a.id === m.id)
        if (!def) continue
        const existing = found.get(m.id)
        if (existing) existing.strength = Math.max(existing.strength, 3)
        else found.set(m.id, { id: def.id, label: def.label, strength: 3 })
      }
    }
  }
  return [...found.values()]
}

// Merges regex-detected archetypes with EDHREC-derived ones, deduplicating by id
// and keeping the higher strength. Tribal archetypes pass through unchanged.
export function mergeArchetypes(regexArchetypes, edhrecArchetypes) {
  const byId = new Map()
  for (const a of regexArchetypes) byId.set(a.id, a)
  for (const a of edhrecArchetypes) {
    const existing = byId.get(a.id)
    if (!existing || a.strength > existing.strength) byId.set(a.id, a)
  }
  return [...byId.values()].sort((a, b) => b.strength - a.strength).slice(0, 5)
}

// Returns the set of anchor card names across the given archetypes.
// Used by assignRoles to auto-promote anchor cards into the synergy bucket.
export function anchorNamesFor(archetypes) {
  const out = new Set()
  if (!archetypes) return out
  for (const arch of archetypes) {
    if (arch.tribe) continue
    const def = ARCHETYPES.find(a => a.id === arch.id)
    if (!def?.anchors) continue
    for (const name of def.anchors) out.add(name)
  }
  return out
}
