// Phase 2 contract tests.
//
// These pin the system-level guarantees the Phase 2 work (score gates,
// ramp ceiling, wincon backstop, viability flag) is supposed to enforce.
// Each test asserts an INVARIANT — something that should hold for every
// commander × bracket combo when the user has a rich collection.
//
// Two-track convention:
//   - Track 1 (these tests): structural invariants. Deterministic,
//     testable with mocked LLM, fast. Run on every commit.
//   - Track 2 (eval-harness, separate flow): outcome / score-distribution
//     observability. Non-deterministic, costs API calls, slow. Run
//     periodically by the user, not in CI.
//
// What we DON'T test here:
//   - "deck scores 9 at B3" — LLM-generated scores are non-deterministic
//   - specific card inclusions ("must contain Sol Ring") — already
//     covered in llmDeckOrchestrator.integration.test.js
//   - prose / phrasing — that's prompt + strip territory
//
// What we DO test here: every floor / ceiling / cap / viability gate
// behaves as designed, across the diverse commander fixture, with a
// realistic rich collection.
//
// ─── ACTIVE vs ASPIRATIONAL CONTRACTS ──────────────────────────────────
// Some contracts encode the END STATE we want but currently fail because
// of known structural limits (bracket-staple ramp stacking, sparse mock
// wincon coverage on niche fixtures). Those use describe.skip with an
// explicit blocked-by note. As we fix the underlying issues, flip the
// .skip off — the test will go green when the gap closes.

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
vi.mock('../utils/edhrecApi',   () => makeEdhrecMock())
vi.mock('../utils/moxfieldApi', () => makeMoxfieldMock())
vi.mock('./llmDeckService',     () => makeLLMServiceMock())

import { generateDeckWithLLMAssist } from './llmDeckOrchestrator'
import { ALL_COMMANDERS } from '../test/fixtures/commanders'
import { buildRichCollection } from '../test/fixtures/cards'
import { maxRampCount } from '../rules/bracketRules'
import { classifyDeckViability } from './evalScoreClamp'

beforeEach(() => {
  resetMockState()
})

async function generateWithMocks({ commander, bracket, collection }) {
  mockState.commander = commander
  mockState.collection = collection
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

const cases = []
for (const cmdr of ALL_COMMANDERS) {
  for (const bracket of [3, 4, 5]) {
    cases.push([cmdr, bracket])
  }
}

// Helpers — count by role/tag in the final deck.
function rampCount(deck)        { return deck.filter(c => (c.roles ?? []).includes('ramp')).length }
function namedWinconCount(deck) {
  return deck.filter(c =>
    (c.roles ?? []).includes('win_condition') ||
    (c.tags ?? []).includes('explosive_finisher')
  ).length
}
function detectedPatterns(result) {
  return result.lensResults?.find(r => r.name === 'win_plan')?._raw?.detectedPatterns ?? []
}

// ─── Contract 4 (ACTIVE): bracket-fit lens agrees with actualBracket ────
//
// If the orchestrator built at bracket B and the resulting deck computes
// actualBracket <= B, the bracket_fit lens MUST report 'pass' (or 'info').
// Anything else means the lens disagrees with the math — that's a lens
// bug. Passes today across all commanders.
describe('Phase 2 contract — bracket_fit lens agrees with actualBracket', () => {
  it.each(cases)('%s at B%d → if actualBracket <= target, lens verdict is pass', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander: cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const target = result.bracketAnalysis?.targetBracket ?? bracket
    const actual = result.bracketAnalysis?.actualBracket ?? null
    if (actual === null || actual > target) return   // lens may report fail/warn — fine

    const bracketLens = result.lensResults?.find(r => r.name === 'bracket_fit')
    expect(bracketLens,
      `${cmdr.name} B${bracket} missing bracket_fit lens result`
    ).toBeDefined()
    expect(['pass', 'info'],
      `${cmdr.name} B${bracket}: actualBracket(${actual}) <= target(${target}) but bracket_fit verdict is ${bracketLens?.verdict}`
    ).toContain(bracketLens.verdict)
  })
})

// ─── Contract 5 (ACTIVE): color identity is never violated ──────────────
//
// Cardinal Commander rule. Any regression breaks deck legality.
describe('Phase 2 contract — color identity is never violated', () => {
  it.each(cases)('%s at B%d → every card respects commander color identity', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander: cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const allowed = new Set(cmdr.color_identity ?? [])
    const offenders = result.mainDeck.filter(c => {
      const ci = c.color_identity ?? []
      return ci.some(color => !allowed.has(color))
    })
    expect(offenders.map(c => c.name),
      `${cmdr.name} B${bracket} has ${offenders.length} off-color cards`
    ).toEqual([])
  })
})

// ─── Contract 1 (ASPIRATIONAL): ramp ceiling enforces fatal-cap ─────────
//
// END STATE: no deck ships above maxRampCount × 1.5. The ramp ceiling
// pass should swap excess ramp for higher-priority roles before final
// validation.
//
// CURRENT GAP: bracket-staples for color-rich commanders (Tiamat 5C,
// Atraxa 4C, Edgar Markov 3C) can themselves push ramp above the fatal
// threshold. The staples lock prevents the ceiling pass from swapping
// them. Documented as accepted limitation in batches 8 + 9.
//
// To unblock this contract:
//   - Add color-aware bracket-staple selection (don't lock all 10
//     talismans + 10 signets for a 5C commander)
//   - OR allow the ramp ceiling to swap staples when over fatal threshold
//     specifically (was tried in batch 9 and reverted — broke Najeela
//     cEDH invariants)
describe.skip('Phase 2 contract — ramp ceiling enforces fatal-cap [BLOCKED: staple stacking]', () => {
  it.each(cases)('%s at B%d → ramp count <= maxRampCount × 1.5', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander: cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const effective = result.bracketAnalysis?.targetBracket ?? bracket
    const cap = maxRampCount(effective, cmdr)
    const ramp = rampCount(result.mainDeck)
    expect(ramp,
      `${cmdr.name} B${bracket} (effective B${effective}) shipped with ${ramp} ramp; fatal threshold is ${Math.floor(cap * 1.5)}`
    ).toBeLessThanOrEqual(Math.floor(cap * 1.5))
  })
})

// ─── Contract 2 (ASPIRATIONAL): every B3+ deck has a recognizable win plan ─
//
// END STATE: every deck has at least 1 named wincon OR a detected
// multi-card pattern. Decks with neither = "no win plan" = fatal.
//
// CURRENT GAP: the test mock LLM service returns a deterministic but
// generic deck that doesn't include named wincons for some 4C/5C
// commanders (Atraxa, Tiamat, Ur-Dragon). The wincon backstop fires
// and tries to add wincons but the test's rich-collection fixture
// doesn't have many named wincons in the legal pool for those colors.
//
// To unblock:
//   - Enrich buildRichCollection() to include named wincons across
//     color identities (Felidar Sovereign, Aetherflux Reservoir,
//     Craterhoof Behemoth, Triumph of the Hordes etc.)
//   - OR: fix the mock LLM to include wincon picks in its response
describe.skip('Phase 2 contract — every B3+ deck has a recognizable win plan [BLOCKED: rich-collection fixture coverage]', () => {
  it.each(cases)('%s at B%d → wincons + patterns >= 1', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander: cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const named = namedWinconCount(result.mainDeck)
    const patterns = detectedPatterns(result)
    expect(named + patterns.length,
      `${cmdr.name} B${bracket} has ${named} named wincons + ${patterns.length} patterns — neither path to victory`
    ).toBeGreaterThanOrEqual(1)
  })
})

// ─── Contract 3 (ASPIRATIONAL): rich collection produces playable decks ──
//
// END STATE: with a rich collection at the EFFECTIVE bracket the
// orchestrator chose, deckViability should never be 'non-competitive'.
//
// CURRENT GAP: same root cause as Contracts 1 & 2 — staple-stacking ramp
// + sparse wincon coverage in test fixture means viability gates fire
// on niche commanders. End-state: when fixtures + orchestrator agree on
// a balanced deck, this passes.
describe.skip('Phase 2 contract — rich collection produces playable decks [BLOCKED: ramp + wincon fixture]', () => {
  it.each(cases)('%s at B%d → deckViability != "non-competitive"', async (cmdr, bracket) => {
    const result = await generateWithMocks({
      commander: cmdr,
      bracket,
      collection: buildRichCollection(),
    })
    const effective = result.bracketAnalysis?.targetBracket ?? bracket
    const cap = maxRampCount(effective, cmdr)
    const fillerCap = ({ 1: 12, 2: 9, 3: 6, 4: 5, 5: 3 })[effective] ?? 6
    const interactionFloor = ({ 1: 4, 2: 5, 3: 7, 4: 8, 5: 10 })[effective] ?? 7
    const trueFiller = result.mainDeck.filter(c => (c.roles ?? [])[0] === 'filler').length
    const interactionCount = result.mainDeck.filter(c =>
      (c.roles ?? []).includes('removal') || (c.roles ?? []).includes('wipe')
    ).length

    const viability = classifyDeckViability({
      bracket: effective,
      fillerCount: trueFiller,
      fillerCap,
      wincons: namedWinconCount(result.mainDeck),
      detectedWincons: detectedPatterns(result),
      rampCount: rampCount(result.mainDeck),
      rampCap: cap,
      interactionCount,
      interactionFloor,
    })
    expect(viability,
      `${cmdr.name} B${bracket} (effective B${effective}) shipped as ${viability} — no deck with a rich collection should land here`
    ).not.toBe('non-competitive')
  })
})
