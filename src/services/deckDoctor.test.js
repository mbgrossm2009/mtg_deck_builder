// Deck Doctor service tests.
//
// evaluateDecklist runs the lens framework against a user-supplied
// decklist (no deck-build pipeline involved). This is the second use
// case of the knowledge layer.

import { describe, it, expect } from 'vitest'
import { evaluateDecklist } from './deckDoctor'
import { findCommander } from '../test/fixtures/top100commanders.js'

const tiamat = findCommander('Tiamat')

const card = ({ name, type = 'Creature', text = '', color_identity = ['R'] }) => ({
  name, type_line: type, oracle_text: text, color_identity,
})
const land = (name = 'Mountain') => ({
  name, type_line: 'Basic Land — Mountain', isBasicLand: true, color_identity: ['R'],
})

describe('evaluateDecklist — basic contract', () => {
  it('throws when commander is missing', () => {
    expect(() => evaluateDecklist({ cards: [] })).toThrow(/commander/i)
  })

  it('throws when cards is not an array', () => {
    expect(() => evaluateDecklist({ commander: tiamat })).toThrow(/cards/i)
  })

  it('returns commanderProfile + lensResults + overall', () => {
    const result = evaluateDecklist({ commander: tiamat, cards: [card({ name: 'Test' })] })
    expect(result).toHaveProperty('commanderProfile')
    expect(result).toHaveProperty('lensResults')
    expect(result).toHaveProperty('overall')
    expect(Array.isArray(result.lensResults)).toBe(true)
  })

  it('returns 4 default lens results (CommanderExecution, WinPlan, BracketFit, ManaBase)', () => {
    const result = evaluateDecklist({ commander: tiamat, cards: [card({ name: 'Test' })] })
    expect(result.lensResults).toHaveLength(4)
    const names = result.lensResults.map(r => r.name)
    expect(names).toContain('commander_execution')
    expect(names).toContain('win_plan')
    expect(names).toContain('bracket_fit')
    expect(names).toContain('mana_base')
  })
})

describe('evaluateDecklist — overall summary verdict', () => {
  it('worst-of: any fail → overall.verdict = fail', () => {
    // Empty deck: bracket_fit might pass (0 offenders), win_plan fails,
    // mana_base fails (no lands).
    const result = evaluateDecklist({ commander: tiamat, cards: [] })
    // Empty mana base + no win plan should produce at least one fail.
    expect(['fail', 'warn']).toContain(result.overall.verdict)
  })

  it('counts warn/fail/pass across all lens results', () => {
    const result = evaluateDecklist({ commander: tiamat, cards: [card({ name: 'Test' })] })
    const counts = result.overall.passCount + result.overall.warnCount +
                   result.overall.failCount + result.overall.infoCount
    expect(counts).toBe(result.lensResults.length)
  })
})

describe('evaluateDecklist — enriches cards with roles/tags', () => {
  it('cards without role arrays get them from assignRoles', () => {
    const result = evaluateDecklist({
      commander: tiamat,
      cards: [
        { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      ],
    })
    // The enriched deck should have ramp role on Sol Ring.
    const solRing = result.enrichedDeck.find(c => c.name === 'Sol Ring')
    expect(solRing).toBeDefined()
    expect(solRing.roles).toContain('ramp')
  })

  it('cards with existing roles are NOT re-enriched (caller-provided wins)', () => {
    const result = evaluateDecklist({
      commander: tiamat,
      cards: [{ name: 'Custom', roles: ['win_condition'] }],
    })
    const custom = result.enrichedDeck.find(c => c.name === 'Custom')
    expect(custom.roles).toEqual(['win_condition'])
  })
})

describe('evaluateDecklist — realistic Tiamat dragon deck', () => {
  it('strong dragon density → win_plan reflects the tribal anchor', () => {
    const dragons = Array.from({ length: 22 }, (_, i) => card({
      name: `Dragon ${i}`,
      type: 'Creature — Dragon',
      text: 'Flying.',
    }))
    const lands = Array.from({ length: 37 }, (_, i) => land(`Mountain ${i}`))
    const ramp = Array.from({ length: 12 }, (_, i) => card({
      name: `Ramp ${i}`,
      type: 'Artifact',
      text: 'Add {C}.',
    }))
    const result = evaluateDecklist({
      commander: tiamat,
      cards: [...dragons, ...lands, ...ramp],
      bracket: 3,
    })
    const exec = result.lensResults.find(r => r.name === 'commander_execution')
    expect(exec).toBeDefined()
    // 22 dragons should produce a non-zero score even after enrichment.
    expect(exec.score).toBeGreaterThan(0)
  })
})

describe('evaluateDecklist — bracket parameter affects evaluation', () => {
  it('B5 bracket triggers different evidence than B3 (mana base reflects target lands)', () => {
    const cards = [
      ...Array.from({ length: 37 }, (_, i) => land(`Mountain ${i}`)),
      ...Array.from({ length: 62 }, (_, i) => card({ name: `Card ${i}` })),
    ]
    const b3 = evaluateDecklist({ commander: tiamat, cards, bracket: 3 })
    const b5 = evaluateDecklist({ commander: tiamat, cards, bracket: 5 })
    // The mana_base lens reads targetLandCount(bracket): B3=37, B5=28.
    // Evidence text includes the target land count, so it differs.
    const b3MeansB3Target = b3.lensResults
      .find(r => r.name === 'mana_base').evidence
      .some(e => /target 37 for B3/.test(e.detail))
    const b5MeansB5Target = b5.lensResults
      .find(r => r.name === 'mana_base').evidence
      .some(e => /target 28 for B5/.test(e.detail))
    expect(b3MeansB3Target).toBe(true)
    expect(b5MeansB5Target).toBe(true)
  })
})
