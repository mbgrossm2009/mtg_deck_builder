// Card fixture for integration tests.
//
// Synthetic card data with enough fields to drive the full deck-gen pipeline:
//   - cardRoles.assignRoles needs oracle_text + type_line for role detection
//   - bracketRules.isBracketAllowed needs name (for fast-mana / game-changer
//     lookups) and tags (set by assignRoles)
//   - landQuality.landTier needs name + oracle_text for tier classification
//   - bracketStaples.buildBracketStaples needs name match against curated lists
//
// Cards are grouped by purpose so tests can compose collections (rich, sparse,
// dragon-heavy, etc.) without listing names individually.

// Card builder. All fields the orchestrator + scoring touch.
function c(name, type, opts = {}) {
  return {
    name,
    type_line:      type,
    oracle_text:    opts.text ?? '',
    mana_cost:      opts.cost ?? '',
    cmc:            opts.cmc ?? 0,
    colors:         opts.colors ?? [],
    color_identity: opts.colors ?? [],
    legalities:     { commander: opts.banned ? 'banned' : 'legal' },
    rarity:         opts.rarity ?? 'rare',
    isBasicLand:    opts.basic ?? false,
    image_uris:     null,
    card_faces:     null,
    quantity:       opts.qty ?? 1,
  }
}

// ─── Universal staples (lock at every bracket if owned) ────────────────────

export const UNIVERSAL_RAMP = [
  c('Sol Ring',         'Artifact', { cost: '{1}', cmc: 1, text: '{T}: Add {C}{C}.' }),
  c('Arcane Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add one mana of any color in your commander\'s identity.' }),
  c('Mind Stone',       'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {1}, {T}, sacrifice this: Draw a card.' }),
  c('Fellwar Stone',    'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add one mana of any color that a land an opponent controls could produce.' }),
  c('Thought Vessel',   'Artifact', { cost: '{2}', cmc: 2, text: 'You have no maximum hand size. {T}: Add {C}.' }),
  c("Wayfarer's Bauble",'Artifact', { cost: '{1}', cmc: 1, text: '{2}, {T}, sacrifice this: Search your library for a basic land card.' }),
  c('Solemn Simulacrum','Artifact Creature — Golem', { cost: '{4}', cmc: 4, text: 'When this enters, search your library for a basic land card.' }),
  c('Burnished Hart',   'Artifact Creature — Elk',   { cost: '{3}', cmc: 3, text: '{3}, {T}, sacrifice this: Search your library for up to two basic land cards.' }),
]

export const UNIVERSAL_PROTECTION = [
  c('Lightning Greaves', 'Artifact — Equipment', { cost: '{2}', cmc: 2, text: 'Equipped creature has haste and shroud.' }),
  c('Swiftfoot Boots',   'Artifact — Equipment', { cost: '{2}', cmc: 2, text: 'Equipped creature has hexproof and haste.' }),
  c('Heroic Intervention','Instant',             { cost: '{1}{G}', cmc: 2, colors: ['G'], text: 'Permanents you control gain hexproof and indestructible until end of turn.' }),
  c("Teferi's Protection",'Instant',             { cost: '{2}{W}', cmc: 3, colors: ['W'], text: 'Permanents you control phase out. You gain protection from everything until your next turn.' }),
]

export const UNIVERSAL_DRAW = [
  c('Skullclamp',           'Artifact — Equipment', { cost: '{1}', cmc: 1, text: 'Equipped creature gets +1/-1. Whenever equipped creature dies, draw two cards.' }),
  c("Sensei's Divining Top",'Artifact',            { cost: '{1}', cmc: 1, text: '{1}: Draw a card, then put a card from your hand on top of your library.' }),
  c("Lifecrafter's Bestiary",'Artifact',           { cost: '{3}', cmc: 3, text: 'At the beginning of your upkeep, scry 1. Whenever you cast a creature spell, draw a card.' }),
]

export const UNIVERSAL_REMOVAL = [
  c('Swords to Plowshares','Instant', { cost: '{W}',    cmc: 1, colors: ['W'], text: 'Exile target creature.' }),
  c('Path to Exile',       'Instant', { cost: '{W}',    cmc: 1, colors: ['W'], text: 'Exile target creature.' }),
  c('Generous Gift',       'Instant', { cost: '{2}{W}', cmc: 3, colors: ['W'], text: 'Destroy target permanent.' }),
  c('Beast Within',        'Instant', { cost: '{2}{G}', cmc: 3, colors: ['G'], text: 'Destroy target permanent.' }),
  c('Counterspell',        'Instant', { cost: '{U}{U}', cmc: 2, colors: ['U'], text: 'Counter target spell.' }),
  c('Cyclonic Rift',       'Instant', { cost: '{1}{U}', cmc: 2, colors: ['U'], text: 'Return target nonland permanent to its owner\'s hand. Overload {6}{U}.' }),
  c('Toxic Deluge',        'Sorcery', { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Pay X life. Each creature gets -X/-X.' }),
  c('Anguished Unmaking',  'Instant', { cost: '{1}{W}{B}', cmc: 3, colors: ['W','B'], text: 'Exile target nonland permanent. You lose 3 life.' }),
  c("Assassin's Trophy",   'Instant', { cost: '{B}{G}',    cmc: 2, colors: ['B','G'], text: 'Destroy target permanent.' }),
]

export const UNIVERSAL_GREEN_RAMP = [
  c('Cultivate',     'Sorcery', { cost: '{2}{G}', cmc: 3, colors: ['G'], text: 'Search your library for up to two basic land cards.' }),
  c("Kodama's Reach",'Sorcery', { cost: '{2}{G}', cmc: 3, colors: ['G'], text: 'Search your library for up to two basic land cards.' }),
  c('Rampant Growth','Sorcery', { cost: '{1}{G}', cmc: 2, colors: ['G'], text: 'Search your library for a basic land card.' }),
  c("Nature's Lore", 'Sorcery', { cost: '{1}{G}', cmc: 2, colors: ['G'], text: 'Search your library for a Forest card.' }),
  c('Three Visits',  'Sorcery', { cost: '{1}{G}', cmc: 2, colors: ['G'], text: 'Search your library for a Forest card.' }),
  c('Eternal Witness','Creature — Human Shaman', { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: 'When this enters, return target card from your graveyard to your hand.' }),
]

// ─── cEDH staples (lock at B4-5 if owned) ──────────────────────────────────

export const CEDH_FAST_MANA = [
  c('Mana Crypt',  'Artifact', { cost: '{0}', cmc: 0, text: '{T}: Add {C}{C}. At the beginning of your upkeep, flip a coin. If you lose the flip, this deals 3 damage to you.' }),
  c('Mana Vault',  'Artifact', { cost: '{1}', cmc: 1, text: '{T}: Add {C}{C}{C}. Doesn\'t untap during your untap step.' }),
  c('Grim Monolith','Artifact',{ cost: '{2}', cmc: 2, text: '{T}: Add {C}{C}{C}. Doesn\'t untap during your untap step.' }),
  c('Mox Diamond', 'Artifact', { cost: '{0}', cmc: 0, text: 'Discard a land card: Mox Diamond becomes a copy of any land. {T}: Add one mana of any color.' }),
  c('Chrome Mox',  'Artifact', { cost: '{0}', cmc: 0, text: 'Imprint - exile a nonartifact, nonland card from your hand. {T}: Add one mana of any of the imprinted card\'s colors.' }),
  c('Mox Opal',    'Artifact', { cost: '{0}', cmc: 0, text: 'Metalcraft - {T}: Add one mana of any color.' }),
  c('Lotus Petal', 'Artifact', { cost: '{0}', cmc: 0, text: '{T}, sacrifice this: Add one mana of any color.' }),
  c('Jeweled Lotus','Artifact',{ cost: '{0}', cmc: 0, text: '{T}, sacrifice this: Add three mana of any one color. Spend this mana only to cast your commander.' }),
  c('Dockside Extortionist','Creature — Goblin Pirate', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'When this enters, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.' }),
]

export const CEDH_TUTORS = [
  c('Demonic Tutor',  'Sorcery', { cost: '{1}{B}', cmc: 2, colors: ['B'], text: 'Search your library for a card and put it into your hand.' }),
  c('Vampiric Tutor', 'Instant', { cost: '{B}',    cmc: 1, colors: ['B'], text: 'Search your library for a card, then put that card on top. You lose 2 life.' }),
  c('Imperial Seal',  'Sorcery', { cost: '{B}',    cmc: 1, colors: ['B'], text: 'Search your library for a card, then put that card on top of your library. You lose 2 life.' }),
  c('Mystical Tutor', 'Instant', { cost: '{U}',    cmc: 1, colors: ['U'], text: 'Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top of your library.' }),
  c('Enlightened Tutor','Instant',{ cost: '{W}',   cmc: 1, colors: ['W'], text: 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top of your library.' }),
  c('Worldly Tutor',  'Instant', { cost: '{G}',    cmc: 1, colors: ['G'], text: 'Search your library for a creature card, reveal it, then shuffle and put that card on top of your library.' }),
  c("Green Sun's Zenith",'Sorcery',{ cost: '{X}{G}', cmc: 1, colors: ['G'], text: 'Search your library for a green creature card with mana value X or less, put it onto the battlefield.' }),
]

export const CEDH_FREE_INTERACTION = [
  c('Force of Will',    'Instant', { cost: '{3}{U}{U}', cmc: 5, colors: ['U'], text: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost. Counter target spell.' }),
  c('Force of Negation','Instant', { cost: '{1}{U}{U}', cmc: 3, colors: ['U'], text: 'If it\'s not your turn, you may exile a blue card from your hand rather than pay this spell\'s mana cost. Counter target noncreature spell.' }),
  c('Pact of Negation', 'Instant', { cost: '{0}', cmc: 0, colors: ['U'], text: 'Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don\'t, you lose the game.' }),
  c('Mana Drain',       'Instant', { cost: '{U}{U}', cmc: 2, colors: ['U'], text: 'Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell\'s mana value.' }),
  c('Flusterstorm',     'Instant', { cost: '{U}',    cmc: 1, colors: ['U'], text: 'Counter target instant or sorcery spell. Storm.' }),
]

export const CEDH_DRAW_ENGINES = [
  c('Rhystic Study',  'Enchantment', { cost: '{2}{U}', cmc: 3, colors: ['U'], text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.' }),
  c('Mystic Remora',  'Enchantment', { cost: '{U}',    cmc: 1, colors: ['U'], text: 'Cumulative upkeep {1}. Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.' }),
  c('Necropotence',   'Enchantment', { cost: '{B}{B}{B}', cmc: 3, colors: ['B'], text: 'Skip your draw step. Pay 1 life: Exile the top card of your library face down.' }),
  c('Sylvan Library', 'Enchantment', { cost: '{1}{G}', cmc: 2, colors: ['G'], text: 'At the beginning of your draw step, you may draw two additional cards.' }),
  c('Esper Sentinel', 'Creature — Human Artificer',{ cost: '{W}', cmc: 1, colors: ['W'], text: 'Whenever an opponent casts their first noncreature spell each turn, you may draw a card unless that player pays {X}.' }),
  c('Smothering Tithe','Enchantment',{ cost: '{3}{W}', cmc: 4, colors: ['W'], text: 'Whenever an opponent draws a card, that player creates a Treasure token unless they pay {2}.' }),
]

export const CEDH_COMBO_WINS = [
  c("Thassa's Oracle",'Creature — Merfolk Wizard', { cost: '{U}{U}', cmc: 2, colors: ['U'], text: 'When this enters, look at the top X cards of your library where X is your devotion to blue. If X is greater than or equal to the number of cards in your library, you win the game.' }),
  c('Demonic Consultation','Instant', { cost: '{B}', cmc: 1, colors: ['B'], text: 'Name a card. Exile the top six cards of your library. Then exile cards from the top of your library until you exile the named card.' }),
  c('Tainted Pact',   'Instant', { cost: '{1}{B}', cmc: 2, colors: ['B'], text: 'Exile the top card of your library. You may put it into your hand. If you do, repeat this process until you put a card into your hand whose name matches a card in exile.' }),
  c('Aetherflux Reservoir','Artifact', { cost: '{4}', cmc: 4, text: 'Whenever you cast a spell, gain 1 life for each spell cast this turn. Pay 50 life: This deals 50 damage to any target.' }),
]

// ─── Talismans + Signets (locked at B4+ for any 2+ color deck) ─────────────

export const TALISMANS = [
  c('Talisman of Conviction','Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {R} or {W}. This deals 1 damage to you.' }),
  c('Talisman of Creativity','Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {U} or {R}. This deals 1 damage to you.' }),
  c('Talisman of Curiosity', 'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {G} or {U}. This deals 1 damage to you.' }),
  c('Talisman of Dominance', 'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {U} or {B}. This deals 1 damage to you.' }),
  c('Talisman of Hierarchy', 'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {W} or {B}. This deals 1 damage to you.' }),
  c('Talisman of Impulse',   'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {R} or {G}. This deals 1 damage to you.' }),
  c('Talisman of Indulgence','Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {B} or {R}. This deals 1 damage to you.' }),
  c('Talisman of Progress',  'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {W} or {U}. This deals 1 damage to you.' }),
  c('Talisman of Resilience','Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {B} or {G}. This deals 1 damage to you.' }),
  c('Talisman of Unity',     'Artifact', { cost: '{2}', cmc: 2, text: '{T}: Add {C}. {T}: Add {G} or {W}. This deals 1 damage to you.' }),
]

export const SIGNETS = [
  c('Azorius Signet',  'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {W}{U}.' }),
  c('Boros Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {R}{W}.' }),
  c('Dimir Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {U}{B}.' }),
  c('Golgari Signet',  'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {B}{G}.' }),
  c('Gruul Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {R}{G}.' }),
  c('Izzet Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {U}{R}.' }),
  c('Orzhov Signet',   'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {W}{B}.' }),
  c('Rakdos Signet',   'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {B}{R}.' }),
  c('Selesnya Signet', 'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {G}{W}.' }),
  c('Simic Signet',    'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Add {G}{U}.' }),
]

// ─── Mana dorks ────────────────────────────────────────────────────────────

export const MANA_DORKS = [
  c('Birds of Paradise','Creature — Bird', { cost: '{G}', cmc: 1, colors: ['G'], text: 'Flying. {T}: Add one mana of any color.' }),
  c('Llanowar Elves',   'Creature — Elf Druid', { cost: '{G}', cmc: 1, colors: ['G'], text: '{T}: Add {G}.' }),
  c('Elvish Mystic',    'Creature — Elf Druid', { cost: '{G}', cmc: 1, colors: ['G'], text: '{T}: Add {G}.' }),
  c('Noble Hierarch',   'Creature — Human Druid', { cost: '{G}', cmc: 1, colors: ['G'], text: 'Exalted. {T}: Add {G}, {W}, or {U}.' }),
  c('Ignoble Hierarch', 'Creature — Human Shaman',{ cost: '{G}', cmc: 1, colors: ['G'], text: 'Exalted. {T}: Add {B}, {R}, or {G}.' }),
]

// ─── Off-theme filler — should be REJECTED by the algorithm ────────────────

export const OFF_THEME_FILLER = [
  c("Liar's Pendulum", 'Artifact', { cost: '{2}', cmc: 2, text: '{1}, {T}: Choose heads or tails, then flip a coin.' }),
  c('Idol of False Gods','Artifact',{ cost: '{2}', cmc: 2, text: 'Mythic Idol — At the beginning of combat on your turn, if you have three or more devotion, this becomes a creature.' }),
  c('Marketback Walker','Artifact Creature — Wolf', { cost: '{6}', cmc: 6, text: '6/6 vanilla.' }),
  c('Hardlight Containment','Artifact', { cost: '{4}', cmc: 4, text: 'Random off-theme effect.' }),
  c('Honor the Fallen', 'Sorcery',  { cost: '{1}{W}', cmc: 2, colors: ['W'], text: 'Exile all creature cards from all graveyards.' }),
  c('Random Coin Flip Card', 'Artifact', { cost: '{3}', cmc: 3, text: 'Flip a coin. If you win, draw a card.' }),
]

// ─── Tribal: Dragons ───────────────────────────────────────────────────────

export const DRAGONS = [
  c('Atarka, World Render', 'Legendary Creature — Elder Dragon', { cost: '{5}{R}{G}', cmc: 7, colors: ['R','G'], text: 'Flying, trample. Whenever a Dragon you control attacks, it gains double strike until end of turn.' }),
  c('Balefire Dragon',      'Creature — Dragon', { cost: '{5}{R}{R}', cmc: 7, colors: ['R'], text: 'Flying. Whenever this deals combat damage to a player, it deals that much damage to each creature that player controls.' }),
  c('Bladewing the Risen',  'Legendary Creature — Zombie Dragon', { cost: '{3}{B}{R}', cmc: 5, colors: ['B','R'], text: 'Flying. When this enters, you may return target Dragon card from your graveyard to the battlefield.' }),
  c('Dragon Tempest',       'Enchantment', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Whenever a creature with flying enters under your control, it gains haste. Whenever a Dragon enters under your control, this deals X damage to any target.' }),
  c("Dragonlord's Servant", 'Creature — Goblin', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Dragon spells you cast cost {1} less to cast.' }),
  c('Dragonspeaker Shaman', 'Creature — Human Barbarian Shaman', { cost: '{2}{R}', cmc: 3, colors: ['R'], text: 'Dragon spells you cast cost {2} less to cast.' }),
  c('Goldspan Dragon',      'Creature — Dragon', { cost: '{3}{R}{R}', cmc: 5, colors: ['R'], text: 'Flying, haste. Whenever this attacks or becomes the target of a spell, create a Treasure token.' }),
  c('Hellkite Tyrant',      'Creature — Dragon', { cost: '{4}{R}{R}', cmc: 6, colors: ['R'], text: 'Flying, trample. Whenever this deals combat damage to a player, gain control of all artifacts that player controls.' }),
  c('Klauth, Unrivaled Ancient','Legendary Creature — Dragon', { cost: '{4}{R}{R}{G}', cmc: 7, colors: ['R','G'], text: 'Flying, trample, haste. When this enters, add X mana in any combination of colors, where X is its power. Whenever you attack with this, you may draw a card for each creature you attacked with.' }),
  c('Lathliss, Dragon Queen','Legendary Creature — Dragon', { cost: '{4}{R}{R}', cmc: 6, colors: ['R'], text: 'Flying. Whenever another nontoken Dragon enters under your control, create a 5/5 red Dragon creature token with flying.' }),
  c('Old Gnawbone',         'Legendary Creature — Dragon', { cost: '{4}{G}{G}', cmc: 6, colors: ['G'], text: 'Flying, trample. Whenever you attack with one or more creatures, create that many Treasure tokens.' }),
  c('Terror of the Peaks',  'Creature — Dragon', { cost: '{4}{R}{R}', cmc: 6, colors: ['R'], text: 'Flying. Whenever another creature enters under your control, this deals damage equal to that creature\'s power to any target.' }),
  c('The Ur-Dragon',        'Legendary Creature — Dragon Avatar', { cost: '{4}{W}{U}{B}{R}{G}', cmc: 9, colors: ['W','U','B','R','G'], text: 'Eminence — Dragon spells you cast cost {1} less to cast. Flying. Whenever this attacks, you may put a permanent card from your hand onto the battlefield.' }),
  c('Utvara Hellkite',      'Creature — Dragon', { cost: '{6}{R}{R}', cmc: 8, colors: ['R'], text: 'Flying. Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.' }),
  c('Karrthus, Tyrant of Jund','Legendary Creature — Dragon', { cost: '{4}{B}{R}{G}', cmc: 7, colors: ['B','R','G'], text: 'Flying, trample, haste. Other Dragon creatures you control have haste. When this enters, gain control of all Dragon creatures.' }),
  c('Wasitora, Nekoru Queen','Legendary Creature — Cat Dragon', { cost: '{2}{B}{R}{G}', cmc: 5, colors: ['B','R','G'], text: 'Flying, trample. Whenever this deals combat damage to a player, that player sacrifices a creature unless they create a 3/3 black Cat Dragon token with flying.' }),
]

// ─── Tribal: Goblins ───────────────────────────────────────────────────────

export const GOBLINS = [
  c('Goblin Lackey',     'Creature — Goblin', { cost: '{R}', cmc: 1, colors: ['R'], text: 'Whenever this deals combat damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.' }),
  c('Goblin Recruiter',  'Creature — Goblin', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'When this enters, search your library for any number of Goblin creature cards and reveal those cards.' }),
  c('Goblin Matron',     'Creature — Goblin', { cost: '{2}{R}', cmc: 3, colors: ['R'], text: 'When this enters, you may search your library for a Goblin card, reveal that card, and put it into your hand.' }),
  c('Skirk Prospector',  'Creature — Goblin', { cost: '{R}', cmc: 1, colors: ['R'], text: 'Sacrifice a Goblin: Add {R}.' }),
  c('Mogg War Marshal',  'Creature — Goblin Warrior', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Echo. When this enters or dies, create a 1/1 red Goblin token.' }),
  c('Goblin Chieftain',  'Creature — Goblin Warrior', { cost: '{1}{R}{R}', cmc: 3, colors: ['R'], text: 'Goblins you control get +1/+1 and have haste.' }),
  c('Goblin King',       'Creature — Goblin', { cost: '{1}{R}{R}', cmc: 3, colors: ['R'], text: 'Other Goblins get +1/+1 and have mountainwalk.' }),
  c('Krenko, Tin Street Kingpin','Legendary Creature — Goblin Warrior', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Whenever this attacks, put a +1/+1 counter on it, then create a number of 1/1 red Goblin creature tokens equal to its power.' }),
  c('Muxus, Goblin Grandee','Legendary Creature — Goblin Noble', { cost: '{4}{R}{R}', cmc: 6, colors: ['R'], text: 'When this enters, look at the top six cards of your library. Put each Goblin creature card with mana value 5 or less from among them onto the battlefield.' }),
  c('Goblin Piledriver', 'Creature — Goblin Warrior', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Protection from blue. Whenever this attacks, it gets +2/+0 until end of turn for each other attacking Goblin.' }),
]

// ─── Tribal: Elves ─────────────────────────────────────────────────────────

export const ELVES = [
  c('Priest of Titania',  'Creature — Elf Druid',   { cost: '{1}{G}', cmc: 2, colors: ['G'], text: '{T}: Add {G} for each Elf on the battlefield.' }),
  c('Heritage Druid',     'Creature — Elf Druid',   { cost: '{G}',    cmc: 1, colors: ['G'], text: 'Tap three untapped Elves you control: Add {G}{G}{G}.' }),
  c('Wirewood Symbiote',  'Creature — Insect',      { cost: '{G}',    cmc: 1, colors: ['G'], text: 'Return target Elf you control to its owner\'s hand: Untap target creature.' }),
  c('Marwyn, the Nurturer','Legendary Creature — Elf Druid', { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: 'Whenever another Elf enters under your control, put a +1/+1 counter on Marwyn. {T}: Add {G} for each +1/+1 counter on Marwyn.' }),
  c('Ezuri, Renegade Leader','Legendary Creature — Elf Warrior', { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: '{G}: Regenerate target Elf. {4}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.' }),
  c('Elvish Archdruid',   'Creature — Elf Druid',   { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: 'Other Elf creatures you control get +1/+1. {T}: Add {G} for each Elf you control.' }),
  c('Elvish Mystic Lord', 'Creature — Elf Druid',   { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: 'Other Elf creatures you control get +1/+1.' }),
  c('Beast Whisperer',    'Creature — Elf Druid',   { cost: '{2}{G}{G}', cmc: 4, colors: ['G'], text: 'Whenever you cast a creature spell, draw a card.' }),
  c('Realmwalker',        'Creature — Shapeshifter',{ cost: '{2}{G}',    cmc: 3, colors: ['G'], text: 'Changeling. Play with the top card of your library revealed. You may cast creature spells of the chosen type from the top of your library.' }),
]

// ─── Tribal: Clerics (often lifegain) ──────────────────────────────────────

export const CLERICS = [
  c('Heliod, Sun-Crowned','Legendary Enchantment Creature — God', { cost: '{1}{W}{W}', cmc: 3, colors: ['W'], text: 'Whenever you gain life, put a +1/+1 counter on target creature or enchantment. {1}{W}: Target creature gains lifelink until end of turn.' }),
  c('Soul Warden',        'Creature — Human Cleric',   { cost: '{W}', cmc: 1, colors: ['W'], text: 'Whenever another creature enters, you gain 1 life.' }),
  c('Soul\'s Attendant',  'Creature — Human Cleric',   { cost: '{W}', cmc: 1, colors: ['W'], text: 'Whenever another creature enters, you gain 1 life.' }),
  c('Walking Ballista',   'Artifact Creature — Construct', { cost: '{X}{X}', cmc: 0, text: 'This enters with X +1/+1 counters. {4}: Put a +1/+1 counter on this. Remove a +1/+1 counter: This deals 1 damage to any target.' }),
  c('Cleric of Life\'s Bond','Creature — Human Cleric',{ cost: '{B}{W}', cmc: 2, colors: ['B','W'], text: 'Lifelink. Whenever you gain life, put that many +1/+1 counters on this.' }),
  c('Tariel, Reckoner of Souls','Legendary Creature — Angel', { cost: '{4}{W}{B}', cmc: 6, colors: ['W','B'], text: 'Flying. {T}: Choose an opponent. Reveal cards from the top of that player\'s graveyard until you reveal a creature card. Put that card onto the battlefield.' }),
  c('Speaker of the Heavens','Creature — Human Cleric',{ cost: '{W}', cmc: 1, colors: ['W'], text: '{T}: You gain 2 life. {2}{W}, {T}: Create a 4/4 white Angel creature token with flying. Activate only if you have at least 27 life.' }),
]

// ─── Tribal: Spiders (often graveyard / token themes) ──────────────────────

export const SPIDERS = [
  c('Shelob, Child of Ungoliant','Legendary Creature — Spider Demon', { cost: '{4}{B}{G}', cmc: 6, colors: ['B','G'], text: 'Menace, deathtouch. Other non-Spider creatures you control are Spiders in addition to their other types. Whenever a Human dealt damage by Shelob this turn dies, put it onto the battlefield under your control. It\'s a Spider in addition to its other types.' }),
  c('Ishkanah, Grafwidow','Legendary Creature — Spider', { cost: '{3}{B}{G}{G}', cmc: 6, colors: ['B','G'], text: 'Reach. Delirium — When this enters, if there are four or more card types in your graveyard, create three 1/2 green Spider creature tokens with reach.' }),
  c('Arasta of the Endless Web','Legendary Creature — Spider', { cost: '{2}{G}{G}', cmc: 4, colors: ['G'], text: 'Reach. Whenever an opponent casts an instant or sorcery spell, create a 1/2 green Spider creature token with reach.' }),
  c('Penumbra Spider',    'Creature — Spider', { cost: '{3}{G}', cmc: 4, colors: ['G'], text: 'Reach. When this dies, create a 2/4 black Spider creature token with reach.' }),
  c('Dragon Egg',         'Creature — Dragon Egg', { cost: '{1}{R}', cmc: 2, colors: ['R'], text: 'Defender. When this dies, create a 2/2 red Dragon creature token with flying and "{R}: This creature gets +1/+0 until end of turn".' }),  // not really spider but fits "small token producer"
  c('Spider Spawning',    'Sorcery', { cost: '{4}{G}', cmc: 5, colors: ['G'], text: 'Create a 1/2 green Spider creature token with reach for each creature card in your graveyard.' }),
  c('Sentinel Spider',    'Creature — Spider', { cost: '{3}{G}', cmc: 4, colors: ['G'], text: 'Vigilance, reach.' }),
]

// ─── Graveyard / Reanimator package ────────────────────────────────────────
//
// For commanders like Karador, Meren, Muldrotha, Sidisi.

export const GRAVEYARD_PACKAGE = [
  // Reanimation spells
  c('Reanimate',          'Sorcery', { cost: '{B}', cmc: 1, colors: ['B'], text: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.' }),
  c('Animate Dead',       'Enchantment — Aura', { cost: '{1}{B}', cmc: 2, colors: ['B'], text: 'Enchant creature card in a graveyard. When this enters, return enchanted creature card to the battlefield under your control with this attached to it.' }),
  c('Necromancy',         'Enchantment',        { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Flash. Return target creature card from a graveyard to the battlefield under your control.' }),
  c('Victimize',          'Sorcery',            { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Sacrifice a creature. Return up to two target creature cards from your graveyard to the battlefield tapped.' }),
  // Graveyard tutors / fillers
  c('Entomb',             'Instant',            { cost: '{B}', cmc: 1, colors: ['B'], text: 'Search your library for a card and put it into your graveyard.' }),
  c('Buried Alive',       'Sorcery',            { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Search your library for up to three creature cards and put them into your graveyard.' }),
  // Recursion engines
  c('Meren of Clan Nel Toth','Legendary Creature — Human Shaman', { cost: '{2}{B}{G}', cmc: 4, colors: ['B','G'], text: 'Whenever another creature you control dies, you get an experience counter. At the beginning of your end step, choose target creature card in your graveyard. If that card\'s mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, return it to your hand.' }),
  c('Sun Titan',          'Creature — Giant',   { cost: '{4}{W}{W}', cmc: 6, colors: ['W'], text: 'Vigilance. Whenever this enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.' }),
  c('Karmic Guide',       'Creature — Angel Spirit', { cost: '{3}{W}{W}', cmc: 5, colors: ['W'], text: 'Flying, protection from black. Echo. When this enters, return target creature card from your graveyard to the battlefield.' }),
  c('Eternal Witness',    'Creature — Human Shaman', { cost: '{1}{G}{G}', cmc: 3, colors: ['G'], text: 'When this enters, return target card from your graveyard to your hand.' }),
  // Sac outlets (aristocrats package)
  c('Phyrexian Altar',    'Artifact',           { cost: '{3}', cmc: 3, text: 'Sacrifice a creature: Add one mana of any color.' }),
  c('Ashnod\'s Altar',    'Artifact',           { cost: '{3}', cmc: 3, text: 'Sacrifice a creature: Add {C}{C}.' }),
  c('Viscera Seer',       'Creature — Vampire Wizard', { cost: '{B}', cmc: 1, colors: ['B'], text: 'Sacrifice a creature: Scry 1.' }),
  // Sac payoffs
  c('Blood Artist',       'Creature — Vampire',  { cost: '{1}{B}', cmc: 2, colors: ['B'], text: 'Whenever this or another creature dies, target player loses 1 life and you gain 1 life.' }),
  c('Zulaport Cutthroat', 'Creature — Human Rogue', { cost: '{1}{B}', cmc: 2, colors: ['B'], text: 'Whenever this or another creature you control dies, each opponent loses 1 life and you gain 1 life.' }),
  // Mill enablers
  c('Stinkweed Imp',      'Creature — Imp',     { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Flying. Whenever this deals combat damage to a creature, destroy that creature. Dredge 5.' }),
  c('Tortured Existence', 'Enchantment',        { cost: '{B}', cmc: 1, colors: ['B'], text: 'Discard a creature card: Return target creature card from your graveyard to your hand.' }),
]

// ─── Tribal: Vampires ──────────────────────────────────────────────────────

export const VAMPIRES = [
  c('Vampire Nocturnus', 'Creature — Vampire', { cost: '{1}{B}{B}{B}', cmc: 4, colors: ['B'], text: 'As long as the top card of your library is black, vampire creatures get +2/+1 and have flying.' }),
  c('Bloodghast',        'Creature — Vampire Spirit', { cost: '{B}{B}', cmc: 2, colors: ['B'], text: 'This can\'t block. Haste as long as an opponent has 10 or less life. Landfall — Whenever a land enters under your control, you may return this from your graveyard.' }),
  c('Captivating Vampire','Creature — Vampire', { cost: '{1}{B}{B}', cmc: 3, colors: ['B'], text: 'Other Vampire creatures you control get +1/+1. {T}, tap five untapped Vampires you control: Gain control of target creature. That creature becomes a Vampire.' }),
  c('Necropolis Regent', 'Creature — Vampire', { cost: '{4}{B}{B}', cmc: 6, colors: ['B'], text: 'Flying. Whenever a creature you control deals combat damage to a player, put that many +1/+1 counters on it.' }),
  c('Bloodline Keeper',  'Creature — Vampire', { cost: '{2}{B}{B}', cmc: 4, colors: ['B'], text: 'Flying. {T}: Create a 2/2 black Vampire creature token with flying.' }),
  c('Sangromancer',      'Creature — Vampire Shaman', { cost: '{2}{B}{B}', cmc: 4, colors: ['B'], text: 'Flying. Whenever an opponent discards a card or a creature an opponent controls dies, you may gain 3 life.' }),
]

// ─── Mana base ─────────────────────────────────────────────────────────────

export const PREMIUM_LANDS = [
  c('Polluted Delta',   'Land', { text: '{T}, pay 1 life, sacrifice this: Search your library for an Island or Swamp card.', colors: ['U','B'] }),
  c('Flooded Strand',   'Land', { text: '{T}, pay 1 life, sacrifice this: Search your library for a Plains or Island card.', colors: ['W','U'] }),
  c('Wooded Foothills', 'Land', { text: '{T}, pay 1 life, sacrifice this: Search your library for a Mountain or Forest card.', colors: ['R','G'] }),
  c('Misty Rainforest', 'Land', { text: '{T}, pay 1 life, sacrifice this: Search your library for a Forest or Island card.', colors: ['G','U'] }),
  c('Bloodstained Mire','Land', { text: '{T}, pay 1 life, sacrifice this: Search your library for a Swamp or Mountain card.', colors: ['B','R'] }),
  c('Steam Vents',      'Land', { text: '({T}: Add {U} or {R}.) As this enters, you may pay 2 life. If you don\'t, it enters tapped.', colors: ['U','R'] }),
  c('Stomping Ground',  'Land', { text: '({T}: Add {R} or {G}.)', colors: ['R','G'] }),
  c('Watery Grave',     'Land', { text: '({T}: Add {U} or {B}.)', colors: ['U','B'] }),
  c('Sacred Foundry',   'Land', { text: '({T}: Add {R} or {W}.)', colors: ['R','W'] }),
  c('Hallowed Fountain','Land', { text: '({T}: Add {W} or {U}.)', colors: ['W','U'] }),
  c('Overgrown Tomb',   'Land', { text: '({T}: Add {B} or {G}.)', colors: ['B','G'] }),
  c('Breeding Pool',    'Land', { text: '({T}: Add {G} or {U}.)', colors: ['G','U'] }),
  c('Godless Shrine',   'Land', { text: '({T}: Add {W} or {B}.)', colors: ['W','B'] }),
  c('Blood Crypt',      'Land', { text: '({T}: Add {B} or {R}.)', colors: ['B','R'] }),
  c('Temple Garden',    'Land', { text: '({T}: Add {G} or {W}.)', colors: ['G','W'] }),
  c('Command Tower',    'Land', { text: '{T}: Add one mana of any color in your commander\'s identity.' }),
  c('City of Brass',    'Land', { text: 'Whenever this becomes tapped, it deals 1 damage to you. {T}: Add one mana of any color.' }),
  c('Mana Confluence',  'Land', { text: '{T}, Pay 1 life: Add one mana of any color.' }),
  c('Reflecting Pool',  'Land', { text: '{T}: Add one mana of any type that a land you control could produce.' }),
  c('Bojuka Bog',       'Land', { text: 'This enters tapped. When this enters, exile all cards from target player\'s graveyard. {T}: Add {B}.', colors: ['B'] }),
  c('Strip Mine',       'Land', { text: '{T}: Add {C}. {T}, sacrifice this: Destroy target land.' }),
]

// Weak lands the user might own — solver should AVOID at high brackets
export const WEAK_LANDS = [
  c('Izzet Guildgate',    'Land', { text: 'Izzet Guildgate enters tapped. {T}: Add {U} or {R}.', colors: ['U','R'] }),
  c('Akoum Refuge',       'Land', { text: 'Akoum Refuge enters tapped. When it enters, you gain 1 life. {T}: Add {B} or {R}.', colors: ['B','R'] }),
  c('Frontier Bivouac',   'Land', { text: 'Frontier Bivouac enters tapped. {T}: Add {G}, {U}, or {R}.', colors: ['G','U','R'] }),
]

export const BASIC_LANDS = [
  c('Plains',  'Basic Land — Plains',   { basic: true, text: '({T}: Add {W}.)', colors: ['W'] }),
  c('Island',  'Basic Land — Island',   { basic: true, text: '({T}: Add {U}.)', colors: ['U'] }),
  c('Swamp',   'Basic Land — Swamp',    { basic: true, text: '({T}: Add {B}.)', colors: ['B'] }),
  c('Mountain','Basic Land — Mountain', { basic: true, text: '({T}: Add {R}.)', colors: ['R'] }),
  c('Forest',  'Basic Land — Forest',   { basic: true, text: '({T}: Add {G}.)', colors: ['G'] }),
]

// ─── Game changers (excluded at B1) ────────────────────────────────────────

export const GAME_CHANGER_BANS = [
  // These names are in the GAME_CHANGERS_SET so they get tagged 'game_changer'
  // by cardRoles.js. At B1 they're filtered out by isBracketAllowed.
  c('Drannith Magistrate','Creature — Human Wizard', { cost: '{1}{W}', cmc: 2, colors: ['W'], text: 'Your opponents can\'t cast spells from anywhere other than their hands.' }),
  c('Opposition Agent',  'Creature — Human Rogue', { cost: '{2}{B}', cmc: 3, colors: ['B'], text: 'Flash. You control any spells and abilities your opponents control that cause them to search a library.' }),
]

// ─── Composite collections (use these in tests) ────────────────────────────

export const ALL_UNIVERSAL_STAPLES = [
  ...UNIVERSAL_RAMP, ...UNIVERSAL_PROTECTION, ...UNIVERSAL_DRAW,
  ...UNIVERSAL_REMOVAL, ...UNIVERSAL_GREEN_RAMP,
]

export const ALL_CEDH_STAPLES = [
  ...CEDH_FAST_MANA, ...CEDH_TUTORS, ...CEDH_FREE_INTERACTION,
  ...CEDH_DRAW_ENGINES, ...CEDH_COMBO_WINS, ...TALISMANS, ...SIGNETS,
]

export const ALL_LANDS = [...PREMIUM_LANDS, ...WEAK_LANDS, ...BASIC_LANDS]

// Bulk generator for filler creatures/spells so mono-color commanders have
// enough non-land legal cards to fill 99-deck slots. Without this, the test
// fixture's mono-R/mono-G/mono-W pools are too small (~50 cards) and the
// orchestrator's hard backstop fires, padding the deck with extra basics.
// Real player collections have hundreds of cards per color — this generator
// approximates that.
// Bulk filler must NOT contain text that overlaps with archetype keywords —
// otherwise cardRoles tags them 'synergy' and the off-theme penalty doesn't
// apply, defeating the test's purpose. Use neutral non-keyword text.
function buildBulkFiller(color, count, prefix) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({
      name:           `${prefix} ${i + 1}`,
      type_line:      'Creature — Bear',          // generic, no tribal overlap with our test commanders
      oracle_text:    '',                          // no text → no role/tag inference; pure filler
      mana_cost:      `{${i % 5 + 1}}{${color}}`,
      cmc:            (i % 5) + 2,
      colors:         [color],
      color_identity: [color],
      legalities:     { commander: 'legal' },
      rarity:         'common',
      isBasicLand:    false,
      image_uris:     null,
      card_faces:     null,
      quantity:       1,
    })
  }
  return out
}

// 25 colorless artifacts so colorless/multi-color commanders have enough.
function buildColorlessBulk() {
  const out = []
  for (let i = 0; i < 25; i++) {
    out.push({
      name:           `Colorless Filler ${i + 1}`,
      type_line:      'Artifact',
      oracle_text:    '{T}: Add {C}.',
      mana_cost:      `{${i % 4 + 2}}`,
      cmc:            (i % 4) + 2,
      colors:         [],
      color_identity: [],
      legalities:     { commander: 'legal' },
      rarity:         'uncommon',
      isBasicLand:    false,
      image_uris:     null,
      card_faces:     null,
      quantity:       1,
    })
  }
  return out
}

// A "comprehensive" 5-color collection — covers all major staples + several
// archetype packages. Tests use this for "rich collection" scenarios.
//
// Sized so even mono-color commanders have 70+ non-land legal cards in pool
// after filters — enough that hard backstop never fires for the rich case.
export function buildRichCollection() {
  return [
    ...ALL_UNIVERSAL_STAPLES,
    ...ALL_CEDH_STAPLES,
    ...MANA_DORKS,
    ...DRAGONS,
    ...GOBLINS,
    ...VAMPIRES,
    ...ELVES, ...CLERICS, ...SPIDERS, ...GRAVEYARD_PACKAGE,
    ...GAME_CHANGER_BANS,
    ...OFF_THEME_FILLER,
    // Bulk filler so mono-color collections have enough bodies
    ...buildBulkFiller('W', 40, 'White Filler'),
    ...buildBulkFiller('U', 40, 'Blue Filler'),
    ...buildBulkFiller('B', 40, 'Black Filler'),
    ...buildBulkFiller('R', 40, 'Red Filler'),
    ...buildBulkFiller('G', 40, 'Green Filler'),
    ...buildColorlessBulk(),
    ...ALL_LANDS,
    // Repeat basics so the solver has plenty of supply
    ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS,
    ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS,
  ]
}

// A "sparse" collection — has only universal staples and basic lands. Tests
// use this to verify the algorithm handles low-coverage gracefully (warnings,
// no crashes, ships a 99-card deck).
export function buildSparseCollection() {
  return [
    ...UNIVERSAL_RAMP, ...UNIVERSAL_PROTECTION,
    ...UNIVERSAL_GREEN_RAMP, ...MANA_DORKS,
    ...DRAGONS.slice(0, 3),    // only 3 dragons available
    ...PREMIUM_LANDS.slice(0, 5),   // only 5 non-basic lands
    ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS,
    ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS,
    ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS, ...BASIC_LANDS,
  ]
}

// Helper for tests: count cards in a deck matching a name list.
export function countByName(deck, names) {
  const set = new Set(names.map(n => n.toLowerCase()))
  return deck.filter(c => set.has(c.name.toLowerCase())).length
}
