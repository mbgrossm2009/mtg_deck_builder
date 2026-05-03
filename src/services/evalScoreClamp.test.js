// Eval score clamp tests.
//
// The clamp post-processes raw LLM eval output. It exists because
// gpt-4o-mini sometimes returns inflated scores (8/9) on decks with
// severe quality issues (zero wincons, runaway filler, near-zero
// commander execution). When the math says "this deck is bad," the
// score must reflect that.
//
// Severity tiers:
//   fatal  → cap at ≤5
//   severe → cap at ≤6
//   mild   → no cap

import { describe, it, expect } from 'vitest'
import { classifyQualitySignals, clampEvalScore } from './evalScoreClamp'

const eval8 = {
  score: 8,
  summary: 'Strong deck with great mana base.',
  strengths: ['x', 'y'],
  weaknesses: [],
  bracketFitNotes: '',
}

describe('classifyQualitySignals — fatal triggers', () => {
  it('fatal: filler runaway (> 2× cap)', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 14, fillerCap: 6,    // 14 > 12
    })
    expect(issues.find(i => i.kind === 'filler_runaway')).toBeDefined()
    expect(issues[0].severity).toBe('fatal')
  })

  it('fatal: zero wincons at B3+ (no single-card AND no detected pattern)', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 5, fillerCap: 6,
      wincons: 0, detectedWincons: [],
    })
    expect(issues.find(i => i.kind === 'no_win_plan')).toBeDefined()
    expect(issues.find(i => i.kind === 'no_win_plan').severity).toBe('fatal')
  })

  it('NO no_win_plan when single-card wincon exists', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 5, fillerCap: 6,
      wincons: 2, detectedWincons: [],
    })
    expect(issues.find(i => i.kind === 'no_win_plan')).toBeUndefined()
  })

  it('NO no_win_plan when multi-card pattern exists', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 5, fillerCap: 6,
      wincons: 0, detectedWincons: ['aristocrats: sac outlet + Blood Artist'],
    })
    expect(issues.find(i => i.kind === 'no_win_plan')).toBeUndefined()
  })

  it('NO no_win_plan at B1/B2 (only B3+ enforced)', () => {
    const issuesB1 = classifyQualitySignals({
      bracket: 1, fillerCount: 5, fillerCap: 12,
      wincons: 0, detectedWincons: [],
    })
    const issuesB2 = classifyQualitySignals({
      bracket: 2, fillerCount: 5, fillerCap: 9,
      wincons: 0, detectedWincons: [],
    })
    expect(issuesB1.find(i => i.kind === 'no_win_plan')).toBeUndefined()
    expect(issuesB2.find(i => i.kind === 'no_win_plan')).toBeUndefined()
  })
})

describe('classifyQualitySignals — severe triggers', () => {
  it('severe: filler over cap but not 2×', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 8, fillerCap: 6,    // 6 < 8 ≤ 12
    })
    expect(issues.find(i => i.kind === 'filler_high')).toBeDefined()
    expect(issues.find(i => i.kind === 'filler_high').severity).toBe('severe')
    // Should NOT also fire filler_runaway
    expect(issues.find(i => i.kind === 'filler_runaway')).toBeUndefined()
  })

  it('severe: execution < half threshold', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 0, fillerCap: 6,
      executionScore: 0.15, executionThreshold: 0.40,
    })
    expect(issues.find(i => i.kind === 'execution_low')).toBeDefined()
    expect(issues.find(i => i.kind === 'execution_low').severity).toBe('severe')
  })

  it('NO execution_low when score is at or above half threshold', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 0, fillerCap: 6,
      executionScore: 0.20, executionThreshold: 0.40,    // exactly half — borderline OK
    })
    expect(issues.find(i => i.kind === 'execution_low')).toBeUndefined()
  })
})

describe('classifyQualitySignals — no false positives', () => {
  it('clean deck produces zero issues', () => {
    const issues = classifyQualitySignals({
      bracket: 3, fillerCount: 4, fillerCap: 6,
      wincons: 3, detectedWincons: ['aristocrats: ...'],
      executionScore: 0.55, executionThreshold: 0.40,
    })
    expect(issues).toEqual([])
  })

  it('does not crash on missing optional fields', () => {
    expect(() => classifyQualitySignals({ bracket: 3 })).not.toThrow()
    expect(() => classifyQualitySignals({})).not.toThrow()
  })
})

describe('clampEvalScore — clamp-to-5 (fatal)', () => {
  it('clamps score 8 → 5 when filler is runaway', () => {
    const result = clampEvalScore(eval8, {
      bracket: 3, fillerCount: 20, fillerCap: 6,
    })
    expect(result.score).toBe(5)
    expect(result._clampedFrom).toBe(8)
    expect(result.summary).toMatch(/score clamped from 8 to 5/)
    expect(result.summary).toMatch(/20 true-filler/)
  })

  it('clamps score 9 → 5 when no win plan at B4', () => {
    const eval9 = { ...eval8, score: 9 }
    const result = clampEvalScore(eval9, {
      bracket: 4, fillerCount: 0, fillerCap: 3,
      wincons: 0, detectedWincons: [],
    })
    expect(result.score).toBe(5)
    expect(result.summary).toMatch(/no detected single-card wincon/)
  })
})

describe('clampEvalScore — clamp-to-6 (severe only)', () => {
  it('clamps score 8 → 6 when execution is below half threshold (severe)', () => {
    const result = clampEvalScore(eval8, {
      bracket: 3, fillerCount: 0, fillerCap: 6,
      wincons: 2, detectedWincons: [],         // no fatal no_win_plan
      executionScore: 0.10, executionThreshold: 0.40,
    })
    expect(result.score).toBe(6)
    expect(result._clampedFrom).toBe(8)
  })

  it('clamps score 8 → 6 when filler is high but not runaway', () => {
    const result = clampEvalScore(eval8, {
      bracket: 3, fillerCount: 9, fillerCap: 6,    // severe but not 2×
      wincons: 2, detectedWincons: [],         // no fatal no_win_plan
    })
    expect(result.score).toBe(6)
  })

  it('does NOT clamp when score is already ≤ cap', () => {
    const eval4 = { ...eval8, score: 4 }
    const result = clampEvalScore(eval4, {
      bracket: 3, fillerCount: 20, fillerCap: 6,    // would clamp to 5, but 4 is already lower
    })
    expect(result.score).toBe(4)
    expect(result._clampedFrom).toBeUndefined()
    expect(result.summary).toBe(eval4.summary)         // untouched
  })
})

describe('clampEvalScore — fatal beats severe', () => {
  it('uses the lower cap when both fatal and severe issues exist', () => {
    const result = clampEvalScore(eval8, {
      bracket: 3, fillerCount: 20, fillerCap: 6,    // fatal: clamp to 5
      executionScore: 0.10, executionThreshold: 0.40,    // severe: clamp to 6
    })
    expect(result.score).toBe(5)                    // fatal wins
  })
})

describe('clampEvalScore — passthrough cases', () => {
  it('returns input unchanged when no issues', () => {
    const result = clampEvalScore(eval8, {
      bracket: 3, fillerCount: 4, fillerCap: 6,
      wincons: 2, detectedWincons: [],
    })
    expect(result).toBe(eval8)        // strict identity — same object
  })

  it('passes through null eval result (LLM call failed)', () => {
    const result = clampEvalScore(null, {
      bracket: 3, fillerCount: 20, fillerCap: 6,
    })
    expect(result).toBeNull()
  })

  it('passes through eval with no numeric score', () => {
    const broken = { score: 'invalid', summary: 'x' }
    const result = clampEvalScore(broken, {
      bracket: 3, fillerCount: 20, fillerCap: 6,
    })
    expect(result).toBe(broken)
  })
})

describe('clampEvalScore — preserves other eval fields', () => {
  it('keeps strengths and weaknesses untouched', () => {
    const evalRich = {
      score: 8, summary: 'Original',
      strengths: ['s1', 's2'], weaknesses: ['w1'],
      bracketFitNotes: 'notes', _meta: { promptTokens: 100 },
    }
    const result = clampEvalScore(evalRich, {
      bracket: 3, fillerCount: 20, fillerCap: 6,
    })
    expect(result.strengths).toEqual(['s1', 's2'])
    expect(result.weaknesses).toEqual(['w1'])
    expect(result.bracketFitNotes).toBe('notes')
    expect(result._meta).toEqual({ promptTokens: 100 })
  })
})
