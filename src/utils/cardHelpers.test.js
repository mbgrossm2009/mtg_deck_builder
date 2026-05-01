import { describe, it, expect } from 'vitest'
import {
  isBasicLand,
  isLand,
  getBasicLandsForCommander,
  colorIdentityLegal,
  isCommanderLegal,
  hasValidData,
  getOracleText,
  deduplicateByName,
  avgCmc,
} from './cardHelpers'

// ─── isBasicLand ─────────────────────────────────────────────────────────────
describe('isBasicLand', () => {
  it('returns true for a snow-covered basic', () => {
    expect(isBasicLand({ type_line: 'Basic Snow Land — Forest' })).toBe(true)
  })

  it('returns true for vanilla basics', () => {
    expect(isBasicLand({ type_line: 'Basic Land — Plains' })).toBe(true)
    expect(isBasicLand({ type_line: 'Basic Land — Island' })).toBe(true)
  })

  it('returns false for non-basic lands', () => {
    expect(isBasicLand({ type_line: 'Land — Forest' })).toBe(false)
    expect(isBasicLand({ type_line: 'Land — Mountain' })).toBe(false)
  })

  it('returns false for non-lands', () => {
    expect(isBasicLand({ type_line: 'Creature — Elf' })).toBe(false)
    expect(isBasicLand({ type_line: 'Sorcery' })).toBe(false)
  })

  it('returns false for cards missing type_line', () => {
    expect(isBasicLand({})).toBe(false)
    expect(isBasicLand({ type_line: '' })).toBe(false)
  })

  it('does not false-positive on cards whose name contains "basic"', () => {
    // A creature named "Basic Healer" or similar shouldn't count.
    expect(isBasicLand({ type_line: 'Creature — Human Cleric' })).toBe(false)
  })

  it('uses word boundaries so partial matches do not trip it up', () => {
    expect(isBasicLand({ type_line: 'Sorcery — Wasteland' })).toBe(false)
  })
})

// ─── isLand ──────────────────────────────────────────────────────────────────
describe('isLand', () => {
  it('returns true for any land type_line', () => {
    expect(isLand({ type_line: 'Land' })).toBe(true)
    expect(isLand({ type_line: 'Basic Land — Forest' })).toBe(true)
    expect(isLand({ type_line: 'Land — Forest Island' })).toBe(true)
    expect(isLand({ type_line: 'Legendary Land' })).toBe(true)
  })

  it('returns false for non-lands', () => {
    expect(isLand({ type_line: 'Creature — Elf' })).toBe(false)
    expect(isLand({ type_line: 'Instant' })).toBe(false)
  })

  it('returns false for cards missing type_line', () => {
    expect(isLand({})).toBe(false)
  })

  it('matches words at boundaries', () => {
    expect(isLand({ type_line: 'Land' })).toBe(true)
    // Should not match substring of other words
    expect(isLand({ type_line: 'Sorcery — Lander' })).toBe(false)
  })
})

// ─── getBasicLandsForCommander ───────────────────────────────────────────────
describe('getBasicLandsForCommander', () => {
  it('returns matching basics for a single-color commander', () => {
    expect(getBasicLandsForCommander({ color_identity: ['G'] })).toEqual([
      'Forest', 'Snow-Covered Forest',
    ])
  })

  it('returns basics for every color in a multicolor identity', () => {
    const result = getBasicLandsForCommander({ color_identity: ['W', 'U', 'B'] })
    expect(result).toContain('Plains')
    expect(result).toContain('Island')
    expect(result).toContain('Swamp')
    // 3 colors × 2 names each = 6 entries
    expect(result).toHaveLength(6)
  })

  it('returns Wastes for colorless commanders', () => {
    expect(getBasicLandsForCommander({ color_identity: [] })).toEqual(['Wastes'])
  })

  it('returns Wastes when color_identity is missing entirely', () => {
    expect(getBasicLandsForCommander({})).toEqual(['Wastes'])
  })

  it('includes both regular and snow-covered variants in order', () => {
    const result = getBasicLandsForCommander({ color_identity: ['R'] })
    expect(result[0]).toBe('Mountain')
    expect(result[1]).toBe('Snow-Covered Mountain')
  })
})

// ─── colorIdentityLegal ──────────────────────────────────────────────────────
describe('colorIdentityLegal', () => {
  it('returns true when card has subset of commander identity', () => {
    expect(colorIdentityLegal(
      { color_identity: ['G'] },
      { color_identity: ['G', 'W'] }
    )).toBe(true)
  })

  it('returns true when card identity exactly matches commander', () => {
    expect(colorIdentityLegal(
      { color_identity: ['U', 'B'] },
      { color_identity: ['U', 'B'] }
    )).toBe(true)
  })

  it('returns false when card has color outside commander identity', () => {
    expect(colorIdentityLegal(
      { color_identity: ['R'] },
      { color_identity: ['G', 'W'] }
    )).toBe(false)
  })

  it('returns true for colorless cards regardless of commander', () => {
    expect(colorIdentityLegal(
      { color_identity: [] },
      { color_identity: ['G'] }
    )).toBe(true)
  })

  it('returns true for any card under a 5-color commander', () => {
    expect(colorIdentityLegal(
      { color_identity: ['W', 'U', 'B'] },
      { color_identity: ['W', 'U', 'B', 'R', 'G'] }
    )).toBe(true)
  })

  it('treats missing card identity as colorless (always legal)', () => {
    expect(colorIdentityLegal(
      {},
      { color_identity: ['G'] }
    )).toBe(true)
  })

  it('treats missing commander identity as colorless commander (only colorless cards legal)', () => {
    expect(colorIdentityLegal(
      { color_identity: ['G'] },
      {}
    )).toBe(false)
    expect(colorIdentityLegal(
      { color_identity: [] },
      {}
    )).toBe(true)
  })
})

// ─── isCommanderLegal ────────────────────────────────────────────────────────
describe('isCommanderLegal', () => {
  it('returns true for legal cards', () => {
    expect(isCommanderLegal({ legalities: { commander: 'legal' } })).toBe(true)
  })

  it('returns true for restricted cards (Commander treats restricted as legal)', () => {
    expect(isCommanderLegal({ legalities: { commander: 'restricted' } })).toBe(true)
  })

  it('returns false for banned cards', () => {
    expect(isCommanderLegal({ legalities: { commander: 'banned' } })).toBe(false)
  })

  it('returns false for not_legal cards', () => {
    expect(isCommanderLegal({ legalities: { commander: 'not_legal' } })).toBe(false)
  })

  it('returns true when legalities is missing entirely (graceful fallback for unvalidated cards)', () => {
    expect(isCommanderLegal({})).toBe(true)
  })

  it('returns false when legalities object is present but commander key is missing', () => {
    expect(isCommanderLegal({ legalities: {} })).toBe(false)
  })
})

// ─── hasValidData ────────────────────────────────────────────────────────────
describe('hasValidData', () => {
  it('returns true for fully validated cards', () => {
    expect(hasValidData({
      type_line: 'Creature — Elf',
      needsValidation: false,
      validationFailed: false,
    })).toBe(true)
  })

  it('returns false for cards still pending validation', () => {
    expect(hasValidData({
      type_line: 'Creature — Elf',
      needsValidation: true,
    })).toBe(false)
  })

  it('returns false for cards that failed Scryfall lookup', () => {
    expect(hasValidData({
      type_line: '',
      validationFailed: true,
    })).toBe(false)
  })

  it('returns false when type_line is missing', () => {
    expect(hasValidData({})).toBe(false)
  })

  it('treats undefined validation flags as falsy (no flag = valid)', () => {
    expect(hasValidData({ type_line: 'Sorcery' })).toBe(true)
  })
})

// ─── getOracleText ───────────────────────────────────────────────────────────
describe('getOracleText', () => {
  it('returns lowercase oracle_text for a single-faced card', () => {
    expect(getOracleText({ oracle_text: 'Tap: Add {G}.' })).toBe('tap: add {g}.')
  })

  it('joins both faces of a double-faced card', () => {
    const dfc = {
      card_faces: [
        { oracle_text: 'Front: deal 2 damage.' },
        { oracle_text: 'Back: gain 3 life.' },
      ],
    }
    const text = getOracleText(dfc)
    expect(text).toContain('front: deal 2 damage.')
    expect(text).toContain('back: gain 3 life.')
  })

  it('handles DFC where one face has no oracle text', () => {
    expect(getOracleText({
      card_faces: [{ oracle_text: 'Effect.' }, {}],
    })).toBe('effect. ')
  })

  it('returns empty string when both oracle_text and card_faces missing', () => {
    expect(getOracleText({})).toBe('')
  })

  it('prefers top-level oracle_text over card_faces if both present', () => {
    expect(getOracleText({
      oracle_text: 'Top level',
      card_faces: [{ oracle_text: 'Face' }],
    })).toBe('top level')
  })
})

// ─── deduplicateByName ───────────────────────────────────────────────────────
describe('deduplicateByName', () => {
  it('removes duplicates case-insensitively, keeping first occurrence', () => {
    const out = deduplicateByName([
      { id: '1', name: 'Sol Ring' },
      { id: '2', name: 'Lightning Bolt' },
      { id: '3', name: 'sol ring' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('1')
    expect(out[1].id).toBe('2')
  })

  it('returns empty for empty input', () => {
    expect(deduplicateByName([])).toEqual([])
  })

  it('preserves all entries when there are no duplicates', () => {
    const cards = [
      { name: 'Sol Ring' },
      { name: 'Mana Crypt' },
      { name: 'Mana Vault' },
    ]
    expect(deduplicateByName(cards)).toEqual(cards)
  })

  it('treats different basic land entries as duplicates by name', () => {
    // saveCollection might store many "Forest" entries with different ids;
    // dedup should collapse them.
    const out = deduplicateByName([
      { id: 'a', name: 'Forest' },
      { id: 'b', name: 'Forest' },
      { id: 'c', name: 'Forest' },
    ])
    expect(out).toHaveLength(1)
  })
})

// ─── avgCmc ──────────────────────────────────────────────────────────────────
describe('avgCmc', () => {
  it('averages CMC of non-land cards only', () => {
    const cards = [
      { type_line: 'Creature', cmc: 2 },
      { type_line: 'Creature', cmc: 4 },
      { type_line: 'Land', cmc: 0 }, // ignored
    ]
    expect(avgCmc(cards)).toBe(3)
  })

  it('returns 0 when there are no non-land cards', () => {
    const cards = [
      { type_line: 'Land' },
      { type_line: 'Basic Land — Forest' },
    ]
    expect(avgCmc(cards)).toBe(0)
  })

  it('returns 0 for an empty deck', () => {
    expect(avgCmc([])).toBe(0)
  })

  it('rounds to one decimal place', () => {
    const cards = [
      { type_line: 'Sorcery', cmc: 1 },
      { type_line: 'Sorcery', cmc: 2 },
      { type_line: 'Sorcery', cmc: 2 },
    ]
    // 5/3 = 1.666... → 1.7
    expect(avgCmc(cards)).toBe(1.7)
  })

  it('treats missing cmc as 0', () => {
    const cards = [
      { type_line: 'Sorcery', cmc: 4 },
      { type_line: 'Sorcery' }, // no cmc
    ]
    // (4 + 0) / 2 = 2
    expect(avgCmc(cards)).toBe(2)
  })

  it('handles a typical 99-card distribution', () => {
    const lands = Array(37).fill({ type_line: 'Land', cmc: 0 })
    const nonLands = [
      ...Array(20).fill({ type_line: 'Creature', cmc: 2 }),
      ...Array(20).fill({ type_line: 'Creature', cmc: 3 }),
      ...Array(22).fill({ type_line: 'Creature', cmc: 4 }),
    ]
    const result = avgCmc([...lands, ...nonLands])
    // (20*2 + 20*3 + 22*4) / 62 = (40 + 60 + 88) / 62 = 188/62 ≈ 3.0
    expect(result).toBeGreaterThan(2.9)
    expect(result).toBeLessThan(3.1)
  })
})
