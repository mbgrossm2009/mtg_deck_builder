import { describe, it, expect, vi } from 'vitest'

// Mock fetchOracleCards so tests don't hit Scryfall.
vi.mock('./scryfallBulk', () => ({
  fetchOracleCards: vi.fn(async ({ onProgress }) => {
    onProgress?.({ stage: 'cached', count: mockCards.length })
    return mockCards
  }),
}))

import { buildTestCollection } from './testCollectionBuilder'

// Build a synthetic Scryfall response: 1000 cards across rarities, with
// edhrec_rank populated for half of them.
const mockCards = []
const RARITIES = ['common', 'uncommon', 'rare', 'mythic']
for (let i = 0; i < 1000; i++) {
  mockCards.push({
    id:             `card-${i}`,
    name:           `Card ${i}`,
    type_line:      i % 50 === 0 ? 'Basic Land — Plains' : 'Creature — Bear',
    oracle_text:    'Bear stuff.',
    mana_cost:      '{2}{G}',
    cmc:            3,
    colors:         ['G'],
    color_identity: ['G'],
    legalities:     { commander: 'legal' },
    rarity:         RARITIES[i % 4],
    edhrec_rank:    i < 500 ? i + 1 : null,
    layout:         'normal',
    lang:           'en',
  })
}

// Add a banned card and a token to verify filtering
mockCards.push({
  id: 'banned-card', name: 'Banned Bonanza',
  legalities: { commander: 'banned' }, layout: 'normal', lang: 'en',
})
mockCards.push({
  id: 'token-card', name: 'Goblin Token',
  legalities: { commander: 'legal' }, layout: 'token', lang: 'en',
})

describe('buildTestCollection', () => {
  it('rejects unknown presets', async () => {
    await expect(buildTestCollection({ preset: 'made-up' })).rejects.toThrow(/Unknown.*preset/)
  })

  it('uses 7500-mixed by default', async () => {
    // Mock returns 1000 cards. After filter and stratification we'll have
    // fewer than 7500 — but the function should still return a valid array
    // capped at what's available.
    const cards = await buildTestCollection()
    expect(Array.isArray(cards)).toBe(true)
    expect(cards.length).toBeGreaterThan(0)
  })

  it('filters out banned cards', async () => {
    const cards = await buildTestCollection({ preset: '3000-staples' })
    const names = cards.map(c => c.name)
    expect(names).not.toContain('Banned Bonanza')
  })

  it('filters out tokens', async () => {
    const cards = await buildTestCollection({ preset: '3000-staples' })
    const names = cards.map(c => c.name)
    expect(names).not.toContain('Goblin Token')
  })

  it('appends synthetic basic lands so the mana base solver has supply', async () => {
    const cards = await buildTestCollection({ preset: '3000-staples' })
    const basicLands = cards.filter(c => c.isBasicLand)
    // 5 basics × 30 each = 150
    expect(basicLands.length).toBeGreaterThanOrEqual(150)
    // Each basic name should be present
    const names = new Set(basicLands.map(c => c.name))
    expect(names.has('Plains')).toBe(true)
    expect(names.has('Island')).toBe(true)
    expect(names.has('Swamp')).toBe(true)
    expect(names.has('Mountain')).toBe(true)
    expect(names.has('Forest')).toBe(true)
  })

  it('outputs cards in the app collection shape', async () => {
    const cards = await buildTestCollection({ preset: '3000-staples' })
    const sample = cards.find(c => !c.isBasicLand)   // first non-basic
    expect(sample).toMatchObject({
      id:             expect.any(String),
      name:           expect.any(String),
      type_line:      expect.any(String),
      oracle_text:    expect.any(String),
      cmc:            expect.any(Number),
      colors:         expect.any(Array),
      color_identity: expect.any(Array),
      legalities:     expect.any(Object),
      rarity:         expect.any(String),
      isBasicLand:    expect.any(Boolean),
      quantity:       1,
    })
  })

  it('reports progress through the pipeline', async () => {
    const stages = []
    await buildTestCollection({
      preset: '3000-staples',
      onProgress: (s) => stages.push(s.stage),
    })
    // We expect at least filtering, sampling, mapping, done
    expect(stages).toContain('filtering')
    expect(stages).toContain('sampling')
    expect(stages).toContain('mapping')
    expect(stages).toContain('done')
  })

  it('top picks come from EDHREC-ranked cards (lowest rank first)', async () => {
    const cards = await buildTestCollection({ preset: '3000-staples' })
    // Card 0 is a Basic Land in the fixture — gets isBasicLand=true and
    // is filtered out here. Card 1 (Creature — Bear, rank 2) is the top
    // non-basic ranked card.
    const nonBasics = cards.filter(c => !c.isBasicLand)
    expect(nonBasics[0]?.name).toBe('Card 1')
  })

  it('7500-mixed includes a stratified random sample beyond the top picks', async () => {
    const cards = await buildTestCollection({ preset: '7500-mixed' })
    const nonBasics = cards.filter(c => !c.isBasicLand)
    // Mock has 500 ranked + 500 unranked (rejected by sampling? no — by `topPicks` only).
    // Sampling pulls from the unranked remainder. So we should have rank-based cards
    // PLUS some sampled cards from the unranked half.
    // Our mock has 500 ranked. topCount = 5000, so we take all 500 ranked.
    // Then sampleCount = 2500, but only 500 unranked exist. Stratified sample
    // returns up to 500.
    expect(nonBasics.length).toBeGreaterThan(500)   // some sample cards present
  })
})
