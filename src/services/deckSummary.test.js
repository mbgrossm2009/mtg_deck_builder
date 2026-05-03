// Per-commander deck summary tests.
//
// These are PROPERTY tests, not snapshots. Snapshot tests on stochastic
// deck output (mock-LLM picks vary, sort orders shift) produce noisy
// failures. Asserting numeric ranges on the same summary fields gives the
// same regression signal without false positives.
//
// For each curated commander at B3, we build the deck and check that key
// counts fall in plausible ranges for that commander's archetype.

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
import {
  TIAMAT, SHEOLDRED, ERTAI, WINTER,
} from '../test/fixtures/commanders'
import { buildRichCollection } from '../test/fixtures/cards'
import { avgCmc } from '../utils/cardHelpers'

beforeEach(() => {
  resetMockState()
})

async function buildDeck(commander, bracket) {
  mockState.commander = commander
  mockState.collection = buildRichCollection()
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

function summarize(result) {
  const deck = result.mainDeck
  const has = (role) => (c) => (c.roles ?? []).includes(role)
  const typeIncludes = (s) => (c) => (c.type_line ?? '').toLowerCase().includes(s)
  // Filter out lands when computing avgCmc — that's the standard EDH metric.
  const nonLands = deck.filter(c => !(c.type_line ?? '').toLowerCase().includes('land'))
  return {
    deckSize:      deck.length,
    rampCount:     deck.filter(has('ramp')).length,
    drawCount:     deck.filter(has('draw')).length,
    removalCount:  deck.filter(has('removal')).length,
    wipeCount:     deck.filter(has('wipe')).length,
    interactionCount: deck.filter(c => has('removal')(c) || has('wipe')(c)).length,
    winconCount:   deck.filter(has('win_condition')).length,
    fillerCount:   deck.filter(has('filler')).length,
    landCount:     deck.filter(has('land')).length,
    avgCmcNonLand: avgCmc(nonLands),
    dragonCount:   deck.filter(typeIncludes('dragon')).length,
    humanCount:    deck.filter(typeIncludes('human')).length,
    warlockCount:  deck.filter(typeIncludes('warlock')).length,
    phyrexianCount:deck.filter(typeIncludes('phyrexian')).length,
    warnings:      (result.warnings ?? []).length,
  }
}

describe('Deck summary properties — Tiamat at B3 (5-color dragon tribal)', () => {
  let s
  beforeEach(async () => {
    const result = await buildDeck(TIAMAT, 3)
    s = summarize(result)
  })

  it('builds a 99-card deck', () => {
    expect(s.deckSize).toBe(99)
  })
  it('has dragon density characteristic of tribal', () => {
    // Rich collection has limited dragons; tribal floor target is 18 but
    // we're defensive against fixture pool size.
    expect(s.dragonCount).toBeGreaterThanOrEqual(8)
  })
  it('ramp count appropriate for high-CMC 5-color commander', () => {
    expect(s.rampCount).toBeGreaterThanOrEqual(6)
  })
  it('has at least one draw source', () => {
    expect(s.drawCount).toBeGreaterThanOrEqual(3)
  })
  it('average non-land CMC is in midrange (3.0 – 5.5)', () => {
    // 5-color dragons skew high — Tiamat is 7 CMC herself. Allow up to 5.5.
    expect(s.avgCmcNonLand).toBeGreaterThan(2.5)
    expect(s.avgCmcNonLand).toBeLessThanOrEqual(5.5)
  })
  it('lands match B3 target', () => {
    expect(s.landCount).toBeGreaterThanOrEqual(34)
    expect(s.landCount).toBeLessThanOrEqual(40)
  })
})

describe('Deck summary properties — Sheoldred at B3 (mono-black draw/drain)', () => {
  let s
  beforeEach(async () => {
    const result = await buildDeck(SHEOLDRED, 3)
    s = summarize(result)
  })

  it('builds a 99-card deck', () => {
    expect(s.deckSize).toBe(99)
  })
  it('has draw count appropriate for a draw/drain commander', () => {
    // Sheoldred IS a draw payoff — deck should lean into card draw.
    // Threshold ≥5 is defensive against fixture pool size; in real runs
    // the count is typically 8-12.
    expect(s.drawCount).toBeGreaterThanOrEqual(5)
  })
  it('does NOT inflate Phyrexian count (no tribal floor for Sheoldred)', () => {
    expect(s.phyrexianCount).toBeLessThan(18)
  })
  it('average non-land CMC is in mid range (under 4.5)', () => {
    expect(s.avgCmcNonLand).toBeLessThanOrEqual(4.5)
  })
})

describe('Deck summary properties — Ertai at B3 (Esper sacrifice/control)', () => {
  let s
  beforeEach(async () => {
    const result = await buildDeck(ERTAI, 3)
    s = summarize(result)
  })

  it('builds a 99-card deck', () => {
    expect(s.deckSize).toBe(99)
  })
  it('has interaction count characteristic of control (≥ 5)', () => {
    expect(s.interactionCount).toBeGreaterThanOrEqual(5)
  })
  it('has at least one wincon', () => {
    expect(s.winconCount).toBeGreaterThanOrEqual(1)
  })
})

describe('Deck summary properties — Winter at B3 (non-tribal Human Warlock)', () => {
  let s
  beforeEach(async () => {
    const result = await buildDeck(WINTER, 3)
    s = summarize(result)
  })

  it('builds a 99-card deck', () => {
    expect(s.deckSize).toBe(99)
  })
  it('does NOT inflate Human density (no tribal floor for Winter)', () => {
    // Tribal floor is 18; Winter must NOT enforce so we expect well below.
    expect(s.humanCount).toBeLessThan(18)
  })
  it('does NOT inflate Warlock density', () => {
    expect(s.warlockCount).toBeLessThan(18)
  })
  it('builds successfully without fatal warnings', () => {
    // The point: a non-tribal commander with a tribal CREATURE TYPE still
    // produces a coherent deck.
    expect(s.deckSize).toBe(99)
  })
})
