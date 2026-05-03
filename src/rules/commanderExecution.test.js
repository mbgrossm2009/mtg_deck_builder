// Commander execution score tests.
//
// The metric: of the deck's non-land, non-universal-staple slots, what
// fraction actually advance the commander's plan? A high score means
// most slots do commander-specific work; low means generic goodstuff.
//
// Cards are execution-relevant if they have:
//   - synergy role (keyword overlap with commander text)
//   - any mechanic tag in the commander's boost set
//   - tribal_<type> tag matching a tribal commander
//   - anchor name from a detected archetype

import { describe, it, expect } from 'vitest'
import {
  computeCommanderExecutionScore,
  getExecutionThresholdForBracket,
  meetsExecutionThreshold,
  _internal,
} from './commanderExecution'

const card = ({ name, roles = [], tags = [], type = 'Creature' }) => ({
  name, roles, tags, type_line: type,
})
const land = (name = 'Plains') => card({ name, type: 'Basic Land — Plains', roles: ['land'] })

describe('computeCommanderExecutionScore — basic counting', () => {
  it('returns score 0 for an empty deck', () => {
    const result = computeCommanderExecutionScore({
      deck: [], commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    expect(result.score).toBe(0)
    expect(result.considered).toBe(0)
    expect(result.relevant).toBe(0)
  })

  it('lands are excluded from both numerator and denominator', () => {
    const deck = [
      land('Plains'),
      land('Plains'),
      land('Plains'),
      card({ name: 'Synergy Card', roles: ['synergy'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    expect(result.considered).toBe(1)         // only the non-land card
    expect(result.relevant).toBe(1)
    expect(result.score).toBe(1.0)
  })

  it('universal staples (Sol Ring, Counterspell, etc.) are excluded from both buckets', () => {
    const deck = [
      card({ name: 'Sol Ring',           roles: ['ramp'] }),
      card({ name: 'Arcane Signet',      roles: ['ramp'] }),
      card({ name: 'Lightning Greaves',  roles: ['protection'] }),
      card({ name: 'On-Theme Card',      roles: ['synergy'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    // Only "On-Theme Card" considered — all 3 staples skipped.
    expect(result.considered).toBe(1)
    expect(result.relevant).toBe(1)
    expect(result.score).toBe(1.0)
  })

  it('generic goodstuff (no synergy, no mechanic match) gets a low score', () => {
    const deck = [
      card({ name: 'Random A', roles: ['ramp'] }),     // ramp role doesn't count
      card({ name: 'Random B', roles: ['draw'] }),     // draw role doesn't count
      card({ name: 'Random C', roles: ['removal'] }),
      card({ name: 'Random D', roles: ['filler'] }),
      card({ name: 'Random E', roles: ['filler'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    expect(result.considered).toBe(5)
    expect(result.relevant).toBe(0)
    expect(result.score).toBe(0)
  })
})

describe('computeCommanderExecutionScore — relevance criteria', () => {
  it('cards with synergy role count as relevant', () => {
    const deck = [
      card({ name: 'A', roles: ['synergy'] }),
      card({ name: 'B', roles: ['synergy', 'ramp'] }),
      card({ name: 'C', roles: ['filler'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    expect(result.ofWhich.synergy).toBe(2)
    expect(result.relevant).toBe(2)
    expect(result.score).toBeCloseTo(2 / 3, 5)
  })

  it('cards with a mechanic tag in the commander boost set count as relevant', () => {
    // Korvold-style: cares_about_sacrifice → boosts sac_outlet, sacrifice_payoff,
    // token_producer, recursion. So a card tagged 'sac_outlet' is relevant.
    const deck = [
      card({ name: 'Sac Outlet 1', roles: ['filler'], tags: ['sac_outlet'] }),
      card({ name: 'Token Maker 1', roles: ['filler'], tags: ['token_producer'] }),
      card({ name: 'Off-theme', roles: ['filler'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: ['cares_about_sacrifice'], anchorNames: new Set(),
    })
    expect(result.ofWhich.mechanicTag).toBe(2)
    expect(result.relevant).toBe(2)
  })

  it('tribal_<type> tags count when commander has the matching tribal mechanic tag', () => {
    // Krenko has tribal_goblins. Cards tagged tribal_goblin count.
    const deck = [
      card({ name: 'Goblin 1', roles: ['filler'], tags: ['tribal_goblin'] }),
      card({ name: 'Goblin 2', roles: ['filler'], tags: ['tribal_goblin'] }),
      card({ name: 'Off-tribe', roles: ['filler'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: ['tribal_goblins'], anchorNames: new Set(),
    })
    expect(result.ofWhich.tribal).toBeGreaterThanOrEqual(2)
    expect(result.relevant).toBeGreaterThanOrEqual(2)
  })

  it('anchor names count even without other signals', () => {
    const deck = [
      card({ name: 'Doubling Season', roles: ['filler'] }),
      card({ name: 'Random Card', roles: ['filler'] }),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [],
      anchorNames: new Set(['doubling season']),
    })
    expect(result.ofWhich.anchor).toBe(1)
    expect(result.relevant).toBe(1)
  })

  it('a card matching multiple criteria only counts ONCE in relevant', () => {
    // The "ofWhich" sub-counts may show >1 because they're per-criterion,
    // but the overall relevant count must not double-count.
    const deck = [
      card({
        name: 'Multi-Match',
        roles: ['synergy'],
        tags: ['sac_outlet', 'tribal_goblin'],
      }),
    ]
    const result = computeCommanderExecutionScore({
      deck,
      commander: {},
      mechanicTags: ['cares_about_sacrifice', 'tribal_goblins'],
      anchorNames: new Set(['multi-match']),
    })
    // Each ofWhich category fires once...
    expect(result.ofWhich.synergy).toBe(1)
    expect(result.ofWhich.mechanicTag).toBe(1)
    expect(result.ofWhich.tribal).toBe(1)
    expect(result.ofWhich.anchor).toBe(1)
    // ...but the card is only one card, so relevant = 1, considered = 1.
    expect(result.relevant).toBe(1)
    expect(result.considered).toBe(1)
    expect(result.score).toBe(1.0)
  })
})

describe('computeCommanderExecutionScore — realistic deck shapes', () => {
  // Build a deck that's mostly on-plan with some staples and lands.
  function tribalGoblinDeck() {
    return [
      // 36 lands (excluded)
      ...Array(36).fill(null).map((_, i) => land(`Mountain ${i}`)),
      // 5 universal staples (excluded)
      card({ name: 'Sol Ring', roles: ['ramp'] }),
      card({ name: 'Arcane Signet', roles: ['ramp'] }),
      card({ name: 'Lightning Greaves', roles: ['protection'] }),
      card({ name: 'Skullclamp', roles: ['draw'] }),
      card({ name: 'Mind Stone', roles: ['ramp'] }),
      // 30 on-tribe / on-mechanic cards
      ...Array(20).fill(null).map((_, i) => card({
        name: `Goblin ${i}`,
        roles: ['synergy', 'filler'],
        tags: ['tribal_goblin'],
        type: 'Creature — Goblin',
      })),
      ...Array(10).fill(null).map((_, i) => card({
        name: `Goblin Synergy ${i}`,
        roles: ['filler'],
        tags: ['token_producer'],
      })),
      // 28 generic off-theme filler
      ...Array(28).fill(null).map((_, i) => card({
        name: `Filler ${i}`,
        roles: ['filler'],
      })),
    ]
  }

  it('tribal goblin deck with strong synergy density scores high (≥ 0.45)', () => {
    const deck = tribalGoblinDeck()
    const result = computeCommanderExecutionScore({
      deck,
      commander: { name: 'Krenko, Mob Boss' },
      mechanicTags: ['cares_about_tokens', 'tribal_goblins'],
      anchorNames: new Set(),
    })
    // 30 on-plan / 63 considered = 0.476
    expect(result.score).toBeGreaterThanOrEqual(0.45)
  })

  it('purely-generic-goodstuff deck scores zero', () => {
    const deck = [
      ...Array(36).fill(null).map((_, i) => land(`Mountain ${i}`)),
      ...Array(63).fill(null).map((_, i) => card({
        name: `Generic ${i}`,
        roles: ['filler'],
      })),
    ]
    const result = computeCommanderExecutionScore({
      deck, commander: {}, mechanicTags: [], anchorNames: new Set(),
    })
    expect(result.score).toBe(0)
  })
})

describe('getExecutionThresholdForBracket — DECREASES at higher brackets', () => {
  it('B1 has a lower threshold than B3 (casual decks tolerate generic goodstuff)', () => {
    expect(getExecutionThresholdForBracket(1)).toBeLessThan(getExecutionThresholdForBracket(3))
  })

  it('B5 has a LOWER threshold than B3 (cEDH legitimately runs more universal staples)', () => {
    // This is the key design choice — opposite of the AI feedback's
    // suggestion. cEDH decks have many tutors / fast mana / free counters
    // that don't tag as commander-specific; demanding HIGHER execution at
    // B5 would incorrectly flag tightly-tuned cEDH lists.
    expect(getExecutionThresholdForBracket(5)).toBeLessThan(getExecutionThresholdForBracket(3))
  })

  it('returns the canonical thresholds', () => {
    expect(getExecutionThresholdForBracket(1)).toBe(0.20)
    expect(getExecutionThresholdForBracket(2)).toBe(0.30)
    expect(getExecutionThresholdForBracket(3)).toBe(0.40)
    expect(getExecutionThresholdForBracket(4)).toBe(0.40)
    expect(getExecutionThresholdForBracket(5)).toBe(0.30)
  })

  it('falls back to a sensible default for unknown brackets', () => {
    expect(getExecutionThresholdForBracket(99)).toBe(0.40)
  })
})

describe('meetsExecutionThreshold', () => {
  it('returns true at exactly the threshold', () => {
    expect(meetsExecutionThreshold(0.40, 3)).toBe(true)
  })
  it('returns false below the threshold', () => {
    expect(meetsExecutionThreshold(0.39, 3)).toBe(false)
  })
  it('returns true comfortably above the threshold', () => {
    expect(meetsExecutionThreshold(0.80, 3)).toBe(true)
  })
})

describe('_internal — sanity checks on the universal-staples list', () => {
  it('includes Sol Ring and Arcane Signet (the universal-of-universal cards)', () => {
    expect(_internal.UNIVERSAL_STAPLE_NAMES.has('sol ring')).toBe(true)
    expect(_internal.UNIVERSAL_STAPLE_NAMES.has('arcane signet')).toBe(true)
  })

  it('does NOT include color-specific staples (those are bracket-specific, not universal)', () => {
    // Cards like Cyclonic Rift, Toxic Deluge, Swords to Plowshares are
    // staples but only in their colors. The universal list is for the
    // truly-everywhere cards.
    expect(_internal.UNIVERSAL_STAPLE_NAMES.has('cyclonic rift')).toBe(false)
    expect(_internal.UNIVERSAL_STAPLE_NAMES.has('toxic deluge')).toBe(false)
    expect(_internal.UNIVERSAL_STAPLE_NAMES.has('swords to plowshares')).toBe(false)
  })
})
