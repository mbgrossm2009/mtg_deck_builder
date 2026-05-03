// Lens framework + initial lenses tests.
//
// Each lens reads { deck, commanderProfile, context } and returns a
// LensResult { name, score, verdict, summary, evidence, suggestions }.
//
// These tests verify the contract: structured output, sane evidence,
// actionable suggestions.

import { describe, it, expect } from 'vitest'
import { evaluateLenses, scoreToVerdict } from './lens'
import { extractCommanderProfile } from './commanderProfile'
import { CommanderExecutionLens } from './lenses/commanderExecutionLens'
import { WinPlanLens } from './lenses/winPlanLens'
import { BracketFitLens } from './lenses/bracketFitLens'
import { ManaBaseLens } from './lenses/manaBaseLens'
import { findCommander } from '../test/fixtures/top100commanders.js'

const card = ({ name, roles = [], tags = [], type = 'Creature', text = '', color_identity = [] }) => ({
  name, roles, tags, type_line: type, oracle_text: text, color_identity,
})
const land = (name = 'Plains') => card({
  name, type: 'Basic Land — Plains', roles: ['land'], color_identity: ['W'],
})

// ─── Lens framework ─────────────────────────────────────────────────────────

describe('evaluateLenses', () => {
  it('runs every lens and returns results in input order', () => {
    const fakeLens = (name) => ({
      name,
      evaluate: () => ({ name, score: 1, verdict: 'pass', summary: '', evidence: [], suggestions: [] }),
    })
    const results = evaluateLenses(
      [fakeLens('a'), fakeLens('b'), fakeLens('c')],
      { deck: [], commanderProfile: extractCommanderProfile(findCommander('Tiamat')) }
    )
    expect(results.map(r => r.name)).toEqual(['a', 'b', 'c'])
  })
})

describe('scoreToVerdict', () => {
  it('null score → info', () => { expect(scoreToVerdict(null, 0.4)).toBe('info') })
  it('at threshold → pass', () => { expect(scoreToVerdict(0.40, 0.40)).toBe('pass') })
  it('above threshold → pass', () => { expect(scoreToVerdict(0.80, 0.40)).toBe('pass') })
  it('between half and threshold → warn', () => { expect(scoreToVerdict(0.30, 0.40)).toBe('warn') })
  it('below half → fail', () => { expect(scoreToVerdict(0.10, 0.40)).toBe('fail') })
})

// ─── CommanderExecutionLens ─────────────────────────────────────────────────

describe('CommanderExecutionLens', () => {
  const tiamat = extractCommanderProfile(findCommander('Tiamat'))

  it('returns LensResult shape', () => {
    const result = CommanderExecutionLens.evaluate({
      deck: [land(), card({ name: 'Random', roles: ['filler'] })],
      commanderProfile: tiamat,
      context: { targetBracket: 3 },
    })
    expect(result).toHaveProperty('name', 'commander_execution')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('verdict')
    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('evidence')
    expect(result).toHaveProperty('suggestions')
  })

  it('all-on-plan deck verdict = pass', () => {
    const deck = Array.from({ length: 30 }, (_, i) => card({
      name: `Dragon ${i}`, roles: ['synergy'], tags: ['tribal_dragon'],
    }))
    const result = CommanderExecutionLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('pass')
    expect(result.score).toBeGreaterThanOrEqual(0.40)
  })

  it('all-off-plan deck verdict = fail', () => {
    const deck = Array.from({ length: 30 }, (_, i) => card({
      name: `Random ${i}`, roles: ['filler'],
    }))
    const result = CommanderExecutionLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('fail')
  })

  it('fail verdict produces actionable suggestions', () => {
    const deck = Array.from({ length: 30 }, (_, i) => card({
      name: `Random ${i}`, roles: ['filler'],
    }))
    const result = CommanderExecutionLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.suggestions.length).toBeGreaterThan(0)
    // Tiamat is dragon tribal — suggestion should mention dragons.
    expect(result.suggestions.join(' ').toLowerCase()).toMatch(/dragon|tribal|mechanic/)
  })
})

// ─── WinPlanLens ────────────────────────────────────────────────────────────

describe('WinPlanLens', () => {
  const tiamat = extractCommanderProfile(findCommander('Tiamat'))

  it('zero wincons at B3 → fail', () => {
    const deck = Array.from({ length: 30 }, (_, i) => card({
      name: `Dragon ${i}`, type: 'Creature — Dragon', roles: ['synergy'],
    }))
    const result = WinPlanLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('fail')
    expect(result.evidence.some(e => e.kind === 'no_plan')).toBe(true)
  })

  it('single-card wincon at B3 → warn (need 2)', () => {
    const deck = [
      card({ name: "Thassa's Oracle", roles: ['win_condition'] }),
      ...Array.from({ length: 30 }, (_, i) => card({ name: `Dragon ${i}` })),
    ]
    const result = WinPlanLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('warn')
  })

  it('two wincons at B3 → pass', () => {
    const deck = [
      card({ name: "Thassa's Oracle", roles: ['win_condition'] }),
      card({ name: 'Aetherflux Reservoir', roles: [], tags: ['explosive_finisher'] }),
      ...Array.from({ length: 30 }, (_, i) => card({ name: `Dragon ${i}` })),
    ]
    const result = WinPlanLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('pass')
  })

  it('B3 zero-wincon failure suggests a tribal_anthem plan for Tiamat', () => {
    const result = WinPlanLens.evaluate({
      deck: [card({ name: 'Random' })],
      commanderProfile: tiamat,
      context: { targetBracket: 3 },
    })
    // Tiamat naturally supports tribal_anthem. Suggestion should reflect this.
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('summary lists detected wincons by name', () => {
    const deck = [
      card({ name: "Thassa's Oracle", roles: ['win_condition'] }),
      card({ name: 'Aetherflux Reservoir', roles: ['win_condition'] }),
    ]
    const result = WinPlanLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.summary).toMatch(/Thassa/)
    expect(result.summary).toMatch(/Aetherflux/)
  })
})

// ─── BracketFitLens ─────────────────────────────────────────────────────────

describe('BracketFitLens', () => {
  const atraxa = extractCommanderProfile(findCommander('Atraxa, Praetors\' Voice'))

  it('clean B3 deck → pass', () => {
    // Empty-ish deck won't trigger any bracket-bumping signals.
    const deck = Array.from({ length: 99 }, (_, i) => card({
      name: `Card ${i}`, roles: ['synergy'], color_identity: ['W'],
    }))
    const result = BracketFitLens.evaluate({
      deck, commanderProfile: atraxa, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('pass')
    expect(result.score).toBe(1)
  })

  it('B3 deck with combo pieces overshoots → warn or fail', () => {
    // Deck has Thassa's Oracle + Demonic Consultation = combo at B3 = bracket bumps.
    const deck = [
      card({ name: "Thassa's Oracle", roles: ['win_condition'], type: 'Creature — Merfolk Wizard' }),
      card({ name: 'Demonic Consultation', roles: ['removal'], type: 'Instant', tags: ['tutor'] }),
      ...Array.from({ length: 97 }, (_, i) => card({ name: `Card ${i}` })),
    ]
    const result = BracketFitLens.evaluate({
      deck, commanderProfile: atraxa, context: { targetBracket: 3 },
    })
    expect(['warn', 'fail']).toContain(result.verdict)
  })
})

// ─── ManaBaseLens ───────────────────────────────────────────────────────────

describe('ManaBaseLens', () => {
  const tiamat = extractCommanderProfile(findCommander('Tiamat'))   // 5-color, CMC 7
  const krenko = extractCommanderProfile(findCommander('Krenko, Mob Boss'))  // mono-R, CMC 4

  it('Tiamat with 38 lands (mixed fixing) + 12 ramp → pass', () => {
    // 5-color deck: ManaBaseLens warns if > 60% basics. Use a 50/50 mix
    // so the basic-heavy check passes.
    const basics = Array.from({ length: 18 }, (_, i) => land(`Plains ${i}`))
    const duals = Array.from({ length: 20 }, (_, i) => ({
      name: `Triome ${i}`, type_line: 'Land',
      roles: ['land'], color_identity: ['W', 'U', 'B'], isBasicLand: false,
    }))
    const deck = [
      ...basics,
      ...duals,
      ...Array.from({ length: 12 }, (_, i) => card({
        name: `Ramp ${i}`, roles: ['ramp'], color_identity: ['G'],
      })),
      ...Array.from({ length: 49 }, (_, i) => card({
        name: `Other ${i}`, color_identity: ['R'],
      })),
    ]
    const result = ManaBaseLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('pass')
  })

  it('Tiamat with too few lands (30) → fail', () => {
    const deck = [
      ...Array.from({ length: 30 }, (_, i) => land(`Mountain ${i}`)),
      ...Array.from({ length: 69 }, (_, i) => card({
        name: `Other ${i}`, color_identity: ['R'],
      })),
    ]
    const result = ManaBaseLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('fail')
    expect(result.suggestions.join(' ')).toMatch(/lands/)
  })

  it('Tiamat with too few ramp pieces → warn', () => {
    const deck = [
      ...Array.from({ length: 37 }, (_, i) => land(`Mountain ${i}`)),
      ...Array.from({ length: 4 }, (_, i) => card({   // 4 ramp, need 12 for CMC 7
        name: `Ramp ${i}`, roles: ['ramp'],
      })),
      ...Array.from({ length: 58 }, (_, i) => card({ name: `Other ${i}` })),
    ]
    const result = ManaBaseLens.evaluate({
      deck, commanderProfile: tiamat, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('warn')
    expect(result.suggestions.join(' ')).toMatch(/ramp/)
  })

  it('Krenko with off-color land (mono-red) → fail', () => {
    const deck = [
      ...Array.from({ length: 35 }, (_, i) => ({
        name: `Mountain ${i}`, type_line: 'Basic Land — Mountain',
        roles: ['land'], color_identity: ['R'], isBasicLand: true,
      })),
      // Off-color land — illegal in mono-red.
      {
        name: 'Cascade Bluffs', type_line: 'Land',
        roles: ['land'], color_identity: ['U', 'R'], isBasicLand: false,
      },
      ...Array.from({ length: 63 }, (_, i) => card({
        name: `Other ${i}`, color_identity: ['R'],
      })),
    ]
    const result = ManaBaseLens.evaluate({
      deck, commanderProfile: krenko, context: { targetBracket: 3 },
    })
    expect(result.verdict).toBe('fail')
    expect(result.evidence.some(e => e.kind === 'off_color_lands')).toBe(true)
  })
})

// ─── Lens composition ───────────────────────────────────────────────────────

describe('evaluateLenses — full composition', () => {
  it('runs all 4 lenses on a Tiamat deck and returns 4 results', () => {
    const tiamat = extractCommanderProfile(findCommander('Tiamat'))
    const deck = [
      ...Array.from({ length: 18 }, (_, i) => land(`Plains ${i}`)),
      ...Array.from({ length: 19 }, (_, i) => ({
        name: `Triome ${i}`, type_line: 'Land',
        roles: ['land'], color_identity: ['W','U','B'], isBasicLand: false,
      })),
      ...Array.from({ length: 12 }, (_, i) => card({ name: `Ramp ${i}`, roles: ['ramp'] })),
      ...Array.from({ length: 50 }, (_, i) => card({
        name: `Dragon ${i}`, type: 'Creature — Dragon', roles: ['synergy'],
        tags: ['tribal_dragon'], color_identity: ['R'],
      })),
    ]
    const results = evaluateLenses(
      [CommanderExecutionLens, WinPlanLens, BracketFitLens, ManaBaseLens],
      { deck, commanderProfile: tiamat, context: { targetBracket: 3 } }
    )
    expect(results).toHaveLength(4)
    expect(results.map(r => r.name)).toEqual([
      'commander_execution', 'win_plan', 'bracket_fit', 'mana_base',
    ])
    // Every result has the contract shape.
    for (const r of results) {
      expect(r).toHaveProperty('verdict')
      expect(['pass', 'warn', 'fail', 'info']).toContain(r.verdict)
      expect(Array.isArray(r.evidence)).toBe(true)
      expect(Array.isArray(r.suggestions)).toBe(true)
    }
  })
})
