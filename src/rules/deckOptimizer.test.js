// Direct unit tests for deckOptimizer's swap logic. These exercise the
// scenarios that broke in eval runs: filler over cap when no role
// deficit, wincons recognized via explosive_finisher tag, and locked
// cards refusing to be removed.

import { describe, it, expect } from 'vitest'
import { optimizeDeckToValidation, computeValidationGaps } from './deckOptimizer'

// Minimal card factory — only the fields the optimizer + countRoles read.
function card(name, opts = {}) {
  return {
    name,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: '',
    cmc: opts.cmc ?? 3,
    color_identity: opts.color_identity ?? [],
    colors: opts.colors ?? [],
    legalities: { commander: 'legal' },
    roles: opts.roles ?? ['filler'],
    tags: opts.tags ?? [],
    score: opts.score ?? 0,
    isBasicLand: opts.isBasicLand ?? false,
    ...opts,
  }
}

const COMMANDER = card('Test Commander', {
  type_line: 'Legendary Creature',
  color_identity: ['G'],
  colors: ['G'],
  roles: [],
})

// Build a 99-card deck with N filler-primary cards and the rest
// reasonable picks. fillerScore is what the optimizer will see when
// deciding swap order. roleMix lets a test tweak counts of each role.
function buildDeck({
  fillerCount = 0,
  fillerScore = 30,
  ramp = 10,
  draw = 8,
  removal = 8,
  wipe = 2,
  wincons = 2,
  protection = 4,
  synergy = 0,
  lands = 36,
  rampOpts = {},
  winconOpts = {},
} = {}) {
  const deck = []
  let id = 0
  for (let i = 0; i < lands; i++) {
    deck.push(card(`Land ${i}`, { type_line: 'Basic Land — Forest', isBasicLand: true, roles: ['land'], score: 0 }))
  }
  for (let i = 0; i < ramp; i++) {
    deck.push(card(`Ramp ${++id}`, { roles: ['ramp'], score: 50, ...rampOpts }))
  }
  for (let i = 0; i < draw; i++) deck.push(card(`Draw ${++id}`, { roles: ['draw'], score: 45 }))
  for (let i = 0; i < removal; i++) deck.push(card(`Removal ${++id}`, { roles: ['removal'], score: 50 }))
  for (let i = 0; i < wipe; i++) deck.push(card(`Wipe ${++id}`, { roles: ['wipe'], score: 50 }))
  for (let i = 0; i < wincons; i++) deck.push(card(`Wincon ${++id}`, { roles: ['win_condition'], score: 60, ...winconOpts }))
  for (let i = 0; i < protection; i++) deck.push(card(`Protect ${++id}`, { roles: ['protection'], score: 40 }))
  for (let i = 0; i < synergy; i++) deck.push(card(`Synergy ${++id}`, { roles: ['synergy'], score: 55 }))
  for (let i = 0; i < fillerCount; i++) {
    deck.push(card(`Filler ${++id}`, { roles: ['filler'], score: fillerScore }))
  }
  while (deck.length > 99) deck.pop()
  while (deck.length < 99) deck.push(card(`Pad ${++id}`, { roles: ['filler'], score: 10 }))
  return deck
}

// Helper: build a candidate pool with N cards of a specific role.
function poolOf(role, count, baseScore = 50, namePrefix = role) {
  const pool = []
  for (let i = 0; i < count; i++) {
    pool.push(card(`${namePrefix} Cand ${i}`, {
      roles: [role],
      score: baseScore - i,    // descending so candidate 0 is highest
    }))
  }
  return pool
}

const passthroughRescore = (cards) => cards.map(c => ({ ...c, score: c.score ?? 0 }))

describe('optimizeDeckToValidation — filler-primary swap should always proceed (no score guard)', () => {
  it('swaps filler for removal even when filler scores higher than candidate', async () => {
    // B5 interaction floor = 10. Deck has 8 interaction (8 removal + 0 wipe).
    // Deficit = 2. Filler scores 80, removal candidates score 40 — no swap
    // would happen if the score guard were applied to filler.
    const deck = buildDeck({ removal: 8, wipe: 0, fillerCount: 6, fillerScore: 80, lands: 28, ramp: 18, draw: 6 })
    const candidates = poolOf('removal', 5, 40)
    const usedNames = new Set(deck.map(c => c.name.toLowerCase()))
    const explanation = []

    const swaps = optimizeDeckToValidation({
      deck, candidates, commander: COMMANDER, bracket: 5,
      targetCounts: { ramp: 14, draw: 8, removal: 10, win_condition: 3, protection: 4 },
      rescore: passthroughRescore,
      usedNames, explanation,
    })

    expect(swaps).toBeGreaterThanOrEqual(2)
    const removalCount = deck.filter(c => (c.roles ?? []).includes('removal')).length
    expect(removalCount).toBeGreaterThanOrEqual(10)
  })
})

describe('optimizeDeckToValidation — wincon detection includes explosive_finisher tag', () => {
  it('counts a card with explosive_finisher tag as a wincon', () => {
    const deck = buildDeck({ wincons: 0, fillerCount: 6, lands: 36, ramp: 12, draw: 8, removal: 8, wipe: 2, protection: 4 })
    // Make room before pushing — buildDeck pads to 99 with filler at the
    // end, so we pop one of those padding slots before adding Craterhoof.
    deck.pop()
    deck.push(card('Craterhoof Behemoth', {
      roles: ['synergy'], tags: ['explosive_finisher'], score: 70,
    }))

    const { deficits } = computeValidationGaps(deck, COMMANDER, 4, {}, { winConFloor: 1 })
    // Wincon count should be ≥1 because of the tag, so no deficit at floor=1.
    expect(deficits.win_condition ?? 0).toBe(0)
  })

  it('adds wincon-tagged cards from the pool when below floor', () => {
    const deck = buildDeck({ wincons: 0, fillerCount: 8, lands: 36, ramp: 12, draw: 8, removal: 8, wipe: 2, protection: 4 })
    // Pool contains a Craterhoof-style card: tagged explosive_finisher,
    // role synergy. Optimizer must accept it for the win_condition deficit.
    const candidates = [
      card('Craterhoof Behemoth', { roles: ['synergy'], tags: ['explosive_finisher'], score: 60 }),
      card('Aetherflux Reservoir', { roles: ['win_condition'], score: 55 }),
    ]
    const usedNames = new Set(deck.map(c => c.name.toLowerCase()))
    const explanation = []

    optimizeDeckToValidation({
      deck, candidates, commander: COMMANDER, bracket: 4,
      targetCounts: { ramp: 12, draw: 8, removal: 8, win_condition: 3, protection: 4 },
      rescore: passthroughRescore,
      usedNames, explanation,
      winConFloor: 3,
    })

    const winconCount = deck.filter(c =>
      (c.roles ?? []).includes('win_condition') ||
      (c.tags ?? []).includes('explosive_finisher')
    ).length
    expect(winconCount).toBeGreaterThanOrEqual(2)
  })
})

describe('optimizeDeckToValidation — locked cards are never removed', () => {
  it('does not remove a card flagged fromBracketStaples even when filler is over cap', () => {
    const deck = buildDeck({ fillerCount: 0, lands: 36, ramp: 12, draw: 8, removal: 8, wipe: 2, wincons: 2, protection: 4 })
    // Insert 5 locked staples (replacing some non-locked slots) so trim
    // pass would target them if it didn't respect locks.
    const lockedNames = ['Staple A', 'Staple B', 'Staple C', 'Staple D', 'Staple E']
    for (let i = 0; i < lockedNames.length; i++) {
      deck[36 + i] = card(lockedNames[i], { roles: ['ramp'], score: 5, fromBracketStaples: true })
    }
    // Push filler over the B4 cap of 5 by replacing some draw slots.
    for (let i = 0; i < 8; i++) {
      // overwrite the draw slots with low-scored filler
      deck[55 + i] = card(`Filler ${i}`, { roles: ['filler'], score: 20 })
    }
    while (deck.length > 99) deck.pop()
    while (deck.length < 99) deck.push(card(`Pad ${deck.length}`, { roles: ['filler'], score: 5 }))

    const candidates = poolOf('synergy', 20, 60)
    const usedNames = new Set(deck.map(c => c.name.toLowerCase()))
    const explanation = []

    optimizeDeckToValidation({
      deck, candidates, commander: COMMANDER, bracket: 4,
      targetCounts: { ramp: 12, draw: 8, removal: 8, win_condition: 3, protection: 4 },
      rescore: passthroughRescore,
      usedNames, explanation,
    })

    // All 5 staples should still be in the deck.
    for (const name of lockedNames) {
      expect(deck.some(c => c.name === name)).toBe(true)
    }
  })
})

describe('optimizeDeckToValidation — trim-surplus pass reduces filler when no role deficit exists', () => {
  it('swaps excess filler for synergy candidates even with no deficits', () => {
    // Build a deck that meets every role floor but has 9 filler at B5 (cap 3).
    const deck = buildDeck({
      lands: 28, ramp: 14, draw: 8, removal: 10, wipe: 0,
      wincons: 3, protection: 4, fillerCount: 9, fillerScore: 25,
    })
    const candidates = poolOf('synergy', 30, 50)
    const usedNames = new Set(deck.map(c => c.name.toLowerCase()))
    const explanation = []

    optimizeDeckToValidation({
      deck, candidates, commander: COMMANDER, bracket: 5,
      targetCounts: { ramp: 14, draw: 8, removal: 10, win_condition: 2, protection: 4 },
      rescore: passthroughRescore,
      usedNames, explanation,
      winConFloor: 2,
    })

    const fillerCount = deck.filter(c => (c.roles?.[0] ?? 'filler') === 'filler').length
    expect(fillerCount).toBeLessThanOrEqual(3)   // B5 cap
  })
})
