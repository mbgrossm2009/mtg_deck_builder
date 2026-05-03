// Per-commander bracket-cap tests.
//
// The cap exists because some commanders (Krenko, Edgar Markov, Marwyn,
// Tiamat) genuinely cannot hit B5 — their game plan IS B3-B4 (tribal
// beatdown, no built-in combo angle). Building them at B5 produces decks
// that the eval evaluator scores as B3-B4 anyway, so we cap honestly
// instead of pretending.
//
// Conversely, B5-capable commanders (Najeela, Kinnan, Thrasios+Tymna,
// Urza) can support cEDH-tier optimization and must NOT be capped.

import { describe, it, expect } from 'vitest'
import {
  applyCommanderBracketCap,
  getCommanderBracketCeiling,
  _internal,
} from './commanderPowerCeiling'

const c = (name) => ({ name })

describe('getCommanderBracketCeiling', () => {
  it('returns 5 for null/undefined commander (graceful default)', () => {
    expect(getCommanderBracketCeiling(null)).toBe(5)
    expect(getCommanderBracketCeiling(undefined)).toBe(5)
    expect(getCommanderBracketCeiling({})).toBe(5)
  })

  it('returns 4 for commanders explicitly listed as B5-incapable', () => {
    expect(getCommanderBracketCeiling(c('Krenko, Mob Boss'))).toBe(4)
    expect(getCommanderBracketCeiling(c('Edgar Markov'))).toBe(4)
    expect(getCommanderBracketCeiling(c('Marwyn, the Nurturer'))).toBe(4)
    expect(getCommanderBracketCeiling(c('Tiamat'))).toBe(4)
    expect(getCommanderBracketCeiling(c('Koma, Cosmos Serpent'))).toBe(4)
  })

  it('returns 5 for unlisted commanders (default = no cap)', () => {
    // We only cap commanders we KNOW can't hit B5. Unknown commanders
    // are assumed capable — false positives (capping a deck that COULD
    // hit B5) are worse than false negatives.
    expect(getCommanderBracketCeiling(c('Made Up Commander'))).toBe(5)
    expect(getCommanderBracketCeiling(c('Some Random Legend'))).toBe(5)
  })

  it('is case-insensitive on commander name', () => {
    expect(getCommanderBracketCeiling(c('KRENKO, MOB BOSS'))).toBe(4)
    expect(getCommanderBracketCeiling(c('edgar markov'))).toBe(4)
  })
})

describe('applyCommanderBracketCap', () => {
  it('caps Krenko at B5 down to B4 (Krenko is B5-incapable)', () => {
    const result = applyCommanderBracketCap(c('Krenko, Mob Boss'), 5)
    expect(result).toEqual({ effective: 4, capped: true, ceiling: 4 })
  })

  it('caps Edgar Markov at B5 down to B4', () => {
    const result = applyCommanderBracketCap(c('Edgar Markov'), 5)
    expect(result).toEqual({ effective: 4, capped: true, ceiling: 4 })
  })

  it('caps Tiamat at B5 down to B4', () => {
    const result = applyCommanderBracketCap(c('Tiamat'), 5)
    expect(result).toEqual({ effective: 4, capped: true, ceiling: 4 })
  })

  it('does NOT cap Najeela at B5 (B5-capable cEDH commander)', () => {
    const result = applyCommanderBracketCap(c('Najeela, the Blade-Blossom'), 5)
    expect(result).toEqual({ effective: 5, capped: false, ceiling: 5 })
  })

  it('does NOT cap Kinnan at B5', () => {
    const result = applyCommanderBracketCap(c('Kinnan, Bonder Prodigy'), 5)
    expect(result).toEqual({ effective: 5, capped: false, ceiling: 5 })
  })

  it('does NOT cap Thrasios at B5 (cEDH partner)', () => {
    const result = applyCommanderBracketCap(c('Thrasios, Triton Hero'), 5)
    expect(result).toEqual({ effective: 5, capped: false, ceiling: 5 })
  })

  it('passes through unchanged when requested bracket is at or below ceiling', () => {
    // Krenko at B3 stays B3 (no cap fires; ceiling is 4 but request is 3)
    expect(applyCommanderBracketCap(c('Krenko, Mob Boss'), 3))
      .toEqual({ effective: 3, capped: false, ceiling: 4 })
    expect(applyCommanderBracketCap(c('Krenko, Mob Boss'), 4))
      .toEqual({ effective: 4, capped: false, ceiling: 4 })
  })

  it('passes through unknown commanders unchanged at any bracket', () => {
    expect(applyCommanderBracketCap(c('Unknown Cmdr'), 1))
      .toEqual({ effective: 1, capped: false, ceiling: 5 })
    expect(applyCommanderBracketCap(c('Unknown Cmdr'), 5))
      .toEqual({ effective: 5, capped: false, ceiling: 5 })
  })
})

describe('B5 incapable list — sanity checks', () => {
  it('the incapable set is non-empty (the cap exists for a reason)', () => {
    expect(_internal.B5_INCAPABLE_COMMANDERS.size).toBeGreaterThan(0)
  })

  it('does not accidentally include known cEDH commanders', () => {
    // If any of these end up in the incapable set, the cap is wrong.
    const cedhStaples = [
      'najeela, the blade-blossom',
      'kinnan, bonder prodigy',
      'thrasios, triton hero',
      'tymna the weaver',
      'urza, lord high artificer',
      'rograkh, son of rohgahh',
      'kraum, ludevic\'s opus',
    ]
    for (const name of cedhStaples) {
      expect(_internal.B5_INCAPABLE_COMMANDERS.has(name),
        `${name} should NOT be in B5_INCAPABLE_COMMANDERS`).toBe(false)
    }
  })

  it('includes the canonical tribal-beatdown commanders', () => {
    // These are the commanders the user empirically saw under-perform at B5
    // because their game plan caps out at B3-B4 even with cEDH staples.
    expect(_internal.B5_INCAPABLE_COMMANDERS.has('krenko, mob boss')).toBe(true)
    expect(_internal.B5_INCAPABLE_COMMANDERS.has('edgar markov')).toBe(true)
    expect(_internal.B5_INCAPABLE_COMMANDERS.has('marwyn, the nurturer')).toBe(true)
  })
})
