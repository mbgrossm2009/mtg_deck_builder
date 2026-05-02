import { describe, it, expect } from 'vitest'
import { buildSkeleton, buildSkeletonFromMoxfield, mergeSkeletons, skeletonRoleCounts } from './deckSkeleton'

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

describe('buildSkeletonFromMoxfield', () => {
  const mox = (name, frequency, decks = null) => ({ name, frequency, decks: decks ?? Math.round(frequency * 10) })

  it('returns empty when no Moxfield data', () => {
    const result = buildSkeletonFromMoxfield({ moxfieldCards: [], legalCardPool: [card('A')] })
    expect(result.staples).toEqual([])
    expect(result.stats.source).toBe('moxfield')
  })

  it('locks cards with frequency ≥ 40% as staples', () => {
    const result = buildSkeletonFromMoxfield({
      moxfieldCards: [
        mox('Sol Ring', 1.0),       // 10 of 10 decks
        mox('Cultivate', 0.5),      // 5 of 10
        mox('Mind Stone', 0.4),     // 4 of 10
        mox('Lightning Bolt', 0.2), // 2 of 10
      ],
      legalCardPool: [
        card('Sol Ring', ['ramp']),
        card('Cultivate', ['ramp']),
        card('Mind Stone', ['ramp']),
        card('Lightning Bolt', ['removal']),
      ],
    })
    const stapleNames = result.staples.map(c => c.name).sort()
    expect(stapleNames).toEqual(['Cultivate', 'Mind Stone', 'Sol Ring'])
    expect(result.strong.map(c => c.name)).toEqual(['Lightning Bolt'])
  })

  it('attaches moxfieldFrequency to skeleton cards', () => {
    const result = buildSkeletonFromMoxfield({
      moxfieldCards: [mox('Sol Ring', 1.0, 10)],
      legalCardPool: [card('Sol Ring', ['ramp'])],
    })
    expect(result.staples[0].moxfieldFrequency).toBe(1.0)
    expect(result.staples[0].moxfieldDecks).toBe(10)
  })

  it('strips lands by default', () => {
    const result = buildSkeletonFromMoxfield({
      moxfieldCards: [mox('Steam Vents', 0.9)],
      legalCardPool: [card('Steam Vents', ['land'], { type_line: 'Land' })],
    })
    expect(result.staples).toEqual([])
  })
})

describe('mergeSkeletons', () => {
  const edhrecCard = (name, inclusion) => ({ name, edhrecInclusion: inclusion, roles: ['ramp'] })
  const moxCard    = (name, frequency) => ({ name, moxfieldFrequency: frequency, roles: ['ramp'] })

  it('unions staples from both sources', () => {
    const merged = mergeSkeletons(
      { staples: [edhrecCard('A', 0.9)], strong: [] },
      { staples: [moxCard('B', 0.8)], strong: [] },
    )
    expect(merged.staples.map(c => c.name).sort()).toEqual(['A', 'B'])
  })

  it('marks cards present in both sources with sources=[edhrec, moxfield]', () => {
    const merged = mergeSkeletons(
      { staples: [edhrecCard('Sol Ring', 0.95)], strong: [] },
      { staples: [moxCard('Sol Ring', 1.0)], strong: [] },
    )
    expect(merged.staples).toHaveLength(1)
    expect(merged.staples[0].sources).toEqual(['edhrec', 'moxfield'])
    expect(merged.staples[0].edhrecInclusion).toBe(0.95)
    expect(merged.staples[0].moxfieldFrequency).toBe(1.0)
  })

  it('reports bothSourceCount in stats', () => {
    const merged = mergeSkeletons(
      { staples: [edhrecCard('A', 0.9), edhrecCard('B', 0.7)], strong: [] },
      { staples: [moxCard('A', 0.8), moxCard('C', 0.6)], strong: [] },
    )
    expect(merged.stats.bothSourceCount).toBe(1)   // only A is in both
    expect(merged.stats.source).toBe('merged')
  })

  it('sorts both-source cards before single-source cards', () => {
    const merged = mergeSkeletons(
      { staples: [edhrecCard('Single', 0.99)], strong: [] },
      { staples: [moxCard('Both', 0.8), moxCard('Single', 0.5)] /* Single now in both */, strong: [] },
    )
    // Both was 80% Mox, Single is now in both. Both should sort before any single-source pick.
    // Actually Single is in BOTH after merge since edhrec also has it.
    // So: Single (both, 99% edhrec) then Both (single-mox).
    expect(merged.staples[0].name).toBe('Single')
    expect(merged.staples[0].sources).toContain('edhrec')
    expect(merged.staples[0].sources).toContain('moxfield')
  })

  it('does not double-list a card that is staple in one source AND strong in another', () => {
    const merged = mergeSkeletons(
      { staples: [edhrecCard('Sol Ring', 0.95)], strong: [] },
      { staples: [], strong: [moxCard('Sol Ring', 0.3)] },
    )
    expect(merged.staples).toHaveLength(1)
    expect(merged.strong).toHaveLength(0)
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
