import { describe, it, expect } from 'vitest'
import { validateDeck, countRoles } from './deckValidator'

const COMMANDER = {
  name: 'Atraxa',
  color_identity: ['W', 'U', 'B', 'G'],
}

// Build a 99-card deck with given role/color/legality defaults filled in.
// Each entry can override fields per-card.
function makeDeck(overrides = []) {
  const deck = []
  // Default: 37 basic lands + 62 generic legal cards
  for (let i = 0; i < 37; i++) {
    deck.push({
      name: `Forest ${i}`, // unique per entry to avoid singleton conflict
      type_line: 'Basic Land — Forest',
      color_identity: [],
      legalities: { commander: 'legal' },
      isBasicLand: true,
      roles: ['land'],
    })
  }
  for (let i = 0; i < 62; i++) {
    deck.push({
      name: `Card ${i}`,
      type_line: 'Sorcery',
      color_identity: [],
      legalities: { commander: 'legal' },
      isBasicLand: false,
      roles: ['filler'],
    })
  }
  // Apply overrides at the start of the deck
  for (let i = 0; i < overrides.length; i++) {
    deck[i] = { ...deck[i], ...overrides[i] }
  }
  return deck
}

// ─── validateDeck — size errors ──────────────────────────────────────────────
describe('validateDeck — deck size', () => {
  it('passes with exactly 99 cards', () => {
    const { errors } = validateDeck(makeDeck(), COMMANDER)
    expect(errors.find(e => e.includes('99'))).toBeUndefined()
  })

  it('errors on a deck with fewer than 99 cards', () => {
    const deck = makeDeck().slice(0, 80)
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.find(e => e.includes('80'))).toBeDefined()
  })

  it('errors on a deck with more than 99 cards', () => {
    const deck = [...makeDeck(), { name: 'Extra', type_line: 'Sorcery', color_identity: [], legalities: { commander: 'legal' }, roles: ['filler'] }]
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.find(e => e.includes('100'))).toBeDefined()
  })

  it('errors on an empty deck', () => {
    const { errors } = validateDeck([], COMMANDER)
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ─── validateDeck — singleton ────────────────────────────────────────────────
describe('validateDeck — singleton enforcement', () => {
  it('passes when each non-basic appears at most once', () => {
    const { errors } = validateDeck(makeDeck(), COMMANDER)
    expect(errors.find(e => e.includes('singleton'))).toBeUndefined()
  })

  it('errors when a non-basic card appears twice', () => {
    const deck = makeDeck([
      { name: 'Sol Ring', type_line: 'Artifact', isBasicLand: false },
      { name: 'Sol Ring', type_line: 'Artifact', isBasicLand: false },
    ])
    const { errors } = validateDeck(deck, COMMANDER)
    // toLowerCase() on both halves so the assertion isn't sensitive to
    // sentence-case capitalization in the error string.
    expect(errors.some(e => {
      const l = e.toLowerCase()
      return l.includes('sol ring') && l.includes('singleton')
    })).toBe(true)
  })

  it('treats names case-insensitively for singleton check', () => {
    const deck = makeDeck([
      { name: 'Sol Ring', type_line: 'Artifact', isBasicLand: false },
      { name: 'sol ring', type_line: 'Artifact', isBasicLand: false },
    ])
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.find(e => e.toLowerCase().includes('singleton'))).toBeDefined()
  })

  it('exempts basic lands from singleton check', () => {
    // Default deck has 37 basic Forests with unique names — but the rule should
    // still allow MULTIPLE basics with the SAME name.
    const deck = []
    for (let i = 0; i < 37; i++) {
      deck.push({ name: 'Forest', type_line: 'Basic Land — Forest', isBasicLand: true, color_identity: [], legalities: { commander: 'legal' }, roles: ['land'] })
    }
    for (let i = 0; i < 62; i++) {
      deck.push({ name: `Card ${i}`, type_line: 'Sorcery', color_identity: [], legalities: { commander: 'legal' }, roles: ['filler'] })
    }
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.find(e => e.includes('Forest') && e.includes('singleton'))).toBeUndefined()
  })
})

// ─── validateDeck — color identity ───────────────────────────────────────────
describe('validateDeck — color identity', () => {
  it('passes when all cards are within commander identity', () => {
    const deck = makeDeck([
      { name: 'White card', color_identity: ['W'] },
      { name: 'Black card', color_identity: ['B'] },
    ])
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.find(e => e.includes('color identity'))).toBeUndefined()
  })

  it('errors on cards outside commander identity', () => {
    const monoGreen = { ...COMMANDER, color_identity: ['G'] }
    const deck = makeDeck([
      { name: 'Lightning Bolt', color_identity: ['R'] },
    ])
    const { errors } = validateDeck(deck, monoGreen)
    expect(errors.some(e => e.includes('Lightning Bolt') && e.includes('color identity'))).toBe(true)
  })
})

// ─── validateDeck — banned cards ─────────────────────────────────────────────
describe('validateDeck — banned cards', () => {
  it('passes when all cards are commander legal', () => {
    const { errors } = validateDeck(makeDeck(), COMMANDER)
    expect(errors.find(e => e.includes('banned'))).toBeUndefined()
  })

  it('errors on banned cards', () => {
    const deck = makeDeck([
      { name: 'Banned Card', legalities: { commander: 'banned' } },
    ])
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.some(e => e.includes('Banned Card') && e.toLowerCase().includes('banned'))).toBe(true)
  })

  it('errors on not_legal cards', () => {
    const deck = makeDeck([
      { name: 'Conspiracy', legalities: { commander: 'not_legal' } },
    ])
    const { errors } = validateDeck(deck, COMMANDER)
    expect(errors.some(e => e.includes('Conspiracy'))).toBe(true)
  })
})

// ─── validateDeck — role balance warnings ────────────────────────────────────
describe('validateDeck — role balance warnings', () => {
  it('warns when fewer than 33 lands', () => {
    const deck = []
    // 30 lands + 69 non-lands = 99
    for (let i = 0; i < 30; i++) {
      deck.push({ name: `Forest ${i}`, type_line: 'Basic Land — Forest', isBasicLand: true, color_identity: [], legalities: { commander: 'legal' }, roles: ['land'] })
    }
    for (let i = 0; i < 69; i++) {
      deck.push({ name: `Card ${i}`, type_line: 'Sorcery', color_identity: [], legalities: { commander: 'legal' }, roles: ['filler'] })
    }
    const { warnings } = validateDeck(deck, COMMANDER)
    expect(warnings.some(w => w.toLowerCase().includes('lands'))).toBe(true)
  })

  it('warns on too few ramp cards', () => {
    const { warnings } = validateDeck(makeDeck(), COMMANDER)
    // Default deck has 0 ramp cards
    expect(warnings.some(w => w.toLowerCase().includes('ramp'))).toBe(true)
  })

  it('warns on too few draw sources', () => {
    const { warnings } = validateDeck(makeDeck(), COMMANDER)
    expect(warnings.some(w => w.toLowerCase().includes('draw'))).toBe(true)
  })

  it('warns on no win conditions', () => {
    const { warnings } = validateDeck(makeDeck(), COMMANDER)
    expect(warnings.some(w => w.toLowerCase().includes('win'))).toBe(true)
  })

  it('does not warn about ramp when deck has 6+ ramp cards', () => {
    const overrides = []
    for (let i = 0; i < 6; i++) {
      overrides.push({ name: `Ramp ${i}`, roles: ['ramp', 'filler'] })
    }
    const deck = makeDeck(overrides)
    const { warnings } = validateDeck(deck, COMMANDER)
    expect(warnings.find(w => w.toLowerCase().includes('ramp'))).toBeUndefined()
  })

  it('does not warn about win conditions when at least one is present', () => {
    const deck = makeDeck([
      { name: 'Wincon', roles: ['win_condition', 'filler'] },
    ])
    const { warnings } = validateDeck(deck, COMMANDER)
    expect(warnings.find(w => w.toLowerCase().includes('win'))).toBeUndefined()
  })
})

// ─── countRoles ──────────────────────────────────────────────────────────────
describe('countRoles', () => {
  it('returns zero counts for an empty deck', () => {
    const counts = countRoles([])
    expect(counts.land).toBe(0)
    expect(counts.ramp).toBe(0)
    expect(counts.synergy).toBe(0)
  })

  it('counts each role once per card', () => {
    const cards = [
      { roles: ['land'] },
      { roles: ['ramp'] },
      { roles: ['ramp'] },
      { roles: ['draw'] },
    ]
    const counts = countRoles(cards)
    expect(counts.land).toBe(1)
    expect(counts.ramp).toBe(2)
    expect(counts.draw).toBe(1)
  })

  it('counts multi-role cards in EVERY bucket they belong to', () => {
    const cards = [
      { roles: ['ramp', 'synergy'] },
      { roles: ['removal', 'protection'] },
    ]
    const counts = countRoles(cards)
    expect(counts.ramp).toBe(1)
    expect(counts.synergy).toBe(1)
    expect(counts.removal).toBe(1)
    expect(counts.protection).toBe(1)
  })

  it('ignores roles not in the standard set', () => {
    const cards = [{ roles: ['land', 'made_up_role'] }]
    const counts = countRoles(cards)
    expect(counts.land).toBe(1)
    expect(counts).not.toHaveProperty('made_up_role')
  })

  it('handles cards with no roles array', () => {
    const counts = countRoles([{ name: 'Naked card' }, { roles: ['land'] }])
    expect(counts.land).toBe(1)
  })

  it('returns object with every standard role key initialized', () => {
    const counts = countRoles([])
    expect(Object.keys(counts).sort()).toEqual([
      'draw', 'filler', 'land', 'protection', 'ramp', 'removal',
      'synergy', 'tutor', 'win_condition', 'wipe',
    ].sort())
  })
})

// ─── Validation warning conditions ──────────────────────────────────────────

describe('validateDeck warning conditions', () => {
  function deckOf(roleCounts) {
    // Build a 99-card deck where each card is a single-role placeholder.
    // Uses unique names to avoid singleton errors.
    const cards = []
    let i = 0
    for (const [role, count] of Object.entries(roleCounts)) {
      for (let j = 0; j < count; j++) {
        cards.push({
          name: `Card-${role}-${i++}`,
          roles: [role],
          color_identity: ['B'],
          legalities: { commander: 'legal' },
          isBasicLand: role === 'land',
        })
      }
    }
    while (cards.length < 99) {
      cards.push({
        name: `Filler-${i++}`,
        roles: ['filler'],
        color_identity: ['B'],
        legalities: { commander: 'legal' },
      })
    }
    return cards
  }
  const cmdr = { name: 'Test', color_identity: ['B'], type_line: 'Legendary Creature' }

  it('warns when fewer than 33 lands', () => {
    const deck = deckOf({ land: 30, ramp: 10, draw: 10, removal: 10, win_condition: 5 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /Only 30 lands/.test(w))).toBe(true)
  })

  it('warns when fewer than 6 ramp pieces', () => {
    const deck = deckOf({ land: 36, ramp: 3, draw: 10, removal: 10, win_condition: 5 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /Only 3 ramp/.test(w))).toBe(true)
  })

  it('warns when fewer than 6 draw sources', () => {
    const deck = deckOf({ land: 36, ramp: 8, draw: 4, removal: 10, win_condition: 5 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /Only 4 draw sources/.test(w))).toBe(true)
  })

  it('warns when fewer than 5 removal pieces', () => {
    const deck = deckOf({ land: 36, ramp: 8, draw: 8, removal: 2, win_condition: 5 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /Only 2 removal spells/.test(w))).toBe(true)
  })

  it('warns when zero win conditions', () => {
    const deck = deckOf({ land: 36, ramp: 8, draw: 8, removal: 8 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /No clear win conditions/.test(w))).toBe(true)
  })

  it('warns when more than 12 filler cards', () => {
    // The deckOf helper pads remaining slots with filler — for this input
    // 99 - (36+8+8+8+2) = 37 filler. Well above the 12 threshold.
    const deck = deckOf({ land: 36, ramp: 8, draw: 8, removal: 8, win_condition: 2 })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /filler cards/.test(w))).toBe(true)
  })

  it('does NOT warn about filler when count is at threshold (12)', () => {
    const deck = []
    for (let i = 0; i < 36; i++) deck.push({ name: `L-${i}`, roles: ['land'], color_identity: ['B'], isBasicLand: true })
    for (let i = 0; i < 30; i++) deck.push({ name: `R-${i}`, roles: ['ramp'], color_identity: ['B'] })
    for (let i = 0; i < 20; i++) deck.push({ name: `D-${i}`, roles: ['draw'], color_identity: ['B'] })
    for (let i = 0; i < 12; i++) deck.push({ name: `F-${i}`, roles: ['filler'], color_identity: ['B'] })
    deck.push({ name: 'W-1', roles: ['win_condition'], color_identity: ['B'] })
    const { warnings } = validateDeck(deck, cmdr)
    expect(warnings.some(w => /filler cards/.test(w))).toBe(false)
  })
})
