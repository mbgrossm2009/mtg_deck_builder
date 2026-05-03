// BracketFitLens — does the deck's actual computed bracket match the
// requested target?
//
// Wraps computeActualBracket. Pass = actual ≤ target. Warn = actual is
// 1 over (overshoots by combo or fast-mana density). Fail = actual is
// 2+ over (deck is at a substantially higher power level than requested).

import { detectCombos } from '../../rules/comboRules'
import { computeActualBracket } from '../../rules/bracketRules'

export const BracketFitLens = {
  name: 'bracket_fit',

  /**
   * @param {import('../lens.js').LensInput} input
   * @returns {import('../lens.js').LensResult}
   */
  evaluate({ deck, commanderProfile, context = {} }) {
    const target = context.targetBracket ?? 3
    const combos = detectCombos(deck.map(c => c.name))
    const { actualBracket, flaggedCards } = computeActualBracket(deck, combos)

    const overshoot = actualBracket - target
    let verdict
    if (overshoot <= 0) verdict = 'pass'
    else if (overshoot === 1) verdict = 'warn'
    else verdict = 'fail'

    const evidence = []
    evidence.push({
      kind: 'actual_bracket',
      detail: `Actual bracket: ${actualBracket} (target: ${target})`,
    })
    if (flaggedCards.length > 0) {
      for (const cardName of flaggedCards.slice(0, 8)) {
        evidence.push({ kind: 'offender', card: cardName, detail: 'Bumps the deck above target bracket' })
      }
      if (flaggedCards.length > 8) {
        evidence.push({
          kind: 'offender_overflow',
          detail: `+${flaggedCards.length - 8} more flagged cards`,
        })
      }
    }
    for (const combo of combos.slice(0, 3)) {
      evidence.push({
        kind: 'combo',
        detail: `${combo.cards.join(' + ')} — ${combo.description}`,
      })
    }

    const suggestions = []
    if (verdict === 'fail') {
      suggestions.push(`Remove combo pieces / excess fast mana / excess tutors to bring actualBracket from ${actualBracket} down to ${target}`)
    } else if (verdict === 'warn') {
      suggestions.push(`Deck overshoots target by 1 — acceptable but consider trimming 2-3 high-power cards if you want a clean ${target} fit`)
    }

    return {
      name: this.name,
      score: overshoot <= 0 ? 1 : Math.max(0, 1 - overshoot * 0.4),
      verdict,
      summary: overshoot <= 0
        ? `Actual bracket ${actualBracket} matches or is below target ${target}`
        : `Deck plays at bracket ${actualBracket}, ${overshoot} above target ${target}`,
      evidence,
      suggestions,
      _raw: { actualBracket, target, overshoot, flaggedCards, combos },
    }
  },
}
