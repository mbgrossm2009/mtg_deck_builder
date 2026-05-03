// CardProfile tests.
//
// These tests pin down the structured semantic understanding of cards.
// Each test uses verbatim Scryfall oracle text where possible (per the
// memory rule: paraphrasing breaks precision).
//
// New mechanic understanding goes here first, then propagates to lenses.

import { describe, it, expect, beforeEach } from 'vitest'
import { extractCardProfile, clearProfileCache } from './cardProfile'

beforeEach(() => {
  clearProfileCache()
})

const card = (props) => ({
  type_line: 'Creature — Bear',
  oracle_text: '',
  ...props,
})

describe('extractCardProfile — base shape', () => {
  it('returns an empty profile for a card with no name', () => {
    const p = extractCardProfile({})
    expect(p.name).toBe('')
    expect(p.roles).toEqual([])
    expect(p.tags).toEqual([])
  })

  it('returns a profile object with all top-level fields', () => {
    const p = extractCardProfile(card({ name: 'Test', oracle_text: '' }))
    expect(p).toHaveProperty('name')
    expect(p).toHaveProperty('roles')
    expect(p).toHaveProperty('tags')
    expect(p).toHaveProperty('evasion')
    expect(p).toHaveProperty('triggers')
    expect(p).toHaveProperty('power')
    expect(p).toHaveProperty('wincon')
  })

  it('caches by card name (returns same object for same name)', () => {
    const c = card({ name: 'Test', oracle_text: 'Add {G}.' })
    const p1 = extractCardProfile(c)
    const p2 = extractCardProfile(c)
    expect(p1).toBe(p2)
  })
})

describe('extractCardProfile — evasion detection', () => {
  it('flying', () => {
    const p = extractCardProfile(card({ name: 'Flyer', oracle_text: 'Flying.' }))
    expect(p.evasion).toContain('flying')
  })

  it('menace + trample (multiple keywords)', () => {
    const p = extractCardProfile(card({
      name: 'Bruiser', oracle_text: 'Menace, trample.',
    }))
    expect(p.evasion).toContain('menace')
    expect(p.evasion).toContain('trample')
  })

  it('"can\'t be blocked" → unblockable', () => {
    const p = extractCardProfile(card({
      name: 'Sneak', oracle_text: 'This creature can\'t be blocked.',
    }))
    expect(p.evasion).toContain('unblockable')
  })

  it('non-creatures don\'t get evasion (artifact with "flying" in flavor)', () => {
    const p = extractCardProfile({
      name: 'Sky Diary',
      type_line: 'Artifact',
      oracle_text: 'When this enters, target creature gains flying until end of turn.',
    })
    expect(p.evasion).toEqual([])
  })

  it('horsemanship (Portal Three Kingdoms-era)', () => {
    const p = extractCardProfile(card({
      name: 'Horse Archer', oracle_text: 'Horsemanship.',
    }))
    expect(p.evasion).toContain('horsemanship')
  })
})

describe('extractCardProfile — attack triggers', () => {
  it('"Whenever ~ attacks, deals N damage" → damage trigger', () => {
    const p = extractCardProfile(card({
      name: 'Far Fortune',
      oracle_text: 'Whenever you attack, Far Fortune deals 1 damage to each opponent.',
    }))
    expect(p.triggers.onAttack).toContain('damage')
  })

  it('"Whenever ~ attacks, draw a card" → draw trigger (Toski)', () => {
    const p = extractCardProfile(card({
      name: 'Toski',
      oracle_text: 'Whenever a creature you control deals combat damage to a player, draw a card.\nWhenever Toski attacks, draw a card.',
    }))
    expect(p.triggers.onAttack).toContain('draw')
  })

  it('"Whenever ~ attacks, create ... token" → token trigger (Najeela)', () => {
    const p = extractCardProfile(card({
      name: 'Najeela',
      oracle_text: 'Whenever a Warrior you control attacks, create a 1/1 Warrior token.',
    }))
    expect(p.triggers.onAttack).toContain('token')
  })
})

describe('extractCardProfile — ETB triggers', () => {
  it('"When ~ enters, deals N damage" → damage trigger', () => {
    const p = extractCardProfile(card({
      name: 'Inferno Titan',
      oracle_text: 'When Inferno Titan enters, it deals 3 damage divided as you choose.',
    }))
    expect(p.triggers.onETB).toContain('damage')
  })

  it('"When ~ enters, draw a card" → draw trigger', () => {
    const p = extractCardProfile(card({
      name: 'Mulldrifter',
      oracle_text: 'When Mulldrifter enters, draw two cards.',
    }))
    expect(p.triggers.onETB).toContain('draw')
  })

  it('"When ~ enters, search your library" → tutor trigger', () => {
    const p = extractCardProfile(card({
      name: 'Tiamat',
      oracle_text: 'When Tiamat enters, search your library for up to five Dragon cards.',
    }))
    expect(p.triggers.onETB).toContain('tutor')
  })
})

describe('extractCardProfile — power signals', () => {
  it('Sol Ring → fastMana = true', () => {
    const p = extractCardProfile({
      name: 'Sol Ring', type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    })
    expect(p.power.fastMana).toBe(true)
  })

  it('Demonic Tutor → tutorTier = "hard"', () => {
    const p = extractCardProfile({
      name: 'Demonic Tutor', type_line: 'Sorcery',
      oracle_text: 'Search your library for a card and put it into your hand.',
    })
    expect(p.power.tutorTier).toBe('hard')
  })

  it('Worldly Tutor → tutorTier = "soft"', () => {
    const p = extractCardProfile({
      name: 'Worldly Tutor', type_line: 'Instant',
      oracle_text: 'Search your library for a creature card, reveal that card, then shuffle.',
    })
    expect(p.power.tutorTier).toBe('soft')
  })

  it('non-tutor → tutorTier = null', () => {
    const p = extractCardProfile(card({ name: 'Random', oracle_text: '' }))
    expect(p.power.tutorTier).toBeNull()
  })
})

describe('extractCardProfile — wincon contributions', () => {
  it('Impact Tremors → contributes to etb_drain', () => {
    const p = extractCardProfile({
      name: 'Impact Tremors', type_line: 'Enchantment',
      oracle_text: 'Whenever a creature enters under your control, this deals 1 damage to each opponent.',
    })
    expect(p.wincon.contributes).toContain('etb_drain')
  })

  it('Blood Artist → contributes to aristocrats_drain', () => {
    const p = extractCardProfile({
      name: 'Blood Artist', type_line: 'Creature — Vampire',
      oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
    })
    expect(p.wincon.contributes).toContain('aristocrats_drain')
  })

  it('Aggravated Assault → contributes to extra_combat', () => {
    const p = extractCardProfile({
      name: 'Aggravated Assault', type_line: 'Enchantment',
      oracle_text: '{3}{R}{R}: Untap all creatures you control. After this phase, there is an additional combat phase.',
    })
    expect(p.wincon.contributes).toContain('extra_combat')
  })

  it('Bident of Thassa → contributes to combat_damage_draw', () => {
    const p = extractCardProfile({
      name: 'Bident of Thassa', type_line: 'Legendary Enchantment Artifact',
      oracle_text: 'Whenever a creature you control deals combat damage to a player, you may draw a card.',
    })
    expect(p.wincon.contributes).toContain('combat_damage_draw')
  })

  it('Thassa\'s Oracle → singleCard wincon = true', () => {
    const p = extractCardProfile({
      name: "Thassa's Oracle", type_line: 'Creature — Merfolk Wizard',
      oracle_text: 'When this enters, look at the top X cards. If X is greater than or equal to the number of cards in your library, you win the game.',
    })
    expect(p.wincon.singleCard).toBe(true)
  })

  it('vanilla creature → no wincon contribution', () => {
    const p = extractCardProfile(card({
      name: 'Grizzly Bears', oracle_text: '',
    }))
    expect(p.wincon.singleCard).toBe(false)
    expect(p.wincon.contributes).toEqual([])
  })
})

describe('extractCardProfile — roles propagated from assignRoles', () => {
  it('Sol Ring has ramp role', () => {
    const p = extractCardProfile({
      name: 'Sol Ring', type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    })
    expect(p.roles).toContain('ramp')
  })

  it('Counterspell has removal role', () => {
    const p = extractCardProfile({
      name: 'Counterspell', type_line: 'Instant',
      oracle_text: 'Counter target spell.',
    })
    expect(p.roles).toContain('removal')
  })

  it('basic land has land role', () => {
    const p = extractCardProfile({
      name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '',
    })
    expect(p.roles).toContain('land')
  })
})

describe('extractCardProfile — caching is commander-aware', () => {
  it('same card with different commanders gets different profiles', () => {
    const dragon = card({
      name: 'Goldspan Dragon',
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying, haste. Whenever Goldspan Dragon attacks or becomes the target of a spell, create a Treasure token.',
    })
    const tiamat = { name: 'Tiamat', oracle_text: 'Dragons you control...' }
    const krenko = { name: 'Krenko', oracle_text: 'Goblin tokens...' }
    const p1 = extractCardProfile(dragon, { commander: tiamat })
    const p2 = extractCardProfile(dragon, { commander: krenko })
    // Different commander context = potentially different synergy role.
    // The cache MUST distinguish them (no cross-contamination).
    expect(p1).not.toBe(p2)
  })
})
