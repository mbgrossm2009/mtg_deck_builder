// Bracket-scaled filler threshold tests.
//
// validateDeck has a single flat threshold (12). The bracket-aware
// validateDeckAtBracket wrapper applies the bracket norm:
//   B1 ≤ 12, B2 ≤ 9, B3 ≤ 6, B4 ≤ 5, B5 ≤ 3
//
// Caps at B4/B5 were relaxed (3→5, 1→3) after eval data showed honest
// optimized decks legitimately ship a few non-keyword utility cards
// (cEDH stax, B4 protection) that don't share keywords with the commander.
//
// These tests pin down each bracket so the threshold can't drift silently.

import { describe, it, expect } from 'vitest'
import { validateDeckAtBracket } from './deckValidator'

const cmdr = { name: 'Test', color_identity: ['B'], type_line: 'Legendary Creature' }

// Build a 99-card deck with the given counts. Pads remaining slots with
// filler-tagged cards so we can crank the filler count for tests.
function deckWithFiller(fillerCount, opts = {}) {
  const lands = opts.lands ?? 36
  const ramp = opts.ramp ?? 8
  const draw = opts.draw ?? 8
  const removal = opts.removal ?? 8
  const wincons = opts.wincons ?? 2
  const synergyFill = 99 - lands - ramp - draw - removal - wincons - fillerCount
  if (synergyFill < 0) throw new Error('counts add up to more than 99')

  const cards = []
  let i = 0
  for (let n = 0; n < lands; n++)        cards.push({ name: `L-${i++}`, roles: ['land'],          color_identity: ['B'], isBasicLand: true })
  for (let n = 0; n < ramp; n++)         cards.push({ name: `R-${i++}`, roles: ['ramp'],          color_identity: ['B'] })
  for (let n = 0; n < draw; n++)         cards.push({ name: `D-${i++}`, roles: ['draw'],          color_identity: ['B'] })
  for (let n = 0; n < removal; n++)      cards.push({ name: `X-${i++}`, roles: ['removal'],       color_identity: ['B'] })
  for (let n = 0; n < wincons; n++)      cards.push({ name: `W-${i++}`, roles: ['win_condition'], color_identity: ['B'] })
  for (let n = 0; n < synergyFill; n++)  cards.push({ name: `S-${i++}`, roles: ['synergy'],       color_identity: ['B'] })
  for (let n = 0; n < fillerCount; n++)  cards.push({ name: `F-${i++}`, roles: ['filler'],        color_identity: ['B'] })
  return cards
}

describe('validateDeckAtBracket — bracket-scaled filler thresholds', () => {
  // For each bracket, test exactly at threshold (no warn) AND one over (warn).
  // Thresholds tightened post-counting-bug fix (filler counts in real decks
  // are 5-15, not 60+, so the previous lenient values were unnecessary).
  it.each([
    [1, 12, 13],
    [2,  9, 10],
    [3,  6,  7],
    [4,  5,  6],
    [5,  3,  4],
  ])('B%d: threshold %d — at threshold = no warn, threshold+1 = warn',
    (bracket, atThreshold, overThreshold) => {
      const atDeck   = deckWithFiller(atThreshold)
      const overDeck = deckWithFiller(overThreshold)

      const atResult   = validateDeckAtBracket(atDeck,   cmdr, bracket)
      const overResult = validateDeckAtBracket(overDeck, cmdr, bracket)

      const fillerWarn = (warns) => warns.some(w => /filler cards/.test(w))
      expect(fillerWarn(atResult.warnings),
        `B${bracket}: ${atThreshold} filler should NOT trigger warning`).toBe(false)
      expect(fillerWarn(overResult.warnings),
        `B${bracket}: ${overThreshold} filler SHOULD trigger warning`).toBe(true)
    }
  )

  it('warning message includes the bracket and the actual count', () => {
    const deck = deckWithFiller(10)
    const { warnings } = validateDeckAtBracket(deck, cmdr, 4)
    const fillerWarn = warnings.find(w => /filler cards/.test(w))
    expect(fillerWarn).toBeDefined()
    expect(fillerWarn).toMatch(/10 filler/)
    expect(fillerWarn).toMatch(/B4/)
    expect(fillerWarn).toMatch(/≤ 5/)
  })

  it('strips the flat-threshold filler warning from the base validator', () => {
    // validateDeck warns at >12 (flat). Bracket-aware B1 threshold is also
    // 12, so 12 filler at B1 → no warning. The flat-threshold warning that
    // would otherwise fire at >12 must be stripped before our return.
    const deck = deckWithFiller(12)
    const { warnings } = validateDeckAtBracket(deck, cmdr, 1)
    expect(warnings.some(w => /filler cards/.test(w))).toBe(false)
  })

  it('still surfaces non-filler warnings (lands, ramp, etc.)', () => {
    // Underweight deck — should still warn about lands etc.
    const deck = deckWithFiller(0, { lands: 30, ramp: 3, draw: 10, removal: 10, wincons: 5 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 3)
    expect(warnings.some(w => /Only 30 lands/.test(w))).toBe(true)
    expect(warnings.some(w => /Only 3 ramp/.test(w))).toBe(true)
  })

  it('passes errors through unchanged', () => {
    // Deck with wrong size → error from base validator
    const cards = deckWithFiller(0).slice(0, 50)
    const { errors } = validateDeckAtBracket(cards, cmdr, 3)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => /50 cards/.test(e))).toBe(true)
  })

  it('returns base validator output unchanged when bracket is unknown', () => {
    const deck = deckWithFiller(15)
    const { warnings } = validateDeckAtBracket(deck, cmdr, 99)  // no such bracket
    // No bracket-scaled threshold applies; flat-threshold filler warning
    // was stripped, so no filler warning at all.
    expect(warnings.some(w => /filler cards/.test(w))).toBe(false)
  })
})

// Context-aware land warning. The flat 33-land floor is wrong at B5 (cEDH
// runs 24-28 lands by design) and even at B4 it depends on whether the
// deck has fast mana + low curve to compensate.
describe('validateDeckAtBracket — context-aware land warning', () => {
  // Build a deck with explicit lands/non-lands/fast-mana/curve controls.
  function deckWithMana({ lands, fastMana = 0, ramp = 8, avgCmc = 3.0 }) {
    const cards = []
    for (let n = 0; n < lands; n++) {
      cards.push({ name: `L-${n}`, roles: ['land'], color_identity: ['B'], type_line: 'Basic Land', isBasicLand: true, cmc: 0 })
    }
    for (let n = 0; n < ramp; n++) {
      cards.push({ name: `R-${n}`, roles: ['ramp'], color_identity: ['B'], type_line: 'Artifact', cmc: 2 })
    }
    for (let n = 0; n < fastMana; n++) {
      cards.push({ name: `F-${n}`, roles: ['ramp'], tags: ['fast_mana'], color_identity: ['B'], type_line: 'Artifact', cmc: 0 })
    }
    // Pad to 99 with non-land synergy cards at the requested avg CMC.
    const filler = 99 - cards.length
    for (let n = 0; n < filler; n++) {
      cards.push({ name: `S-${n}`, roles: ['synergy'], color_identity: ['B'], type_line: 'Creature', cmc: avgCmc })
    }
    return cards
  }

  it('B5 28 lands + 10 fast mana + 12 ramp + low curve → no land warning', () => {
    const deck = deckWithMana({ lands: 28, fastMana: 10, ramp: 4, avgCmc: 2.0 })
    // Note ramp=4 + fastMana=10 = 14 ramp pieces (fast mana counts as ramp here).
    const { warnings } = validateDeckAtBracket(deck, cmdr, 5)
    expect(warnings.some(w => /lands/i.test(w))).toBe(false)
  })

  it('B5 28 lands + high curve (3.5) → warning about missing fast-mana shape', () => {
    const deck = deckWithMana({ lands: 28, fastMana: 0, ramp: 8, avgCmc: 3.5 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 5)
    expect(warnings.some(w => /lands/i.test(w))).toBe(true)
  })

  it('B5 25 lands → strict-floor warning (below 26)', () => {
    const deck = deckWithMana({ lands: 25, fastMana: 12, ramp: 4, avgCmc: 2.0 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 5)
    expect(warnings.some(w => /lands/i.test(w))).toBe(true)
  })

  it('B4 32 lands → no warning', () => {
    const deck = deckWithMana({ lands: 32, fastMana: 4, ramp: 8, avgCmc: 3.0 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 4)
    expect(warnings.some(w => /lands/i.test(w))).toBe(false)
  })

  it('B4 28 lands without fast-mana shape → warning', () => {
    const deck = deckWithMana({ lands: 28, fastMana: 2, ramp: 6, avgCmc: 3.0 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 4)
    expect(warnings.some(w => /lands/i.test(w))).toBe(true)
  })

  it('B3 32 lands → strict-floor warning (B3 floor is 33)', () => {
    const deck = deckWithMana({ lands: 32, fastMana: 4, ramp: 4, avgCmc: 2.0 })
    const { warnings } = validateDeckAtBracket(deck, cmdr, 3)
    expect(warnings.some(w => /lands/i.test(w))).toBe(true)
  })
})

describe('validateDeckAtBracket — ramp upper cap', () => {
  // Ramp upper caps prevent the eval failure mode where decks ship with
  // 19 ramp pieces and 6 removal — ramp crowding out interaction.
  function deckWithRamp(rampCount) {
    const cards = []
    for (let n = 0; n < 36; n++) {
      cards.push({ name: `L-${n}`, roles: ['land'], color_identity: ['B'], type_line: 'Basic Land', isBasicLand: true, cmc: 0 })
    }
    for (let n = 0; n < rampCount; n++) {
      cards.push({ name: `R-${n}`, roles: ['ramp'], color_identity: ['B'], type_line: 'Artifact', cmc: 2 })
    }
    const filler = 99 - cards.length
    for (let n = 0; n < filler; n++) {
      cards.push({ name: `S-${n}`, roles: ['synergy'], color_identity: ['B'], type_line: 'Creature', cmc: 3 })
    }
    return cards
  }

  it('B4 with 19 ramp triggers cap warning (B4 cap = 16)', () => {
    const { warnings } = validateDeckAtBracket(deckWithRamp(19), cmdr, 4)
    expect(warnings.some(w => /ramp pieces/.test(w))).toBe(true)
  })

  it('B5 with 25 ramp triggers cap warning (B5 cap = 18 base)', () => {
    const { warnings } = validateDeckAtBracket(deckWithRamp(25), cmdr, 5)
    expect(warnings.some(w => /ramp pieces/.test(w))).toBe(true)
  })

  it('B4 with 14 ramp does NOT trigger cap (within target+variance)', () => {
    const { warnings } = validateDeckAtBracket(deckWithRamp(14), cmdr, 4)
    expect(warnings.some(w => /ramp pieces/.test(w))).toBe(false)
  })

  it('high-CMC commander gets allowance but is still capped', () => {
    const atraxa = { name: 'Atraxa', color_identity: ['B'], type_line: 'Legendary Creature', cmc: 7 }
    // B5 cap base 18 + 4 (CMC>=7) = 22. 21 should pass, 23 should warn.
    const noWarn = validateDeckAtBracket(deckWithRamp(21), atraxa, 5).warnings
    const warns  = validateDeckAtBracket(deckWithRamp(23), atraxa, 5).warnings
    expect(noWarn.some(w => /ramp pieces/.test(w))).toBe(false)
    expect(warns .some(w => /ramp pieces/.test(w))).toBe(true)
  })
})

describe('validateDeckAtBracket — interaction floor', () => {
  // Builds a deck with explicit interaction count. Interaction = removal
  // + wipe + counterspells (counterspells get the `removal` role).
  function deckWithInteraction(interactionCount, opts = {}) {
    const lands = opts.lands ?? 36
    const ramp  = opts.ramp ?? 8
    const cards = []
    for (let n = 0; n < lands; n++)
      cards.push({ name: `L-${n}`, roles: ['land'], color_identity: ['B'], type_line: 'Basic Land', isBasicLand: true, cmc: 0 })
    for (let n = 0; n < ramp; n++)
      cards.push({ name: `R-${n}`, roles: ['ramp'], color_identity: ['B'], type_line: 'Artifact', cmc: 2 })
    for (let n = 0; n < interactionCount; n++)
      cards.push({ name: `X-${n}`, roles: ['removal'], color_identity: ['B'], type_line: 'Instant', cmc: 2 })
    const filler = 99 - cards.length
    for (let n = 0; n < filler; n++)
      cards.push({ name: `S-${n}`, roles: ['synergy'], color_identity: ['B'], type_line: 'Creature', cmc: 3 })
    return cards
  }

  it('B4 with 6 interaction triggers floor warning (B4 floor = 8)', () => {
    const { warnings } = validateDeckAtBracket(deckWithInteraction(6), cmdr, 4)
    expect(warnings.some(w => /interaction pieces/.test(w))).toBe(true)
  })

  it('B5 with 6 interaction triggers floor warning (B5 floor = 10)', () => {
    const { warnings } = validateDeckAtBracket(deckWithInteraction(6), cmdr, 5)
    expect(warnings.some(w => /interaction pieces/.test(w))).toBe(true)
  })

  it('B5 with 12 interaction does NOT trigger', () => {
    const { warnings } = validateDeckAtBracket(deckWithInteraction(12), cmdr, 5)
    expect(warnings.some(w => /interaction pieces/.test(w))).toBe(false)
  })

  it('B3 with 7 interaction does NOT trigger', () => {
    const { warnings } = validateDeckAtBracket(deckWithInteraction(7), cmdr, 3)
    expect(warnings.some(w => /interaction pieces/.test(w))).toBe(false)
  })
})
