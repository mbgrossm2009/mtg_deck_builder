import { describe, it, expect } from 'vitest'
import {
  parseImportedText,
  parseCsvText,
  parseAuto,
  normalizeImportedCards,
  cleanCardName,
} from './cardImportParser'

// ─── parseImportedText (plain text / Manabox / Moxfield style) ───────────────
describe('parseImportedText', () => {
  it('parses "1 Sol Ring" format', () => {
    const result = parseImportedText('1 Sol Ring')
    expect(result).toEqual([
      expect.objectContaining({ name: 'Sol Ring', quantity: 1 }),
    ])
  })

  it('parses "1x Sol Ring" format', () => {
    const result = parseImportedText('1x Sol Ring')
    expect(result[0].name).toBe('Sol Ring')
    expect(result[0].quantity).toBe(1)
  })

  it('parses "1X Sol Ring" (uppercase X)', () => {
    const result = parseImportedText('1X Sol Ring')
    expect(result[0].name).toBe('Sol Ring')
  })

  it('parses lines without quantity prefix as quantity 1', () => {
    const result = parseImportedText('Sol Ring')
    expect(result[0]).toEqual(
      expect.objectContaining({ name: 'Sol Ring', quantity: 1 })
    )
  })

  it('handles quantities greater than 1', () => {
    const result = parseImportedText('4 Lightning Bolt')
    expect(result[0].quantity).toBe(4)
  })

  it('parses multiple lines', () => {
    const result = parseImportedText('1 Sol Ring\n1 Mana Crypt\n1 Mana Vault')
    expect(result).toHaveLength(3)
    expect(result.map(c => c.name)).toEqual(['Sol Ring', 'Mana Crypt', 'Mana Vault'])
  })

  it('handles Windows line endings', () => {
    const result = parseImportedText('1 Sol Ring\r\n1 Mana Crypt')
    expect(result).toHaveLength(2)
  })

  it('skips blank lines', () => {
    const result = parseImportedText('1 Sol Ring\n\n\n1 Mana Crypt')
    expect(result).toHaveLength(2)
  })

  it('skips section headers', () => {
    const result = parseImportedText(`Commander\n1 Atraxa, Praetors' Voice\n\nCreatures\n1 Sol Ring`)
    expect(result).toHaveLength(2)
    expect(result.map(c => c.name)).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring'])
  })

  it('skips numeric-only lines (page numbers, totals)', () => {
    const result = parseImportedText('1 Sol Ring\n100\n1 Mana Crypt')
    expect(result).toHaveLength(2)
  })

  it('strips set codes in parentheses with collector number', () => {
    const result = parseImportedText('1 Sol Ring (CMM) 400')
    expect(result[0].name).toBe('Sol Ring')
  })

  it('strips set codes in brackets', () => {
    const result = parseImportedText('1 Sol Ring [C21]')
    expect(result[0].name).toBe('Sol Ring')
  })

  it('strips foil markers like *F* and *FOIL*', () => {
    expect(parseImportedText('1 Sol Ring *F*')[0].name).toBe('Sol Ring')
    expect(parseImportedText('1 Sol Ring *FOIL*')[0].name).toBe('Sol Ring')
  })

  it('strips finish suffixes like (Foil), (Etched), (Extended Art)', () => {
    expect(parseImportedText('1 Sol Ring (Foil)')[0].name).toBe('Sol Ring')
    expect(parseImportedText('1 Sol Ring (Etched)')[0].name).toBe('Sol Ring')
    expect(parseImportedText('1 Sol Ring (Extended Art)')[0].name).toBe('Sol Ring')
  })

  it('strips TCGPlayer-style " - SET - Category" suffix', () => {
    expect(parseImportedText('1 Sol Ring - MH1 - Five Color')[0].name).toBe('Sol Ring')
  })

  it('handles cards with apostrophes in name', () => {
    expect(parseImportedText("1 Atraxa, Praetors' Voice")[0].name).toBe("Atraxa, Praetors' Voice")
  })

  it('handles cards with commas in name', () => {
    expect(parseImportedText('1 Yawgmoth, Thran Physician')[0].name).toBe('Yawgmoth, Thran Physician')
  })

  it('handles double-faced cards with // separator', () => {
    const result = parseImportedText('1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')
    expect(result[0].name).toContain('Fable')
  })

  it('deduplicates and sums quantities for same name (case-insensitive)', () => {
    const result = parseImportedText('1 Sol Ring\n2 Sol Ring\n1 sol ring')
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(4)
  })

  it('returns an empty array for empty input', () => {
    expect(parseImportedText('')).toEqual([])
  })

  it('returns an empty array for input with only blank lines', () => {
    expect(parseImportedText('\n\n\n')).toEqual([])
  })

  it('records original sourceLine on each entry for debugging', () => {
    const result = parseImportedText('1 Sol Ring (CMM) 400')
    expect(result[0].sourceLine).toBe('1 Sol Ring (CMM) 400')
  })
})

// ─── parseCsvText ────────────────────────────────────────────────────────────
describe('parseCsvText', () => {
  it('parses CSV with name + quantity headers', () => {
    const csv = 'Name,Quantity\nSol Ring,1\nMana Crypt,1'
    const result = parseCsvText(csv)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({ name: 'Sol Ring', quantity: 1 })
    )
  })

  it('handles header alias "Card Name"', () => {
    const csv = 'Card Name,Count\nSol Ring,2'
    const result = parseCsvText(csv)
    expect(result[0].name).toBe('Sol Ring')
    expect(result[0].quantity).toBe(2)
  })

  it('handles header alias "qty"', () => {
    const csv = 'cardname,qty\nSol Ring,3'
    const result = parseCsvText(csv)
    expect(result[0].quantity).toBe(3)
  })

  it('handles quoted values', () => {
    const csv = 'Name,Quantity\n"Sol Ring",1\n"Atraxa, Praetors\' Voice",1'
    const result = parseCsvText(csv)
    expect(result.map(c => c.name)).toEqual(['Sol Ring', "Atraxa, Praetors' Voice"])
  })

  it('parses positional CSV without headers (qty, name)', () => {
    const csv = '1,Sol Ring\n2,Lightning Bolt'
    const result = parseCsvText(csv)
    expect(result[0]).toEqual(
      expect.objectContaining({ name: 'Sol Ring', quantity: 1 })
    )
    expect(result[1].quantity).toBe(2)
  })

  it('parses positional CSV without headers (name, qty)', () => {
    const csv = 'Sol Ring,1\nMana Crypt,1'
    const result = parseCsvText(csv)
    expect(result.map(c => c.name)).toEqual(['Sol Ring', 'Mana Crypt'])
  })

  it('handles single-column CSV (name only)', () => {
    const csv = 'Sol Ring\nMana Crypt'
    const result = parseCsvText(csv)
    expect(result.map(c => c.name)).toEqual(['Sol Ring', 'Mana Crypt'])
    expect(result[0].quantity).toBe(1)
  })

  it('skips fully blank rows', () => {
    const csv = 'Name,Quantity\nSol Ring,1\n,\nMana Crypt,1'
    const result = parseCsvText(csv)
    expect(result).toHaveLength(2)
  })

  it('defaults invalid quantity to 1 with a warning', () => {
    const csv = 'Name,Quantity\nSol Ring,abc'
    const result = parseCsvText(csv)
    expect(result[0].quantity).toBe(1)
  })

  it('returns an empty array for empty input', () => {
    expect(parseCsvText('')).toEqual([])
  })

  it('strips set codes from name in CSV rows', () => {
    const csv = 'Name,Qty\nSol Ring (CMM) 400,1'
    const result = parseCsvText(csv)
    expect(result[0].name).toBe('Sol Ring')
  })

  it('deduplicates by name', () => {
    const csv = 'Name,Quantity\nSol Ring,1\nsol ring,2'
    const result = parseCsvText(csv)
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(3)
  })
})

// ─── parseAuto ───────────────────────────────────────────────────────────────
describe('parseAuto', () => {
  it('routes to CSV parser when first line has CSV-style headers', () => {
    const csv = 'Name,Quantity\nSol Ring,1'
    const result = parseAuto(csv)
    expect(result[0].name).toBe('Sol Ring')
  })

  it('routes to text parser for plain "1 Sol Ring" format', () => {
    const text = '1 Sol Ring\n1 Mana Crypt'
    const result = parseAuto(text)
    expect(result).toHaveLength(2)
  })

  it('routes to text parser for raw card names with no commas', () => {
    const result = parseAuto('Sol Ring\nMana Crypt')
    expect(result).toHaveLength(2)
  })

  it('handles empty input gracefully', () => {
    expect(parseAuto('')).toEqual([])
  })

  it('detects CSV with "Card Name" header alias', () => {
    const csv = 'Card Name,Count\nSol Ring,1'
    const result = parseAuto(csv)
    expect(result[0].name).toBe('Sol Ring')
  })
})

// ─── normalizeImportedCards ──────────────────────────────────────────────────
describe('normalizeImportedCards', () => {
  it('removes entries with empty name', () => {
    const result = normalizeImportedCards([
      { name: 'Sol Ring', quantity: 1 },
      { name: '', quantity: 1 },
    ])
    expect(result).toHaveLength(1)
  })

  it('removes entries with quantity less than 1', () => {
    const result = normalizeImportedCards([
      { name: 'Sol Ring', quantity: 1 },
      { name: 'Junk', quantity: 0 },
      { name: 'More junk', quantity: -3 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Sol Ring')
  })

  it('preserves valid entries unchanged', () => {
    const cards = [
      { name: 'Sol Ring', quantity: 1, warnings: [] },
      { name: 'Mana Crypt', quantity: 1, warnings: [] },
    ]
    expect(normalizeImportedCards(cards)).toEqual(cards)
  })

  it('returns empty array for empty input', () => {
    expect(normalizeImportedCards([])).toEqual([])
  })
})

// ─── cleanCardName ───────────────────────────────────────────────────────────
describe('cleanCardName', () => {
  it('strips set code in parentheses with collector number', () => {
    expect(cleanCardName('Sol Ring (CMM) 400')).toBe('Sol Ring')
  })

  it('strips foil markers', () => {
    expect(cleanCardName('Sol Ring *F*')).toBe('Sol Ring')
  })

  it('strips treatment suffix', () => {
    expect(cleanCardName('Sol Ring (Foil)')).toBe('Sol Ring')
    expect(cleanCardName('Sol Ring (Extended Art)')).toBe('Sol Ring')
  })

  it('returns clean name unchanged', () => {
    expect(cleanCardName('Sol Ring')).toBe('Sol Ring')
  })

  it('strips glued-on edition codes (e.g. VizzerdrixS5 → Vizzerdrix)', () => {
    // The de-glue rule strips trailing [a-z][A-Z][0-9]+
    expect(cleanCardName('VizzerdrixS5')).toBe('Vizzerdrix')
  })

  it('does not de-glue if result would be too short to be a real name', () => {
    // If de-gluing would leave 3 or fewer chars, fall back to the un-deglued name
    expect(cleanCardName('FooT9')).toBe('FooT9')
  })

  it('handles names with apostrophes', () => {
    expect(cleanCardName("Atraxa, Praetors' Voice (CMM)")).toBe("Atraxa, Praetors' Voice")
  })
})
