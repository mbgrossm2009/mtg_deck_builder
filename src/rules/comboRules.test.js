import { describe, it, expect } from 'vitest'
import {
  detectCombos,
  findIncompleteCombos,
  combosForCard,
  getAllCombos,
  registerCombos,
} from './comboRules'

// ─── detectCombos ────────────────────────────────────────────────────────────
describe('detectCombos', () => {
  it('returns no combos for an empty deck', () => {
    expect(detectCombos([])).toEqual([])
  })

  it('detects a 2-card combo when both cards are present', () => {
    const result = detectCombos(['Exquisite Blood', 'Sanguine Bond'])
    expect(result.length).toBeGreaterThan(0)
    const found = result.find(c =>
      c.cards.includes('Exquisite Blood') && c.cards.includes('Sanguine Bond')
    )
    expect(found).toBeDefined()
    expect(found.minimumBracket).toBeDefined()
    expect(found.description).toBeDefined()
  })

  it('does NOT detect a combo when one piece is missing', () => {
    const result = detectCombos(['Exquisite Blood'])  // Missing Sanguine Bond
    const blood = result.find(c =>
      c.cards.includes('Exquisite Blood') && c.cards.includes('Sanguine Bond')
    )
    expect(blood).toBeUndefined()
  })

  it('matches case-insensitively', () => {
    const result = detectCombos(['exquisite blood', 'SANGUINE BOND'])
    expect(result.length).toBeGreaterThan(0)
  })

  it('detects a 3-card combo only when all 3 are present', () => {
    // Aetherflux + Sensei's Top + Bolas's Citadel — bracket 5 combo
    const allThree = detectCombos(['Aetherflux Reservoir', 'Sensei\'s Divining Top', 'Bolas\'s Citadel'])
    const found = allThree.find(c => c.cards.length === 3)
    expect(found).toBeDefined()

    const onlyTwo = detectCombos(['Aetherflux Reservoir', 'Sensei\'s Divining Top'])
    const stillFound = onlyTwo.find(c => c.cards.length === 3 && c.cards.includes('Bolas\'s Citadel'))
    expect(stillFound).toBeUndefined()
  })

  it('detects multiple distinct combos in the same deck', () => {
    const result = detectCombos([
      'Exquisite Blood', 'Sanguine Bond',
      'Heliod, Sun-Crowned', 'Walking Ballista',
    ])
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('handles deck with only unrelated cards', () => {
    const result = detectCombos(['Lightning Bolt', 'Counterspell', 'Forest'])
    expect(result).toEqual([])
  })

  it('returns each combo only once even when many unrelated cards are present', () => {
    const deck = [
      'Exquisite Blood', 'Sanguine Bond',
      ...Array(95).fill('Forest'),
    ]
    const result = detectCombos(deck)
    const blood = result.filter(c =>
      c.cards.includes('Exquisite Blood') && c.cards.includes('Sanguine Bond')
    )
    expect(blood).toHaveLength(1)
  })
})

// ─── findIncompleteCombos ────────────────────────────────────────────────────
//
// Note: the combo registry includes some single-card "combos" — these are
// one-card win conditions (Insurrection, Craterhoof Behemoth, Triumph of the
// Hordes) registered alongside multi-card combos so the recommender can flag
// them as "you don't own this finisher yet, consider adding it." These will
// show as missing-1-card combos when their single card isn't present.
describe('findIncompleteCombos', () => {
  it('returns missing single-card "combos" against an empty deck', () => {
    // Single-card win-cons all show as "1-away" when absent from the deck.
    const incomplete = findIncompleteCombos([])
    expect(incomplete.length).toBeGreaterThan(0)
    // All should be single-card entries
    for (const e of incomplete) {
      expect(e.combo.cards).toHaveLength(1)
      expect(e.missing).toBe(e.combo.cards[0])
    }
  })

  it('flags a 2-card combo missing exactly one piece', () => {
    const incomplete = findIncompleteCombos(['Exquisite Blood'])  // Sanguine Bond missing
    const sanguine = incomplete.find(x => x.missing === 'Sanguine Bond')
    expect(sanguine).toBeDefined()
  })

  it('does NOT flag 2-card combos with NEITHER piece present (missing >= 2)', () => {
    const incomplete = findIncompleteCombos(['Forest', 'Lightning Bolt'])
    // Should not contain Exquisite Blood + Sanguine Bond combo since both are missing
    const blood = incomplete.find(x =>
      x.combo.cards.includes('Exquisite Blood') &&
      x.combo.cards.includes('Sanguine Bond')
    )
    expect(blood).toBeUndefined()
  })

  it('does NOT flag combos that are already complete', () => {
    // Exquisite Blood + Sanguine Bond is complete; should be in detectCombos but
    // NOT in findIncompleteCombos.
    const incomplete = findIncompleteCombos(['Exquisite Blood', 'Sanguine Bond'])
    const sanguine = incomplete.find(x => x.missing === 'Sanguine Bond')
    expect(sanguine).toBeUndefined()
  })

  it('reports the missing card by exact registered name', () => {
    // Even if the input casing differs, the missing piece reports the original name.
    const incomplete = findIncompleteCombos(['exquisite blood'])
    const sanguine = incomplete.find(x => x.missing === 'Sanguine Bond')
    expect(sanguine).toBeDefined()
  })

  it('handles 3-card combo with one missing piece', () => {
    const incomplete = findIncompleteCombos(['Aetherflux Reservoir', 'Sensei\'s Divining Top'])
    // Missing the third (Bolas's Citadel)
    const found = incomplete.find(x => x.combo.cards.length === 3)
    expect(found).toBeDefined()
    expect(found.missing).toBe('Bolas\'s Citadel')
  })
})

// ─── combosForCard ──────────────────────────────────────────────────────────
describe('combosForCard', () => {
  it('returns combos that include the named card', () => {
    const result = combosForCard('Sanguine Bond')
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(c =>
      c.cards.some(n => n.toLowerCase() === 'sanguine bond')
    )).toBe(true)
  })

  it('matches case-insensitively', () => {
    const lower = combosForCard('sanguine bond')
    const upper = combosForCard('SANGUINE BOND')
    expect(lower).toEqual(upper)
  })

  it('returns empty for cards not in any combo', () => {
    expect(combosForCard('Lightning Bolt')).toEqual([])
  })

  it('returns multiple combos for cards that appear in many', () => {
    // Exquisite Blood appears in 3+ combos in the registry
    const result = combosForCard('Exquisite Blood')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── getAllCombos ───────────────────────────────────────────────────────────
describe('getAllCombos', () => {
  it('returns the live combo registry', () => {
    const all = getAllCombos()
    expect(Array.isArray(all)).toBe(true)
    expect(all.length).toBeGreaterThan(0)
  })

  it('every entry has cards + description + minimumBracket', () => {
    const all = getAllCombos()
    for (const c of all) {
      expect(Array.isArray(c.cards)).toBe(true)
      // Some entries are single-card win-cons (Insurrection, Craterhoof) — that's
      // intentional, so the recommender can suggest them as missing finishers.
      expect(c.cards.length).toBeGreaterThanOrEqual(1)
      expect(typeof c.description).toBe('string')
      expect(typeof c.minimumBracket).toBe('number')
    }
  })
})

// ─── registerCombos ─────────────────────────────────────────────────────────
describe('registerCombos', () => {
  it('adds a new combo to the registry', () => {
    const before = getAllCombos().length
    registerCombos([
      { cards: ['Test Card A', 'Test Card B'], description: 'test combo', minimumBracket: 3 },
    ])
    const after = getAllCombos().length
    expect(after).toBe(before + 1)
  })

  it('detects the newly registered combo', () => {
    registerCombos([
      { cards: ['Brand New Card 1', 'Brand New Card 2'], description: 'new infinite', minimumBracket: 4 },
    ])
    const detected = detectCombos(['Brand New Card 1', 'Brand New Card 2'])
    const found = detected.find(c =>
      c.cards.includes('Brand New Card 1') && c.cards.includes('Brand New Card 2')
    )
    expect(found).toBeDefined()
  })

  it('does not double-register an existing combo (case-insensitive cards match)', () => {
    // Spellbook integration may push the same combo we already have.
    const before = getAllCombos().length
    registerCombos([
      { cards: ['EXQUISITE BLOOD', 'sanguine bond'], description: 'duplicate', minimumBracket: 4 },
    ])
    const after = getAllCombos().length
    expect(after).toBe(before)
  })

  it('skips entries with no cards array', () => {
    const before = getAllCombos().length
    registerCombos([{ description: 'invalid' }, { cards: [] }, null])
    const after = getAllCombos().length
    expect(after).toBe(before)
  })
})
