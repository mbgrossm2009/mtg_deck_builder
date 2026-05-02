// Mock helpers for orchestrator integration tests.
//
// We mock four boundaries:
//   1. localStorage — getCollection / getSelectedCommander
//   2. EDHREC fetch — fetchEdhrecCommander
//   3. Moxfield fetch — fetchMoxfieldConsensus
//   4. LLM service — generateDeckWithLLM + critiqueDeck
//
// Tests set the collection + commander, then drive the orchestrator. The LLM
// mock returns a controlled "picks N cards from the pool" response so tests
// are deterministic. The critique mock returns approved=true by default to
// skip iteration; specific tests override it to test critique behavior.

import { vi } from 'vitest'

// In-memory localStorage stub. Vitest doesn't include a DOM by default.
const memStore = new Map()
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem:    (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem:    (k, v) => memStore.set(k, String(v)),
    removeItem: (k) => memStore.delete(k),
    clear:      () => memStore.clear(),
    key:        (i) => Array.from(memStore.keys())[i] ?? null,
    get length() { return memStore.size },
  }
}

// State the mocks read from. Tests mutate this in beforeEach.
export const mockState = {
  commander: null,
  collection: [],
  edhrecTopCards: [],
  moxfieldCards: [],
  llmPicks: [],            // names the mock LLM should return for the build pass
  critiqueApproved: true,  // whether the critique mock returns approved=true
  critiqueSwaps: [],       // swap proposals when not approved
}

export function resetMockState() {
  mockState.commander = null
  mockState.collection = []
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  mockState.llmPicks = []
  mockState.critiqueApproved = true
  mockState.critiqueSwaps = []
  memStore.clear()
}

// vi.mock declarations — call from each integration test file at module top.
// We can't put them here directly because vi.mock is hoisted to the top of
// the importing file. Instead, expose the mock factories.

export function makeLocalStorageMock() {
  return {
    getSelectedCommander: vi.fn(() => mockState.commander),
    getCollection:        vi.fn(() => mockState.collection),
    getDeck:              vi.fn(() => null),
    saveDeck:             vi.fn(),
  }
}

export function makeEdhrecMock() {
  return {
    fetchEdhrecCommander: vi.fn(async () => ({
      topCards: mockState.edhrecTopCards,
      themes:   [],
    })),
    commanderSlug: vi.fn((name) => name.toLowerCase().replace(/\s/g, '-')),
    clearEdhrecCache: vi.fn(),
  }
}

export function makeMoxfieldMock() {
  return {
    fetchMoxfieldConsensus: vi.fn(async () => ({
      decksAnalyzed:   mockState.moxfieldCards.length > 0 ? 10 : 0,
      totalDecksFound: mockState.moxfieldCards.length > 0 ? 10 : 0,
      cards:           mockState.moxfieldCards,
    })),
    clearMoxfieldCache: vi.fn(),
  }
}

// LLM mock: returns N random cards from the pool, themed by what tests asked
// for. If mockState.llmPicks is set (a list of names), we return THAT
// specifically (so tests can control which cards the LLM "picked").
// Otherwise we pick the first N pool cards by name to keep output deterministic.
export function makeLLMServiceMock() {
  return {
    LLM_MODE: { DISABLED: 'disabled', MOCK: 'mock', LIVE: 'live' },
    setLLMMode: vi.fn(),
    getLLMMode: vi.fn(() => 'live'),
    generateDeckWithLLM: vi.fn(async ({ legalCardPool, deckRules }) => {
      const targetCount = deckRules?.llmSlots ?? deckRules?.nonLandSlots ?? 30

      let picks
      if (mockState.llmPicks.length > 0) {
        // Test specified exact picks. Filter to ones actually in the pool.
        const poolNames = new Set(legalCardPool.map(c => c.name.toLowerCase()))
        picks = mockState.llmPicks
          .filter(name => poolNames.has(name.toLowerCase()))
          .slice(0, targetCount)
          .map(name => {
            const card = legalCardPool.find(c => c.name.toLowerCase() === name.toLowerCase())
            return { name: card.name, role: (card.roles ?? ['filler'])[0], reason: 'mock pick (test-specified)' }
          })
      } else {
        // Default: prefer cards a real LLM would pick — non-empty oracle text
        // (suggests the card actually does something) and meaningful roles.
        // This keeps bulk-filler bears (empty oracle text) out of the picks
        // unless nothing else is available.
        const meaningful = legalCardPool.filter(c => (c.oracle_text ?? '').length > 0)
        const fillerOnly = legalCardPool.filter(c => (c.oracle_text ?? '').length === 0)
        const ranked = [...meaningful, ...fillerOnly]   // meaningful first, filler last
        picks = ranked
          .slice(0, targetCount)
          .map(card => ({ name: card.name, role: (card.roles ?? ['filler'])[0], reason: 'mock pick (default)' }))
      }

      return {
        chosenStrategy:    'Mock strategy',
        strategySummary:   { primaryStrategy: 'Mock', secondaryStrategy: '', winPlan: 'Mock' },
        coreEngine:        [],
        deck:              picks,
        deckStats:         {},
        weakIncludes:      [],
        winConditionDetails: [],
        warnings:          [],
        _meta:             { mode: 'mock', promptTokens: 0 },
      }
    }),
    critiqueDeck: vi.fn(async () => ({
      approved: mockState.critiqueApproved,
      summary:  mockState.critiqueApproved ? 'Mock critique: approved' : 'Mock critique: needs improvements',
      swaps:    mockState.critiqueSwaps,
      _meta:    { promptTokens: 0 },
    })),
  }
}
