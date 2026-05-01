import { describe, it, expect } from 'vitest'
import { filterLegalCards } from './commanderRules'

// Helper to make a fully validated card with a default legal status
function card(overrides) {
  return {
    name: 'Test Card',
    type_line: 'Sorcery',
    color_identity: [],
    legalities: { commander: 'legal' },
    needsValidation: false,
    validationFailed: false,
    ...overrides,
  }
}

const COMMANDER = {
  name: 'Atraxa, Praetors\' Voice',
  type_line: 'Legendary Creature — Phyrexian Angel Horror',
  color_identity: ['W', 'U', 'B', 'G'],
}

describe('filterLegalCards', () => {
  it('returns empty when collection is empty', () => {
    const { legal, excluded } = filterLegalCards([], COMMANDER)
    expect(legal).toEqual([])
    expect(excluded).toEqual([])
  })

  it('keeps in-color, legal, validated cards', () => {
    const collection = [
      card({ name: 'Sol Ring', color_identity: [] }),
      card({ name: 'Cultivate', color_identity: ['G'] }),
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal).toHaveLength(2)
    expect(excluded).toEqual([])
  })

  it('excludes cards outside commander color identity', () => {
    const monoGreenCommander = { ...COMMANDER, color_identity: ['G'] }
    const collection = [
      card({ name: 'Lightning Bolt', color_identity: ['R'] }),
      card({ name: 'Cultivate', color_identity: ['G'] }),
    ]
    const { legal, excluded } = filterLegalCards(collection, monoGreenCommander)
    expect(legal.map(c => c.name)).toEqual(['Cultivate'])
    expect(excluded).toHaveLength(1)
    expect(excluded[0].name).toBe('Lightning Bolt')
    expect(excluded[0].excludeReason).toContain('color identity')
  })

  it('excludes banned cards', () => {
    const collection = [
      card({ name: 'Lutri, the Spellchaser', legalities: { commander: 'banned' } }),
      card({ name: 'Sol Ring' }),
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal.map(c => c.name)).toEqual(['Sol Ring'])
    expect(excluded[0].excludeReason).toContain('Banned')
  })

  it('keeps Relentless Rats even when treated as restricted/banned in legalities (ALWAYS_LEGAL)', () => {
    const collection = [
      card({
        name: 'Relentless Rats',
        type_line: 'Creature — Rat',
        color_identity: ['B'],
        legalities: { commander: 'banned' },
      }),
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal).toHaveLength(1)
    expect(excluded).toEqual([])
  })

  it('keeps Shadowborn Apostle as ALWAYS_LEGAL', () => {
    const collection = [
      card({
        name: 'Shadowborn Apostle',
        color_identity: ['B'],
        legalities: { commander: 'banned' },
      }),
    ]
    expect(filterLegalCards(collection, COMMANDER).legal).toHaveLength(1)
  })

  it('excludes the commander itself', () => {
    const collection = [
      card({
        name: 'Atraxa, Praetors\' Voice',
        type_line: 'Legendary Creature — Phyrexian Angel Horror',
        color_identity: ['W', 'U', 'B', 'G'],
      }),
      card({ name: 'Sol Ring' }),
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal.map(c => c.name)).toEqual(['Sol Ring'])
    expect(excluded[0].excludeReason).toContain('commander')
  })

  it('excludes the commander case-insensitively', () => {
    const collection = [
      card({
        name: 'atraxa, praetors\' voice',
        color_identity: ['W', 'U', 'B', 'G'],
        type_line: 'Legendary Creature',
      }),
    ]
    const { legal } = filterLegalCards(collection, COMMANDER)
    expect(legal).toHaveLength(0)
  })

  it('excludes cards with missing/invalid data (needs validation)', () => {
    const collection = [
      card({ name: 'Sol Ring' }),
      { name: 'Unknown Card', type_line: '', color_identity: [], needsValidation: true },
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal.map(c => c.name)).toEqual(['Sol Ring'])
    expect(excluded[0].excludeReason).toContain('Missing card data')
  })

  it('excludes cards that failed Scryfall validation', () => {
    const collection = [
      { name: 'Definitely Not A Real Card', type_line: '', validationFailed: true, color_identity: [] },
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal).toEqual([])
    expect(excluded).toHaveLength(1)
  })

  it('deduplicates legal cards by name (case-insensitive)', () => {
    const collection = [
      card({ id: '1', name: 'Sol Ring' }),
      card({ id: '2', name: 'sol ring' }),
      card({ id: '3', name: 'SOL RING' }),
    ]
    const { legal } = filterLegalCards(collection, COMMANDER)
    expect(legal).toHaveLength(1)
    // Should keep the first one
    expect(legal[0].id).toBe('1')
  })

  it('does NOT deduplicate excluded cards (excluded list shows every entry)', () => {
    const monoGreen = { ...COMMANDER, color_identity: ['G'] }
    const collection = [
      card({ id: '1', name: 'Lightning Bolt', color_identity: ['R'] }),
      card({ id: '2', name: 'lightning bolt', color_identity: ['R'] }),
    ]
    const { excluded } = filterLegalCards(collection, monoGreen)
    expect(excluded).toHaveLength(2)
  })

  it('flags basics with isBasicLand: true on the legal card', () => {
    const collection = [
      card({ name: 'Forest', type_line: 'Basic Land — Forest', color_identity: [] }),
    ]
    const { legal } = filterLegalCards(collection, COMMANDER)
    expect(legal[0].isBasicLand).toBe(true)
  })

  it('flags non-basics with isBasicLand: false', () => {
    const collection = [
      card({ name: 'Sol Ring' }),
    ]
    const { legal } = filterLegalCards(collection, COMMANDER)
    expect(legal[0].isBasicLand).toBe(false)
  })

  it('handles a multi-color reduction correctly (4-color permits 4-color and below)', () => {
    const collection = [
      card({ name: 'White card', color_identity: ['W'] }),
      card({ name: 'Black card', color_identity: ['B'] }),
      card({ name: 'Red card', color_identity: ['R'] }),  // Not in Atraxa's WUBG
      card({ name: 'Colorless', color_identity: [] }),
      card({ name: 'WUB triomb', color_identity: ['W', 'U', 'B'] }),
    ]
    const { legal, excluded } = filterLegalCards(collection, COMMANDER)
    expect(legal.map(c => c.name)).toEqual(['White card', 'Black card', 'Colorless', 'WUB triomb'])
    expect(excluded.map(c => c.name)).toEqual(['Red card'])
  })
})
