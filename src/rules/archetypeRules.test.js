import { describe, it, expect } from 'vitest'
import {
  detectArchetypes,
  scoreArchetypeFit,
  cardMatchesArchetype,
  isCompetingArchetypeAnchor,
  themesToArchetypes,
  mergeArchetypes,
  anchorNamesFor,
} from './archetypeRules'

// ─── detectArchetypes ───────────────────────────────────────────────────────
describe('detectArchetypes', () => {
  it('returns [] for null commander', () => {
    expect(detectArchetypes(null)).toEqual([])
    expect(detectArchetypes(undefined)).toEqual([])
  })

  it('detects token archetype from commander text', () => {
    const commander = {
      name: 'Rhys the Redeemed',
      type_line: 'Legendary Creature — Elf Warrior',
      oracle_text: '{T}: Create a 1/1 green Elf Warrior creature token.',
    }
    const result = detectArchetypes(commander)
    expect(result.some(a => a.id === 'tokens')).toBe(true)
  })

  it('detects +1/+1 counters archetype', () => {
    const commander = {
      name: 'Marwyn, the Nurturer',
      type_line: 'Legendary Creature — Elf Druid',
      oracle_text: 'Whenever another Elf enters under your control, put a +1/+1 counter on Marwyn.',
    }
    const result = detectArchetypes(commander)
    expect(result.some(a => a.id === 'plus_one_counters')).toBe(true)
  })

  it('detects tribal archetype when commander text mentions own subtype', () => {
    const commander = {
      name: 'Sliver Overlord',
      type_line: 'Legendary Creature — Sliver Mutant',
      oracle_text: 'All Slivers have changeling. {3}: Search your library for a Sliver card.',
    }
    const result = detectArchetypes(commander)
    expect(result.some(a => a.id === 'tribal_sliver')).toBe(true)
  })

  it('does NOT detect tribal when commander oracle text does not mention its own subtype', () => {
    // Almost every legendary creature has a Human subtype but isn't tribal Human
    const commander = {
      name: 'Generic Human Commander',
      type_line: 'Legendary Creature — Human Wizard',
      oracle_text: 'Other creatures you control get +1/+1.',
    }
    const result = detectArchetypes(commander)
    expect(result.some(a => a.id === 'tribal_human')).toBe(false)
  })

  it('caps results at top 4 by strength', () => {
    // Engineered to match many archetypes
    const commander = {
      name: 'Generic All-Theme Commander',
      type_line: 'Legendary Creature — God',
      oracle_text:
        'Create a treasure token. Whenever you gain life, draw a card. Put a +1/+1 counter on each creature. Sacrifice a creature: each opponent loses life. Equipment you control. Reanimate target creature.',
    }
    const result = detectArchetypes(commander)
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('sorts results by strength descending', () => {
    const commander = {
      name: 'Atraxa, Praetors\' Voice',
      type_line: 'Legendary Creature — Phyrexian Angel Horror',
      // Heavy on +1/+1 + proliferate signals
      oracle_text: 'At the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    }
    const result = detectArchetypes(commander)
    if (result.length > 1) {
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].strength).toBeGreaterThanOrEqual(result[i + 1].strength)
      }
    }
  })

  it('emits each archetype once even if multiple hints match', () => {
    const commander = {
      name: 'Token Spam Commander',
      type_line: 'Legendary Creature',
      // Multiple regex hints all hit, but the result should still have one tokens entry
      oracle_text: 'Create a 1/1 token. Populate. Tokens you control get +1/+1.',
    }
    const result = detectArchetypes(commander)
    const tokensEntries = result.filter(a => a.id === 'tokens')
    expect(tokensEntries).toHaveLength(1)
  })
})

// ─── cardMatchesArchetype ───────────────────────────────────────────────────
describe('cardMatchesArchetype', () => {
  it('returns true for an anchor card of a non-tribal archetype', () => {
    const result = cardMatchesArchetype(
      { name: 'Doubling Season', oracle_text: '', type_line: 'Enchantment' },
      { id: 'tokens', strength: 2 }
    )
    expect(result).toBe(true)
  })

  it('returns true when card oracle text matches an archetype signal', () => {
    const result = cardMatchesArchetype(
      { name: 'Anointed Procession', oracle_text: 'create one or more tokens', type_line: 'Enchantment' },
      { id: 'tokens', strength: 2 }
    )
    expect(result).toBe(true)
  })

  it('returns false when card has no signal match and is not an anchor', () => {
    const result = cardMatchesArchetype(
      { name: 'Lightning Bolt', oracle_text: 'deal 3 damage', type_line: 'Instant' },
      { id: 'tokens', strength: 2 }
    )
    expect(result).toBe(false)
  })

  it('returns true for tribal match by type line', () => {
    const result = cardMatchesArchetype(
      { name: 'Llanowar Elves', oracle_text: '{T}: add {G}.', type_line: 'Creature — Elf Druid' },
      { id: 'tribal_elf', tribe: 'elf' }
    )
    expect(result).toBe(true)
  })

  it('returns true for tribal match in oracle text (Sliver Hivelord)', () => {
    const result = cardMatchesArchetype(
      { name: 'Sliver Hivelord', oracle_text: 'sliver creatures you control have indestructible', type_line: 'Creature' },
      { id: 'tribal_sliver', tribe: 'sliver' }
    )
    expect(result).toBe(true)
  })

  it('returns false for unknown archetype id', () => {
    const result = cardMatchesArchetype(
      { name: 'Anything' },
      { id: 'made_up_archetype', strength: 2 }
    )
    expect(result).toBe(false)
  })

  it('returns false for null archetype reference', () => {
    expect(cardMatchesArchetype({ name: 'X' }, null)).toBe(false)
    expect(cardMatchesArchetype({ name: 'X' }, undefined)).toBe(false)
  })
})

// ─── scoreArchetypeFit ──────────────────────────────────────────────────────
describe('scoreArchetypeFit', () => {
  it('returns 0 for empty/missing archetypes', () => {
    expect(scoreArchetypeFit({ name: 'X' }, [])).toBe(0)
    expect(scoreArchetypeFit({ name: 'X' }, null)).toBe(0)
  })

  it('returns 0 for cards that match nothing', () => {
    const score = scoreArchetypeFit(
      { name: 'Lightning Bolt', oracle_text: 'deal 3 damage', type_line: 'Instant' },
      [{ id: 'tokens', strength: 2 }]
    )
    expect(score).toBe(0)
  })

  it('gives 50 for an anchor card (no primary lock)', () => {
    const score = scoreArchetypeFit(
      { name: 'Doubling Season', oracle_text: '', type_line: 'Enchantment' },
      [{ id: 'tokens', strength: 2 }]
    )
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('gives 75 for an anchor card when primary IS locked (amplified)', () => {
    const score = scoreArchetypeFit(
      { name: 'Doubling Season', oracle_text: '', type_line: 'Enchantment' },
      [{ id: 'tokens', strength: 2 }],
      'tokens'
    )
    expect(score).toBeGreaterThanOrEqual(75)
  })

  it('zeroes out non-primary archetypes when a primary is locked', () => {
    const card = { name: 'Soul Warden', oracle_text: 'whenever a creature enters, you gain 1 life.', type_line: 'Creature' }
    // Soul Warden hits lifegain signals but tokens=primary should mean only tokens contributes
    const archetypes = [
      { id: 'tokens', strength: 2 },
      { id: 'lifegain', strength: 2 },
    ]
    const lockedToTokens = scoreArchetypeFit(card, archetypes, 'tokens')
    // Without primary lock, lifegain would contribute. With primary=tokens, lifegain is zeroed.
    const noLock = scoreArchetypeFit(card, archetypes)
    expect(noLock).toBeGreaterThan(lockedToTokens)
  })

  it('scales by archetype strength for signal-only matches', () => {
    const card = { name: 'Anointed Procession', oracle_text: 'create one or more tokens', type_line: 'Enchantment' }
    const weak = scoreArchetypeFit(card, [{ id: 'tokens', strength: 1 }])
    const strong = scoreArchetypeFit(card, [{ id: 'tokens', strength: 3 }])
    expect(strong).toBeGreaterThan(weak)
  })

  it('handles tribal-by-typeline (strong match: 12 per tribe)', () => {
    const elf = { name: 'Llanowar Elves', oracle_text: '', type_line: 'Creature — Elf Druid' }
    const score = scoreArchetypeFit(elf, [{ id: 'tribal_elf', tribe: 'elf', strength: 2 }])
    expect(score).toBe(12)
  })

  it('handles tribal-by-text (weaker match: 6 per tribe)', () => {
    const card = { name: 'Lord of Atlantis', oracle_text: 'merfolk creatures you control', type_line: 'Creature — Merfolk' }
    // Type-line match takes precedence (12), so test a card that only matches in text
    const cardTextOnly = { name: 'Coat of Arms', oracle_text: 'each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it. (sliver counts here.)', type_line: 'Artifact' }
    const score = scoreArchetypeFit(cardTextOnly, [{ id: 'tribal_sliver', tribe: 'sliver', strength: 2 }])
    expect(score).toBe(6)
  })
})

// ─── isCompetingArchetypeAnchor ─────────────────────────────────────────────
describe('isCompetingArchetypeAnchor', () => {
  it('returns true when card is an anchor of a non-primary archetype', () => {
    // Vito is a lifegain anchor. If the deck's primary is tokens, Vito competes.
    const result = isCompetingArchetypeAnchor(
      { name: 'Vito, Thorn of the Dusk Rose' },
      'tokens',
      [{ id: 'tokens', strength: 2 }, { id: 'lifegain', strength: 2 }]
    )
    expect(result).toBe(true)
  })

  it('returns false when card is an anchor of the primary archetype', () => {
    const result = isCompetingArchetypeAnchor(
      { name: 'Doubling Season' },
      'tokens',
      [{ id: 'tokens', strength: 2 }, { id: 'lifegain', strength: 2 }]
    )
    expect(result).toBe(false)
  })

  it('returns false when no primary is locked', () => {
    expect(isCompetingArchetypeAnchor(
      { name: 'Vito, Thorn of the Dusk Rose' },
      null,
      [{ id: 'lifegain', strength: 2 }]
    )).toBe(false)
  })

  it('returns false for cards that are not anchors at all', () => {
    expect(isCompetingArchetypeAnchor(
      { name: 'Lightning Bolt' },
      'tokens',
      [{ id: 'tokens', strength: 2 }, { id: 'lifegain', strength: 2 }]
    )).toBe(false)
  })

  it('skips tribal archetypes (they don\'t have anchors)', () => {
    expect(isCompetingArchetypeAnchor(
      { name: 'Lightning Bolt' },
      'tokens',
      [{ id: 'tokens', strength: 2 }, { id: 'tribal_elf', tribe: 'elf', strength: 2 }]
    )).toBe(false)
  })
})

// ─── themesToArchetypes (EDHREC theme mapper) ───────────────────────────────
describe('themesToArchetypes', () => {
  it('returns [] for empty input', () => {
    expect(themesToArchetypes([])).toEqual([])
    expect(themesToArchetypes(null)).toEqual([])
  })

  it('maps "Tokens" theme to tokens archetype', () => {
    const result = themesToArchetypes(['Tokens'])
    expect(result.some(a => a.id === 'tokens')).toBe(true)
  })

  it('maps "+1/+1 Counters" theme to plus_one_counters', () => {
    const result = themesToArchetypes(['+1/+1 Counters'])
    expect(result.some(a => a.id === 'plus_one_counters')).toBe(true)
  })

  it('maps "Counters Matter" to plus_one_counters', () => {
    const result = themesToArchetypes(['Counters Matter'])
    expect(result.some(a => a.id === 'plus_one_counters')).toBe(true)
  })

  it('maps "Lifegain" to lifegain', () => {
    expect(themesToArchetypes(['Lifegain'])[0].id).toBe('lifegain')
  })

  it('maps "Aristocrats" to aristocrats', () => {
    expect(themesToArchetypes(['Aristocrats'])[0].id).toBe('aristocrats')
  })

  it('always returns strength 3 for matched themes', () => {
    const result = themesToArchetypes(['Tokens'])
    expect(result[0].strength).toBe(3)
  })

  it('deduplicates if multiple themes map to the same archetype', () => {
    const result = themesToArchetypes(['Tokens', 'tokens', 'Token Production'])
    // All three match the tokens regex, but result should have one entry
    const tokenEntries = result.filter(a => a.id === 'tokens')
    expect(tokenEntries).toHaveLength(1)
  })

  it('handles unknown themes gracefully', () => {
    expect(themesToArchetypes(['Some Made Up Theme'])).toEqual([])
  })
})

// ─── mergeArchetypes ────────────────────────────────────────────────────────
describe('mergeArchetypes', () => {
  it('merges two non-overlapping lists', () => {
    const result = mergeArchetypes(
      [{ id: 'tokens', strength: 2 }],
      [{ id: 'lifegain', strength: 3 }]
    )
    expect(result).toHaveLength(2)
    // EDHREC-tier (3) ranks before regex-tier (2)
    expect(result[0].id).toBe('lifegain')
  })

  it('keeps the higher strength when an id appears in both lists', () => {
    const result = mergeArchetypes(
      [{ id: 'tokens', strength: 1 }],
      [{ id: 'tokens', strength: 3 }]
    )
    expect(result).toHaveLength(1)
    expect(result[0].strength).toBe(3)
  })

  it('caps result at 5 archetypes', () => {
    const inputs = Array(10).fill(null).map((_, i) => ({ id: `id_${i}`, strength: i }))
    const result = mergeArchetypes(inputs, [])
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('passes tribal archetypes through unchanged', () => {
    const result = mergeArchetypes(
      [{ id: 'tribal_elf', tribe: 'elf', strength: 2 }],
      []
    )
    expect(result[0].tribe).toBe('elf')
  })

  it('returns sorted by strength descending', () => {
    const result = mergeArchetypes(
      [{ id: 'a', strength: 1 }, { id: 'b', strength: 3 }, { id: 'c', strength: 2 }],
      []
    )
    expect(result.map(a => a.id)).toEqual(['b', 'c', 'a'])
  })
})

// ─── anchorNamesFor ─────────────────────────────────────────────────────────
describe('anchorNamesFor', () => {
  it('returns empty Set for empty input', () => {
    const result = anchorNamesFor([])
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it('returns empty Set for null input', () => {
    const result = anchorNamesFor(null)
    expect(result.size).toBe(0)
  })

  it('returns anchor names for a single archetype', () => {
    const result = anchorNamesFor([{ id: 'tokens', strength: 2 }])
    expect(result.has('Doubling Season')).toBe(true)
    expect(result.has('Parallel Lives')).toBe(true)
  })

  it('combines anchors across multiple archetypes', () => {
    const result = anchorNamesFor([
      { id: 'tokens', strength: 2 },
      { id: 'lifegain', strength: 2 },
    ])
    expect(result.has('Doubling Season')).toBe(true)        // tokens anchor
    expect(result.has('Aetherflux Reservoir')).toBe(true)   // lifegain anchor
  })

  it('skips tribal archetypes (they have no anchors list)', () => {
    const result = anchorNamesFor([
      { id: 'tribal_elf', tribe: 'elf', strength: 2 },
    ])
    // No anchors, but no error either
    expect(result.size).toBe(0)
  })

  it('handles unknown archetype ids gracefully', () => {
    const result = anchorNamesFor([{ id: 'made_up_id', strength: 2 }])
    expect(result.size).toBe(0)
  })
})
