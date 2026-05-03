// stripFalseAboveBracketClaims tests.
//
// The eval LLM consistently writes "Card X pushes this above bracket" in
// weaknesses even when bracket_fit lens verdict is 'pass'. The eval prompt
// forbids this (CARDS-LEGAL-AT-BRACKET RULE), but the model has a strong
// prior to mention these phrases anyway. stripFalseAboveBracketClaims is
// the belt-and-suspenders fix that removes those sentences after the fact.

import { describe, it, expect } from 'vitest'
import { stripFalseAboveBracketClaims } from './llmDeckService'

const passLens = { name: 'bracket_fit', verdict: 'pass' }
const failLens = { name: 'bracket_fit', verdict: 'fail' }
const warnLens = { name: 'bracket_fit', verdict: 'warn' }

const baseEval = {
  score: 8,
  summary: 'Solid B4 deck.',
  topStrength: 'Strong synergy.',
  strengths: ['90% commander-relevant.', 'Good mana base.'],
  weaknesses: [],
  bracketFitNotes: '',
}

describe('stripFalseAboveBracketClaims — only acts when bracket_fit verdict is pass', () => {
  it('does NOT strip when bracket_fit verdict is fail (LLM may be right)', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: ['Demonic Tutor pushes this above bracket.'],
    }
    const out = stripFalseAboveBracketClaims(evalIn, failLens)
    expect(out.weaknesses).toContain('Demonic Tutor pushes this above bracket.')
  })

  it('does NOT strip when bracket_fit verdict is warn', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: ['Pushes the deck above bracket.'],
    }
    const out = stripFalseAboveBracketClaims(evalIn, warnLens)
    expect(out.weaknesses).toContain('Pushes the deck above bracket.')
  })

  it('does NOT strip when bracket_fit lens is missing', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: ['Pushes above bracket.'],
    }
    const out = stripFalseAboveBracketClaims(evalIn, null)
    expect(out.weaknesses).toContain('Pushes above bracket.')
  })

  it('STRIPS "pushes above bracket" when verdict is pass', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: [
        'Demonic Tutor pushes this above the target bracket.',
        '90% of slots advance the strategy.',
      ],
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out.weaknesses).not.toContain('Demonic Tutor pushes this above the target bracket.')
    expect(out.weaknesses).toContain('90% of slots advance the strategy.')
  })

  it('STRIPS "over-tuned for B4" variants', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: [
        'The deck is slightly over-tuned for B4.',
        'Real strategy concern: lacks counterspells.',
      ],
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out.weaknesses).toHaveLength(1)
    expect(out.weaknesses[0]).toMatch(/counterspells/)
  })

  it('STRIPS bracketFitNotes sentence when it claims above-bracket', () => {
    const evalIn = {
      ...baseEval,
      bracketFitNotes:
        'The deck functions in B4. Several powerful cards push it above the intended bracket. Mana base is fine.',
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    // The forbidden middle sentence dropped; the others survive.
    expect(out.bracketFitNotes).not.toMatch(/push it above the intended bracket/)
    expect(out.bracketFitNotes).toMatch(/functions in B4/)
    expect(out.bracketFitNotes).toMatch(/Mana base is fine/)
  })

  it('replaces empty bracketFitNotes with a fallback when all sentences stripped', () => {
    const evalIn = {
      ...baseEval,
      bracketFitNotes: 'The deck is slightly over-tuned for B4.',
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out.bracketFitNotes).toMatch(/bracket-legal/)
  })

  it('returns the original object when nothing is stripped', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: ['Lacks card draw.', 'Mana base could fix better.'],
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out).toBe(evalIn)   // no clone, no mutation
  })

  it('counts strips via _stripped.aboveBracketClaims', () => {
    const evalIn = {
      ...baseEval,
      weaknesses: [
        'Bumps deck significantly above the target bracket.',
        'Pushes this above bracket.',
        'Mana base is solid.',
      ],
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out._stripped.aboveBracketClaims).toBe(2)
  })

  it('does not crash on null input', () => {
    expect(() => stripFalseAboveBracketClaims(null, passLens)).not.toThrow()
    expect(stripFalseAboveBracketClaims(null, passLens)).toBeNull()
  })
})

// Phrase coverage from real eval-LLM output. Each entry below is a sentence
// the LLM has actually emitted in production runs. When the model invents a
// new euphemism for "above bracket," add the example here AND extend
// ABOVE_BRACKET_PHRASES in llmDeckService.js.
describe('stripFalseAboveBracketClaims — empirical phrase coverage', () => {
  const empiricalPhrases = [
    // run 0a6b4372 — Sorin B3
    'The presence of several high-powered cards like Chrome Mox and Demonic Tutor pushes the deck towards a higher competitive bracket than intended.',
    // run 0a6b4372 — Daxos B3
    'Despite passing the bracket fit, the presence of certain cards suggests the deck is leaning towards higher tiers.',
    // run 0a6b4372 — Daxos B4
    'Despite fitting the actual bracket as B4, the presence of multiple high-impact ramp cards creates a sense of higher power, potentially impacting game balance.',
    // run 0a6b4372 — Amalia B5 (built at B4 due to cap)
    'The deck matches the target bracket of 4, but the number of high-impact cards suggests it could feel more like a B5 deck due to the excessive tutor and ramp density.',
    // historical — over-tuned variants
    'The deck feels slightly over-tuned for B4.',
    'Slightly over-tuned for B4.',
    // historical — bracket mismatch language
    'This may lead to a power-level mismatch in casual play.',
    // run a606abe3 — Daxos B5
    'Indicating a potential mismatch.',
    // run a606abe3 — Sorin B3 (synonym for "above bracket")
    'The presence of multiple cards exceeds the target bracket.',
    // run a606abe3 — Daxos B4
    'The deck includes too many high-impact cards that could lead to a more competitive feel than intended for B4.',
  ]

  it.each(empiricalPhrases)('strips: %s', (phrase) => {
    const evalIn = {
      ...baseEval,
      weaknesses: [phrase, 'Unrelated weakness about card draw.'],
    }
    const out = stripFalseAboveBracketClaims(evalIn, passLens)
    expect(out.weaknesses).not.toContain(phrase)
    // Unrelated weakness should survive.
    expect(out.weaknesses).toContain('Unrelated weakness about card draw.')
  })
})
