// Collection sensitivity tests.
//
// Same commander, different card pools — the generator should:
//   1. Build a coherent deck even from a thin collection.
//   2. PRIORITIZE the on-theme cards available, even when the pool is weak.
//   3. Not waste available synergy slots on off-theme filler.
//
// These tests catch the regression where the orchestrator over-relies on
// universal staples and ignores the weak-but-on-theme cards a small
// collection actually has.

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
import { TIAMAT, KRENKO } from '../test/fixtures/commanders'
import { buildRichCollection, buildSparseCollection, DRAGONS } from '../test/fixtures/cards'

beforeEach(() => {
  resetMockState()
})

async function buildDeck(commander, bracket, collection) {
  mockState.commander = commander
  mockState.collection = collection
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

const isDragon = (c) => (c.type_line ?? '').toLowerCase().includes('dragon')

describe('Collection sensitivity — Tiamat with rich pool', () => {
  let result
  beforeEach(async () => {
    result = await buildDeck(TIAMAT, 3, buildRichCollection())
  })

  it('builds without error', () => {
    expect(result.error).toBeUndefined()
    expect(result.mainDeck.length).toBe(99)
  })

  it('hits meaningful dragon density (≥ 8 with rich pool)', () => {
    const dragons = result.mainDeck.filter(isDragon)
    expect(dragons.length).toBeGreaterThanOrEqual(8)
  })
})

describe('Collection sensitivity — Tiamat with SPARSE pool (only 3 dragons available)', () => {
  let result
  beforeEach(async () => {
    // buildSparseCollection only has DRAGONS.slice(0, 3) — three dragons.
    result = await buildDeck(TIAMAT, 3, buildSparseCollection())
  })

  it('still builds a 99-card deck (no crash on thin pool)', () => {
    expect(result.error).toBeUndefined()
    expect(result.mainDeck.length).toBe(99)
  })

  it('uses ALL available dragons — does not waste synergy slots', () => {
    // The 3 sparse-collection dragons are the only on-theme creatures.
    // The deck MUST include all of them rather than picking off-theme
    // generic filler over them.
    const sparseDragons = DRAGONS.slice(0, 3).map(c => c.name.toLowerCase())
    const inDeck = result.mainDeck.filter(c =>
      sparseDragons.includes(c.name.toLowerCase())
    )
    expect(inDeck.length).toBe(3)
  })

  it('emits a warning about thin tribal coverage when applicable', () => {
    // The orchestrator's tribal floor warns when on-tribe count is below
    // target AND no more candidates exist. With 3 dragons in a sparse pool,
    // the deck inevitably falls below the 18-floor — warning expected.
    const warningTexts = (result.warnings ?? []).map(w =>
      typeof w === 'object' ? w.message : w
    )
    const hasTribalWarn = warningTexts.some(w => /dragon/i.test(w))
    expect(hasTribalWarn).toBe(true)
  })
})

describe('Collection sensitivity — same commander produces different decks per pool', () => {
  it('Tiamat rich vs sparse: rich has more dragons', async () => {
    const rich   = await buildDeck(TIAMAT, 3, buildRichCollection())
    const sparse = await buildDeck(TIAMAT, 3, buildSparseCollection())

    const richDragons   = rich.mainDeck.filter(isDragon).length
    const sparseDragons = sparse.mainDeck.filter(isDragon).length

    // Rich pool has the full DRAGONS bucket; sparse has only 3.
    expect(richDragons).toBeGreaterThan(sparseDragons)
  })
})

describe('Collection sensitivity — Krenko with rich pool prioritizes goblins', () => {
  it('Krenko rich pool: pulls available goblins over filler', async () => {
    const result = await buildDeck(KRENKO, 3, buildRichCollection())
    const goblins = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('goblin')
    )
    // Should pull most/all goblins from the bucket — defensive at ≥6.
    expect(goblins.length).toBeGreaterThanOrEqual(6)
  })
})
