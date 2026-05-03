// Mana base stress tests.
//
// Pin down the mana-base behavior under conditions that have caused
// real-world deck quality issues:
//   - 5-color decks defaulting to too many basics when fixing exists
//   - mono-color decks that should pull color-specific payoff lands
//     (Cabal Coffers, Urborg) when available
//   - high-bracket decks that include too many tapped lands
//   - high-CMC commanders that don't get enough ramp
//
// These tests use the full orchestrator (not solveManaBase in isolation)
// because the orchestrator's land selection runs through skeleton + mana
// solver + bracket downgrade — the actual production path.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockState,
  resetMockState,
  makeLocalStorageMock,
  makeEdhrecMock,
  makeMoxfieldMock,
  makeLLMServiceMock,
} from '../test/fixtures/mocks'

vi.mock('../utils/localStorage', () => makeLocalStorageMock())
vi.mock('../utils/edhrecApi',     () => makeEdhrecMock())
vi.mock('../utils/moxfieldApi',   () => makeMoxfieldMock())
vi.mock('./llmDeckService',       () => makeLLMServiceMock())

import { generateDeckWithLLMAssist } from './llmDeckOrchestrator'
import { TIAMAT, SHEOLDRED, NAJEELA } from '../test/fixtures/commanders'
import { buildRichCollection } from '../test/fixtures/cards'

beforeEach(() => {
  resetMockState()
})

async function buildDeck(commander, bracket, collection) {
  mockState.commander = commander
  mockState.collection = collection ?? buildRichCollection()
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

const isLand = (c) => (c.type_line ?? '').toLowerCase().includes('land')
const isBasic = (c) => c.isBasicLand || /^basic land/i.test(c.type_line ?? '')

describe('Mana base stress — 5-color (Tiamat) prefers fixing over basics', () => {
  it('Tiamat B3: < 60% of lands are basics when fixing is in the pool', async () => {
    const result = await buildDeck(TIAMAT, 3)
    const lands = result.mainDeck.filter(isLand)
    const basics = lands.filter(isBasic)
    const basicRatio = basics.length / lands.length
    // Rich collection has triomes/shocks/fetches — basics should be < 60%.
    expect(basicRatio).toBeLessThan(0.6)
  })

  it('Tiamat B4: < 50% basics (B4 prefers premium fixing)', async () => {
    const result = await buildDeck(TIAMAT, 4)
    const lands = result.mainDeck.filter(isLand)
    const basics = lands.filter(isBasic)
    expect(basics.length / lands.length).toBeLessThan(0.5)
  })

  it('5-color deck includes Command Tower if available', async () => {
    const result = await buildDeck(TIAMAT, 3)
    const hasCommandTower = result.mainDeck.some(c => c.name === 'Command Tower')
    expect(hasCommandTower).toBe(true)
  })
})

describe('Mana base stress — mono-color color-identity correctness', () => {
  it('Sheoldred (mono-black) deck has zero non-black color identity', async () => {
    const result = await buildDeck(SHEOLDRED, 3)
    for (const card of result.mainDeck) {
      const colors = card.color_identity ?? []
      for (const color of colors) {
        expect(color, `${card.name} has color ${color}`).toBe('B')
      }
    }
  })

  it('Sheoldred deck does not include 2-color lands like Watery Grave', async () => {
    const result = await buildDeck(SHEOLDRED, 3)
    // Watery Grave is U/B — should NOT show up in a mono-B deck even
    // though it's in the rich collection.
    const hasWateryGrave = result.mainDeck.some(c => c.name === 'Watery Grave')
    expect(hasWateryGrave).toBe(false)
  })
})

describe('Mana base stress — mono-color synergy lands prioritized when in pool', () => {
  it('mono-black deck pulls Cabal Coffers when added to collection', async () => {
    const collection = buildRichCollection()
    // Cabal Coffers — devotion-to-black mana payoff. Mono-black decks
    // should prioritize this whenever it's available.
    collection.push({
      name: 'Cabal Coffers',
      type_line: 'Land',
      oracle_text: '{T}: Add {B} for each Swamp you control.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['B'],
      legalities: { commander: 'legal' },
      rarity: 'rare',
      image_uris: null,
      card_faces: null,
      quantity: 1,
    })
    const result = await buildDeck(SHEOLDRED, 3, collection)
    const hasCabal = result.mainDeck.some(c => c.name === 'Cabal Coffers')
    expect(hasCabal).toBe(true)
  })

  it('mono-black deck pulls Urborg, Tomb of Yawgmoth when in pool', async () => {
    const collection = buildRichCollection()
    collection.push({
      name: 'Urborg, Tomb of Yawgmoth',
      type_line: 'Legendary Land',
      oracle_text: 'Each land is a Swamp in addition to its other land types.',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: ['B'],
      legalities: { commander: 'legal' },
      rarity: 'rare',
      image_uris: null,
      card_faces: null,
      quantity: 1,
    })
    const result = await buildDeck(SHEOLDRED, 3, collection)
    const hasUrborg = result.mainDeck.some(c => c.name === 'Urborg, Tomb of Yawgmoth')
    expect(hasUrborg).toBe(true)
  })
})

describe('Mana base stress — high brackets avoid weak/tapped lands', () => {
  it('Tiamat B4 deck includes weak guildgates only as last resort', async () => {
    // Premium 5-color manabases (triomes, fetches, shocks) should dominate.
    // Weak guildgates may still appear if the solver needs to hit the count
    // and basics aren't preferred — but they shouldn't be more than half
    // of the non-basic lands.
    const result = await buildDeck(TIAMAT, 4)
    const lands = result.mainDeck.filter(isLand)
    const nonBasic = lands.filter(c => !isBasic(c))
    const weakLandNames = new Set(['Izzet Guildgate', 'Akoum Refuge', 'Frontier Bivouac'])
    const weakLandsInDeck = result.mainDeck.filter(c => weakLandNames.has(c.name))
    expect(weakLandsInDeck.length).toBeLessThanOrEqual(nonBasic.length / 2)
  })

  it('Najeela B5 deck minimizes weak guildgates (≤3 in current fixture)', async () => {
    // TODO: At B5 the mana solver should HARD-REJECT weak lands when ANY
    // premium fixing remains in the pool. Current behavior includes them
    // when basics aren't preferred. This test is a regression backstop —
    // if the count creeps above 3, something has gotten worse.
    const result = await buildDeck(NAJEELA, 5)
    const weakLandNames = new Set(['Izzet Guildgate', 'Akoum Refuge', 'Frontier Bivouac'])
    const weakLandsInDeck = result.mainDeck.filter(c => weakLandNames.has(c.name))
    expect(weakLandsInDeck.length).toBeLessThanOrEqual(3)
  })
})

describe('Mana base stress — high-CMC commanders get sufficient ramp', () => {
  it('Tiamat (CMC 7) at B3 has at least 8 ramp pieces', async () => {
    const result = await buildDeck(TIAMAT, 3)
    const ramp = result.mainDeck.filter(c => (c.roles ?? []).includes('ramp'))
    // Casting a 7-CMC commander reliably needs lots of ramp. 8 is the
    // generic deckbuilding floor; defensive against fixture pool size.
    expect(ramp.length).toBeGreaterThanOrEqual(8)
  })
})
