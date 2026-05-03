// WinPlanLens — does this deck have a coherent way to win?
//
// A win plan is "single-card wincon" OR "detected multi-card pattern."
// Combat damage from undifferentiated creatures is NOT a win plan unless
// the commander supports a recognized shape (extra_combat,
// combat_damage_draw, tribal_anthem with density).

import { detectMultiCardWincons } from '../../services/llmDeckOrchestrator'

const WINCON_TARGET_BY_BRACKET = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 1 }

export const WinPlanLens = {
  name: 'win_plan',

  /**
   * @param {import('../lens.js').LensInput} input
   * @returns {import('../lens.js').LensResult}
   */
  evaluate({ deck, commanderProfile, context = {} }) {
    const bracket = context.targetBracket ?? 3

    const singleCardWincons = deck.filter(c =>
      (c.roles ?? []).includes('win_condition') ||
      (c.tags ?? []).includes('explosive_finisher')
    )
    const detectedPatterns = detectMultiCardWincons(
      deck,
      { archetypes: commanderProfile.archetypes },
      { name: commanderProfile.name, oracle_text: commanderProfile.oracleText ?? '' }
    )

    const total = singleCardWincons.length + detectedPatterns.length
    const target = WINCON_TARGET_BY_BRACKET[bracket] ?? 2

    let verdict
    if (total >= target) verdict = 'pass'
    else if (total > 0) verdict = 'warn'
    else verdict = 'fail'

    const evidence = []
    for (const wc of singleCardWincons) {
      evidence.push({ kind: 'single_card_wincon', card: wc.name, detail: 'Tagged win_condition' })
    }
    for (const pattern of detectedPatterns) {
      evidence.push({ kind: 'multi_card_pattern', detail: pattern })
    }
    if (total === 0 && bracket >= 3) {
      evidence.push({
        kind: 'no_plan',
        detail: 'No detected single-card wincon AND no multi-card pattern. ' +
                'Deck has no recognizable way to close a game.',
      })
    }

    const suggestions = []
    if (verdict === 'fail') {
      // Suggest patterns the commander naturally supports
      const shapes = commanderProfile.bracket?.winPlanShapes ?? []
      if (shapes.length > 0) {
        suggestions.push(
          `Build toward ${shapes[0]}: this commander naturally supports it. ` +
          (shapes[0] === 'aristocrats' ? 'Add a sac outlet + Blood Artist class drain payoff.' :
           shapes[0] === 'etb_drain' ? 'Add token producers + Impact Tremors / Purphoros.' :
           shapes[0] === 'combat_damage_draw' ? 'Add evasive creatures + Bident of Thassa / Coastal Piracy.' :
           shapes[0] === 'extra_combat' ? 'Add Aggravated Assault / Hellkite Charger + creature density.' :
           shapes[0] === 'tribal_anthem' ? 'Add 2+ tribal lords + 18+ on-tribe creatures.' :
           'Add a combo line or finisher.')
        )
      } else {
        suggestions.push('Add at least one named win condition (Thassa\'s Oracle, Aetherflux Reservoir, Craterhoof Behemoth, etc.) ')
      }
    } else if (verdict === 'warn' && total < target) {
      suggestions.push(`Add ${target - total} more wincon(s) for redundancy at B${bracket}`)
    }

    return {
      name: this.name,
      score: total >= target ? 1 : (total / target),
      verdict,
      summary: total === 0
        ? `No win plan detected (B${bracket} target: ${target}+)`
        : `${total} wincon${total === 1 ? '' : 's'} detected: ` +
          [...singleCardWincons.map(c => c.name), ...detectedPatterns].slice(0, 3).join('; ') +
          (total > 3 ? ` (+${total - 3} more)` : ''),
      evidence,
      suggestions,
      _raw: { singleCardWincons: singleCardWincons.length, detectedPatterns },
    }
  },
}
