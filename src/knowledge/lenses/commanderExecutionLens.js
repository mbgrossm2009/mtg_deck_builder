// CommanderExecutionLens — what fraction of non-land non-staple slots
// actually advance the commander's plan?
//
// Wraps the existing computeCommanderExecutionScore but returns the
// structured Lens shape (verdict, evidence, suggestions) so consumers
// can show specific cards instead of just a number.

import { computeCommanderExecutionScore, getExecutionThresholdForBracket } from '../../rules/commanderExecution'

export const CommanderExecutionLens = {
  name: 'commander_execution',

  /**
   * @param {import('../lens.js').LensInput} input
   * @returns {import('../lens.js').LensResult}
   */
  evaluate({ deck, commanderProfile, context = {} }) {
    const bracket = context.targetBracket ?? 3
    const result = computeCommanderExecutionScore({
      deck,
      commander: { name: commanderProfile.name },
      mechanicTags: commanderProfile.mechanicTags,
      anchorNames: commanderProfile.anchorNames,
    })

    const threshold = getExecutionThresholdForBracket(bracket)
    let verdict
    if (result.considered === 0) verdict = 'info'
    else if (result.score >= threshold) verdict = 'pass'
    else if (result.score >= threshold * 0.5) verdict = 'warn'
    else verdict = 'fail'

    const evidence = []
    if (result.relevant > 0) {
      evidence.push({
        kind: 'on_plan_count',
        detail: `${result.relevant} of ${result.considered} non-staple slots advance ${commanderProfile.name}'s plan ` +
                `(synergy: ${result.ofWhich.synergy}, mechanic: ${result.ofWhich.mechanicTag}, ` +
                `tribal: ${result.ofWhich.tribal}, anchor: ${result.ofWhich.anchor})`,
      })
    }
    if (verdict === 'fail' || verdict === 'warn') {
      evidence.push({
        kind: 'threshold_miss',
        detail: `Score ${(result.score * 100).toFixed(0)}% vs B${bracket} target ${(threshold * 100).toFixed(0)}%`,
      })
    }

    const suggestions = []
    if (verdict === 'fail') {
      suggestions.push(`Replace generic-goodstuff slots with cards that have a ${commanderProfile.mechanicTags.slice(0, 3).join(', ') || 'commander-relevant'} tag`)
      if (commanderProfile.tribal.tribe) {
        suggestions.push(`Add more on-tribe ${commanderProfile.tribal.tribe} creatures`)
      }
    } else if (verdict === 'warn') {
      suggestions.push(`Marginal — replace 2-3 weak slots with cards matching the commander's mechanics`)
    }

    return {
      name: this.name,
      score: result.score,
      verdict,
      summary: `${(result.score * 100).toFixed(0)}% of slots are commander-relevant ` +
               `(target ${(threshold * 100).toFixed(0)}% at B${bracket})`,
      evidence,
      suggestions,
      _raw: result,
    }
  },
}
