import { describe, it, expect } from 'vitest'
import { buildSkeleton, skeletonRoleCounts } from './deckSkeleton'

const card = (name, roles = ['filler'], extra = {}) => ({
  name,
  type_line: extra.type_line ?? 'Sorcery',
  oracle_text: extra.oracle_text ?? '',
  color_identity: extra.color_identity ?? [],
  roles,
  tags: extra.tags ?? [],
  legalities: { commander: 'legal' },
  ...extra,
})

const top = (name, inclusion, extra = {}) => ({
  name,
  inclusion,
  numDecks: extra.numDecks ?? 1000,
  synergy: extra.synergy ?? null,
})

describe('buildSkeleton — empty inputs', () => {
  it('returns empty skeleton when no EDHREC data', () => {
    const result = buildSkeleton({ edhrecTopCards: [], legalCardPool: [card('A')] })
    expect(result.staples).toEqual([])
    expect(result.strong).toEqual([])
    expect(result.stats.skeletonSize).toBe(0)
  })

  it('returns empty skeleton when no legal cards intersect', () => {
    const result = buildSkeleton({
      edhrecTopCards: [top('Sol Ring', 0.95)],
      legalCardPool: [card('Some Other Card')],
    })
    expect(result.staples).toEqual([])
  })
})

describe('buildSkeleton — inclusion thresholds', () => {
  it('locks cards with inclusion ≥ 40% as staples', () => {
    const result = buildSkeleton({
      edhrecTopCards: [
        top('Sol Ring', 0.95),
        top('Cultivate', 0.55),
        top('Arcane Signet', 0.40),
      ],
      legalCardPool: [
        card('Sol Ring', ['ramp']),
        card('Cultivate', ['ramp']),
        card('Arcane Signet', ['ramp']),
      ],
    })
    expect(result.staples.map(c => c.name).sort()).toEqual(['Arcane Signet', 'Cultivate', 'Sol Ring'])
  })

  it('routes 20-40% inclusion to "strong" not "staples"', () => {
    const result = buildSkeleton({
      edhrecTopCards: [
        top('Sol Ring', 0.95),       // staple
        top('Mind Stone', 0.30),     // strong
        top('Wayfarer\'s Bauble', 0.15),  // niche — neither
      ],
      legalCardPool: [
        card('Sol Ring', ['ramp']),
        card('Mind Stone', ['ramp']),
        card('Wayfarer\'s Bauble', ['ramp']),
      ],
    })
    expect(result.staples.map(c => c.name)).toEqual(['Sol Ring'])
    expect(result.strong.map(c => c.name)).toEqual(['Mind Stone'])
  })

  it('handles inclusion as 0-100 percentage too (defensive)', () => {
    const result = buildSkeleton({
      edhrecTopCards: [
        top('Sol Ring', 95),       // 0-100 form → 95% → staple
        top('Mind Stone', 30),     // 30% → strong
      ],
      legalCardPool: [
        card('Sol Ring', ['ramp']),
        card('Mind Stone', ['ramp']),
      ],
    })
    expect(result.staples.map(c => c.name)).toEqual(['Sol Ring'])
    expect(result.strong.map(c => c.name)).toEqual(['Mind Stone'])
  })

  it('skips cards with no inclusion signal', () => {
    const result = buildSkeleton({
      edhrecTopCards: [{ name: 'Sol Ring', inclusion: null }],
      legalCardPool: [card('Sol Ring', ['ramp'])],
    })
    expect(result.staples).toEqual([])
  })
})

describe('buildSkeleton — land stripping', () => {
  it('skips lands by default (mana solver owns lands)', () => {
    const result = buildSkeleton({
      edhrecTopCards: [
        top('Steam Vents', 0.80),
        top('Sol Ring', 0.95),
      ],
      legalCardPool: [
        card('Steam Vents', ['land'], { type_line: 'Land' }),
        card('Sol Ring', ['ramp']),
      ],
    })
    expect(result.staples.map(c => c.name)).toEqual(['Sol Ring'])
  })

  it('includes lands when stripLands option is false', () => {
    const result = buildSkeleton({
      edhrecTopCards: [top('Steam Vents', 0.80)],
      legalCardPool: [card('Steam Vents', ['land'], { type_line: 'Land' })],
      options: { stripLands: false },
    })
    expect(result.staples.map(c => c.name)).toEqual(['Steam Vents'])
  })
})

describe('buildSkeleton — bracket / legality respect', () => {
  it('only locks cards present in the legal pool', () => {
    // Cyclonic Rift might be a 70% staple but if bracket filter kicked it
    // out it's not in the legal pool — skeleton must skip it.
    const result = buildSkeleton({
      edhrecTopCards: [
        top('Cyclonic Rift', 0.70),
        top('Sol Ring', 0.95),
      ],
      legalCardPool: [card('Sol Ring', ['ramp'])],   // Cyclonic Rift bracket-filtered out
    })
    expect(result.staples.map(c => c.name)).toEqual(['Sol Ring'])
  })
})

describe('buildSkeleton — annotates skeleton cards', () => {
  it('attaches edhrecInclusion + edhrecRank to each skeleton card', () => {
    const result = buildSkeleton({
      edhrecTopCards: [top('Sol Ring', 0.95), top('Cultivate', 0.55)],
      legalCardPool: [card('Sol Ring', ['ramp']), card('Cultivate', ['ramp'])],
    })
    expect(result.staples[0].edhrecInclusion).toBe(0.95)
    expect(result.staples[0].edhrecRank).toBe(1)
    expect(result.staples[1].edhrecInclusion).toBe(0.55)
    expect(result.staples[1].edhrecRank).toBe(2)
  })
})

describe('buildSkeleton — size cap', () => {
  it('caps skeleton at MAX_SKELETON_SIZE staples', () => {
    const tops = []
    const pool = []
    for (let i = 0; i < 100; i++) {
      tops.push(top(`Card ${i}`, 0.90))
      pool.push(card(`Card ${i}`, ['filler']))
    }
    const result = buildSkeleton({ edhrecTopCards: tops, legalCardPool: pool })
    expect(result.staples.length).toBeLessThanOrEqual(35)
  })
})

describe('skeletonRoleCounts', () => {
  it('counts skeleton cards by primary role', () => {
    const skeleton = [
      card('A', ['ramp']),
      card('B', ['ramp']),
      card('C', ['removal']),
      card('D', ['synergy']),
    ]
    const counts = skeletonRoleCounts(skeleton)
    expect(counts).toEqual({ ramp: 2, removal: 1, synergy: 1 })
  })

  it('handles cards with no roles array', () => {
    const counts = skeletonRoleCounts([{ name: 'X' }])
    expect(counts).toEqual({ filler: 1 })
  })

  it('returns empty object for empty input', () => {
    expect(skeletonRoleCounts([])).toEqual({})
  })
})
