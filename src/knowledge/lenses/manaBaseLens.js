// ManaBaseLens — does the deck have appropriate land count, fixing,
// and ramp for its commander and bracket?
//
// Wraps targetLandCount + role counting + commander CMC expectations.

import { targetLandCount } from '../../rules/bracketRules'

export const ManaBaseLens = {
  name: 'mana_base',

  /**
   * @param {import('../lens.js').LensInput} input
   * @returns {import('../lens.js').LensResult}
   */
  evaluate({ deck, commanderProfile, context = {} }) {
    const bracket = context.targetBracket ?? 3
    const lands = deck.filter(c => (c.type_line ?? '').toLowerCase().includes('land'))
    const basics = lands.filter(c => c.isBasicLand || /^basic land/i.test(c.type_line ?? ''))
    const ramp = deck.filter(c => (c.roles ?? []).includes('ramp'))

    const targetLands = targetLandCount(bracket)
    const minRamp = commanderProfile.expectations?.minRamp ?? 6
    const colorCount = commanderProfile.colorIdentity.length

    const evidence = []
    const suggestions = []
    let verdicts = []

    // Check 1: land count
    const landDelta = lands.length - targetLands
    if (landDelta < -2) {
      verdicts.push('fail')
      evidence.push({
        kind: 'land_low',
        detail: `${lands.length} lands; B${bracket} target is ${targetLands}`,
      })
      suggestions.push(`Add ${targetLands - lands.length} more lands`)
    } else {
      evidence.push({
        kind: 'land_count',
        detail: `${lands.length} lands (target ${targetLands} for B${bracket})`,
      })
    }

    // Check 2: ramp count vs commander CMC
    if (ramp.length < minRamp) {
      verdicts.push('warn')
      evidence.push({
        kind: 'ramp_low',
        detail: `${ramp.length} ramp pieces; commander CMC ${commanderProfile.cmc} needs ${minRamp}+`,
      })
      suggestions.push(`Add ${minRamp - ramp.length} more ramp piece${minRamp - ramp.length === 1 ? '' : 's'} (high-CMC commander)`)
    } else {
      evidence.push({
        kind: 'ramp_count',
        detail: `${ramp.length} ramp (target ${minRamp}+ for CMC ${commanderProfile.cmc})`,
      })
    }

    // Check 3: 5-color decks shouldn't be > 60% basics
    if (colorCount >= 5) {
      const basicRatio = lands.length > 0 ? basics.length / lands.length : 0
      if (basicRatio > 0.6) {
        verdicts.push('warn')
        evidence.push({
          kind: 'basic_heavy_5c',
          detail: `${(basicRatio * 100).toFixed(0)}% of lands are basics — 5-color needs more fixing`,
        })
        suggestions.push('Add more dual lands / triomes / fetches for color fixing')
      }
    }

    // Check 4: mono-color decks should have 0 off-color land identity
    if (colorCount === 1) {
      const offColor = lands.filter(c => {
        const ci = c.color_identity ?? []
        return ci.some(color => !commanderProfile.colorIdentity.includes(color))
      })
      if (offColor.length > 0) {
        verdicts.push('fail')
        evidence.push({
          kind: 'off_color_lands',
          detail: `${offColor.length} land(s) outside the commander's color identity`,
        })
        suggestions.push('Remove off-color lands (illegal in mono-color)')
      }
    }

    // Aggregate verdict: worst wins.
    const verdict = verdicts.includes('fail') ? 'fail'
                  : verdicts.includes('warn') ? 'warn'
                  : 'pass'

    const score = verdict === 'pass' ? 1 : verdict === 'warn' ? 0.6 : 0.3

    return {
      name: this.name,
      score,
      verdict,
      summary: `${lands.length} lands, ${ramp.length} ramp; ` +
               (colorCount >= 5 ? `${(basics.length / Math.max(lands.length, 1) * 100).toFixed(0)}% basics; ` : '') +
               (verdict === 'pass' ? 'mana base looks solid' : verdict === 'warn' ? 'mana base has weaknesses' : 'mana base is broken'),
      evidence,
      suggestions,
      _raw: { lands: lands.length, basics: basics.length, ramp: ramp.length, targetLands, minRamp, colorCount },
    }
  },
}
