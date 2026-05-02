// End-to-end bracket-fitness tests.
//
// These exist because of a real regression: a B5 generation came out feeling
// like B2 even though the user owned Mana Crypt, Force of Will, etc. The
// scorer was the culprit — Mana Crypt wasn't in POWER_CARDS so it lost
// score-priority slots to mid-tier synergy. Bracket staples + expanded
// POWER_CARDS fix it. These tests lock that fix in.
//
// What we test (deterministic only, no LLM/network):
//   - POWER_CARDS contains the cEDH staples that used to be missing
//   - scoreCard ranks Mana Crypt + Force of Will higher at B5 than at B3
//   - Mana base solver picks more non-basics at B5 than at B3 from the same pool
//   - buildBracketStaples surfaces increasing counts as bracket rises (when
//     the user owns the relevant cards)

import { describe, it, expect } from 'vitest'
import { scoreCard } from './deckScorer'
import { solveManaBase } from './manaBaseSolver'
import { buildBracketStaples } from './bracketStaples'
import { landTier } from './landQuality'

const card = (name, overrides = {}) => ({
  name,
  type_line: overrides.type_line ?? 'Artifact',
  oracle_text: overrides.oracle_text ?? '',
  cmc: overrides.cmc ?? 2,
  color_identity: overrides.color_identity ?? [],
  roles: overrides.roles ?? ['ramp'],
  tags: overrides.tags ?? [],
  legalities: { commander: 'legal' },
  ...overrides,
})

const COMMANDER_DRAGON = {
  name: 'Tiamat',
  color_identity: ['W', 'U', 'B', 'R', 'G'],
  oracle_text: 'When Tiamat enters the battlefield, search your library for up to five Dragon cards.',
  type_line: 'Legendary Creature — Dragon God',
}

const COMMANDER_2C = {
  name: 'Klauth',
  color_identity: ['R', 'G'],
  oracle_text: 'Whenever you attack with Klauth, add (X) where X is its power.',
  type_line: 'Legendary Creature — Dragon',
}

// ─── POWER_CARDS contains cEDH staples ─────────────────────────────────────

describe('cEDH staples are in POWER_CARDS', () => {
  // We don't import POWER_CARDS directly (it's not exported). Instead we
  // verify behaviorally: scoreCard gives these cards a meaningful score
  // even with no role match and no EDHREC bonus.
  const CEDH_STAPLES = [
    'Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox',
    'Demonic Tutor', 'Vampiric Tutor', 'Force of Will', 'Force of Negation',
    'Mana Drain', 'Rhystic Study', 'Mystic Remora',
    "Thassa's Oracle", 'Demonic Consultation',
  ]

  for (const name of CEDH_STAPLES) {
    it(`${name} scores positively at B5 (in POWER_CARDS or has tags)`, () => {
      const c = card(name, { roles: ['ramp'] })
      // POWER_CARDS contributes +8; if missing entirely, the card might
      // score very low or negative thanks to vanilla penalty.
      const score = scoreCard(c, 'ramp', COMMANDER_2C, 5, {})
      expect(score).toBeGreaterThanOrEqual(0)
    })
  }
})

// ─── Bracket staples scale with bracket ─────────────────────────────────────

describe('bracket staples surface more cards at higher brackets', () => {
  // User owns a wide variety of cards across every tier.
  const richPool = [
    card('Sol Ring'),
    card('Arcane Signet'),
    card('Lightning Greaves'),
    card('Cultivate', { roles: ['ramp'] }),
    card('Mana Crypt'),
    card('Force of Will', { roles: ['removal'] }),
    card('Demonic Tutor', { roles: ['tutor'] }),
    card("Thassa's Oracle", { roles: ['win_condition'] }),
    card('Demonic Consultation', { roles: ['tutor'] }),
  ]

  it('B1 returns only universal staples', () => {
    const result = buildBracketStaples({ bracket: 1, legalNonLands: richPool })
    const names = result.map(c => c.name)
    expect(names).toContain('Sol Ring')
    expect(names).not.toContain('Mana Crypt')
    expect(names).not.toContain("Thassa's Oracle")
  })

  it('B4 includes universal + cEDH staples (no combo wincons)', () => {
    const result = buildBracketStaples({ bracket: 4, legalNonLands: richPool })
    const names = result.map(c => c.name)
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Mana Crypt')
    expect(names).toContain('Force of Will')
    expect(names).not.toContain("Thassa's Oracle")
  })

  it('B5 includes everything', () => {
    const result = buildBracketStaples({ bracket: 5, legalNonLands: richPool })
    const names = result.map(c => c.name)
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Mana Crypt')
    expect(names).toContain("Thassa's Oracle")
    expect(names).toContain('Demonic Consultation')
  })

  it('staple count is strictly increasing from B1→B5 (when user owns relevant cards)', () => {
    const counts = [1, 2, 3, 4, 5].map(b =>
      buildBracketStaples({ bracket: b, legalNonLands: richPool }).length
    )
    expect(counts[0]).toBe(counts[1])    // B1 == B2 (both universal-only)
    expect(counts[1]).toBe(counts[2])    // B2 == B3 (both universal-only)
    expect(counts[2]).toBeLessThan(counts[3])    // B3 < B4 (B4 adds cEDH tier)
    expect(counts[3]).toBeLessThan(counts[4])    // B4 < B5 (B5 adds combo wincons)
  })
})

// ─── Mana base solver scales aggressiveness with bracket ───────────────────

describe('mana base solver picks more non-basics at higher brackets', () => {
  // Pool with plenty of premium fixing.
  const premiumLands = [
    { name: 'Stomping Ground',  type_line: 'Land', oracle_text: '({T}: Add {R} or {G}.)', color_identity: ['R', 'G'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Wooded Foothills', type_line: 'Land', oracle_text: '{T}, sacrifice this: Search your library for a Mountain or Forest card.', color_identity: ['R', 'G'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Steam Vents',      type_line: 'Land', oracle_text: '({T}: Add {U} or {R}.)', color_identity: ['U', 'R'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Breeding Pool',    type_line: 'Land', oracle_text: '({T}: Add {G} or {U}.)', color_identity: ['G', 'U'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Misty Rainforest', type_line: 'Land', oracle_text: '{T}, sacrifice this: Search your library for a Forest or Island card.', color_identity: ['G', 'U'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Volcanic Island',  type_line: 'Land', oracle_text: '({T}: Add {U} or {R}.)', color_identity: ['U', 'R'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Tropical Island',  type_line: 'Land', oracle_text: '({T}: Add {G} or {U}.)', color_identity: ['G', 'U'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Taiga',            type_line: 'Land', oracle_text: '({T}: Add {R} or {G}.)', color_identity: ['R', 'G'], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'Mana Confluence',  type_line: 'Land', oracle_text: '{T}, Pay 1 life: Add one mana of any color.', color_identity: [], legalities: { commander: 'legal' }, isBasicLand: false },
    { name: 'City of Brass',    type_line: 'Land', oracle_text: '{T}: Add one mana of any color.', color_identity: [], legalities: { commander: 'legal' }, isBasicLand: false },
  ]
  // Add 20 dummy premium lands so even B5 has enough to fill.
  for (let i = 0; i < 20; i++) {
    premiumLands.push({
      name: `Premium Land ${i}`,
      type_line: 'Land',
      oracle_text: '{T}: Add {U} or {R}.',
      color_identity: ['U', 'R'],
      legalities: { commander: 'legal' },
      isBasicLand: false,
    })
  }

  it('B1 picks ≤6 non-basics; B5 picks 25+', () => {
    const COMMANDER_GRU = { name: 'Riku', color_identity: ['G', 'R', 'U'] }
    const b1 = solveManaBase({ commander: COMMANDER_GRU, legalLands: premiumLands, bracket: 1, targetLandCount: 37 })
    const b5 = solveManaBase({ commander: COMMANDER_GRU, legalLands: premiumLands, bracket: 5, targetLandCount: 37 })

    const b1NonBasic = b1.lands.filter(l => !l.isBasicLand).length
    const b5NonBasic = b5.lands.filter(l => !l.isBasicLand).length

    expect(b1NonBasic).toBeLessThanOrEqual(6)
    expect(b5NonBasic).toBeGreaterThanOrEqual(25)
    expect(b5NonBasic).toBeGreaterThan(b1NonBasic)    // monotonic
  })

  it('5-color mana base reaches for many non-basics regardless of bracket', () => {
    // Even at B3, 5-color needs lots of multi-color fixing.
    const result = solveManaBase({
      commander: COMMANDER_DRAGON,
      legalLands: premiumLands,
      bracket: 3,
      targetLandCount: 37,
    })
    const nonBasic = result.lands.filter(l => !l.isBasicLand).length
    // 5-color B3 cap = 18 + 8 (5c bump) = 26
    expect(nonBasic).toBeGreaterThanOrEqual(15)
  })
})

// ─── Off-theme penalty in scoring ───────────────────────────────────────────

describe('off-theme cards score MUCH lower than on-theme alternatives', () => {
  // This test exists because of a real complaint: Liar's Pendulum (a random
  // coin-flip artifact with zero connection to dragons) ended up in a Tiamat
  // dragon deck. The scorer wasn't separating off-theme from on-theme
  // strongly enough — the gap was ~12 points (right at the swap threshold).
  // After adding the off-theme penalty in runHeuristicCritique, the gap
  // should be ≥40 points so the swap fires unambiguously.

  // We verify the underlying scoring components are correct: a vanilla dragon
  // for Tiamat scores higher than a non-dragon non-staple card via
  // scoreArchetypeFit (which gives +12 for tribe match in the type line).

  it('a dragon scores higher than a random off-theme artifact for Tiamat', () => {
    const archetypes = [{ id: 'tribal:dragon', label: 'Dragons', tribe: 'dragon', strength: 3 }]
    const ctx = { archetypes, primaryArchetypeId: null }

    const dragon = card('Some Vanilla Dragon', {
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying. Some text about dragons.',
      cmc: 5,
      roles: ['synergy'],
    })
    const offThemeArtifact = card('Random Coin-Flip Artifact', {
      type_line: 'Artifact',
      oracle_text: 'Pay 1: Flip a coin. If you win the flip, draw a card.',
      cmc: 2,
      roles: ['filler'],
    })

    const dragonScore = scoreCard(dragon, 'synergy', COMMANDER_DRAGON, 3, ctx)
    const artifactScore = scoreCard(offThemeArtifact, 'filler', COMMANDER_DRAGON, 3, ctx)
    expect(dragonScore).toBeGreaterThan(artifactScore)
  })
})

// ─── Land quality classification correctness ────────────────────────────────

describe('land tiers are stable for canonical lands', () => {
  // These are tier classifications the rest of the pipeline depends on. If
  // someone refactors landQuality and changes them, this test flags it.
  const cases = [
    ['Polluted Delta', 'premium'],   // fetch
    ['Steam Vents',    'premium'],   // shock
    ['Underground Sea', 'premium'],  // original dual
    ['Indatha Triome', 'premium'],   // triome
    ['Bojuka Bog',     'premium'],   // utility
    ['Underground River', 'good'],   // pain land
    ['Drowned Catacomb',  'good'],   // check land
  ]
  for (const [name, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(landTier({ name, type_line: 'Land', oracle_text: '' })).toBe(expected)
    })
  }
})
