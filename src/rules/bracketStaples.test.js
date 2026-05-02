import { describe, it, expect } from 'vitest'
import { buildBracketStaples, getBracketStapleNames, getStapleCoverage } from './bracketStaples'

const card = (name, extra = {}) => ({
  name,
  type_line: extra.type_line ?? 'Artifact',
  oracle_text: extra.oracle_text ?? '',
  color_identity: extra.color_identity ?? [],
  roles: extra.roles ?? ['ramp'],
  tags: extra.tags ?? [],
  legalities: { commander: 'legal' },
  ...extra,
})

describe('getBracketStapleNames — universal staples', () => {
  it('returns universal staples at every bracket (Sol Ring goes in every deck)', () => {
    for (const bracket of [1, 2, 3, 4, 5]) {
      const names = getBracketStapleNames(bracket)
      expect(names).toContain('Sol Ring')
      expect(names).toContain('Lightning Greaves')
      expect(names).toContain('Cultivate')
    }
  })

  it('B1 returns ONLY universal staples (no fast mana / cEDH staples)', () => {
    const names = getBracketStapleNames(1)
    expect(names).toContain('Sol Ring')               // universal
    expect(names).not.toContain('Mana Crypt')         // B4+
    expect(names).not.toContain("Thassa's Oracle")    // B5-only
    expect(names).not.toContain('Demonic Tutor')      // B4+ tutor
  })

  it('B3 returns universal staples but no fast mana / cEDH tutors', () => {
    const names = getBracketStapleNames(3)
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Path to Exile')
    expect(names).not.toContain('Mana Crypt')
    expect(names).not.toContain('Force of Will')
  })

  it('B4 adds the B4+ tier on top of universal', () => {
    const names = getBracketStapleNames(4)
    expect(names).toContain('Sol Ring')               // universal
    expect(names).toContain('Mana Crypt')             // B4+
    expect(names).toContain('Force of Will')          // B4+
    expect(names).toContain('Demonic Tutor')          // B4+
    expect(names).not.toContain("Thassa's Oracle")    // B5-only
  })

  it('B5 adds B4+ AND B5 extras on top of universal', () => {
    const names = getBracketStapleNames(5)
    expect(names).toContain('Sol Ring')                  // universal
    expect(names).toContain('Mana Crypt')                // B4+
    expect(names).toContain("Thassa's Oracle")           // B5-only
    expect(names).toContain('Demonic Consultation')      // B5-only
  })

  it('staple count grows monotonically with bracket', () => {
    const counts = [1, 2, 3, 4, 5].map(b => getBracketStapleNames(b).length)
    expect(counts[0]).toBe(counts[1])    // B1 == B2
    expect(counts[1]).toBe(counts[2])    // B2 == B3
    expect(counts[2]).toBeLessThan(counts[3])    // B3 < B4
    expect(counts[3]).toBeLessThan(counts[4])    // B4 < B5
  })
})

describe('buildBracketStaples', () => {
  it('returns universal staples even at B1 if user owns them', () => {
    const result = buildBracketStaples({
      bracket: 1,
      legalNonLands: [card('Sol Ring'), card('Lightning Greaves'), card('Cultivate')],
    })
    const names = result.map(c => c.name).sort()
    expect(names).toEqual(['Cultivate', 'Lightning Greaves', 'Sol Ring'])
  })

  it('returns universal staples at B3 (Sol Ring locks but Mana Crypt does not)', () => {
    const result = buildBracketStaples({
      bracket: 3,
      legalNonLands: [card('Sol Ring'), card('Mana Crypt'), card('Cultivate')],
    })
    const names = result.map(c => c.name).sort()
    // Sol Ring + Cultivate = universal, Mana Crypt is B4+ only
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Cultivate')
    expect(names).not.toContain('Mana Crypt')
  })

  it('returns owned cEDH staples at B4+', () => {
    const result = buildBracketStaples({
      bracket: 4,
      legalNonLands: [
        card('Mana Crypt'),
        card('Demonic Tutor'),
        card('Some Random Card'),     // not a staple
      ],
    })
    const names = result.map(c => c.name).sort()
    expect(names).toEqual(['Demonic Tutor', 'Mana Crypt'])
    // Each staple is annotated
    expect(result[0].fromBracketStaples).toBe(true)
  })

  it('skips staples not in the legal pool (user does not own them)', () => {
    const result = buildBracketStaples({
      bracket: 5,
      legalNonLands: [card('Sol Ring')],   // user owns Sol Ring but not Mana Crypt
    })
    const names = result.map(c => c.name)
    expect(names).toEqual(['Sol Ring'])
    expect(names).not.toContain('Mana Crypt')
  })

  it('skips staples already covered by the skeleton (no double-lock)', () => {
    const result = buildBracketStaples({
      bracket: 5,
      legalNonLands: [card('Sol Ring'), card('Mana Crypt')],
      alreadyLockedNames: new Set(['sol ring']),   // Sol Ring already in skeleton
    })
    const names = result.map(c => c.name)
    expect(names).not.toContain('Sol Ring')
    expect(names).toContain('Mana Crypt')
  })

  it('returns more staples at B5 than B4 (when user owns the B5-only ones)', () => {
    const pool = [
      card('Mana Crypt'),
      card('Demonic Tutor'),
      card("Thassa's Oracle"),
      card('Demonic Consultation'),
    ]
    const b4 = buildBracketStaples({ bracket: 4, legalNonLands: pool })
    const b5 = buildBracketStaples({ bracket: 5, legalNonLands: pool })
    expect(b5.length).toBeGreaterThan(b4.length)
    expect(b5.map(c => c.name)).toContain("Thassa's Oracle")
    expect(b4.map(c => c.name)).not.toContain("Thassa's Oracle")
  })

  it('case-insensitive name match', () => {
    const result = buildBracketStaples({
      bracket: 4,
      legalNonLands: [card('mana crypt'), card('DEMONIC TUTOR')],
    })
    const names = result.map(c => c.name).sort()
    expect(names).toContain('mana crypt')
    expect(names).toContain('DEMONIC TUTOR')
  })
})

describe('getStapleCoverage', () => {
  it('reports 0/N when collection has none of the staples', () => {
    const cov = getStapleCoverage({
      bracket: 5,
      collectionNames: ['Forest', 'Mountain', 'Random Card'],
    })
    expect(cov.owned).toBe(0)
    expect(cov.total).toBeGreaterThan(20)
    expect(cov.missing.length).toBe(cov.total)
  })

  it('reports the right counts when the collection has some staples', () => {
    const cov = getStapleCoverage({
      bracket: 4,
      collectionNames: ['Sol Ring', 'Mana Crypt', 'Demonic Tutor', 'Random Card'],
    })
    expect(cov.owned).toBe(3)
    expect(cov.ownedNames.sort()).toEqual(['Demonic Tutor', 'Mana Crypt', 'Sol Ring'])
    expect(cov.missing).toContain('Force of Will')   // user doesn't have it
  })

  it('case-insensitive', () => {
    const cov = getStapleCoverage({
      bracket: 5,
      collectionNames: ['sol ring', 'MANA CRYPT'],
    })
    expect(cov.owned).toBe(2)
  })

  it('returns total: 0 at brackets with no staples', () => {
    // After universal staples were added at every bracket, every bracket has
    // staples. But the function should still gracefully handle an empty list
    // if one ever exists.
    const cov = getStapleCoverage({ bracket: 5, collectionNames: [] })
    expect(cov.total).toBeGreaterThan(0)
    expect(cov.owned).toBe(0)
  })
})
