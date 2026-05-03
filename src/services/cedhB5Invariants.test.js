// cEDH (Bracket 5) invariants.
//
// Building at B5 with a B5-CAPABLE commander (Najeela, Kinnan, Thrasios+
// Tymna, Urza, Rograkh) should produce a deck that ACTUALLY looks like
// cEDH: low curve, high tutor density, fast mana, tight finishers.
//
// These tests fire on the deck output — not just that it's "tagged B5",
// but that the actual contents match what cEDH players would expect.

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
import { NAJEELA, KINNAN, KRENKO } from '../test/fixtures/commanders'
import { buildRichCollection } from '../test/fixtures/cards'
import { avgCmc } from '../utils/cardHelpers'

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

describe('cEDH B5 invariants — Najeela (B5-capable, not capped)', () => {
  let deck, result
  beforeEach(async () => {
    result = await buildDeck(NAJEELA, 5)
    deck = result.mainDeck
  })

  it('builds at B5 (not capped down)', () => {
    expect(result.bracketAnalysis?.targetBracket).toBe(5)
  })

  it('average non-land CMC is low (≤ 3.0) — cEDH curves are low', () => {
    const nonLands = deck.filter(c => !(c.type_line ?? '').toLowerCase().includes('land'))
    expect(avgCmc(nonLands)).toBeLessThanOrEqual(3.0)
  })

  it('tutor density is high (≥ 5)', () => {
    // B5 tutor floor is 8; defensive check at 5 against fixture pool size
    // (rich collection has 7 hard tutors, possibly + soft tutors).
    const tutors = deck.filter(c => (c.tags ?? []).includes('tutor'))
    expect(tutors.length).toBeGreaterThanOrEqual(5)
  })

  it('fast mana density is high (≥ 6)', () => {
    // Rich collection has 9 fast-mana cards; cEDH B5 should pick most.
    const fastMana = deck.filter(c => (c.tags ?? []).includes('fast_mana'))
    expect(fastMana.length).toBeGreaterThanOrEqual(6)
  })

  it('has a win plan — single-card wincon OR detected multi-card pattern', () => {
    // Najeela's plan is the extra-combat loop: each Warrior attack creates
    // a new Warrior, then her WUBRG ability grants additional combat. The
    // detectMultiCardWincons function recognizes this as an "extra-combat
    // loop" pattern (commander grants additional combat + makes tokens on
    // attack).
    const singleCardWincons = deck.filter(c =>
      (c.roles ?? []).includes('win_condition') ||
      (c.tags ?? []).includes('explosive_finisher')
    )
    // Phase 8: detectedWincons is no longer a top-level orchestrator
    // field. Read from win_plan lens result._raw.
    const winLens = result.lensResults?.find(r => r.name === 'win_plan')
    const detectedPatterns = winLens?._raw?.detectedPatterns ?? []
    expect(singleCardWincons.length + detectedPatterns.length).toBeGreaterThanOrEqual(1)
  })

  // NOTE: We don't assert filler counts here. The fixture-based mock LLM
  // picks cards by a simple "has oracle text" rule, which means many
  // utility cards (token doublers, tribal anthems) tag as `filler` despite
  // being on-plan. Real LLM runs produce far lower filler counts. The
  // bracket-scaled filler threshold is enforced via `validateDeckAtBracket`
  // and tested in `fillerThreshold.test.js` against synthetic decks.

  it('low land count appropriate for B5 (28-32)', () => {
    const lands = deck.filter(c => (c.type_line ?? '').toLowerCase().includes('land'))
    expect(lands.length).toBeGreaterThanOrEqual(28)
    expect(lands.length).toBeLessThanOrEqual(32)
  })
})

describe('cEDH B5 negative test — Krenko request gets capped', () => {
  it('Krenko at B5 builds at effective bracket 4 (cap fires)', async () => {
    const result = await buildDeck(KRENKO, 5)
    expect(result.bracketAnalysis?.targetBracket).toBe(4)
  })

  it('Krenko at capped B4 has B4 land count (~36), not B5 (~28)', async () => {
    const result = await buildDeck(KRENKO, 5)
    const lands = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('land')
    )
    expect(lands.length).toBeGreaterThanOrEqual(34)
    expect(lands.length).toBeLessThanOrEqual(38)
  })
})

describe('cEDH B5 — Kinnan also stays at B5 (B5-capable)', () => {
  it('Kinnan B5 builds at effective bracket 5', async () => {
    const result = await buildDeck(KINNAN, 5)
    expect(result.bracketAnalysis?.targetBracket).toBe(5)
  })
})

describe('cEDH B5 — graceful degradation on weak collection', () => {
  // The "weak collection" here = same rich collection but stripped of the
  // cEDH staples. The deck should still BUILD without crashing — it just
  // won't hit the high tutor/fast-mana counts.
  it('builds without error even when cEDH staples are missing', async () => {
    const rich = buildRichCollection()
    // Strip fast-mana / tutor / free-interaction staples by name.
    const stripNames = new Set([
      'mana crypt', 'mana vault', 'grim monolith', 'mox diamond', 'chrome mox',
      'mox opal', 'lotus petal', 'jeweled lotus', 'dockside extortionist',
      'demonic tutor', 'vampiric tutor', 'imperial seal', 'mystical tutor',
      'enlightened tutor', 'worldly tutor', "green sun's zenith",
      'force of will', 'force of negation', 'pact of negation', 'mana drain',
      'flusterstorm',
    ])
    const weak = rich.filter(c => !stripNames.has(c.name.toLowerCase()))
    const result = await buildDeck(NAJEELA, 5, weak)
    expect(result.error).toBeUndefined()
    expect(result.mainDeck.length).toBe(99)
  })
})
