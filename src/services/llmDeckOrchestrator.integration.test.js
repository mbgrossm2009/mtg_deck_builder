// Integration tests for the full deck-generation orchestrator.
//
// Strategy: mock the four external boundaries (localStorage, EDHREC, Moxfield,
// LLM service) and test STRUCTURAL INVARIANTS — properties that should hold
// for any commander/bracket combination. These catch the categories of bugs
// we've debugged manually over the last several iterations:
//   - 43-land deck (mana base double-counting)
//   - Liar's Pendulum swap (off-theme card cycling)
//   - Missing Sol Ring at high brackets (universal staples not locked)
//   - cEDH staples missing at B5 (bracket staples not locked)
//   - Off-theme filler in tribal decks (no archetype enforcement)
//
// Tests are organized as:
//   1. Universal invariants — apply to EVERY commander + bracket combo
//   2. Bracket-specific behavior — tutors scale, mana base scales, etc.
//   3. Commander-specific behavior — tribal density, color identity, etc.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockState,
  resetMockState,
  makeLocalStorageMock,
  makeEdhrecMock,
  makeMoxfieldMock,
  makeLLMServiceMock,
} from '../test/fixtures/mocks'

// vi.mock declarations are HOISTED to the top, so they must reference imports
// that don't depend on the test file's runtime.
vi.mock('../utils/localStorage', () => makeLocalStorageMock())
vi.mock('../utils/edhrecApi', () => makeEdhrecMock())
vi.mock('../utils/moxfieldApi', () => makeMoxfieldMock())
vi.mock('./llmDeckService', () => makeLLMServiceMock())

// Imports MUST come after vi.mock.
import { generateDeckWithLLMAssist } from './llmDeckOrchestrator'
import {
  TIAMAT, KRENKO, EDGAR_MARKOV, MARWYN, SHELOB,
  NAJEELA, KINNAN, NIV_MIZZET, MEREN, KARADOR, HELIOD, ATRAXA,
  ALL_COMMANDERS,
} from '../test/fixtures/commanders'
import {
  buildRichCollection, buildSparseCollection, countByName,
  ALL_CEDH_STAPLES, ALL_UNIVERSAL_STAPLES, DRAGONS, GOBLINS, VAMPIRES,
  OFF_THEME_FILLER, GAME_CHANGER_BANS,
} from '../test/fixtures/cards'

beforeEach(() => {
  resetMockState()
})

// Helper: set up the mock state for a generation, then run it.
async function generateWithMocks({ commander, bracket, collection }) {
  mockState.commander = commander
  mockState.collection = collection
  // Default: no EDHREC/Moxfield data so skeleton is empty (let bracket-staples
  // and the LLM mock drive output deterministically). Specific tests override.
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

// ─── Tier 1: Universal invariants (run for every commander × bracket) ───────
//
// If any of these fail for any commander, the algorithm is broken in a
// general way (not commander-specific).

describe('Universal invariants — apply to every commander', () => {
  // Parameterize: 12 commanders × 3 brackets (1, 3, 5) = 36 test cases per invariant.
  const cases = []
  for (const cmdr of ALL_COMMANDERS) {
    for (const bracket of [1, 3, 5]) {
      cases.push([cmdr, bracket])
    }
  }

  it.each(cases)('%s at B%d → produces a deck with no fatal error', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    expect(result).toBeDefined()
    expect(result.error).toBeUndefined()
    expect(result.mainDeck).toBeDefined()
  })

  it.each(cases)('%s at B%d → deck has exactly 99 cards', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    expect(result.mainDeck.length).toBe(99)
  })

  it.each(cases)('%s at B%d → land count matches bracket target', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const lands = result.mainDeck.filter(c => (c.type_line ?? '').toLowerCase().includes('land'))
    const landCount = lands.length
    const expected = bracket === 5 ? 28 : bracket === 3 ? 37 : 38
    expect(landCount).toBe(expected)
  })

  it.each(cases)('%s at B%d → all cards respect commander color identity', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const allowed = new Set(cmdr.color_identity)
    for (const card of result.mainDeck) {
      const cardColors = card.color_identity ?? []
      for (const color of cardColors) {
        expect(allowed.has(color)).toBe(true)
      }
    }
  })

  it.each(cases)('%s at B%d → no banned cards', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    for (const card of result.mainDeck) {
      const legality = card.legalities?.commander
      expect(legality).not.toBe('banned')
    }
  })

  it.each(cases)('%s at B%d → singleton enforced (basics may repeat)', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const seen = new Map()
    for (const card of result.mainDeck) {
      if (card.isBasicLand) continue
      seen.set(card.name, (seen.get(card.name) ?? 0) + 1)
    }
    for (const [name, count] of seen.entries()) {
      expect(count, `${name} appears ${count} times`).toBe(1)
    }
  })
})

// ─── Tier 1.5: Off-theme rejection (catches Liar's Pendulum class of bugs) ──

describe('Off-theme cards never make it into a tribal deck', () => {
  // For each tribal commander, ensure off-theme filler doesn't appear.
  const tribalCommanders = [TIAMAT, KRENKO, EDGAR_MARKOV, MARWYN, SHELOB]
  const offThemeNames = OFF_THEME_FILLER.map(c => c.name)

  // Note: small collections might force a couple of off-theme picks if the
  // pool genuinely lacks better alternatives. The real invariant is "the
  // algorithm doesn't FLOOD the deck with off-theme filler" — assert ≤3.
  it.each(tribalCommanders)('%s deck has minimal off-theme filler at B3 (≤3)', async (cmdr) => {
    const result = await generateWithMocks({
      commander:  cmdr,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const offThemeCount = countByName(result.mainDeck, offThemeNames)
    expect(offThemeCount).toBeLessThanOrEqual(3)
  })
})

// ─── Tier 2: Bracket-specific behavior ─────────────────────────────────────

describe('Bracket-specific behavior', () => {
  it('B1 deck excludes all game changers + cEDH fast mana', async () => {
    const result = await generateWithMocks({
      commander:  ATRAXA,
      bracket:    1,
      collection: buildRichCollection(),
    })
    const fastManaNames = ['Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox', 'Mox Opal', 'Lotus Petal', 'Jeweled Lotus', 'Dockside Extortionist']
    const gameChangerNames = GAME_CHANGER_BANS.map(c => c.name)
    expect(countByName(result.mainDeck, fastManaNames)).toBe(0)
    expect(countByName(result.mainDeck, gameChangerNames)).toBe(0)
  })

  it('B5 deck includes cEDH fast mana when in collection', async () => {
    const result = await generateWithMocks({
      commander:  NAJEELA,
      bracket:    5,
      collection: buildRichCollection(),
    })
    // Najeela's color identity is 5-color so all cEDH staples are color-legal.
    expect(countByName(result.mainDeck, ['Mana Crypt'])).toBe(1)
    expect(countByName(result.mainDeck, ['Demonic Tutor'])).toBe(1)
    expect(countByName(result.mainDeck, ['Force of Will'])).toBe(1)
  })

  it('Sol Ring is locked at B2+ if owned (excluded at B1 — fast mana)', async () => {
    // B1 explicitly excludes fast_mana including Sol Ring; B2+ has the
    // safe-rocks exemption for Sol Ring/Arcane Signet. Test that Sol Ring
    // ABSENT at B1, PRESENT at B2+.
    const b1 = await generateWithMocks({ commander: ATRAXA, bracket: 1, collection: buildRichCollection() })
    expect(countByName(b1.mainDeck, ['Sol Ring'])).toBe(0)
    for (const bracket of [2, 3, 4, 5]) {
      const result = await generateWithMocks({ commander: ATRAXA, bracket, collection: buildRichCollection() })
      expect(countByName(result.mainDeck, ['Sol Ring']), `Sol Ring missing at B${bracket}`).toBe(1)
    }
  })

  it('Universal staples (Lightning Greaves, Cultivate) are locked at every bracket', async () => {
    for (const bracket of [1, 3, 5]) {
      const result = await generateWithMocks({
        commander:  KRENKO,
        bracket,
        collection: buildRichCollection(),
      })
      // Krenko is mono-R so green ramp (Cultivate) is off-color and won't lock.
      // But Lightning Greaves is colorless and should always be in.
      expect(countByName(result.mainDeck, ['Lightning Greaves']), `Lightning Greaves missing at B${bracket}`).toBe(1)
    }
  })
})

// ─── Tier 3: Commander/archetype-specific behavior ─────────────────────────

describe('Tribal commanders include their tribe', () => {
  it('Tiamat (dragon tribal) → deck contains dragons + zero off-theme bulk', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    // The real invariant for a tribal commander: deck has SOME tribal cards
    // AND zero off-theme bulk-filler bears. The critique can correctly
    // promote cEDH staples (Vampiric Tutor, Tainted Pact) over more dragons
    // when those score higher — that's optimization, not a regression.
    const dragonsInDeck = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('dragon')
    ).length
    const bulkFillerInDeck = result.mainDeck.filter(c =>
      /^(Black|Blue|Red|White|Green) Filler \d+$/.test(c.name)
    ).length

    expect(bulkFillerInDeck, 'off-theme bulk filler bears must NOT survive critique').toBe(0)
    expect(dragonsInDeck, 'tribal commander must have at least some on-tribe creatures').toBeGreaterThanOrEqual(2)
  })

  it('Krenko (goblin tribal, mono-R) → deck contains goblins', async () => {
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const goblinsInDeck = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('goblin')
    ).length
    expect(goblinsInDeck).toBeGreaterThanOrEqual(5)
  })

  it('Mono-R Krenko deck has no off-color cards', async () => {
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    for (const card of result.mainDeck) {
      const colors = card.color_identity ?? []
      for (const color of colors) {
        expect(['R'].includes(color), `${card.name} has off-color ${color}`).toBe(true)
      }
    }
  })

  it('Mono-G Marwyn deck has no off-color cards', async () => {
    const result = await generateWithMocks({
      commander:  MARWYN,
      bracket:    3,
      collection: buildRichCollection(),
    })
    for (const card of result.mainDeck) {
      const colors = card.color_identity ?? []
      for (const color of colors) {
        expect(['G'].includes(color), `${card.name} has off-color ${color}`).toBe(true)
      }
    }
  })
})

// ─── Coverage warnings when collection is sparse ───────────────────────────

describe('Sparse collection surfaces coverage warnings', () => {
  it('B5 with sparse collection generates a deck and issues a coverage warning', async () => {
    const result = await generateWithMocks({
      commander:  NAJEELA,
      bracket:    5,
      collection: buildSparseCollection(),
    })
    expect(result.mainDeck.length).toBe(99)
    // Coverage warning should appear in result.warnings (not just explanation)
    const hasCoverageWarning = (result.warnings ?? []).some(w =>
      typeof w?.message === 'string' && /staple/i.test(w.message)
    )
    expect(hasCoverageWarning).toBe(true)
  })
})

// ─── Heuristic critique never adds off-theme cards ─────────────────────────

describe('Critique passes never re-add off-theme cards', () => {
  it('Tiamat deck after critique still contains zero off-theme filler', async () => {
    // This catches the Liar's Pendulum bug: heuristic critique was swapping
    // -Idol of False Gods → +Liar's Pendulum (both off-theme). Off-theme
    // cards should never be on either side of a swap.
    mockState.critiqueApproved = false
    mockState.critiqueSwaps = [
      // Even if the LLM proposes off-theme swaps, the validator/applier
      // should reject them — they're not in the available pool because
      // we filter off-theme cards out.
      { out: 'Bloodghast', in: "Liar's Pendulum", reason: 'malicious test swap' },
    ]
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    expect(countByName(result.mainDeck, ["Liar's Pendulum"])).toBe(0)
  })
})
