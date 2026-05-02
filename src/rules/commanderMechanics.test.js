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
