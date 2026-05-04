import { describe, it, expect } from 'vitest'
import {
  extractCommanderMechanicTags,
  commanderToCardTagBoosts,
  mechanicSynergyBonus,
} from './commanderMechanics'

const cmdr = (text) => ({ name: 'Test', oracle_text: text, color_identity: ['B'] })
const card = (tags) => ({ name: 'Test', tags })

describe('extractCommanderMechanicTags', () => {
  it('returns empty for a commander with no oracle text', () => {
    expect(extractCommanderMechanicTags(null)).toEqual([])
    expect(extractCommanderMechanicTags(cmdr(''))).toEqual([])
  })

  it('detects sacrifice cares-about (death trigger)', () => {
    const tags = extractCommanderMechanicTags(cmdr('Whenever another creature you control dies, you draw a card.'))
    expect(tags).toContain('cares_about_sacrifice')
    // Note: "draw a card" here is a CONSEQUENCE, not a trigger. We don't
    // tag this as cares_about_draw — that's reserved for commanders that
    // trigger ON drawing (Niv-Mizzet Parun, etc.).
    expect(tags).not.toContain('cares_about_draw')
  })

  it('detects draw cares-about only when commander TRIGGERS on draws', () => {
    // Niv-Mizzet, Parun-style — actually triggers on each draw
    const niv = extractCommanderMechanicTags(cmdr('Whenever you draw a card, this deals 1 damage to any target.'))
    expect(niv).toContain('cares_about_draw')

    // A commander that just draws cards as a consequence is NOT a draw
    // commander
    const consequence = extractCommanderMechanicTags(cmdr('When this enters, draw a card.'))
    expect(consequence).not.toContain('cares_about_draw')
  })

  it('detects token cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr('Create a 1/1 white Soldier creature token. Whenever a token enters, gain 1 life.'))
    expect(tags).toContain('cares_about_tokens')
  })

  it('detects spellslinger cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr('Whenever you cast an instant or sorcery spell, draw a card.'))
    expect(tags).toContain('cares_about_spells')
  })

  it('detects attack cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr('Whenever Najeela, the Blade-Blossom attacks, create a 1/1 Warrior token.'))
    expect(tags).toContain('cares_about_attacks')
  })

  it('detects counters cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr("At the beginning of your end step, proliferate. Atraxa is +1/+1 counter themed."))
    expect(tags).toContain('cares_about_counters')
  })

  it('detects graveyard cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr('Return target creature card from your graveyard to the battlefield.'))
    expect(tags).toContain('cares_about_graveyard')
  })

  it('detects ETB cares-about', () => {
    const tags = extractCommanderMechanicTags(cmdr('Whenever another creature enters under your control, draw a card.'))
    expect(tags).toContain('cares_about_etb')
  })

  it('detects multiple tags from a multi-faceted commander', () => {
    // Korvold-style: sacrifice + counters. "draw a card" is consequence,
    // not trigger, so not tagged as cares_about_draw.
    const tags = extractCommanderMechanicTags(cmdr(
      'Whenever you sacrifice another permanent, put a +1/+1 counter on Korvold and draw a card.'
    ))
    expect(tags).toContain('cares_about_sacrifice')
    expect(tags).toContain('cares_about_counters')
    expect(tags).not.toContain('cares_about_draw')   // consequence, not trigger
  })

  it('returns empty when text has no relevant patterns', () => {
    // A vanilla commander with just stats and a flavor-text-style ability
    const tags = extractCommanderMechanicTags(cmdr('Vigilance.'))
    expect(tags).toEqual([])
  })
})

describe('commanderToCardTagBoosts', () => {
  it('returns empty set for empty commander tags', () => {
    expect(commanderToCardTagBoosts([]).size).toBe(0)
  })

  it('maps sacrifice → sac_outlet, sacrifice_payoff, token_producer, recursion', () => {
    const boosts = commanderToCardTagBoosts(['cares_about_sacrifice'])
    expect(boosts.has('sac_outlet')).toBe(true)
    expect(boosts.has('sacrifice_payoff')).toBe(true)
    expect(boosts.has('token_producer')).toBe(true)
    expect(boosts.has('recursion')).toBe(true)
  })

  it('unions card tags from multiple commander tags', () => {
    const boosts = commanderToCardTagBoosts(['cares_about_tokens', 'cares_about_attacks'])
    expect(boosts.has('token_producer')).toBe(true)
    expect(boosts.has('attack_payoff')).toBe(true)
    expect(boosts.has('extra_combat')).toBe(true)
  })

  it('dedupes overlapping card tags from multiple commander tags', () => {
    // Both sacrifice and tokens map to token_producer → only counted once
    const boosts = commanderToCardTagBoosts(['cares_about_sacrifice', 'cares_about_tokens'])
    expect(boosts.has('token_producer')).toBe(true)
    // Sets dedupe inherently — just verify the set has the expected entries
  })
})

describe('mechanicSynergyBonus', () => {
  it('returns 0 for empty boost set', () => {
    expect(mechanicSynergyBonus(card(['sac_outlet']), new Set())).toBe(0)
  })

  it('returns 0 when card has no tags', () => {
    const boosts = new Set(['sac_outlet'])
    expect(mechanicSynergyBonus(card([]), boosts)).toBe(0)
    expect(mechanicSynergyBonus({ name: 'X' }, boosts)).toBe(0)   // no tags array
  })

  it('returns 8 per matching tag', () => {
    const boosts = new Set(['sac_outlet'])
    expect(mechanicSynergyBonus(card(['sac_outlet']), boosts)).toBe(8)
  })

  it('stacks across multiple matches up to the cap', () => {
    const boosts = new Set(['sac_outlet', 'token_producer', 'recursion'])
    // Card with 3 matching tags: 8 * 3 = 24 (right at cap)
    expect(mechanicSynergyBonus(card(['sac_outlet', 'token_producer', 'recursion']), boosts)).toBe(24)
  })

  it('caps at 24 even when more tags match', () => {
    const boosts = new Set(['a', 'b', 'c', 'd', 'e'])
    expect(mechanicSynergyBonus(card(['a', 'b', 'c', 'd', 'e']), boosts)).toBe(24)
  })

  it('ignores card tags not in boost set', () => {
    const boosts = new Set(['sac_outlet'])
    // Card has 3 tags but only 1 matches
    expect(mechanicSynergyBonus(card(['sac_outlet', 'lifegain', 'extra_combat']), boosts)).toBe(8)
  })
})

// ─── Precision tests — wording matters in Magic ─────────────────────────────
//
// Magic oracle text is precise. "Whenever you draw a card" is fundamentally
// different from "draw a card" or "if you've drawn cards this turn". The
// first is a TRIGGER (the commander cares); the second is an EFFECT (the
// commander itself draws); the third is a CONDITION (storm-style payoff).
// These tests pin down those distinctions for each tag pattern.

describe('Precision: cares_about_lifegain — trigger vs effect', () => {
  it('TRIGGER: "Whenever you gain life" → tagged', () => {
    const tags = extractCommanderMechanicTags(cmdr('Whenever you gain life, draw a card.'))
    expect(tags).toContain('cares_about_lifegain')
  })
  it('SELF-GAIN: "you gain N life" → tagged (commander gains life)', () => {
    // Sheoldred-style: "Whenever you draw a card, you gain 2 life"
    const tags = extractCommanderMechanicTags(cmdr('Whenever you draw a card, you gain 2 life.'))
    expect(tags).toContain('cares_about_lifegain')
  })
  it('LIFELINK keyword → tagged', () => {
    const tags = extractCommanderMechanicTags(cmdr('Lifelink. {T}: Add {W}.'))
    expect(tags).toContain('cares_about_lifegain')
  })
  it('SINGLE one-shot life gain (not commander-relevant) → NOT tagged', () => {
    // A commander whose only "life" reference is a one-shot life payment
    // is NOT a lifegain commander — should not tag.
    const tags = extractCommanderMechanicTags(cmdr('When this enters, target opponent loses 3 life.'))
    expect(tags).not.toContain('cares_about_lifegain')
  })
})

describe('Precision: cares_about_lifeloss — opponent damage payoff', () => {
  it('TRIGGER: "Whenever an opponent loses life" → tagged', () => {
    // Vito-style
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever an opponent loses life, you gain that much life.')
    )
    expect(tags).toContain('cares_about_lifeloss')
  })
  it('SHEOLDRED: "they lose 2 life" → tagged', () => {
    // Sheoldred, the Apocalypse — lifeloss payoff in opponent draw trigger
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever an opponent draws a card, they lose 2 life.')
    )
    expect(tags).toContain('cares_about_lifeloss')
  })
  it('SELF-LOSS payment (not commander-relevant) → NOT tagged as lifeloss-cares', () => {
    // K'rrik pays life as a cost — that's a lifeloss ENABLER for self,
    // not a lifeloss payoff. Different tag.
    // (We DO tag this as something else, but not cares_about_lifeloss
    // which is about punishing opponents.)
    const tags = extractCommanderMechanicTags(
      cmdr('As an additional cost to cast a Black spell, pay 2 life or {B}.')
    )
    expect(tags).not.toContain('cares_about_lifeloss')
  })
})

describe('Precision: tribal tags from oracle text — NOT from creature type', () => {
  it('Tiamat oracle text mentions Dragon → tribal_dragons tag', () => {
    const tags = extractCommanderMechanicTags(
      cmdr('Search your library for up to five Dragon cards, reveal them, put them into your hand.')
    )
    expect(tags).toContain('tribal_dragons')
  })
  it('Krenko oracle text mentions Goblin → tribal_goblins tag', () => {
    const tags = extractCommanderMechanicTags(
      cmdr('{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.')
    )
    expect(tags).toContain('tribal_goblins')
  })
  it('Edgar Markov oracle text mentions Vampire → tribal_vampires tag', () => {
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever you cast another Vampire spell, create a 1/1 black Vampire creature token.')
    )
    expect(tags).toContain('tribal_vampires')
  })
  it('Wilhelt oracle text mentions Zombie → tribal_zombies tag', () => {
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever a non-token Zombie you control dies, create a 2/2 black Zombie creature token.')
    )
    expect(tags).toContain('tribal_zombies')
  })
  it('Marwyn oracle text mentions Elf → tribal_elves tag', () => {
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever another Elf enters under your control, put a +1/+1 counter on Marwyn.')
    )
    expect(tags).toContain('tribal_elves')
  })
  it('Sliver Hivelord oracle text mentions Sliver → tribal_slivers tag', () => {
    const tags = extractCommanderMechanicTags(cmdr('Sliver creatures you control have indestructible.'))
    expect(tags).toContain('tribal_slivers')
  })
  it('Winter has Human Warlock TYPE but oracle text mentions NEITHER → NO tribal tag', () => {
    // Winter, Cynical Opportunist — type is Human Warlock but text only
    // mentions attack/mill/delirium/graveyard. Must NOT tag tribal.
    const tags = extractCommanderMechanicTags(cmdr(
      'Deathtouch\n' +
      'Whenever Winter attacks, mill three cards.\n' +
      'Delirium — At the beginning of your end step, you may exile any number of cards from your graveyard with four or more card types among them.'
    ))
    expect(tags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })
})

describe('Precision: cares_about_artifacts / cares_about_enchantments / cares_about_lands', () => {
  it('detects artifacts when oracle text references artifact cards/spells', () => {
    // Daretti — "Sacrifice an artifact... return target artifact card"
    const tags = extractCommanderMechanicTags(
      cmdr('Sacrifice an artifact. If you do, return target artifact card from your graveyard to the battlefield.')
    )
    expect(tags).toContain('cares_about_artifacts')
  })
  it('detects enchantments when oracle text references enchantment cards/spells', () => {
    // Sythis — "Whenever you cast an enchantment spell"
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever you cast an enchantment spell, you gain 1 life and draw a card.')
    )
    expect(tags).toContain('cares_about_enchantments')
  })
  it('detects lands when oracle text references landfall / land cards', () => {
    // Tatyova-style
    const tags = extractCommanderMechanicTags(
      cmdr('Whenever a land enters under your control, draw a card and you gain 1 life.')
    )
    expect(tags).toContain('cares_about_lands')
  })
  it('does NOT tag artifacts when only "artifact creature" mentioned in passing', () => {
    // A commander that's just an artifact creature shouldn't be tagged
    // as cares_about_artifacts unless its abilities reference them.
    const tags = extractCommanderMechanicTags(
      cmdr('Flying. When this enters, draw a card.')
    )
    expect(tags).not.toContain('cares_about_artifacts')
  })
})

// ─── Per-commander expectations using REAL Scryfall oracle text ─────────────

describe('Real commander mechanic tags — verbatim oracle text from Scryfall', () => {
  // Dynamic import so the JSON fixture loads lazily.
  it.each([
    ['Sheoldred, the Apocalypse', ['cares_about_draw', 'cares_about_lifegain', 'cares_about_lifeloss']],
    ['Tiamat',                     ['tribal_dragons']],
    ['Krenko, Mob Boss',           ['cares_about_tokens', 'tribal_goblins']],
    ['Edgar Markov',               ['cares_about_tokens', 'tribal_vampires']],
    ['Niv-Mizzet, Parun',          ['cares_about_draw', 'cares_about_spells']],
    // Note: cares_about_draw means TRIGGERS on drawing (Niv-Mizzet, Sheoldred).
    // Commanders that PRODUCE draws (Korvold, Sythis, Tatyova) don't get the
    // tag — drawing is the consequence, not the trigger.
    ['Korvold, Fae-Cursed King',   ['cares_about_sacrifice', 'cares_about_counters']],
    ['Sythis, Harvest\'s Hand',    ['cares_about_enchantments', 'cares_about_lifegain']],
    ['Lord Windgrace',             ['cares_about_lands', 'cares_about_graveyard', 'cares_about_discard']],
    ['Daretti, Scrap Savant',      ['cares_about_artifacts', 'cares_about_graveyard', 'cares_about_discard']],
    ['Tatyova, Benthic Druid',     ['cares_about_lands', 'cares_about_lifegain']],
    ['Najeela, the Blade-Blossom', ['cares_about_attacks', 'cares_about_combat_phases']],
    ['Marwyn, the Nurturer',       ['tribal_elves', 'cares_about_counters']],
  ])('%s should tag: %j', async (name, expectedTags) => {
    const { findCommander } = await import('../test/fixtures/top100commanders.js')
    const commander = findCommander(name)
    expect(commander, `Commander "${name}" missing from fixture`).toBeDefined()
    const tags = extractCommanderMechanicTags(commander)
    for (const expected of expectedTags) {
      expect(tags, `${name} expected to have ${expected} (actual: ${tags.join(', ')})`).toContain(expected)
    }
  })

  it('Winter, Cynical Opportunist — NO tribal tag (type ≠ text)', async () => {
    const { findCommander } = await import('../test/fixtures/top100commanders.js')
    const winter = findCommander('Winter, Cynical Opportunist')
    expect(winter).toBeDefined()
    const tags = extractCommanderMechanicTags(winter)
    expect(tags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })
})

// Phase 2.4: cares_about_activated_abilities. Eval data showed Zirda the
// Dawnwaker shipping with 13 filler at B5 because the lens couldn't tell
// which cards were on-plan — "activated abilities matter" wasn't modeled.
// These tests pin the new mechanic detector + the card-tag mapping.
describe('cares_about_activated_abilities mechanic', () => {
  it('detects activation-cost-reduction commanders (Zirda-style)', () => {
    const zirda = {
      name: 'Zirda, the Dawnwaker',
      type_line: 'Legendary Creature — Elemental Dog',
      oracle_text:
        'Activated abilities of creatures you control cost up to {2} less to activate. ' +
        'This effect can\'t reduce the mana in that cost to less than one mana. ' +
        '{X}{R}{W}, {T}: Up to one target creature gets +X/+X until end of turn.',
    }
    const tags = extractCommanderMechanicTags(zirda)
    expect(tags).toContain('cares_about_activated_abilities')
  })

  it('detects untap-for-activation (Marwyn-style mana commanders)', () => {
    const marwyn = {
      name: 'Marwyn, the Nurturer',
      type_line: 'Legendary Creature — Elf Druid',
      oracle_text:
        'Whenever another Elf enters the battlefield under your control, put a +1/+1 counter on Marwyn, the Nurturer. ' +
        '{T}: Add an amount of {G} equal to Marwyn\'s power.',
    }
    const tags = extractCommanderMechanicTags(marwyn)
    expect(tags).toContain('cares_about_activated_abilities')
  })

  it('does NOT tag a vanilla legendary creature with activated_abilities', () => {
    const vanilla = {
      name: 'Test Vanilla Commander',
      type_line: 'Legendary Creature — Human',
      oracle_text: 'Other creatures you control get +1/+1.',
    }
    const tags = extractCommanderMechanicTags(vanilla)
    expect(tags).not.toContain('cares_about_activated_abilities')
  })

  it('cares_about_activated_abilities maps to activated_ability + untap + mana_doubler card tags', () => {
    const boosts = commanderToCardTagBoosts(['cares_about_activated_abilities'])
    expect(boosts.has('activated_ability')).toBe(true)
    expect(boosts.has('untap')).toBe(true)
    expect(boosts.has('mana_doubler')).toBe(true)
  })
})

// Phase 2.4 (continued): the activated_ability card tag detection in
// cardRoles.js. Pins what counts as "has an activated ability" so the
// boost-mapping above actually finds candidates.
describe('activated_ability card tag', () => {
  it('tags Walking Ballista (activated +1/+1 ability)', async () => {
    const { assignRoles } = await import('./cardRoles')
    const walkingBallista = {
      name: 'Walking Ballista',
      type_line: 'Artifact Creature — Construct',
      oracle_text: 'Walking Ballista enters the battlefield with X +1/+1 counters on it. ' +
                   '{4}: Put a +1/+1 counter on Walking Ballista. ' +
                   'Remove a +1/+1 counter from Walking Ballista: It deals 1 damage to any target.',
    }
    const { tags } = assignRoles(walkingBallista, { name: 'Cmd', oracle_text: '', type_line: 'Legendary Creature' })
    expect(tags).toContain('activated_ability')
  })

  it('tags cards with cycling', async () => {
    const { assignRoles } = await import('./cardRoles')
    const eternalDragon = {
      name: 'Eternal Dragon',
      type_line: 'Creature — Dragon Spirit',
      oracle_text: 'Flying. {3}{W}{W}: Return Eternal Dragon from your graveyard to your hand. ' +
                   'Plainscycling {2}.',
    }
    const { tags } = assignRoles(eternalDragon, { name: 'Cmd', oracle_text: '', type_line: 'Legendary Creature' })
    expect(tags).toContain('activated_ability')
  })

  it('does NOT tag a vanilla creature without activated abilities', async () => {
    const { assignRoles } = await import('./cardRoles')
    const grizzlyBears = {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    }
    const { tags } = assignRoles(grizzlyBears, { name: 'Cmd', oracle_text: '', type_line: 'Legendary Creature' })
    expect(tags).not.toContain('activated_ability')
  })
})
