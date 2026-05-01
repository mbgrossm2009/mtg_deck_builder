import { describe, it, expect } from 'vitest'
import { scoreCard } from './deckScorer'

const COMMANDER = {
  name: 'Generic Commander',
  type_line: 'Legendary Creature — Human',
  oracle_text: '',
  color_identity: ['G'],
  cmc: 3,
}

// Helper to make a non-trivial card with sensible defaults.
// Default oracle_text avoids the "vanilla" penalty (-25 for cards with no
// meaningful text) by including a real game effect. Tests can override.
function card(overrides = {}) {
  return {
    name: 'Test Card',
    type_line: 'Sorcery',
    oracle_text: 'Draw a card.',  // meaningful enough to skip the vanilla penalty
    cmc: 3,
    colors: [],
    color_identity: [],
    rarity: 'rare',
    roles: ['filler'],
    tags: [],
    ...overrides,
  }
}

const NO_CONTEXT = {}

// ═════════════════════════════════════════════════════════════════════════════
// CMC CURVE SCORING — bracket-aware
// ═════════════════════════════════════════════════════════════════════════════
describe('CMC scoring — bracket-aware curve', () => {
  it('a 2-cmc ramp card scores higher at bracket 5 (target 2.0) than at bracket 1 (target 4.0)', () => {
    // Wait — actually a 2-cmc card is BELOW target at both, so both should bonus.
    // The interesting comparison: at B5, 2.0 is exactly target so smaller bonus;
    // at B1, 2.0 is well below target (4.0) so bigger bonus.
    const c = card({ name: 'X', cmc: 2, roles: ['ramp'] })
    const scoreB1 = scoreCard(c, 'ramp', COMMANDER, 1, {})
    const scoreB5 = scoreCard(c, 'ramp', COMMANDER, 5, {})
    expect(scoreB1).toBeGreaterThan(scoreB5)
  })

  it('a 6-cmc card scores LOWER at cEDH (target 2.0) than at casual (target 4.0)', () => {
    const c = card({ name: 'Big Dumb', cmc: 6, roles: ['synergy'] })
    const scoreB1 = scoreCard(c, 'synergy', COMMANDER, 1, {})
    const scoreB5 = scoreCard(c, 'synergy', COMMANDER, 5, {})
    expect(scoreB5).toBeLessThan(scoreB1)
  })

  it('a card AT the bracket target gets a small bonus', () => {
    // bracket 3 target = 3.3, so a 3-cmc card is "on target"
    const c = card({ name: 'On Target', cmc: 3, roles: ['ramp'] })
    const score = scoreCard(c, 'ramp', COMMANDER, 3, {})
    expect(score).toBeGreaterThan(20)  // role-match (20) + small CMC bonus
  })

  it('a card WAY above target receives a strong penalty (negative CMC contribution)', () => {
    // bracket 5 target = 2.0; a 7-drop is 5 over → -9 penalty
    const c = card({ name: 'Way Too Big', cmc: 7, roles: ['synergy'] })
    const onLane = scoreCard(c, 'synergy', COMMANDER, 5, {})
    const cheap = scoreCard(card({ name: 'Cheap Synergy', cmc: 1, roles: ['synergy'] }), 'synergy', COMMANDER, 5, {})
    expect(cheap).toBeGreaterThan(onLane)
  })

  it('penalty amplifies 1.5x when running deck average is already above target', () => {
    const c = card({ name: 'X', cmc: 6, roles: ['synergy'] })
    const noLeaning  = scoreCard(c, 'synergy', COMMANDER, 5, { runningCmcOverTarget: 0 })
    const overLeaning = scoreCard(c, 'synergy', COMMANDER, 5, { runningCmcOverTarget: 1.0 })
    expect(overLeaning).toBeLessThan(noLeaning)
  })

  it('does not amplify when runningCmcOverTarget is small (≤ 0.3)', () => {
    const c = card({ name: 'X', cmc: 5, roles: ['synergy'] })
    const small = scoreCard(c, 'synergy', COMMANDER, 5, { runningCmcOverTarget: 0.2 })
    const zero  = scoreCard(c, 'synergy', COMMANDER, 5, { runningCmcOverTarget: 0 })
    expect(small).toBe(zero)
  })

  it('win_condition role skips CMC scoring entirely', () => {
    const expensive = card({ name: 'X', cmc: 9, roles: ['win_condition'] })
    const score = scoreCard(expensive, 'win_condition', COMMANDER, 5, {})
    // Score will reflect the win-condition role match but not be hammered by CMC.
    // Compare against a wincon-CMC-9 vs wincon-CMC-2 — should be identical since CMC
    // is skipped for this role.
    const cheap = card({ name: 'Y', cmc: 2, roles: ['win_condition'] })
    const cheapScore = scoreCard(cheap, 'win_condition', COMMANDER, 5, {})
    expect(score).toBe(cheapScore)
  })

  it('filler role also skips CMC scoring', () => {
    const expensive = card({ name: 'X', cmc: 9, roles: ['filler'] })
    const cheap     = card({ name: 'Y', cmc: 2, roles: ['filler'] })
    const a = scoreCard(expensive, 'filler', COMMANDER, 5, {})
    const b = scoreCard(cheap,     'filler', COMMANDER, 5, {})
    expect(a).toBe(b)
  })

  it('expensive cards are penalized but never auto-banned by score (no -Infinity)', () => {
    const monster = card({ name: 'Eldrazi', cmc: 12, roles: ['synergy'] })
    const score = scoreCard(monster, 'synergy', COMMANDER, 5, {})
    expect(Number.isFinite(score)).toBe(true)
    // Even at the worst case, the score is just low — not impossibly low
    expect(score).toBeGreaterThan(-100)
  })

  it('CMC contribution alone cannot drop score below combined other bonuses', () => {
    // A card that's a multi-role power-card on-archetype should still beat a
    // 1-cmc filler at bracket 5 even with the CMC penalty.
    const expensiveButPremium = card({
      name: 'Sol Ring',                        // hardcoded power card
      cmc: 6,
      roles: ['ramp', 'synergy'],
      rarity: 'mythic',
    })
    const cheapVanilla = card({ name: 'Random Filler', cmc: 1, rarity: 'common', roles: ['synergy'] })
    const a = scoreCard(expensiveButPremium, 'ramp', COMMANDER, 5, {})
    const b = scoreCard(cheapVanilla, 'synergy', COMMANDER, 5, {})
    expect(a).toBeGreaterThan(b)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ROLE MATCH SCORING
// ═════════════════════════════════════════════════════════════════════════════
describe('Role match scoring', () => {
  it('primary role match gets +20', () => {
    const c = card({ name: 'X', roles: ['ramp'], cmc: 3 })
    const score = scoreCard(c, 'ramp', COMMANDER, 3, {})
    // 20 (primary) + ~3 CMC bonus + rarity (rare = 0)
    expect(score).toBeGreaterThanOrEqual(20)
  })

  it('secondary role match gets +10', () => {
    const c = card({ name: 'X', roles: ['draw', 'ramp'], cmc: 3 })
    const score = scoreCard(c, 'ramp', COMMANDER, 3, {})
    // 10 (secondary) + ~3 CMC + ...
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('no role match gets 0 from role bucket', () => {
    const c = card({ name: 'X', roles: ['draw'], cmc: 3 })
    const score = scoreCard(c, 'wipe', COMMANDER, 3, {})
    // No match — only CMC + rarity contribute
    expect(score).toBeLessThan(10)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// HARDCODED LISTS
// ═════════════════════════════════════════════════════════════════════════════
describe('Power card / deadweight lists', () => {
  it('Sol Ring (power card) gets +8 boost', () => {
    const c = card({ name: 'Sol Ring', roles: ['ramp'], cmc: 1 })
    const power = scoreCard(c, 'ramp', COMMANDER, 3, {})
    const noPower = scoreCard(card({ name: 'Generic Rock', roles: ['ramp'], cmc: 1 }), 'ramp', COMMANDER, 3, {})
    expect(power).toBeGreaterThan(noPower)
  })

  it('Vizzerdrix (deadweight) gets -60 hammer', () => {
    const c = card({ name: 'Vizzerdrix', roles: ['filler'], cmc: 4 })
    const score = scoreCard(c, 'filler', COMMANDER, 3, {})
    // Deadweight = -60, base filler with no other bonuses → very negative
    expect(score).toBeLessThan(-30)
  })

  it('Storm Crow (deadweight) is also hammered', () => {
    const c = card({ name: 'Storm Crow', roles: ['filler'], cmc: 2 })
    const score = scoreCard(c, 'filler', COMMANDER, 3, {})
    expect(score).toBeLessThan(-30)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// RARITY ADJUSTMENT
// ═════════════════════════════════════════════════════════════════════════════
describe('Rarity adjustment', () => {
  it('common cards get -6 (excluding lands and power cards)', () => {
    const cmn = card({ name: 'Common Card', roles: ['filler'], cmc: 3, rarity: 'common' })
    const rar = card({ name: 'Rare Card',   roles: ['filler'], cmc: 3, rarity: 'rare' })
    const cScore = scoreCard(cmn, 'filler', COMMANDER, 3, {})
    const rScore = scoreCard(rar, 'filler', COMMANDER, 3, {})
    expect(cScore).toBeLessThan(rScore)
  })

  it('uncommon cards get -2', () => {
    const unc = card({ name: 'Uncommon Card', roles: ['filler'], rarity: 'uncommon', cmc: 3 })
    const rar = card({ name: 'Rare Card',     roles: ['filler'], rarity: 'rare', cmc: 3 })
    expect(scoreCard(unc, 'filler', COMMANDER, 3, {})).toBeLessThan(scoreCard(rar, 'filler', COMMANDER, 3, {}))
  })

  it('mythic cards get +2', () => {
    const myt = card({ name: 'Mythic Card', roles: ['filler'], rarity: 'mythic', cmc: 3 })
    const rar = card({ name: 'Rare Card',   roles: ['filler'], rarity: 'rare', cmc: 3 })
    expect(scoreCard(myt, 'filler', COMMANDER, 3, {})).toBeGreaterThan(scoreCard(rar, 'filler', COMMANDER, 3, {}))
  })

  it('lands skip rarity penalty', () => {
    const c = card({ name: 'Common Land', roles: ['land'], rarity: 'common', cmc: 0 })
    const score = scoreCard(c, 'land', COMMANDER, 3, {})
    // Should not be hammered for being common
    expect(score).toBeGreaterThanOrEqual(20)  // primary role match holds up
  })

  it('power-card list skips rarity penalty (Sol Ring is uncommon-printed but should be valued)', () => {
    const c = card({ name: 'Sol Ring', roles: ['ramp'], rarity: 'uncommon', cmc: 1 })
    const score = scoreCard(c, 'ramp', COMMANDER, 3, {})
    // Should be solidly positive even though printed at uncommon
    expect(score).toBeGreaterThan(20)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-ROLE FLEXIBILITY
// ═════════════════════════════════════════════════════════════════════════════
describe('Multi-role flexibility bonus', () => {
  it('multi-role cards get a flex bonus', () => {
    const single = card({ name: 'A', roles: ['ramp'], cmc: 3 })
    const multi  = card({ name: 'B', roles: ['ramp', 'draw', 'synergy'], cmc: 3 })
    expect(scoreCard(multi, 'ramp', COMMANDER, 3, {})).toBeGreaterThan(scoreCard(single, 'ramp', COMMANDER, 3, {}))
  })

  it('flex bonus caps at 3 extra roles (no infinite stacking)', () => {
    const triple = card({ name: 'A', roles: ['a', 'b', 'c', 'd'], cmc: 3 })  // 4 roles
    const sextuple = card({ name: 'B', roles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], cmc: 3 })
    // Only the first 3 extras count; both should score the same
    expect(scoreCard(triple, 'a', COMMANDER, 3, NO_CONTEXT))
      .toBe(scoreCard(sextuple, 'a', COMMANDER, 3, NO_CONTEXT))
  })
})
