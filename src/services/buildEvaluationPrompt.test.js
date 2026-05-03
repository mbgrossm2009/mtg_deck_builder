// buildEvaluationPrompt tests — focused on the Phase 6 lens-output
// integration. The eval prompt should send structured lens verdicts so
// the LLM grades our analysis instead of redoing it from scratch.

import { describe, it, expect } from 'vitest'
import { buildEvaluationPrompt } from './llmPromptBuilder'

const commander = {
  name: 'Tiamat',
  type_line: 'Legendary Creature — Dragon God',
  oracle_text: 'When Tiamat enters, search your library for up to five Dragon cards.',
  mana_cost: '{4}{W}{U}{B}{R}{G}', cmc: 7,
  colors: ['W','U','B','R','G'], color_identity: ['W','U','B','R','G'],
  legalities: { commander: 'legal' }, rarity: 'mythic',
}

const card = (n, role) => ({ name: n, roles: [role], cmc: 3, type_line: 'Creature' })

describe('buildEvaluationPrompt — lens_verdicts is in the user payload', () => {
  it('passes lensResults verbatim into user.lens_verdicts', () => {
    const lensResults = [
      {
        name: 'commander_execution', score: 0.65, verdict: 'pass',
        summary: '65% commander-relevant',
        evidence: [{ kind: 'on_plan_count', detail: '24 of 37 on plan' }],
        suggestions: [],
      },
      {
        name: 'win_plan', score: 1.0, verdict: 'pass',
        summary: '2 wincons detected',
        evidence: [{ kind: 'multi_card_pattern', detail: 'aristocrats: ...' }],
        suggestions: [],
      },
    ]
    const { user } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')],
      lensResults,
    })
    expect(Array.isArray(user.lens_verdicts)).toBe(true)
    expect(user.lens_verdicts).toHaveLength(2)
    expect(user.lens_verdicts[0].lens).toBe('commander_execution')
    expect(user.lens_verdicts[0].verdict).toBe('pass')
    expect(user.lens_verdicts[0].evidence).toHaveLength(1)
  })

  it('omits lens_verdicts gracefully when no lensResults provided', () => {
    const { user } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')],
    })
    // The field should still be present (empty array) for stable shape.
    expect(Array.isArray(user.lens_verdicts)).toBe(true)
    expect(user.lens_verdicts).toEqual([])
  })

  it('lens_verdicts comes BEFORE deck array in payload (LLM weighting)', () => {
    const lensResults = [{
      name: 'win_plan', score: 0, verdict: 'fail',
      summary: 'no plan', evidence: [], suggestions: [],
    }]
    const { user } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')], lensResults,
    })
    const keys = Object.keys(user)
    expect(keys.indexOf('lens_verdicts')).toBeLessThan(keys.indexOf('deck'))
  })

  it('Phase 8: legacy counts/detected_wincon_patterns/commander_execution fields removed', () => {
    // Those fields are no longer in the user payload — lens_verdicts is
    // the single source of truth for analytical signals.
    const { user } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')],
      lensResults: [],
    })
    expect(user.counts).toBeUndefined()
    expect(user.detected_wincon_patterns).toBeUndefined()
    expect(user.commander_execution).toBeUndefined()
  })
})

describe('buildEvaluationPrompt — system prompt instructs LLM on lens verdicts', () => {
  it('system prompt mentions lens_verdicts and how to use it', () => {
    const { system } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')],
    })
    expect(system).toMatch(/lens_verdicts/)
    expect(system).toMatch(/grade our analysis/i)
  })

  it('system prompt warns NOT to ignore fail verdicts', () => {
    const { system } = buildEvaluationPrompt({
      commander, bracket: 3, deck: [card('A', 'synergy')],
    })
    expect(system).toMatch(/fail/i)
  })
})
