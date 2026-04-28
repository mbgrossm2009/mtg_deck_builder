// Curated combo database. Each entry:
//   cards          — exact card names that must all be present
//   description    — short, plain-language outcome
//   minimumBracket — bracket level at which this combo is considered acceptable
//   archetype      — optional archetype id this combo supports (matches archetypeRules.js)
//
// The `cards` list is matched case-insensitively against the deck. Combos at minimum
// bracket 5 are typically cEDH-tier; bracket 4 is "high-power"; bracket 2-3 is fair.
const COMBOS = [
  // ─── Lifegain / drain ───────────────────────────────────────────────────────
  { cards: ['Exquisite Blood', 'Sanguine Bond'], description: 'Infinite life drain — any life gain triggers infinite damage.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Exquisite Blood', 'Vito, Thorn of the Dusk Rose'], description: 'Infinite drain via Vito\'s lifegain replacement.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Exquisite Blood', 'Defiant Bloodlord'], description: 'Defiant Bloodlord drains, Exquisite Blood gains, loops.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Heliod, Sun-Crowned', 'Walking Ballista'], description: 'Infinite damage with lifelink loop.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Heliod, Sun-Crowned', 'Spike Feeder'], description: 'Infinite life via +1/+1 counter and Spike Feeder.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Aetherflux Reservoir', 'Bolas\'s Citadel'], description: 'Cast spells off the top, gain life, drain to win.', minimumBracket: 4, archetype: 'lifegain' },
  { cards: ['Aetherflux Reservoir', 'Sensei\'s Divining Top', 'Bolas\'s Citadel'], description: 'Stack Citadel + Top + Reservoir for guaranteed kill.', minimumBracket: 5, archetype: 'lifegain' },

  // ─── Thoracle / win-on-empty-library ────────────────────────────────────────
  { cards: ['Thassa\'s Oracle', 'Demonic Consultation'], description: 'Exile your library, Oracle wins immediately.', minimumBracket: 5 },
  { cards: ['Thassa\'s Oracle', 'Tainted Pact'], description: 'Exile your library, Oracle wins immediately.', minimumBracket: 5 },
  { cards: ['Thassa\'s Oracle', 'Doomsday'], description: 'Set up a 5-card pile that wins next upkeep.', minimumBracket: 5 },
  { cards: ['Laboratory Maniac', 'Demonic Consultation'], description: 'Empty library + draw = win.', minimumBracket: 5 },
  { cards: ['Laboratory Maniac', 'Tainted Pact'], description: 'Empty library + draw = win.', minimumBracket: 5 },
  { cards: ['Jace, Wielder of Mysteries', 'Demonic Consultation'], description: 'Empty library + draw = win.', minimumBracket: 5 },

  // ─── Kiki / Twin / Splinter Twin clones ─────────────────────────────────────
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'], description: 'Infinite hasty creature tokens.', minimumBracket: 4 },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Deceiver Exarch'], description: 'Infinite hasty creature tokens.', minimumBracket: 4 },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Pestermite'], description: 'Infinite hasty creature tokens.', minimumBracket: 4 },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Combat Celebrant'], description: 'Infinite combat steps.', minimumBracket: 4 },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Felidar Guardian'], description: 'Infinite hasty cats.', minimumBracket: 4 },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel'], description: 'Infinite hasty angels.', minimumBracket: 4 },
  { cards: ['Splinter Twin', 'Deceiver Exarch'], description: 'Infinite hasty creature tokens.', minimumBracket: 4 },
  { cards: ['Splinter Twin', 'Pestermite'], description: 'Infinite hasty creature tokens.', minimumBracket: 4 },
  { cards: ['Twinflame', 'Zealous Conscripts'], description: 'Infinite hasty tokens via Twinflame.', minimumBracket: 4 },

  // ─── Infinite mana ──────────────────────────────────────────────────────────
  { cards: ['Isochron Scepter', 'Dramatic Reversal'], description: 'Infinite mana with mana rocks in play.', minimumBracket: 4 },
  { cards: ['Deadeye Navigator', 'Palinchron'], description: 'Infinite mana via repeated ETB.', minimumBracket: 4 },
  { cards: ['Deadeye Navigator', 'Peregrine Drake'], description: 'Infinite mana via repeated ETB.', minimumBracket: 4 },
  { cards: ['Deadeye Navigator', 'Great Whale'], description: 'Infinite mana via repeated ETB.', minimumBracket: 4 },
  { cards: ['Deadeye Navigator', 'Cloud of Faeries'], description: 'Infinite mana with extra lands or rocks.', minimumBracket: 4 },
  { cards: ['Power Artifact', 'Basalt Monolith'], description: 'Infinite colorless mana.', minimumBracket: 4 },
  { cards: ['Rings of Brighthearth', 'Basalt Monolith'], description: 'Infinite colorless mana via copied untap.', minimumBracket: 4 },
  { cards: ['Rings of Brighthearth', 'Grim Monolith'], description: 'Infinite mana via copied untap.', minimumBracket: 4 },
  { cards: ['Pemmin\'s Aura', 'Palinchron'], description: 'Infinite mana via Pemmin\'s untap.', minimumBracket: 4 },
  { cards: ['Freed from the Real', 'Bloom Tender'], description: 'Infinite mana of all colors Bloom Tender taps for.', minimumBracket: 4 },
  { cards: ['Pili-Pala', 'Grand Architect'], description: 'Infinite mana via Architect\'s mana ability.', minimumBracket: 4 },
  { cards: ['Bloom Tender', 'Faeburrow Elder'], description: 'Mana ramp engine in 5-color shells.', minimumBracket: 3 },
  { cards: ['Earthcraft', 'Squirrel Nest'], description: 'Infinite squirrel tokens.', minimumBracket: 4, archetype: 'tokens' },
  { cards: ['Glimpse of Nature', 'Earthcraft', 'Birchlore Rangers'], description: 'Elf storm — draw deck and float infinite mana.', minimumBracket: 5, archetype: 'tribal_elf' },

  // ─── Ad nauseam / draw-deck wins ────────────────────────────────────────────
  { cards: ['Ad Nauseam', 'Angel\'s Grace'], description: 'Draw your entire deck without losing.', minimumBracket: 5 },
  { cards: ['Ad Nauseam', 'Phyrexian Unlife'], description: 'Draw your deck while at "can\'t lose" life.', minimumBracket: 5 },

  // ─── Aristocrats / sac loops ────────────────────────────────────────────────
  { cards: ['Mikaeus, the Unhallowed', 'Triskelion'], description: 'Infinite damage via undying counter loop.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Mikaeus, the Unhallowed', 'Walking Ballista'], description: 'Walking Ballista comes back forever; ping out the table.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Necrotic Ooze', 'Triskelion', 'Phyrexian Devourer'], description: 'Devour deck, ping with Triskelion abilities.', minimumBracket: 5, archetype: 'graveyard' },
  { cards: ['Karmic Guide', 'Reveillark'], description: 'Infinite recursion of small creatures with a sac outlet.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Karmic Guide', 'Reveillark', 'Viscera Seer'], description: 'Infinite scry + ETB / death triggers.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Murderous Redcap', 'Mikaeus, the Unhallowed'], description: 'Infinite damage via undying.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Reassembling Skeleton', 'Phyrexian Altar', 'Pitiless Plunderer'], description: 'Infinite mana + sac triggers.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Gravecrawler', 'Phyrexian Altar', 'Diregraf Captain'], description: 'Infinite drain via Zombie sac loop.', minimumBracket: 4, archetype: 'tribal_zombie' },
  { cards: ['Nim Deathmantle', 'Ashnod\'s Altar'], description: 'Infinite ETB and sac triggers with a 3-mana creature.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Animate Dead', 'Worldgorger Dragon'], description: 'Infinite ETB / mana / damage.', minimumBracket: 4 },
  { cards: ['Necromancy', 'Worldgorger Dragon'], description: 'Infinite ETB / mana / damage.', minimumBracket: 4 },
  { cards: ['Dance of the Dead', 'Worldgorger Dragon'], description: 'Infinite ETB / mana / damage.', minimumBracket: 4 },
  { cards: ['Animate Dead', 'Leonin Relic-Warder'], description: 'Infinite ETB/death triggers via Animate loop.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Saffi Eriksdotter', 'Renegade Rallier', 'Altar of Dementia'], description: 'Mill your opponents to death via recursion loop.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Melira, Sylvok Outcast', 'Kitchen Finks', 'Viscera Seer'], description: 'Infinite life via persist + sac outlet.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Melira, Sylvok Outcast', 'Murderous Redcap', 'Viscera Seer'], description: 'Infinite damage via persist.', minimumBracket: 4, archetype: 'aristocrats' },

  // ─── Token / mass triggers ──────────────────────────────────────────────────
  { cards: ['Krenko, Mob Boss', 'Thornbite Staff'], description: 'Infinite Goblin tokens via untap.', minimumBracket: 4, archetype: 'tribal_goblin' },
  { cards: ['Krenko, Mob Boss', 'Umbral Mantle'], description: 'Infinite Goblin tokens via untap.', minimumBracket: 4, archetype: 'tribal_goblin' },
  { cards: ['Avenger of Zendikar', 'Craterhoof Behemoth'], description: 'Token swarm wins on the spot.', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Doubling Season', 'Parallel Lives'], description: 'Quadruples your token output.', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Anointed Procession', 'Parallel Lives'], description: 'Quadruples your token output (white/green).', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Purphoros, God of the Forge', 'Avenger of Zendikar'], description: 'Massive ETB damage.', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Impact Tremors', 'Purphoros, God of the Forge'], description: 'Stacked ETB damage triggers per token.', minimumBracket: 3, archetype: 'tokens' },

  // ─── Doubling Season + planeswalker ult shenanigans ─────────────────────────
  { cards: ['Doubling Season', 'The Chain Veil'], description: 'Activate planeswalker ults turn one cast.', minimumBracket: 4, archetype: 'superfriends' },
  { cards: ['Teferi, Temporal Archmage', 'The Chain Veil'], description: 'Infinite turns/loyalty with mana rocks (cEDH classic).', minimumBracket: 5, archetype: 'superfriends' },

  // ─── Painter / mill ─────────────────────────────────────────────────────────
  { cards: ['Painter\'s Servant', 'Grindstone'], description: 'Mill an opponent\'s entire library.', minimumBracket: 4, archetype: 'mill' },
  { cards: ['Altar of Dementia', 'Reveillark', 'Karmic Guide'], description: 'Mill opponents out via sac loop.', minimumBracket: 4, archetype: 'mill' },

  // ─── Stax / lock pieces ─────────────────────────────────────────────────────
  { cards: ['Knowledge Pool', 'Teferi, Mage of Zhalfir'], description: 'No one can cast spells. Soft lock.', minimumBracket: 5 },
  { cards: ['Stasis', 'Kismet'], description: 'Lock the table out of untapping.', minimumBracket: 5 },

  // ─── Food chain / Prossh / Squee ────────────────────────────────────────────
  { cards: ['Food Chain', 'Prossh, Skyraider of Kher'], description: 'Infinite mana and tokens.', minimumBracket: 4 },
  { cards: ['Food Chain', 'Eternal Scourge'], description: 'Infinite creature mana.', minimumBracket: 4 },
  { cards: ['Food Chain', 'Misthollow Griffin'], description: 'Infinite creature mana.', minimumBracket: 4 },
  { cards: ['Food Chain', 'Squee, the Immortal'], description: 'Infinite creature mana.', minimumBracket: 4 },

  // ─── Underworld Breach lines ────────────────────────────────────────────────
  { cards: ['Underworld Breach', 'Brain Freeze', 'Lion\'s Eye Diamond'], description: 'Storm off and mill the table out.', minimumBracket: 5, archetype: 'storm' },
  { cards: ['Underworld Breach', 'Lion\'s Eye Diamond'], description: 'Loop LED for infinite mana with anything cheap to recast.', minimumBracket: 5, archetype: 'storm' },

  // ─── Storm classics ─────────────────────────────────────────────────────────
  { cards: ['Aetherflux Reservoir', 'Sensei\'s Divining Top', 'Future Sight'], description: 'Cast Top from the top forever, gain life, win.', minimumBracket: 5, archetype: 'storm' },
  { cards: ['Past in Flames', 'Mana Severance'], description: 'Storm engine recurring rituals.', minimumBracket: 5, archetype: 'storm' },

  // ─── Eldrazi titan loops ────────────────────────────────────────────────────
  { cards: ['Eldrazi Displacer', 'Peregrine Drake'], description: 'Infinite mana (3 colorless required).', minimumBracket: 4 },

  // ─── Combat / extra turns ───────────────────────────────────────────────────
  { cards: ['Aggravated Assault', 'Sword of Feast and Famine'], description: 'Infinite combat steps.', minimumBracket: 4, archetype: 'aggro_combat' },
  { cards: ['Aggravated Assault', 'Bear Umbra'], description: 'Infinite combat steps.', minimumBracket: 4, archetype: 'aggro_combat' },
  { cards: ['Aggravated Assault', 'Druids\' Repository'], description: 'Infinite combat steps via repository charges.', minimumBracket: 4, archetype: 'aggro_combat' },
  { cards: ['Helm of the Host', 'Combat Celebrant'], description: 'Infinite combat steps.', minimumBracket: 4, archetype: 'aggro_combat' },

  // ─── Counter / proliferate ──────────────────────────────────────────────────
  { cards: ['Sage of Hours', 'Ezuri, Claw of Progress'], description: 'Infinite turns via experience counters.', minimumBracket: 4, archetype: 'plus_one_counters' },
  { cards: ['Sage of Hours', 'Hardened Scales', 'Forgotten Ancient'], description: 'Build counters, take infinite turns.', minimumBracket: 4, archetype: 'plus_one_counters' },

  // ─── Wheels / discard ───────────────────────────────────────────────────────
  { cards: ['Notion Thief', 'Wheel of Fortune'], description: 'Steal the table\'s wheel draws.', minimumBracket: 4, archetype: 'wheels' },
  { cards: ['Notion Thief', 'Windfall'], description: 'Steal the table\'s wheel draws.', minimumBracket: 4, archetype: 'wheels' },
  { cards: ['Waste Not', 'Wheel of Fortune'], description: 'Snowball off forced discards.', minimumBracket: 3, archetype: 'wheels' },

  // ─── Enchantress draw engines ───────────────────────────────────────────────
  { cards: ['Enchantress\'s Presence', 'Solitary Confinement'], description: 'Soft lock — fog, draw, immune.', minimumBracket: 4, archetype: 'enchantments' },
  { cards: ['Argothian Enchantress', 'Solitary Confinement'], description: 'Soft lock — fog, draw, immune.', minimumBracket: 4, archetype: 'enchantments' },

  // ─── Lands matter ───────────────────────────────────────────────────────────
  { cards: ['Crucible of Worlds', 'Strip Mine'], description: 'Lock opponents off lands.', minimumBracket: 4, archetype: 'lands_matter' },
  { cards: ['Crucible of Worlds', 'Wasteland'], description: 'Recur land destruction every turn.', minimumBracket: 4, archetype: 'lands_matter' },
  { cards: ['Lotus Cobra', 'Oracle of Mul Daya'], description: 'Massive ramp engine in landfall decks.', minimumBracket: 3, archetype: 'lands_matter' },

  // ─── Blink engines ──────────────────────────────────────────────────────────
  { cards: ['Brago, King Eternal', 'Strionic Resonator'], description: 'Re-blink your board endlessly with a sac.', minimumBracket: 4, archetype: 'blink' },
  { cards: ['Felidar Guardian', 'Saheeli Rai'], description: 'Infinite hasty cat tokens.', minimumBracket: 4, archetype: 'blink' },

  // ─── Misc finishers ─────────────────────────────────────────────────────────
  { cards: ['Insurrection'], description: 'Steal everyone\'s creatures and swing for lethal.', minimumBracket: 3 },
  { cards: ['Triumph of the Hordes'], description: 'Infect kill via your token board.', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Craterhoof Behemoth'], description: 'Generic green token finisher.', minimumBracket: 3, archetype: 'tokens' },

  // ─── Equipment / Voltron ────────────────────────────────────────────────────
  { cards: ['Sword of Feast and Famine', 'Aggravated Assault'], description: 'Infinite combats.', minimumBracket: 4, archetype: 'voltron' },
  { cards: ['Helm of the Host', 'Godo, Bandit Warlord'], description: 'Equip + extra combat = lethal commander damage.', minimumBracket: 4, archetype: 'voltron' },
  { cards: ['Colossus Hammer', 'Sigarda\'s Aid'], description: 'Free 10/10 trample on a small creature.', minimumBracket: 3, archetype: 'voltron' },

  // ─── Spellslinger ───────────────────────────────────────────────────────────
  { cards: ['Young Pyromancer', 'Murmuring Mystic'], description: 'Massive token output from spell-heavy decks.', minimumBracket: 3, archetype: 'spellslinger' },
  { cards: ['Talrand, Sky Summoner', 'Snapcaster Mage'], description: 'Drake army + flashback recursion.', minimumBracket: 3, archetype: 'spellslinger' },

  // ─── Reanimator setup ───────────────────────────────────────────────────────
  { cards: ['Buried Alive', 'Reanimate'], description: 'Tutor a fatty to graveyard, cheat it in.', minimumBracket: 4, archetype: 'graveyard' },
  { cards: ['Entomb', 'Reanimate'], description: 'Tutor a fatty to graveyard, cheat it in.', minimumBracket: 4, archetype: 'graveyard' },
  { cards: ['Buried Alive', 'Animate Dead'], description: 'Tutor a fatty to graveyard, cheat it in.', minimumBracket: 4, archetype: 'graveyard' },

  // ─── Cradle + token combos ──────────────────────────────────────────────────
  { cards: ['Gaea\'s Cradle', 'Hornet Queen'], description: 'Massive green mana for big plays.', minimumBracket: 4, archetype: 'tokens' },

  // ─── Niv-Mizzet / spellcast triggers ────────────────────────────────────────
  { cards: ['Niv-Mizzet, Parun', 'Curiosity'], description: 'Infinite damage + draw.', minimumBracket: 4, archetype: 'spellslinger' },
  { cards: ['Niv-Mizzet, Parun', 'Tandem Lookout'], description: 'Infinite damage + draw.', minimumBracket: 4, archetype: 'spellslinger' },
  { cards: ['Niv-Mizzet, the Firemind', 'Curiosity'], description: 'Infinite damage + draw.', minimumBracket: 4, archetype: 'spellslinger' },

  // ─── Cloudstone Curio / ETB loops ───────────────────────────────────────────
  { cards: ['Cloudstone Curio', 'Aluren', 'Cavern Harpy'], description: 'Infinite ETB / mana with a couple cheap creatures.', minimumBracket: 4, archetype: 'aristocrats' },
  { cards: ['Cloudstone Curio', 'Priest of Titania'], description: 'Infinite mana in elf decks.', minimumBracket: 4, archetype: 'tribal_elf' },

  // ─── Misc cEDH staples / glass-cannon wins ──────────────────────────────────
  { cards: ['Hermit Druid', 'Thassa\'s Oracle'], description: 'Mill yourself to a single basic + Oracle win.', minimumBracket: 5 },
  { cards: ['Protean Hulk', 'Grand Abolisher', 'Devoted Druid', 'Vizier of Remedies', 'Walking Ballista'], description: 'Hulk pile that wins on the spot.', minimumBracket: 5 },
  { cards: ['Vizier of Remedies', 'Devoted Druid'], description: 'Infinite green mana.', minimumBracket: 4 },
  { cards: ['Devoted Druid', 'Swift Reconfiguration'], description: 'Infinite green mana via vigilance.', minimumBracket: 4 },
  { cards: ['Devoted Druid', 'Quillspike'], description: 'Infinite power Quillspike.', minimumBracket: 4 },
  { cards: ['Phyrexian Devourer', 'Necrotic Ooze'], description: 'Devour your library; combine with another piece for lethal.', minimumBracket: 5, archetype: 'graveyard' },

  // ─── Bond combos (deals damage equal to lifegain) ───────────────────────────
  { cards: ['Cliffhaven Vampire', 'Exquisite Blood'], description: 'Infinite drain via lifegain trigger.', minimumBracket: 4, archetype: 'lifegain' },

  // ─── Bloodchief ascension / mill wins ───────────────────────────────────────
  { cards: ['Bloodchief Ascension', 'Mindcrank'], description: 'Mill an opponent on any damage.', minimumBracket: 4, archetype: 'mill' },
  { cards: ['Duskmantle Guildmage', 'Mindcrank'], description: 'Pay 2 to mill the table.', minimumBracket: 4, archetype: 'mill' },

  // ─── Final fortune / one-shots ──────────────────────────────────────────────
  { cards: ['Final Fortune', 'Sundial of the Infinite'], description: 'Take an extra turn without dying.', minimumBracket: 3 },

  // ─── Soft / synergy combos (not instant wins, but real win paths) ───────────
  // These are the "we win because these cards stack" pairs — not single-card
  // finishers, but together they snowball to lethal in a turn or two. Bracket 2
  // so they fire even in casual decks.
  { cards: ['Scute Swarm', 'Doubling Season'], description: 'Each land drop creates exponential Scute Swarms (4→8→16…). Lethal in 2-3 land drops.', minimumBracket: 2, archetype: 'tokens' },
  { cards: ['Scute Swarm', 'Parallel Lives'], description: 'Each land drop creates exponential Scute Swarms.', minimumBracket: 2, archetype: 'tokens' },
  { cards: ['Scute Swarm', 'Anointed Procession'], description: 'Each land drop creates exponential Scute Swarms.', minimumBracket: 2, archetype: 'tokens' },
  { cards: ['Scute Swarm', 'Hardened Scales'], description: 'Each land drop creates Scute Swarms with extra +1/+1 counters via Adapt-style triggers.', minimumBracket: 3, archetype: 'lands_matter' },
  { cards: ['Avenger of Zendikar', 'Craterhoof Behemoth'], description: 'Avenger plops a token board, Craterhoof swings for lethal.', minimumBracket: 2, archetype: 'tokens' },
  { cards: ['Avenger of Zendikar', 'Triumph of the Hordes'], description: 'Avenger\'s plant army with infect = one-shot kill.', minimumBracket: 3, archetype: 'tokens' },
  { cards: ['Avenger of Zendikar', 'Doubling Season'], description: 'Doubled landfall plant tokens become a lethal swing very quickly.', minimumBracket: 2, archetype: 'lands_matter' },
  { cards: ['Lotus Cobra', 'Doubling Season'], description: 'Doubled mana off every landfall enables explosive starts.', minimumBracket: 3, archetype: 'lands_matter' },
  { cards: ['Lotus Cobra', 'Crucible of Worlds'], description: 'Replay fetches/utility lands for mana every turn.', minimumBracket: 3, archetype: 'lands_matter' },
  { cards: ['Field of the Dead', 'Crucible of Worlds'], description: 'Replay fetchlands and utility lands; Field churns out 2/2 zombies forever.', minimumBracket: 3, archetype: 'lands_matter' },
  { cards: ['Field of the Dead', 'Scapeshift'], description: 'Drop 6+ unique lands at once and overwhelm with zombies.', minimumBracket: 3, archetype: 'lands_matter' },

  // Aristocrats engines (not infinite, but reliable drain wins)
  { cards: ['Bitterblossom', 'Blood Artist'], description: 'Faerie tokens fuel a slow drain over many turns.', minimumBracket: 2, archetype: 'aristocrats' },
  { cards: ['Bitterblossom', 'Zulaport Cutthroat'], description: 'Faerie tokens drain the table over many turns.', minimumBracket: 2, archetype: 'aristocrats' },
  { cards: ['Ophiomancer', 'Blood Artist'], description: 'A free token every turn fuels Blood Artist drain.', minimumBracket: 2, archetype: 'aristocrats' },
  { cards: ['Grave Pact', 'Blood Artist'], description: 'Whenever opponents lose creatures, you drain. Snowballs hard.', minimumBracket: 2, archetype: 'aristocrats' },
  { cards: ['Dictate of Erebos', 'Blood Artist'], description: 'Whenever opponents lose creatures, you drain.', minimumBracket: 2, archetype: 'aristocrats' },
  { cards: ['Skullclamp', 'Bitterblossom'], description: 'Free 1/1 Faeries fuel infinite Skullclamp draws over time.', minimumBracket: 3, archetype: 'aristocrats' },
  { cards: ['Skullclamp', 'Ophiomancer'], description: 'Free 1/1 Snake every turn fuels Skullclamp draws.', minimumBracket: 3, archetype: 'aristocrats' },

  // Counter doublers + +1/+1 commanders
  { cards: ['Hardened Scales', 'Doubling Season'], description: 'Counter triplers → snowballing creature stats.', minimumBracket: 3, archetype: 'plus_one_counters' },
  { cards: ['Hardened Scales', 'Branching Evolution'], description: 'Counter triplers — every counter becomes 3.', minimumBracket: 3, archetype: 'plus_one_counters' },
  { cards: ['Branching Evolution', 'Doubling Season'], description: 'Counter quadruplers — explosive +1/+1 creature growth.', minimumBracket: 3, archetype: 'plus_one_counters' },
  { cards: ['Hardened Scales', 'The Ozolith'], description: 'Counter doubling preserved across deaths — relentless growth.', minimumBracket: 3, archetype: 'plus_one_counters' },

  // Spellslinger / Storm-y soft combos
  { cards: ['Mizzix\'s Mastery', 'Past in Flames'], description: 'Recur instants/sorceries from grave — combo turn enabler.', minimumBracket: 4, archetype: 'spellslinger' },
  { cards: ['Underworld Breach', 'Brain Freeze'], description: 'Mill yourself, Breach into Brain Freezes for lethal mill loop.', minimumBracket: 4, archetype: 'storm' },

  // Ramp + payoff
  { cards: ['Smothering Tithe', 'Wheel of Fortune'], description: 'Each opponent draws → you make 21+ treasures from a single wheel.', minimumBracket: 3, archetype: 'wheels' },
  { cards: ['Smothering Tithe', 'Windfall'], description: 'Each opponent draws → you make 21+ treasures from a single wheel.', minimumBracket: 3, archetype: 'wheels' },
  { cards: ['Rhystic Study', 'Smothering Tithe'], description: 'Tax every opponent\'s spells and card draws — runaway resource lead.', minimumBracket: 3 },
]

// Strict combo check — every named card must be present in the deck.
export function detectCombos(cardNames) {
  const nameSet = new Set(cardNames.map(n => n.toLowerCase()))
  return COMBOS.filter(combo =>
    combo.cards.every(c => nameSet.has(c.toLowerCase()))
  )
}

// "Almost-completed" combos: missing exactly one card.
// Used by the scorer to bonus the missing piece during selection.
// Returns [{ combo, missing: 'Card Name' }]
export function findIncompleteCombos(presentNames) {
  const nameSet = new Set(presentNames.map(n => n.toLowerCase()))
  const out = []
  for (const combo of COMBOS) {
    const missing = combo.cards.filter(c => !nameSet.has(c.toLowerCase()))
    if (missing.length === 1) out.push({ combo, missing: missing[0] })
  }
  return out
}

// All combos a card name appears in. Used to flag "synergy with the commander".
export function combosForCard(cardName) {
  const lower = cardName.toLowerCase()
  return COMBOS.filter(c => c.cards.some(n => n.toLowerCase() === lower))
}

// Returns the live array of every registered combo (hardcoded ∪ Spellbook).
// Mutates as registerCombos is called — callers should re-read after registering.
export function getAllCombos() {
  return COMBOS
}

// Allow the Spellbook integration to merge in additional combos at runtime.
export function registerCombos(extra) {
  for (const combo of extra) {
    if (!combo?.cards?.length) continue
    const exists = COMBOS.some(c =>
      c.cards.length === combo.cards.length &&
      c.cards.every(name => combo.cards.some(n => n.toLowerCase() === name.toLowerCase()))
    )
    if (!exists) COMBOS.push(combo)
  }
}
