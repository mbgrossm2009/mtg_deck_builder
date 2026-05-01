// End-to-end integration tests for the heuristic deck generator.
//
// Strategy:
//   - Mock the two network-dependent imports (edhrec + spellbook) so tests
//     don't hit real APIs and aren't flaky.
//   - Populate dataStore directly with a synthetic 160-card collection +
//     commander so getCollection() / getSelectedCommander() return our fixtures.
//   - Run generateDeck() and assert on the output's shape and slot counts.
//
// Tolerances are loose because the generator is deterministic but slot fill
// depends on what's available in the collection. We assert on "reasonable"
// counts, not exact targets.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock network dependencies BEFORE importing the generator ────────────────
vi.mock('../utils/edhrecApi', () => ({
  fetchEdhrecCommander: vi.fn(async () => ({ topCards: [], themes: [] })),
  commanderSlug: vi.fn(name => name.toLowerCase().replace(/\s/g, '-')),
}))

vi.mock('../utils/commanderSpellbook', () => ({
  fetchSpellbookCombos: vi.fn(async () => []),
}))

import { generateDeck } from './deckGenerator'
import * as dataStore from '../lib/dataStore'

// ─── Synthetic test collection ───────────────────────────────────────────────
// Enough cards in each role to satisfy any bracket's targets. Oracle text is
// crafted to trigger the regex classifiers in cardRoles.js.
function makeTestCollection() {
  const cards = []
  let id = 0

  // 35 basic Forests (lands always pass color identity)
  for (let i = 0; i < 35; i++) {
    cards.push({
      id: `forest_${i}`,
      name: `Forest`,  // same name OK — basics are exempt from singleton
      type_line: 'Basic Land — Forest',
      oracle_text: '',
      cmc: 0,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      isBasicLand: true,
      rarity: 'common',
    })
  }

  // 6 utility lands (non-basic, distinct names)
  for (let i = 0; i < 6; i++) {
    cards.push({
      id: `utility_land_${i}`,
      name: `Utility Land ${i}`,
      type_line: 'Land',
      oracle_text: '{T}: Add one mana of any color.',
      cmc: 0,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      isBasicLand: false,
      rarity: 'rare',
    })
  }

  // 18 ramp pieces (regex tag: 'add {g}')
  for (let i = 0; i < 18; i++) {
    cards.push({
      id: `ramp_${++id}`,
      name: `Ramp Card ${i}`,
      type_line: i < 8 ? 'Creature — Elf' : 'Sorcery',
      oracle_text: i < 8 ? '{T}: Add {G}.' : 'Search your library for a basic land card and put it onto the battlefield.',
      cmc: 2,
      color_identity: i < 8 ? ['G'] : [],
      colors: i < 8 ? ['G'] : [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  // 15 draw cards
  for (let i = 0; i < 15; i++) {
    cards.push({
      id: `draw_${++id}`,
      name: `Draw Card ${i}`,
      type_line: 'Sorcery',
      oracle_text: 'Draw two cards.',
      cmc: 3,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  // 12 removal spells
  for (let i = 0; i < 12; i++) {
    cards.push({
      id: `removal_${++id}`,
      name: `Removal Card ${i}`,
      type_line: 'Instant',
      oracle_text: 'Destroy target permanent.',
      cmc: 3,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  // 6 board wipes
  for (let i = 0; i < 6; i++) {
    cards.push({
      id: `wipe_${++id}`,
      name: `Wipe Card ${i}`,
      type_line: 'Sorcery',
      oracle_text: 'Destroy all creatures.',
      cmc: 4,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  // 8 protection
  for (let i = 0; i < 8; i++) {
    cards.push({
      id: `prot_${++id}`,
      name: `Protection Card ${i}`,
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have hexproof.',
      cmc: 3,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  // 5 win conditions (use real names from the WIN_CONDITIONS list to make sure
  // they get classified — since they're hardcoded, oracle text doesn't need to match)
  const realWinconNames = ['Aetherflux Reservoir', 'Insurrection', 'Approach of the Second Sun',
                           'Mayael\'s Aria', 'Felidar Sovereign']
  for (const name of realWinconNames) {
    cards.push({
      id: `wincon_${name}`,
      name,
      type_line: 'Sorcery',
      oracle_text: 'Some win-related text.',
      cmc: 4,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'mythic',
    })
  }

  // 30 synergy / filler — generic creatures
  for (let i = 0; i < 30; i++) {
    cards.push({
      id: `gen_${++id}`,
      name: `Generic Card ${i}`,
      type_line: 'Creature — Beast',
      oracle_text: 'When this creature enters the battlefield, look at the top card of your library.',
      cmc: 3,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    })
  }

  return cards
}

const TEST_COMMANDER = {
  id: 'cmdr_001',
  name: 'Test Commander',
  type_line: 'Legendary Creature — Human Druid',
  oracle_text: 'When this creature enters, draw a card.',
  cmc: 3,
  color_identity: ['G'],
  colors: ['G'],
  legalities: { commander: 'legal' },
}

beforeEach(() => {
  // Hydrate dataStore with our synthetic collection. The generator's calls to
  // getCollection() / getSelectedCommander() (in localStorage.js) will read
  // from dataStore, so they get our test fixtures.
  dataStore.setState({
    userId:     'test-user',
    commander:  TEST_COMMANDER,
    collection: makeTestCollection(),
    decks:      [],
    ready:      true,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SHAPE + INVARIANTS
// ═════════════════════════════════════════════════════════════════════════════
describe('generateDeck — shape and invariants', () => {
  it('produces a result object with the expected fields', async () => {
    const result = await generateDeck(3, null)
    expect(result).toHaveProperty('commander')
    expect(result).toHaveProperty('mainDeck')
    expect(result).toHaveProperty('stats')
    expect(result).toHaveProperty('bracketAnalysis')
    expect(Array.isArray(result.mainDeck)).toBe(true)
  })

  it('produces exactly 99 cards in mainDeck (any bracket)', async () => {
    for (const b of [1, 2, 3, 4, 5]) {
      const result = await generateDeck(b, null)
      expect(result.mainDeck).toHaveLength(99)
    }
  })

  it('does not include the commander in mainDeck', async () => {
    const result = await generateDeck(3, null)
    const names = result.mainDeck.map(c => c.name.toLowerCase())
    expect(names).not.toContain(TEST_COMMANDER.name.toLowerCase())
  })

  it('returns an error object when no commander is selected', async () => {
    dataStore.setState({ ...dataStore.getState(), commander: null })
    const result = await generateDeck(3, null)
    expect(result.error).toBeDefined()
  })

  it('returns an error when collection is empty', async () => {
    dataStore.setState({ ...dataStore.getState(), collection: [] })
    const result = await generateDeck(3, null)
    expect(result.error).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SLOT ALLOCATION (TOLERANCE-BASED)
// ═════════════════════════════════════════════════════════════════════════════
describe('generateDeck — slot allocation matches bracket targets (within tolerance)', () => {
  it('bracket 1 fills ~38 lands (within ±3)', async () => {
    const result = await generateDeck(1, null)
    expect(result.stats.landCount).toBeGreaterThanOrEqual(35)
    expect(result.stats.landCount).toBeLessThanOrEqual(41)
  })

  it('bracket 5 fills ~28 lands (within ±3)', async () => {
    const result = await generateDeck(5, null)
    expect(result.stats.landCount).toBeGreaterThanOrEqual(25)
    expect(result.stats.landCount).toBeLessThanOrEqual(31)
  })

  it('bracket 5 has more ramp than bracket 1 (cEDH = 18, casual = 10)', async () => {
    const b1 = await generateDeck(1, null)
    const b5 = await generateDeck(5, null)
    expect(b5.stats.roleCounts.ramp).toBeGreaterThan(b1.stats.roleCounts.ramp)
  })

  it('bracket 1 has 0 tutor cards (eligibility blocks them)', async () => {
    // Add a fake tutor to the collection
    const collection = [...makeTestCollection(), {
      id: 'fake_tutor',
      name: 'Demonic Tutor',
      type_line: 'Sorcery',
      oracle_text: 'Search your library for a card and put that card into your hand.',
      cmc: 2,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'rare',
    }]
    dataStore.setState({ ...dataStore.getState(), collection })

    const result = await generateDeck(1, null)
    const names = result.mainDeck.map(c => c.name)
    expect(names).not.toContain('Demonic Tutor')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY ENFORCEMENT (END-TO-END)
// ═════════════════════════════════════════════════════════════════════════════
describe('generateDeck — eligibility filter is enforced end-to-end', () => {
  it('Mana Crypt is excluded at bracket 1', async () => {
    const collection = [...makeTestCollection(), {
      id: 'mana_crypt',
      name: 'Mana Crypt',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      cmc: 0,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'mythic',
    }]
    dataStore.setState({ ...dataStore.getState(), collection })

    const b1 = await generateDeck(1, null)
    const b5 = await generateDeck(5, null)

    expect(b1.mainDeck.map(c => c.name)).not.toContain('Mana Crypt')
    expect(b5.mainDeck.map(c => c.name)).toContain('Mana Crypt')
  })

  it('Mana Crypt is excluded at bracket 3 (elite fast mana, B4+ only)', async () => {
    const collection = [...makeTestCollection(), {
      id: 'mana_crypt',
      name: 'Mana Crypt',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      cmc: 0,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'mythic',
    }]
    dataStore.setState({ ...dataStore.getState(), collection })

    const b3 = await generateDeck(3, null)
    const b4 = await generateDeck(4, null)

    expect(b3.mainDeck.map(c => c.name)).not.toContain('Mana Crypt')
    expect(b4.mainDeck.map(c => c.name)).toContain('Mana Crypt')
  })

  it('Sol Ring is bracket-blocked at B1 but only "not selected" (or picked) at B2+', async () => {
    const collection = [...makeTestCollection(), {
      id: 'sol_ring',
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      cmc: 1,
      color_identity: [],
      colors: [],
      legalities: { commander: 'legal' },
      rarity: 'uncommon',
    }]
    dataStore.setState({ ...dataStore.getState(), collection })

    const b1 = await generateDeck(1, null)
    const b2 = await generateDeck(2, null)

    // At B1, Sol Ring is hard-blocked. The exclude reason should reference
    // the bracket filter explicitly.
    const b1SolRing = b1.excludedCards.find(c => c.name === 'Sol Ring')
    expect(b1SolRing).toBeDefined()
    expect(b1SolRing.excludeReason).toMatch(/bracket/i)
    expect(b1.mainDeck.map(c => c.name)).not.toContain('Sol Ring')

    // At B2, Sol Ring is eligible. Either it's in the deck OR it's in the
    // unselected list (with a "not selected" reason, NOT a bracket-block reason).
    const b2InDeck = b2.mainDeck.some(c => c.name === 'Sol Ring')
    const b2SolRing = b2.excludedCards.find(c => c.name === 'Sol Ring')
    if (!b2InDeck) {
      expect(b2SolRing).toBeDefined()
      expect(b2SolRing.excludeReason).not.toMatch(/bracket/i)
    }
  })

  it('cards outside commander color identity are excluded', async () => {
    // Test commander is mono-green; add a red card.
    const collection = [...makeTestCollection(), {
      id: 'red_card',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      cmc: 1,
      color_identity: ['R'],
      colors: ['R'],
      legalities: { commander: 'legal' },
      rarity: 'common',
    }]
    dataStore.setState({ ...dataStore.getState(), collection })

    const result = await generateDeck(3, null)
    expect(result.mainDeck.map(c => c.name)).not.toContain('Lightning Bolt')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// CMC CURVE (B5 should not produce a battlecruiser pile)
// ═════════════════════════════════════════════════════════════════════════════
describe('generateDeck — CMC curve enforcement', () => {
  it('bracket 5 picks lower-CMC cards on average than bracket 1', async () => {
    // Add a mix of cheap and expensive options
    const expensiveCards = []
    for (let i = 0; i < 10; i++) {
      expensiveCards.push({
        id: `expensive_${i}`,
        name: `Big Threat ${i}`,
        type_line: 'Creature — Beast',
        oracle_text: 'When this creature enters, draw a card.',
        cmc: 7,
        color_identity: [],
        colors: [],
        legalities: { commander: 'legal' },
        rarity: 'rare',
      })
    }
    dataStore.setState({
      ...dataStore.getState(),
      collection: [...makeTestCollection(), ...expensiveCards],
    })

    const b1 = await generateDeck(1, null)
    const b5 = await generateDeck(5, null)
    expect(parseFloat(b5.stats.avgCmc)).toBeLessThan(parseFloat(b1.stats.avgCmc))
  })
})
