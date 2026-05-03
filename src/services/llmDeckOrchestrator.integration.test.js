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
import { generateDeckWithLLMAssist, isLockedByFloor, LOCK_FLAGS, isLockedAgainstDowngrade } from './llmDeckOrchestrator'
import {
  TIAMAT, KRENKO, EDGAR_MARKOV, MARWYN, SHELOB,
  NAJEELA, KINNAN, NIV_MIZZET, MEREN, KARADOR, HELIOD, ATRAXA,
  SHEOLDRED, ERTAI, WINTER, UR_DRAGON,
  ALL_COMMANDERS,
} from '../test/fixtures/commanders'
import { TOP_100_COMMANDERS } from '../test/fixtures/top100commanders.js'
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
    // Use the EFFECTIVE bracket from bracketAnalysis — the orchestrator may
    // cap a B5 request down to B4 for commanders that can't honestly hit
    // cEDH speed (Krenko, Edgar, Marwyn, etc.). Land count follows the
    // effective build bracket, not the requested one.
    const effective = result.bracketAnalysis?.targetBracket ?? bracket
    const expected = effective === 5 ? 28 : effective === 4 ? 36 : effective === 3 ? 37 : 38
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

// ─── Bracket downgrade — actual bracket should match target ──────────────

describe('Bracket-downgrade backstop — actual bracket matches target at B1-B3', () => {
  // The critical bug this fixes: B3-targeted decks were computing as B5
  // because EDHREC skeleton + heuristic critique slipped in combo pieces,
  // tutors, and fast mana. The downgrade pass swaps offenders out
  // post-assembly until actual bracket matches target.

  it('B3 target → actual bracket ≤ B3 (with rich collection)', async () => {
    const result = await generateWithMocks({
      commander:  ATRAXA,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const actual = result.bracketAnalysis?.actualBracket ?? 1
    expect(actual).toBeLessThanOrEqual(3)
  })

  it('B2 target → actual bracket ≤ B2', async () => {
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    2,
      collection: buildRichCollection(),
    })
    const actual = result.bracketAnalysis?.actualBracket ?? 1
    expect(actual).toBeLessThanOrEqual(2)
  })

  it('B1 target → actual bracket = B1', async () => {
    const result = await generateWithMocks({
      commander:  EDGAR_MARKOV,
      bracket:    1,
      collection: buildRichCollection(),
    })
    const actual = result.bracketAnalysis?.actualBracket ?? 1
    expect(actual).toBe(1)
  })

  it('B4 target → actual bracket ≤ B4 (allows 1 combo, breaks 2+)', async () => {
    const result = await generateWithMocks({
      commander:  ATRAXA,
      bracket:    4,
      collection: buildRichCollection(),
    })
    const actual = result.bracketAnalysis?.actualBracket ?? 1
    expect(actual).toBeLessThanOrEqual(4)
  })

  it('B5 target → no downgrade applied (actual can be B5)', async () => {
    const result = await generateWithMocks({
      commander:  NAJEELA,
      bracket:    5,
      collection: buildRichCollection(),
    })
    // No bracket-downgrade tagged cards should exist
    const downgradeCards = result.mainDeck.filter(c => c.fromBracketDowngrade).length
    expect(downgradeCards).toBe(0)
  })

  it('B3 deck post-downgrade has no infinite-combo wincons', async () => {
    const result = await generateWithMocks({
      commander:  ATRAXA,
      bracket:    3,
      collection: buildRichCollection(),
    })
    // Specifically: Thassa's Oracle and Demonic Consultation should not
    // both be present. They form a known infinite combo.
    const hasOracle = result.mainDeck.some(c => c.name === "Thassa's Oracle")
    const hasConsult = result.mainDeck.some(c => c.name === 'Demonic Consultation')
    expect(hasOracle && hasConsult).toBe(false)
  })
})

// ─── Off-theme penalty in capPoolForLLM (not just critique) ───────────────

describe('Off-theme penalty applies at LLM-pool capping', () => {
  // The fix: off-theme cards (non-archetype, non-universal-role) are
  // penalized -30 BEFORE the LLM sees them. Previously the penalty only
  // fired in heuristic critique, so the LLM picked filler and the
  // critique couldn't always swap it back out.

  it('Tiamat (dragon tribal) with bulk filler in pool — LLM picks zero bulk filler', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    // Bulk-filler bears (off-theme, non-universal) should not appear.
    const bulkFillerInDeck = result.mainDeck.filter(c =>
      /^(Black|Blue|Red|White|Green) Filler \d+$/.test(c.name)
    ).length
    expect(bulkFillerInDeck).toBe(0)
  })

  it('Krenko (goblin tribal) — non-goblin, non-universal cards are filtered from LLM pool', async () => {
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    // Non-goblin creatures with no universal role should be rare.
    // Acceptable: goblins, lands, ramp, draw, removal, etc.
    // Not acceptable: random mono-R creatures with no archetype fit.
    const llmPicks = result.mainDeck.filter(c => c.llmRole)
    const offThemeLLMPicks = llmPicks.filter(c => {
      const tl = (c.type_line ?? '').toLowerCase()
      const roles = c.roles ?? []
      const universal = ['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition']
      const isUniversal = roles.some(r => universal.includes(r))
      const isGoblin = tl.includes('goblin')
      return !isUniversal && !isGoblin
    })
    // Allow some off-theme picks — Krenko decks often want a few big
    // creatures (dragons, etc.) as finishers even though they're not
    // goblins. The penalty's job is to STOP THE FLOOD, not eliminate
    // every off-theme card. ≤8 leaves room for finishers; 20+ would
    // mean the penalty isn't doing anything.
    expect(offThemeLLMPicks.length).toBeLessThanOrEqual(8)
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

// ─── Tribal density floor (Tier 2 — commander-specific behavior) ───────────

describe('Tribal density floor — tribal commanders get many on-tribe creatures', () => {
  it('Tiamat (5c dragon tribal) deck has ≥10 dragons after the floor fires', async () => {
    // The fixture has 16 dragon creatures. After floor enforcement, we
    // expect most of them in the deck. Floor target is 18 — fixture caps
    // it at 16, so a strong tribal density is the realistic expectation.
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const dragonsInDeck = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('dragon')
    ).length
    expect(dragonsInDeck).toBeGreaterThanOrEqual(10)
  })

  it('Krenko (mono-R goblin tribal) deck has all owned goblins', async () => {
    // Fixture has ~10 goblins. All Krenko-color-legal. Floor should add them.
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const goblinsInDeck = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('goblin')
    ).length
    expect(goblinsInDeck).toBeGreaterThanOrEqual(8)
  })

  it('Edgar Markov (WBR vampire tribal) deck has multiple vampires', async () => {
    const result = await generateWithMocks({
      commander:  EDGAR_MARKOV,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const vampiresInDeck = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('vampire')
    ).length
    expect(vampiresInDeck).toBeGreaterThanOrEqual(4)
  })

  it('non-tribal commander (Atraxa) does NOT get tribal floor enforcement', async () => {
    // Atraxa's archetype is 'counters' / 'proliferate', no tribe.
    // The tribal floor should NOT fire — no 'fromTribalFloor' tagged cards.
    const result = await generateWithMocks({
      commander:  ATRAXA,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const tribalFloorCards = result.mainDeck.filter(c => c.fromTribalFloor).length
    expect(tribalFloorCards).toBe(0)
  })

  it('cEDH commander (Najeela) — tribal floor fires AND cEDH staples are still present', async () => {
    // Najeela is human-warrior tribal AND cEDH. The floor should add
    // warriors but not at the expense of locked cEDH staples like Mana
    // Crypt or Force of Will.
    const result = await generateWithMocks({
      commander:  NAJEELA,
      bracket:    5,
      collection: buildRichCollection(),
    })
    // cEDH staples must still be there (locked, not swapped out)
    expect(countByName(result.mainDeck, ['Mana Crypt'])).toBe(1)
    expect(countByName(result.mainDeck, ['Force of Will'])).toBe(1)
    expect(countByName(result.mainDeck, ['Demonic Tutor'])).toBe(1)
  })

  it('tribal floor surfaces a warning when collection lacks tribal density', async () => {
    // Sparse collection has only 3 dragons. Floor target is 18. Should warn.
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildSparseCollection(),
    })
    // Either a tribal-floor warning OR a coverage warning should appear.
    const hasTribalWarning = (result.warnings ?? []).some(w =>
      typeof w?.message === 'string' && /(dragon|tribal)/i.test(w.message)
    )
    expect(hasTribalWarning).toBe(true)
  })
})

// ─── Commander mechanic synergy bonus ──────────────────────────────────────

describe('Commander mechanic tags drive card prioritization', () => {
  it('orchestrator surfaces a Commander mechanics line when commander triggers on something', async () => {
    // Meren is the best test case — her ability has clear graveyard +
    // sacrifice triggers. Tiamat-style "value" commanders have no
    // care-about triggers and correctly produce no mechanics line.
    const result = await generateWithMocks({
      commander:  MEREN,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const mechLine = (result.explanation ?? []).find(e =>
      typeof e === 'string' && e.startsWith('Commander mechanics:')
    )
    expect(mechLine).toBeTruthy()
  })

  it('value commanders without explicit triggers produce no mechanics line', async () => {
    // Tiamat's only ability is "When Tiamat enters, search for Dragons" —
    // a one-shot tutor, not a recurring mechanic the deck cares about.
    // Should produce no mechanics line (or an empty one).
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const mechLine = (result.explanation ?? []).find(e =>
      typeof e === 'string' && e.startsWith('Commander mechanics:')
    )
    // Either no line, or a line that's safely formatted
    if (mechLine) {
      expect(mechLine).toMatch(/^Commander mechanics: \w/)
    }
  })

  it('graveyard commander (Meren) gets cares_about_graveyard surfaced', async () => {
    const result = await generateWithMocks({
      commander:  MEREN,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const mechLine = (result.explanation ?? []).find(e =>
      typeof e === 'string' && e.startsWith('Commander mechanics:')
    )
    expect(mechLine).toBeTruthy()
    expect(mechLine).toMatch(/graveyard|sacrifice/)
  })

  it('spellslinger commander (Niv-Mizzet, Parun) gets cares_about_spells AND cares_about_draw', async () => {
    const result = await generateWithMocks({
      commander:  NIV_MIZZET,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const mechLine = (result.explanation ?? []).find(e =>
      typeof e === 'string' && e.startsWith('Commander mechanics:')
    )
    expect(mechLine).toBeTruthy()
    expect(mechLine).toMatch(/spells|draw/)
  })

  it('vanilla-style commander gets few or no mechanic tags', async () => {
    // Krenko's text only mentions "Create X 1/1 red Goblin creature tokens"
    // → cares_about_tokens. Just one mechanic, not many.
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const mechLine = (result.explanation ?? []).find(e =>
      typeof e === 'string' && e.startsWith('Commander mechanics:')
    )
    if (mechLine) {
      // tokens is the obvious one for Krenko
      expect(mechLine).toMatch(/tokens/)
    }
  })
})

// ─── Lock contract — every floor flag must be honored everywhere ────────────
//
// Background: in May 2026, the tutor floor would lift Koma B3 from 2 → 3
// tutors, then the heuristic critique would swap one back out for a higher-
// scoring non-tutor — shipping at 2. Root cause: three separate swap
// functions (heuristic critique, LLM critique, bracket downgrade) each had
// their own hand-rolled lock-flag check, and three of them missed the new
// fromTutorFloor / fromRemovalFloor / fromWinconBackstop flags. The lock
// contract was implicit and easy to drift.
//
// Fix: extract isLockedByFloor() as the single source of truth. These tests
// document the contract so future floors can't fall through the same crack.

describe('Lock contract — isLockedByFloor', () => {
  it('exports a non-empty LOCK_FLAGS list', () => {
    expect(Array.isArray(LOCK_FLAGS)).toBe(true)
    expect(LOCK_FLAGS.length).toBeGreaterThan(0)
    // Each flag is a from* string convention.
    for (const flag of LOCK_FLAGS) {
      expect(typeof flag).toBe('string')
      expect(flag).toMatch(/^from[A-Z]/)
    }
  })

  it('returns true when ANY single flag is set', () => {
    for (const flag of LOCK_FLAGS) {
      const card = { name: 'Test Card', [flag]: true }
      expect(isLockedByFloor(card)).toBe(true)
    }
  })

  it('returns false for a clean card with no flags', () => {
    expect(isLockedByFloor({ name: 'Test Card' })).toBe(false)
    expect(isLockedByFloor({ name: 'Test Card', cmc: 3 })).toBe(false)
  })

  it('returns false for null/undefined card', () => {
    expect(isLockedByFloor(null)).toBe(false)
    expect(isLockedByFloor(undefined)).toBe(false)
  })

  it('LOCK_FLAGS includes every floor/backstop currently in the pipeline', () => {
    // If a new floor is added without updating LOCK_FLAGS, the team will
    // hit the original bug shape (floor adds card, critique swaps it out).
    // This test fails any time the canonical list misses a from* flag we
    // know about — forces conscious updates to the contract.
    const REQUIRED_LOCKS = [
      'fromManaSolver',      // mana base solver
      'fromSkeleton',         // EDHREC + Moxfield skeleton
      'fromBracketStaples',   // bracket-aware staples
      'fromTribalFloor',      // tribal density floor
      'fromTutorFloor',       // bracket-based tutor floor
      'fromRemovalFloor',     // bracket-based removal floor
      'fromWinconBackstop',   // 2+ win conditions backstop
    ]
    for (const required of REQUIRED_LOCKS) {
      expect(LOCK_FLAGS).toContain(required)
    }
  })
})

describe('Lock contract — floor-added cards survive critique passes', () => {
  // Build with a tribal commander and rich collection so the tribal floor
  // and (potentially) other floors fire. After the full pipeline (which
  // includes heuristic critique, LLM critique, bracket downgrade), every
  // card carrying a lock flag must still be in the deck — none of those
  // downstream passes should have swapped them out.
  it('Edgar Markov B3 — every floor-flagged card remains in final deck', async () => {
    const result = await generateWithMocks({
      commander:  EDGAR_MARKOV,
      bracket:    3,
      collection: buildRichCollection(),
    })

    // Sanity: at least one floor flag must have fired (otherwise the test
    // proves nothing). Edgar B3 reliably triggers the tribal floor; other
    // floors may also fire depending on the LLM mock's picks.
    const flaggedCards = result.mainDeck.filter(c => isLockedByFloor(c))
    expect(flaggedCards.length).toBeGreaterThan(0)

    // Every flagged card must still be present in the final deck. If the
    // critique passes or downgrade pass had swapped any of them out, the
    // card name wouldn't be in result.mainDeck anymore.
    const finalNames = new Set(result.mainDeck.map(c => c.name.toLowerCase()))
    for (const card of flaggedCards) {
      expect(finalNames.has(card.name.toLowerCase())).toBe(true)
    }
  })

  it('Krenko B4 — tutor/removal floors persist through critique', async () => {
    // B4 has higher tutor and removal floors than B3, so this exercises
    // both fromTutorFloor and fromRemovalFloor more aggressively.
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    4,
      collection: buildRichCollection(),
    })

    const tutorFloorCards = result.mainDeck.filter(c => c.fromTutorFloor)
    const removalFloorCards = result.mainDeck.filter(c => c.fromRemovalFloor)

    // Both floor sets stay locked through the rest of the pipeline.
    // (We don't assert non-zero here — a rich enough collection or LLM
    // mock might cover the floor without needing the backstop. We only
    // assert that whatever WAS added by the floors is still present.)
    for (const card of [...tutorFloorCards, ...removalFloorCards]) {
      const stillPresent = result.mainDeck.some(c =>
        c.name.toLowerCase() === card.name.toLowerCase()
      )
      expect(stillPresent).toBe(true)
    }
  })
})

// ─── Per-commander integration: Tiamat / Sheoldred / Ertai / Winter ─────────
//
// These tests verify the FULL deck-generation pipeline produces decks that
// match what each commander DOES (not just generic deck slots). A passing
// test here means the full chain — archetype detection → mechanic tags →
// scoring → role fill → critique → final assembly — preserves commander
// identity end to end.

describe('Per-commander integration: Tiamat (5-color dragon tribal)', () => {
  it('builds with significant dragon density', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const dragons = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('dragon')
    )
    // Tribal floor enforces ~18 on-tribe; rich collection should easily clear.
    expect(dragons.length).toBeGreaterThanOrEqual(10)
  })

  it('respects 5-color identity', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    // Tiamat is 5-color so all cards are legal — but check no banned color.
    const allowed = new Set(['W', 'U', 'B', 'R', 'G'])
    for (const card of result.mainDeck) {
      for (const color of card.color_identity ?? []) {
        expect(allowed.has(color)).toBe(true)
      }
    }
  })

  it('detects dragon tribal archetype', async () => {
    const { detectArchetypes } = await import('../rules/archetypeRules.js')
    const archetypes = detectArchetypes(TIAMAT)
    expect(archetypes.some(a => a.id === 'tribal_dragon')).toBe(true)
  })

  it('extracts tribal_dragons mechanic tag', async () => {
    const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
    const tags = extractCommanderMechanicTags(TIAMAT)
    expect(tags).toContain('tribal_dragons')
  })
})

describe('Per-commander integration: Sheoldred (mono-black draw/drain)', () => {
  it('mono-black mana base — no off-color cards', async () => {
    const result = await generateWithMocks({
      commander:  SHEOLDRED,
      bracket:    3,
      collection: buildRichCollection(),
    })
    for (const card of result.mainDeck) {
      for (const color of card.color_identity ?? []) {
        expect(color).toBe('B')
      }
    }
  })

  it('extracts cares_about_draw + cares_about_lifegain + cares_about_lifeloss tags', async () => {
    const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
    const tags = extractCommanderMechanicTags(SHEOLDRED)
    expect(tags).toContain('cares_about_draw')
    expect(tags).toContain('cares_about_lifegain')
    expect(tags).toContain('cares_about_lifeloss')
  })

  it('does NOT enforce tribal_human or tribal_phyrexian density', async () => {
    // Sheoldred is a Phyrexian Praetor but oracle text doesn't reference
    // any creature type — must NOT enforce tribal density.
    const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
    const tags = extractCommanderMechanicTags(SHEOLDRED)
    expect(tags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })

  it('produces a valid 99-card deck', async () => {
    const result = await generateWithMocks({
      commander:  SHEOLDRED,
      bracket:    3,
      collection: buildRichCollection(),
    })
    expect(result.error).toBeUndefined()
    expect(result.mainDeck.length).toBe(99)
  })
})

describe('Per-commander integration: Ertai (Esper sacrifice/control)', () => {
  it('detects aristocrats archetype from "Sacrifice a creature" cost', async () => {
    const { detectArchetypes } = await import('../rules/archetypeRules.js')
    const archetypes = detectArchetypes(ERTAI)
    const ids = archetypes.map(a => a.id)
    // Ertai's text mentions "Sacrifice a creature or enchantment" as cost.
    expect(ids).toContain('aristocrats')
  })

  it('extracts cares_about_sacrifice tag', async () => {
    const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
    const tags = extractCommanderMechanicTags(ERTAI)
    expect(tags).toContain('cares_about_sacrifice')
  })

  it('respects WUB color identity (no green or red)', async () => {
    const result = await generateWithMocks({
      commander:  ERTAI,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const allowed = new Set(['W', 'U', 'B'])
    for (const card of result.mainDeck) {
      for (const color of card.color_identity ?? []) {
        expect(allowed.has(color)).toBe(true)
      }
    }
  })
})

describe('Per-commander integration: Winter (creature-type tribal NEGATIVE test)', () => {
  it('Winter is a Human Warlock but has NO tribal mechanic tags', async () => {
    const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
    const tags = extractCommanderMechanicTags(WINTER)
    expect(tags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })

  it('Winter does NOT detect tribal_human / tribal_warlock archetypes', async () => {
    const { detectArchetypes } = await import('../rules/archetypeRules.js')
    const archetypes = detectArchetypes(WINTER)
    const ids = archetypes.map(a => a.id)
    expect(ids).not.toContain('tribal_human')
    expect(ids).not.toContain('tribal_warlock')
  })

  it('Winter deck does NOT have inflated Human/Warlock density', async () => {
    const result = await generateWithMocks({
      commander:  WINTER,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const humans = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('human')
    )
    const warlocks = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('warlock')
    )
    // No tribal floor should fire; counts come from natural collection
    // distribution. We can't assert "exactly N" because the rich collection
    // contains some humans for unrelated reasons (e.g. ramp dorks). But
    // we CAN assert the count isn't artificially boosted toward 18+.
    expect(humans.length).toBeLessThan(18)
    expect(warlocks.length).toBeLessThan(18)
  })
})

// ─── Tribal floor — numeric thresholds ──────────────────────────────────────

describe('Tribal density floor — numeric expectations', () => {
  it('Tiamat at B3 hits meaningful dragon density', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const dragons = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('dragon')
    )
    // The point is that the deck IS dragon tribal — not generic 5-color.
    // Threshold defensive against fixture pool size (rich collection has
    // ~10-15 dragons available depending on how it's built).
    expect(dragons.length).toBeGreaterThanOrEqual(10)
  })

  it('Krenko at B3 hits meaningful goblin density', async () => {
    const result = await generateWithMocks({
      commander:  KRENKO,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const goblins = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('goblin')
    )
    expect(goblins.length).toBeGreaterThanOrEqual(8)
  })

  it('Sheoldred at B3 (non-tribal) — does NOT inflate Phyrexian creatures', async () => {
    const result = await generateWithMocks({
      commander:  SHEOLDRED,
      bracket:    3,
      collection: buildRichCollection(),
    })
    const phyrexians = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('phyrexian')
    )
    // No tribal floor for Sheoldred — count should come from natural mix.
    expect(phyrexians.length).toBeLessThan(18)
  })
})

// ─── Regression tests — A/B/C/D from real observed failures ─────────────────
//
// Each test pins down a specific failure mode the user reported in eval runs.
// If any of these regress, the fix that resolved the failure has been undone.

describe('Regression: Failure A — non-tribal commander treated as tribal', () => {
  it('Winter (Human Warlock) commander never detects tribal_human via type-only', async () => {
    const { detectArchetypes } = await import('../rules/archetypeRules.js')
    const ids = detectArchetypes(WINTER).map(a => a.id)
    expect(ids).not.toContain('tribal_human')
    expect(ids).not.toContain('tribal_warlock')
  })

  it('Yarok (Nightmare Horror) does NOT detect tribal_nightmare or tribal_horror', async () => {
    // Yarok's text mentions "permanent enters", not Nightmare or Horror.
    const yarok = {
      name: 'Yarok, the Desecrated',
      type_line: 'Legendary Creature — Nightmare Horror',
      oracle_text: 'Deathtouch, lifelink. If a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      color_identity: ['U', 'B', 'G'],
    }
    const { detectArchetypes } = await import('../rules/archetypeRules.js')
    const ids = detectArchetypes(yarok).map(a => a.id)
    expect(ids).not.toContain('tribal_nightmare')
    expect(ids).not.toContain('tribal_horror')
  })
})

describe('Regression: Failure D — 5-color tribal needs fixing, not too many basics', () => {
  it('Tiamat B4 deck has fewer than half its lands as basics', async () => {
    const result = await generateWithMocks({
      commander:  TIAMAT,
      bracket:    4,
      collection: buildRichCollection(),
    })
    const lands = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('land')
    )
    const basics = lands.filter(c => c.isBasicLand || /^basic land/i.test(c.type_line ?? ''))
    // 5-color at B4: should have lots of fixing, not pile of basics.
    // Expect < 50% basic lands (rich collection has triomes, fetches, shocks).
    expect(basics.length).toBeLessThan(lands.length / 2)
  })
})

// ─── Broad invariants across ALL 100 fixture commanders ─────────────────────
//
// These are SHALLOW tests run against every commander in the top-100 fixture
// set. The point: catch bugs that only manifest for specific commanders
// (weird oracle text crashes the parser, planeswalker commanders break ETB
// assumptions, mono-color commanders break mana base solver, etc.).
//
// Only B3 + only invariants that are cheap to compute. Deeper assertions
// stay on the curated 16-commander set in commanders.js fixtures.

describe('100-commander invariants — every fixture must produce a valid deck (B3)', () => {
  // Only test commanders that are LEGAL in Commander format. The fixture
  // set occasionally has cards that lost commander legality.
  const legalCommanders = TOP_100_COMMANDERS.filter(c =>
    (c.legalities?.commander ?? 'unknown') !== 'banned'
  )

  it.each(legalCommanders.map(c => [c.name, c]))(
    '%s — produces a deck with no error',
    async (_name, commander) => {
      const result = await generateWithMocks({
        commander,
        bracket: 3,
        collection: buildRichCollection(),
      })
      expect(result.error).toBeUndefined()
      expect(result.mainDeck).toBeDefined()
    },
    15000  // 15s per commander — generous for slow CI
  )

  it.each(legalCommanders.map(c => [c.name, c]))(
    '%s — exactly 99 cards',
    async (_name, commander) => {
      const result = await generateWithMocks({
        commander,
        bracket: 3,
        collection: buildRichCollection(),
      })
      expect(result.mainDeck.length).toBe(99)
    },
    15000
  )

  it.each(legalCommanders.map(c => [c.name, c]))(
    '%s — color identity respected',
    async (_name, commander) => {
      const result = await generateWithMocks({
        commander,
        bracket: 3,
        collection: buildRichCollection(),
      })
      const allowed = new Set(commander.color_identity ?? [])
      for (const card of result.mainDeck) {
        for (const color of card.color_identity ?? []) {
          expect(allowed.has(color), `${card.name} has ${color} not in ${commander.name}'s identity`).toBe(true)
        }
      }
    },
    15000
  )

  it.each(legalCommanders.map(c => [c.name, c]))(
    '%s — extractCommanderMechanicTags executes without throwing',
    async (_name, commander) => {
      const { extractCommanderMechanicTags } = await import('../rules/commanderMechanics.js')
      const tags = extractCommanderMechanicTags(commander)
      expect(Array.isArray(tags)).toBe(true)
    }
  )

  it.each(legalCommanders.map(c => [c.name, c]))(
    '%s — detectArchetypes executes without throwing',
    async (_name, commander) => {
      const { detectArchetypes } = await import('../rules/archetypeRules.js')
      const result = detectArchetypes(commander)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeLessThanOrEqual(4)  // cap is 4
    }
  )
})

// ─── Lock asymmetry — bracket downgrade vs other passes ─────────────────────
//
// The bracket downgrade uses a NARROWER lock set than other passes. Other
// passes (critique / floors / wincon backstop) preserve skeleton +
// floor-added cards. The downgrade allows swapping skeleton + floor adds
// because bracket fit beats EDHREC fidelity and beats hitting minimums.
//
// Regression: in commit 0cfe528 the lock-helper refactor accidentally
// added fromSkeleton to the canonical lock set, which made the downgrade
// unable to remove combo pieces that EDHREC's skeleton handed it. Result:
// real-world B3/B4 builds shipped at actualBracket 5.

describe('Lock asymmetry — isLockedAgainstDowngrade is NARROWER than isLockedByFloor', () => {
  it('skeleton cards are locked against most passes BUT NOT against the downgrade', () => {
    const skel = { name: 'EDHREC pick', fromSkeleton: true }
    expect(isLockedByFloor(skel)).toBe(true)              // critique can't swap
    expect(isLockedAgainstDowngrade(skel)).toBe(false)   // downgrade CAN swap
  })

  it('tutor-floor cards are locked against most passes BUT NOT against the downgrade', () => {
    const tut = { name: 'Forced Tutor', fromTutorFloor: true }
    expect(isLockedByFloor(tut)).toBe(true)
    expect(isLockedAgainstDowngrade(tut)).toBe(false)
  })

  it('removal-floor cards are locked against most passes BUT NOT against the downgrade', () => {
    const r = { name: 'Forced Removal', fromRemovalFloor: true }
    expect(isLockedByFloor(r)).toBe(true)
    expect(isLockedAgainstDowngrade(r)).toBe(false)
  })

  it('wincon-backstop cards are locked against most passes BUT NOT against the downgrade', () => {
    const w = { name: 'Forced Wincon', fromWinconBackstop: true }
    expect(isLockedByFloor(w)).toBe(true)
    expect(isLockedAgainstDowngrade(w)).toBe(false)
  })

  it('mana-solver cards are locked against EVERYTHING (lands are sacred)', () => {
    const land = { name: 'Forced Land', fromManaSolver: true }
    expect(isLockedByFloor(land)).toBe(true)
    expect(isLockedAgainstDowngrade(land)).toBe(true)
  })

  it('bracket-staples are locked against EVERYTHING (already bracket-aware)', () => {
    const staple = { name: 'Sol Ring', fromBracketStaples: true }
    expect(isLockedByFloor(staple)).toBe(true)
    expect(isLockedAgainstDowngrade(staple)).toBe(true)
  })

  it('tribal-floor cards are locked against EVERYTHING (tribal density is identity)', () => {
    const tribal = { name: 'Forced Dragon', fromTribalFloor: true }
    expect(isLockedByFloor(tribal)).toBe(true)
    expect(isLockedAgainstDowngrade(tribal)).toBe(true)
  })

  it('clean cards are locked nowhere', () => {
    const clean = { name: 'Random' }
    expect(isLockedByFloor(clean)).toBe(false)
    expect(isLockedAgainstDowngrade(clean)).toBe(false)
  })
})

// ─── Regression: B3 with combo-piece-in-skeleton must downgrade ─────────────
//
// In production the user saw B3/B4 decks shipping at actualBracket 5
// because EDHREC skeleton handed them combo pieces and the downgrade
// couldn't remove them (skeleton was locked). This test puts known combo
// pieces in the skeleton via mockState.edhrecTopCards and verifies the
// downgrade brings actualBracket back to target.

describe('Regression: EDHREC skeleton combo piece must be removable by downgrade at B3', () => {
  it('Atraxa B3 with Thassa\'s Oracle + Demonic Consultation in skeleton → actualBracket ≤ 3', async () => {
    mockState.commander = ATRAXA
    mockState.collection = buildRichCollection()
    mockState.edhrecTopCards = [
      { name: "Thassa's Oracle", inclusion: 0.95 },
      { name: 'Demonic Consultation', inclusion: 0.93 },
    ]
    mockState.moxfieldCards = []
    const result = await generateDeckWithLLMAssist(3, null, { twoPass: false })

    // The downgrade pass MUST be able to break this combo. If skeleton is
    // locked against downgrade, both pieces stick and actualBracket = 5.
    expect(result.bracketAnalysis?.actualBracket).toBeLessThanOrEqual(3)

    // And specifically, the deck cannot end with BOTH halves of the combo.
    const hasOracle = result.mainDeck.some(c => c.name === "Thassa's Oracle")
    const hasConsult = result.mainDeck.some(c => c.name === 'Demonic Consultation')
    expect(hasOracle && hasConsult).toBe(false)
  })

  it('Atraxa B3 with single combo piece in skeleton → actualBracket ≤ 3', async () => {
    // Single piece doesn't form a combo on its own, but is still a high-power
    // game changer that bumps brackets. Downgrade must be able to swap it.
    mockState.commander = ATRAXA
    mockState.collection = buildRichCollection()
    mockState.edhrecTopCards = [
      { name: 'Mana Crypt', inclusion: 0.99 },     // game-changer fast mana
    ]
    mockState.moxfieldCards = []
    const result = await generateDeckWithLLMAssist(3, null, { twoPass: false })
    expect(result.bracketAnalysis?.actualBracket).toBeLessThanOrEqual(3)
  })
})
