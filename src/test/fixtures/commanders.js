// Commander fixtures covering the major archetype patterns.
//
// Why these specific commanders: each represents a distinct deck-building
// pattern the algorithm must handle. New commanders that fit one of these
// patterns inherit the coverage — e.g. Chatterfang Squirrel General fits the
// "tribal token producer" pattern shared with Krenko, so universal invariants
// + Krenko-style tests cover it implicitly.
//
// We don't claim exhaustive coverage. The point is: pick representative
// archetypes, test the structural properties that hold across them, trust
// that uncovered commanders still satisfy universal invariants.

function commander(name, colorIdentity, opts = {}) {
  return {
    name,
    type_line: opts.type ?? `Legendary Creature — ${opts.subtype ?? 'Human'}`,
    oracle_text: opts.text ?? '',
    mana_cost: opts.cost ?? '',
    cmc: opts.cmc ?? 4,
    colors: colorIdentity,
    color_identity: colorIdentity,
    legalities: { commander: 'legal' },
    rarity: 'mythic',
    image_uris: null,
    card_faces: null,
    quantity: 1,
  }
}

// ─── Tribal ─────────────────────────────────────────────────────────────────

export const TIAMAT = commander('Tiamat', ['W','U','B','R','G'], {
  type: 'Legendary Creature — Dragon God',
  cmc: 7, cost: '{4}{W}{U}{B}{R}{G}',
  text: 'Flying. When Tiamat enters, search your library for up to five Dragon cards with different names, reveal them, put them into your hand, then shuffle.',
  subtype: 'Dragon God',
})

export const KRENKO = commander('Krenko, Mob Boss', ['R'], {
  type: 'Legendary Creature — Goblin Warrior',
  cmc: 4, cost: '{2}{R}{R}',
  text: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
  subtype: 'Goblin Warrior',
})

export const EDGAR_MARKOV = commander('Edgar Markov', ['W','B','R'], {
  type: 'Legendary Creature — Vampire Knight',
  cmc: 6, cost: '{3}{R}{W}{B}',
  text: 'Eminence — Whenever you cast another Vampire spell, if Edgar Markov is in the command zone or on the battlefield, create a 1/1 black Vampire creature token. First strike, haste. Whenever Edgar Markov attacks, put a +1/+1 counter on each Vampire you control.',
  subtype: 'Vampire Knight',
})

export const MARWYN = commander('Marwyn, the Nurturer', ['G'], {
  type: 'Legendary Creature — Elf Druid',
  cmc: 3, cost: '{1}{G}{G}',
  text: 'Whenever another Elf enters under your control, put a +1/+1 counter on Marwyn. {T}: Add {G} for each +1/+1 counter on Marwyn.',
  subtype: 'Elf Druid',
})

export const SHELOB = commander('Shelob, Child of Ungoliant', ['B','G'], {
  type: 'Legendary Creature — Spider Demon',
  cmc: 6, cost: '{4}{B}{G}',
  text: 'Menace, deathtouch. Other non-Spider creatures you control are Spiders in addition to their other types. Whenever a Human dealt damage by Shelob this turn dies, put it onto the battlefield under your control. It\'s a Spider in addition to its other types.',
  subtype: 'Spider Demon',
})

// ─── Combo / cEDH ───────────────────────────────────────────────────────────

export const NAJEELA = commander('Najeela, the Blade-Blossom', ['W','U','B','R','G'], {
  type: 'Legendary Creature — Human Warrior',
  cmc: 3, cost: '{2}{R}',
  text: 'Whenever a Warrior you control attacks, create a 1/1 Warrior token. {W}{U}{B}{R}{G}: Untap all attacking creatures. They gain trample, lifelink, and haste until end of turn. After the combat phase this turn, there is an additional combat phase.',
  subtype: 'Human Warrior',
})

export const KINNAN = commander('Kinnan, Bonder Prodigy', ['G','U'], {
  type: 'Legendary Creature — Human Druid',
  cmc: 3, cost: '{1}{G}{U}',
  text: 'Whenever you tap a nonland permanent for mana, add an additional {C}. {5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield.',
  subtype: 'Human Druid',
})

// ─── Spellslinger ───────────────────────────────────────────────────────────

export const NIV_MIZZET = commander('Niv-Mizzet, Parun', ['U','R'], {
  type: 'Legendary Creature — Dragon Wizard',
  cmc: 6, cost: '{U}{U}{U}{R}{R}{R}',
  text: 'Niv-Mizzet, Parun can\'t be countered. Flying. Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target. Whenever a player casts an instant or sorcery spell, you draw a card.',
  subtype: 'Dragon Wizard',
})

// ─── Graveyard / Reanimator ─────────────────────────────────────────────────

export const MEREN = commander('Meren of Clan Nel Toth', ['B','G'], {
  type: 'Legendary Creature — Human Shaman',
  cmc: 4, cost: '{2}{B}{G}',
  text: 'Whenever another creature you control dies, you get an experience counter. At the beginning of your end step, choose target creature card in your graveyard. If that card\'s mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, return it to your hand.',
  subtype: 'Human Shaman',
})

export const KARADOR = commander('Karador, Ghost Chieftain', ['W','B','G'], {
  type: 'Legendary Creature — Centaur Spirit',
  cmc: 8, cost: '{3}{W}{B}{B}{G}{G}',
  text: 'Karador, Ghost Chieftain costs {1} less to cast for each creature card in your graveyard. During each of your turns, you may cast a creature spell from your graveyard.',
  subtype: 'Centaur Spirit',
})

// ─── Lifegain combo ─────────────────────────────────────────────────────────

export const HELIOD = commander('Heliod, Sun-Crowned', ['W'], {
  type: 'Legendary Enchantment Creature — God',
  cmc: 3, cost: '{1}{W}{W}',
  text: 'Indestructible. As long as your devotion to white is less than five, Heliod isn\'t a creature. Whenever you gain life, put a +1/+1 counter on target creature or enchantment. {1}{W}: Target creature gains lifelink until end of turn.',
  subtype: 'God',
})

// ─── Counters / value ───────────────────────────────────────────────────────

export const ATRAXA = commander("Atraxa, Praetors' Voice", ['W','U','B','G'], {
  type: 'Legendary Creature — Phyrexian Angel',
  cmc: 4, cost: '{G}{W}{U}{B}',
  text: 'Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.',
  subtype: 'Phyrexian Angel',
})

// ─── All commanders by archetype, for parameterized tests ──────────────────

export const ALL_COMMANDERS = [
  TIAMAT, KRENKO, EDGAR_MARKOV, MARWYN, SHELOB,
  NAJEELA, KINNAN,
  NIV_MIZZET,
  MEREN, KARADOR,
  HELIOD,
  ATRAXA,
]

export const TRIBAL_COMMANDERS  = [TIAMAT, KRENKO, EDGAR_MARKOV, MARWYN, SHELOB]
export const CEDH_COMMANDERS    = [NAJEELA, KINNAN]
export const GRAVEYARD_COMMANDERS = [MEREN, KARADOR]
