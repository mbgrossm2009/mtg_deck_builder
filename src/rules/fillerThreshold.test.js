// Bracket-scaled filler threshold tests.
//
// validateDeck has a single flat threshold (12). The bracket-aware
// validateDeckAtBracket wrapper applies the bracket norm:
//   B1 ≤ 18, B2 ≤ 12, B3 ≤ 8, B4 ≤ 5, B5 ≤ 3
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
  it.each([
    [1, 18, 19],
    [2, 12, 13],
    [3,  8,  9],
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
    // validateDeck warns at >12; with 13 filler at B1 (where 18 is the bracket
    // threshold) the bracket-aware result should have NO filler warning at all.
    const deck = deckWithFiller(13)
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
