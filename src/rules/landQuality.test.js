import { describe, it, expect } from 'vitest'
import { landTier, landTierScoreDelta, landColorsProduced } from './landQuality'

const land = (overrides) => ({
  type_line: 'Land',
  oracle_text: '',
  color_identity: [],
  ...overrides,
})

describe('landTier — premium', () => {
  it('classifies fetches as premium', () => {
    expect(landTier(land({ name: 'Polluted Delta' }))).toBe('premium')
    expect(landTier(land({ name: 'Wooded Foothills' }))).toBe('premium')
  })
  it('classifies shocks as premium', () => {
    expect(landTier(land({ name: 'Steam Vents' }))).toBe('premium')
    expect(landTier(land({ name: 'Watery Grave' }))).toBe('premium')
  })
  it('classifies original duals as premium', () => {
    expect(landTier(land({ name: 'Underground Sea' }))).toBe('premium')
  })
  it('classifies triomes as premium', () => {
    expect(landTier(land({ name: 'Indatha Triome' }))).toBe('premium')
  })
  it('classifies key utility lands as premium', () => {
    expect(landTier(land({ name: 'Bojuka Bog' }))).toBe('premium')
    expect(landTier(land({ name: 'Boseiju, Who Endures' }))).toBe('premium')
  })
})

describe('landTier — good', () => {
  it('classifies pain lands as good', () => {
    expect(landTier(land({ name: 'Underground River' }))).toBe('good')
  })
  it('classifies check lands as good', () => {
    expect(landTier(land({ name: 'Drowned Catacomb' }))).toBe('good')
  })
  it('classifies filter lands as good', () => {
    expect(landTier(land({ name: 'Sunken Ruins' }))).toBe('good')
  })
})

describe('landTier — weak (regex categories)', () => {
  it('flags guildgates as weak', () => {
    expect(landTier(land({
      name: 'Izzet Guildgate',
      oracle_text: 'Izzet Guildgate enters the battlefield tapped. {T}: Add {U} or {R}.',
    }))).toBe('weak')
  })
  it('flags gain lands as weak', () => {
    expect(landTier(land({
      name: 'Akoum Refuge',
      oracle_text: 'Akoum Refuge enters the battlefield tapped. When it enters, you gain 1 life. {T}: Add {B} or {R}.',
    }))).toBe('weak')
  })
  it('flags tri-lands as weak', () => {
    expect(landTier(land({
      name: 'Frontier Bivouac',
      oracle_text: 'Frontier Bivouac enters the battlefield tapped. {T}: Add {G}, {U}, or {R}.',
    }))).toBe('weak')
  })
  it('flags bounce lands (Karoos) as weak', () => {
    expect(landTier(land({
      name: 'Izzet Boilerworks',
      oracle_text: 'Izzet Boilerworks enters the battlefield tapped. When it enters, return a land you control to its owner\'s hand. {T}: Add {U}{R}.',
    }))).toBe('weak')
  })
  it('flags Alara panoramas as weak', () => {
    expect(landTier(land({
      name: 'Esper Panorama',
      oracle_text: '{T}: Add {C}. {1}, {T}, sacrifice this: Search your library for a basic Plains, Island, or Swamp card.',
    }))).toBe('weak')
  })
  it('flags vanilla tapped utility as weak', () => {
    expect(landTier(land({
      name: 'Random Tap Land',
      oracle_text: 'This enters the battlefield tapped. {T}: Add {U}.',
    }))).toBe('weak')
  })
})

describe('landTier — mid (tapped with payoff)', () => {
  it('flags tapped lands with scry as mid', () => {
    expect(landTier(land({
      name: 'Temple of Mystery',
      oracle_text: 'Temple of Mystery enters the battlefield tapped. When it enters, scry 1. {T}: Add {G} or {U}.',
    }))).toBe('mid')
  })
  it('flags tapped lands with cycling as mid', () => {
    expect(landTier(land({
      name: 'Lonely Sandbar',
      oracle_text: 'Lonely Sandbar enters the battlefield tapped. {T}: Add {U}. Cycling {U} ({U}, Discard this card: Draw a card.)',
    }))).toBe('mid')  // cycling provides "draw"
  })
})

describe('landTier — good (untapped multi-color)', () => {
  it('classifies any-color untapped lands as good', () => {
    expect(landTier(land({
      name: 'Some Untapped Dual',
      oracle_text: '{T}: Add {W} or {U}.',
    }))).toBe('good')
  })
})

describe('landTierScoreDelta', () => {
  it('returns +25 for premium', () => {
    expect(landTierScoreDelta(land({ name: 'Steam Vents' }))).toBe(25)
  })
  it('returns +12 for good', () => {
    expect(landTierScoreDelta(land({ name: 'Underground River' }))).toBe(12)
  })
  it('returns -22 for weak', () => {
    expect(landTierScoreDelta(land({
      name: 'Izzet Guildgate',
      oracle_text: 'enters the battlefield tapped. {T}: Add {U} or {R}.',
    }))).toBe(-22)
  })
})

describe('landColorsProduced', () => {
  it('detects single color', () => {
    const colors = landColorsProduced(land({ oracle_text: '{T}: Add {U}.' }))
    expect([...colors].sort()).toEqual(['U'])
  })
  it('detects multiple colors', () => {
    const colors = landColorsProduced(land({
      name: 'Steam Vents',
      oracle_text: '{T}: Add {U} or {R}.',
    }))
    expect([...colors].sort()).toEqual(['R', 'U'])
  })
  it('detects "any color" producers as all five', () => {
    const colors = landColorsProduced(land({
      name: 'City of Brass',
      oracle_text: '{T}: Add one mana of any color.',
    }))
    expect([...colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W'])
  })
  it('falls back to color_identity when oracle text is sparse', () => {
    const colors = landColorsProduced(land({
      name: 'Mysterious Land',
      oracle_text: '',
      color_identity: ['G'],
    }))
    expect([...colors].sort()).toEqual(['G'])
  })
})
