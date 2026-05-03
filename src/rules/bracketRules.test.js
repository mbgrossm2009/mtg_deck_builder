import { describe, it, expect } from 'vitest'
import {
  BRACKET_LABELS,
  isBracketAllowed,
  computeActualBracket,
  targetLandCount,
  targetRoleCounts,
  targetAvgCmc,
} from './bracketRules'

// ─── helpers ─────────────────────────────────────────────────────────────────
function card({ name = 'Test Card', tags = [], roles = [], type_line = 'Sorcery' } = {}) {
  return { name, tags, roles, type_line, color_identity: [], legalities: { commander: 'legal' } }
}

const COMMANDER = { name: 'Generic Commander', cmc: 3, color_identity: ['G'], type_line: 'Legendary Creature — Human' }

// ═════════════════════════════════════════════════════════════════════════════
// 1. BRACKET CONFIG INTEGRITY
// ═════════════════════════════════════════════════════════════════════════════
describe('Bracket config integrity', () => {
  it('exposes exactly 5 brackets in BRACKET_LABELS', () => {
    const keys = Object.keys(BRACKET_LABELS).map(Number).sort()
    expect(keys).toEqual([1, 2, 3, 4, 5])
  })

  it('every bracket has a non-empty label', () => {
    for (const b of [1, 2, 3, 4, 5]) {
      expect(typeof BRACKET_LABELS[b]).toBe('string')
      expect(BRACKET_LABELS[b].length).toBeGreaterThan(0)
    }
  })

  it('targetRoleCounts returns all required role keys for every bracket', () => {
    const required = [
      'ramp', 'draw', 'removal', 'wipe', 'protection',
      'win_condition', 'tutor', 'synergy', 'filler',
    ]
    for (const b of [1, 2, 3, 4, 5]) {
      const counts = targetRoleCounts(b, COMMANDER, [])
      for (const key of required) {
        expect(counts).toHaveProperty(key)
        expect(typeof counts[key]).toBe('number')
        expect(counts[key]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('targetLandCount returns a positive number for every bracket', () => {
    for (const b of [1, 2, 3, 4, 5]) {
      const lands = targetLandCount(b)
      expect(typeof lands).toBe('number')
      expect(lands).toBeGreaterThan(0)
      expect(lands).toBeLessThanOrEqual(40)
    }
  })

  it('targetAvgCmc returns a sensible CMC target for every bracket', () => {
    for (const b of [1, 2, 3, 4, 5]) {
      const cmc = targetAvgCmc(b)
      expect(typeof cmc).toBe('number')
      expect(cmc).toBeGreaterThan(0)
      expect(cmc).toBeLessThan(8)
    }
  })

  it('CMC target decreases monotonically from bracket 1 to bracket 5', () => {
    expect(targetAvgCmc(1)).toBeGreaterThan(targetAvgCmc(2))
    expect(targetAvgCmc(2)).toBeGreaterThan(targetAvgCmc(3))
    expect(targetAvgCmc(3)).toBeGreaterThan(targetAvgCmc(4))
    expect(targetAvgCmc(4)).toBeGreaterThan(targetAvgCmc(5))
  })

  it('bracket 1 is the most restrictive eligibility-wise (blocks most)', () => {
    // Bracket 1 blocks 4 categories; bracket 5 blocks none.
    const fast = card({ name: 'Mana Crypt', tags: ['fast_mana'] })
    const tutor = card({ name: 'Demonic Tutor', tags: ['tutor'] })
    const gc = card({ name: 'Some Game-Changer', tags: ['game_changer'] })
    expect(isBracketAllowed(fast, 1)).toBe(false)
    expect(isBracketAllowed(tutor, 1)).toBe(false)
    expect(isBracketAllowed(gc, 1)).toBe(false)

    expect(isBracketAllowed(fast, 5)).toBe(true)
    expect(isBracketAllowed(tutor, 5)).toBe(true)
    expect(isBracketAllowed(gc, 5)).toBe(true)
  })

  it('bracket 5 is the least restrictive (allows everything)', () => {
    const cards = [
      card({ name: 'Mana Crypt',  tags: ['fast_mana'] }),
      card({ name: 'Demonic Tutor', tags: ['tutor'] }),
      card({ name: 'Some Game-Changer', tags: ['game_changer'] }),
      card({ name: "Thassa's Oracle", roles: ['win_condition'] }),
    ]
    for (const c of cards) {
      expect(isBracketAllowed(c, 5)).toBe(true)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. CARD ELIGIBILITY BY BRACKET
// ═════════════════════════════════════════════════════════════════════════════
describe('Eligibility — Bracket 1 (Exhibition)', () => {
  it('blocks fast_mana tagged cards', () => {
    expect(isBracketAllowed(card({ name: 'Sol Ring',    tags: ['fast_mana'] }), 1)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Mana Crypt',  tags: ['fast_mana'] }), 1)).toBe(false)
  })

  it('blocks card tutors', () => {
    expect(isBracketAllowed(card({ name: 'Demonic Tutor',  tags: ['tutor'] }), 1)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Vampiric Tutor', tags: ['tutor'] }), 1)).toBe(false)
  })

  it('blocks game changers', () => {
    expect(isBracketAllowed(card({ name: 'X', tags: ['game_changer'] }), 1)).toBe(false)
  })

  it('blocks infinite wincons by name', () => {
    const oracle = card({ name: "Thassa's Oracle", roles: ['win_condition'] })
    expect(isBracketAllowed(oracle, 1)).toBe(false)

    const lab = card({ name: 'Laboratory Maniac', roles: ['win_condition'] })
    expect(isBracketAllowed(lab, 1)).toBe(false)
  })

  it('does NOT block non-infinite win conditions', () => {
    // Generic wincon (e.g. "Craterhoof Behemoth") is fine at B1
    const finisher = card({ name: 'Craterhoof Behemoth', roles: ['win_condition'] })
    expect(isBracketAllowed(finisher, 1)).toBe(true)
  })

  it('allows generic non-tagged cards', () => {
    expect(isBracketAllowed(card({ name: 'Lightning Bolt' }), 1)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Birds of Paradise', roles: ['ramp'] }), 1)).toBe(true)
  })
})

describe('Eligibility — Bracket 2 (Core)', () => {
  it('allows safe rocks (Sol Ring, Arcane Signet, Fellwar Stone, Mind Stone, Thought Vessel)', () => {
    const safeRocks = ['Sol Ring', 'Arcane Signet', 'Fellwar Stone', 'Mind Stone', 'Thought Vessel']
    for (const name of safeRocks) {
      expect(isBracketAllowed(card({ name, tags: ['fast_mana'] }), 2)).toBe(true)
    }
  })

  it('still blocks premium fast mana (Mana Crypt, Mox Diamond, etc.)', () => {
    const premium = ['Mana Crypt', 'Mana Vault', 'Mox Diamond', 'Chrome Mox', 'Lotus Petal']
    for (const name of premium) {
      expect(isBracketAllowed(card({ name, tags: ['fast_mana'] }), 2)).toBe(false)
    }
  })

  it('allows soft (land) tutors', () => {
    const soft = ['Cultivate', "Kodama's Reach", 'Farseek', "Nature's Lore",
                  'Rampant Growth', 'Three Visits', 'Skyshroud Claim', 'Tempt with Discovery']
    for (const name of soft) {
      // These are typically tagged 'ramp' and untagged as 'tutor' by cardRoles —
      // but the bracket filter has an explicit carve-out for them too.
      expect(isBracketAllowed(card({ name, tags: ['tutor'] }), 2)).toBe(true)
    }
  })

  it('still blocks card tutors (Demonic Tutor, Mystical Tutor, etc.)', () => {
    expect(isBracketAllowed(card({ name: 'Demonic Tutor', tags: ['tutor'] }), 2)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Mystical Tutor', tags: ['tutor'] }), 2)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Vampiric Tutor', tags: ['tutor'] }), 2)).toBe(false)
  })

  it('still blocks game changers and infinite wincons', () => {
    expect(isBracketAllowed(card({ name: 'X', tags: ['game_changer'] }), 2)).toBe(false)
    expect(isBracketAllowed(card({ name: "Thassa's Oracle", roles: ['win_condition'] }), 2)).toBe(false)
  })
})

describe('Eligibility — Bracket 3 (Upgraded) does not behave like Bracket 4', () => {
  it('B3 blocks elite fast mana that B4 allows', () => {
    const elite = ['Mana Crypt', 'Mana Vault', 'Grim Monolith', 'Mox Diamond',
                   'Chrome Mox', 'Mox Opal', 'Mox Amber', 'Lotus Petal', 'Jeweled Lotus']
    for (const name of elite) {
      const c = card({ name, tags: ['fast_mana'] })
      expect(isBracketAllowed(c, 3)).toBe(false)
      expect(isBracketAllowed(c, 4)).toBe(true)
    }
  })

  it('B3 still allows safe rocks and Talismans (mid-tier fast mana)', () => {
    expect(isBracketAllowed(card({ name: 'Sol Ring', tags: ['fast_mana'] }), 3)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Arcane Signet', tags: ['fast_mana'] }), 3)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Talisman of Indulgence', tags: ['fast_mana'] }), 3)).toBe(true)
  })

  it('B3 unlocks soft tutors but still blocks the elite tier-1 hard tutors', () => {
    // Soft / mid-tier tutors (Eladamri's Call, Idyllic Tutor, etc.) are fine at B3.
    expect(isBracketAllowed(card({ name: "Eladamri's Call", tags: ['tutor'] }), 3)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Idyllic Tutor',   tags: ['tutor'] }), 3)).toBe(true)
    // The tier-1 cEDH-grade tutors stay banned at B3 — they belong to B4+.
    expect(isBracketAllowed(card({ name: 'Demonic Tutor',   tags: ['tutor'] }), 3)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Vampiric Tutor',  tags: ['tutor'] }), 3)).toBe(false)
    // Both should be allowed at B4.
    expect(isBracketAllowed(card({ name: 'Demonic Tutor',   tags: ['tutor'] }), 4)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Vampiric Tutor',  tags: ['tutor'] }), 4)).toBe(true)
  })

  it('B3 allows generic game changers but blocks the elite free-interaction set', () => {
    // A generic non-elite game changer is fine at B3 (subject to deck-level cap).
    expect(isBracketAllowed(card({ name: 'X', tags: ['game_changer'] }), 3)).toBe(true)
    // Elite free counters / draw engines stay banned at B3.
    expect(isBracketAllowed(card({ name: 'Force of Will',  tags: ['game_changer'] }), 3)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Mana Drain',     tags: ['game_changer'] }), 3)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Rhystic Study',  tags: ['game_changer'] }), 3)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Smothering Tithe', tags: ['game_changer'] }), 3)).toBe(false)
    // All allowed at B4+.
    expect(isBracketAllowed(card({ name: 'Force of Will',  tags: ['game_changer'] }), 4)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Mana Drain',     tags: ['game_changer'] }), 4)).toBe(true)
  })

  it('B3 unlocks infinite wincons (lifted from B1/B2 ban)', () => {
    expect(isBracketAllowed(card({ name: "Thassa's Oracle", roles: ['win_condition'] }), 3)).toBe(true)
  })
})

describe('Eligibility — Bracket 4 (Optimized)', () => {
  it('allows all high-power cards including elite fast mana', () => {
    const c = card({ name: 'Mana Crypt', tags: ['fast_mana'] })
    expect(isBracketAllowed(c, 4)).toBe(true)
  })

  it('allows Jeweled Lotus and Dockside Extortionist', () => {
    expect(isBracketAllowed(card({ name: 'Jeweled Lotus', tags: ['fast_mana'] }), 4)).toBe(true)
    expect(isBracketAllowed(card({ name: 'Dockside Extortionist', tags: ['fast_mana'] }), 4)).toBe(true)
  })
})

describe('Eligibility — Bracket 5 (cEDH) allows all competitive cards', () => {
  it('allows the elite fast mana suite', () => {
    const elite = ['Mana Crypt', 'Mox Diamond', 'Chrome Mox', 'Lotus Petal', 'Jeweled Lotus']
    for (const name of elite) {
      expect(isBracketAllowed(card({ name, tags: ['fast_mana'] }), 5)).toBe(true)
    }
  })

  it('allows all tutors', () => {
    expect(isBracketAllowed(card({ name: 'Demonic Tutor', tags: ['tutor'] }), 5)).toBe(true)
  })

  it('allows infinite wincons', () => {
    expect(isBracketAllowed(card({ name: "Thassa's Oracle", roles: ['win_condition'] }), 5)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. LAND RAMP vs CARD TUTOR — the critical UX distinction
// ═════════════════════════════════════════════════════════════════════════════
describe('Land ramp vs card tutor', () => {
  // Land tutors are tagged as 'ramp' role by cardRoles.js (not 'tutor' tag).
  // But even if some classifier mistagged them, the bracket eligibility has
  // an explicit carve-out via isSoftTutor() at B2.
  const landTutors = ['Cultivate', "Kodama's Reach", 'Rampant Growth', 'Farseek',
                      "Nature's Lore", 'Three Visits', 'Skyshroud Claim',
                      'Tempt with Discovery']

  it('untagged land ramp passes Bracket 1', () => {
    // The realistic scenario: cardRoles tags Cultivate as ['ramp'] with no 'tutor' tag.
    for (const name of landTutors) {
      const c = card({ name, roles: ['ramp'], tags: [] })
      expect(isBracketAllowed(c, 1)).toBe(true)
    }
  })

  it('land ramp passes Bracket 2 even when mistakenly tagged as tutor', () => {
    // Defensive — if a future change tags these as 'tutor', the bracket
    // filter still allows them via isSoftTutor.
    for (const name of landTutors) {
      const c = card({ name, roles: ['ramp'], tags: ['tutor'] })
      expect(isBracketAllowed(c, 2)).toBe(true)
    }
  })

  it('REAL card tutors are still blocked at Bracket 1 and 2', () => {
    const realTutors = ['Demonic Tutor', 'Vampiric Tutor', 'Mystical Tutor',
                        'Worldly Tutor', 'Imperial Seal']
    for (const name of realTutors) {
      const c = card({ name, tags: ['tutor'] })
      expect(isBracketAllowed(c, 1)).toBe(false)
      expect(isBracketAllowed(c, 2)).toBe(false)
    }
  })

  it('land ramp is allowed at every bracket; elite hard tutors only B4+', () => {
    // Land ramp is universal.
    expect(isBracketAllowed(card({ name: 'Cultivate',     roles: ['ramp'], tags: [] }), 3)).toBe(true)
    // Demonic Tutor unlocks at B4 (B3 keeps it out as part of the elite set).
    expect(isBracketAllowed(card({ name: 'Demonic Tutor', tags: ['tutor'] }), 3)).toBe(false)
    expect(isBracketAllowed(card({ name: 'Demonic Tutor', tags: ['tutor'] }), 4)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMMANDER CMC RAMP BONUS
// ═════════════════════════════════════════════════════════════════════════════
describe('Commander CMC ramp bonus', () => {
  it('commander CMC < 5 gets no extra ramp', () => {
    const baseRamp = targetRoleCounts(3, { ...COMMANDER, cmc: 0 }, []).ramp
    expect(targetRoleCounts(3, { ...COMMANDER, cmc: 2 }, []).ramp).toBe(baseRamp)
    expect(targetRoleCounts(3, { ...COMMANDER, cmc: 4 }, []).ramp).toBe(baseRamp)
  })

  it('commander CMC 5 gets +2 ramp', () => {
    const base   = targetRoleCounts(3, { ...COMMANDER, cmc: 4 }, []).ramp
    const cmc5   = targetRoleCounts(3, { ...COMMANDER, cmc: 5 }, []).ramp
    const cmc6   = targetRoleCounts(3, { ...COMMANDER, cmc: 6 }, []).ramp
    expect(cmc5).toBe(base + 2)
    expect(cmc6).toBe(base + 2)
  })

  it('commander CMC 7+ gets +4 ramp', () => {
    const base = targetRoleCounts(3, { ...COMMANDER, cmc: 4 }, []).ramp
    expect(targetRoleCounts(3, { ...COMMANDER, cmc: 7 }, []).ramp).toBe(base + 4)
    expect(targetRoleCounts(3, { ...COMMANDER, cmc: 9 }, []).ramp).toBe(base + 4)
  })

  it('CMC bonus applies consistently across brackets 1-4', () => {
    for (const b of [1, 2, 3, 4]) {
      const base = targetRoleCounts(b, { ...COMMANDER, cmc: 4 }, []).ramp
      expect(targetRoleCounts(b, { ...COMMANDER, cmc: 5 }, []).ramp).toBe(base + 2)
      expect(targetRoleCounts(b, { ...COMMANDER, cmc: 7 }, []).ramp).toBe(base + 4)
    }
  })

  it('CMC bonus also applies at bracket 5 (cEDH 7-drop commanders need extra ramp)', () => {
    // Atraxa GU is a 7-drop cEDH commander — should get the bonus
    const base = targetRoleCounts(5, { ...COMMANDER, cmc: 4 }, []).ramp
    expect(targetRoleCounts(5, { ...COMMANDER, cmc: 7 }, []).ramp).toBe(base + 4)
  })

  it('handles missing cmc field gracefully (treats as 0)', () => {
    const result = targetRoleCounts(3, { name: 'Anything', color_identity: [] }, [])
    expect(result.ramp).toBeGreaterThan(0)
  })

  it('handles null commander gracefully', () => {
    const result = targetRoleCounts(3, null, [])
    expect(result.ramp).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. TRIBAL SYNERGY MODIFIER
// ═════════════════════════════════════════════════════════════════════════════
describe('Tribal synergy modifier', () => {
  it('non-tribal commander uses baseline synergy (20)', () => {
    const result = targetRoleCounts(3, COMMANDER, [])
    expect(result.synergy).toBe(20)
  })

  it('non-tribal commander unaffected by non-tribal archetypes', () => {
    const result = targetRoleCounts(3, COMMANDER, [
      { id: 'tokens', strength: 2 },
      { id: 'lifegain', strength: 2 },
    ])
    expect(result.synergy).toBe(20)
  })

  it('tribal commander gets boosted synergy (28)', () => {
    const result = targetRoleCounts(3, COMMANDER, [
      { id: 'tribal_elf', tribe: 'elf', strength: 2 },
    ])
    expect(result.synergy).toBe(28)
  })

  it('tribal expansion ALSO trims draw, removal, tutor', () => {
    const baseline = targetRoleCounts(3, COMMANDER, [])
    const tribal   = targetRoleCounts(3, COMMANDER, [
      { id: 'tribal_elf', tribe: 'elf', strength: 2 },
    ])
    // Tribal steals from these categories to fund the bigger synergy
    expect(tribal.draw).toBeLessThan(baseline.draw)
    expect(tribal.removal).toBeLessThan(baseline.removal)
    expect(tribal.tutor).toBeLessThanOrEqual(baseline.tutor)
  })

  it('tribal expansion is DISABLED at bracket 5', () => {
    const noLock  = targetRoleCounts(5, COMMANDER, [])
    const tribal  = targetRoleCounts(5, COMMANDER, [
      { id: 'tribal_sliver', tribe: 'sliver', strength: 2 },
    ])
    // Bracket 5 returns the same synergy regardless of tribal archetype.
    expect(tribal.synergy).toBe(noLock.synergy)
  })

  it('tribal cap is 28, not 35 (lowered to keep room for interaction)', () => {
    const tribal = targetRoleCounts(3, COMMANDER, [{ id: 'tribal_elf', tribe: 'elf', strength: 2 }])
    expect(tribal.synergy).toBe(28)
  })

  it('tribal does NOT push lands or wipes off the deck', () => {
    // After tribal expansion at B3: lands stay 37, wipes stay 4
    const tribal = targetRoleCounts(3, COMMANDER, [{ id: 'tribal_elf', tribe: 'elf', strength: 2 }])
    expect(targetLandCount(3)).toBe(37)
    expect(tribal.wipe).toBeGreaterThan(0)
    expect(tribal.protection).toBeGreaterThan(0)
    // Sum should not exceed reasonable total
    const synergy   = tribal.synergy + tribal.ramp + tribal.draw + tribal.removal +
                      tribal.wipe + tribal.protection + tribal.win_condition + tribal.tutor
    expect(synergy).toBeLessThanOrEqual(80)  // leaves room for lands + flex
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. BRACKET ESCALATION (computeActualBracket)
// ═════════════════════════════════════════════════════════════════════════════
describe('Bracket escalation — computeActualBracket', () => {
  function tagged(name, tags) {
    return { name, tags, roles: [] }
  }

  it('a clean precon-style deck stays at bracket 1', () => {
    const deck = [
      tagged('Forest', []),
      tagged('Llanowar Elves', []),
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBe(1)
  })

  it('a deck with a game-changer escalates to at least bracket 3', () => {
    const deck = [tagged('Some Game Changer', ['game_changer'])]
    const { actualBracket, flaggedCards } = computeActualBracket(deck, [])
    expect(actualBracket).toBeGreaterThanOrEqual(3)
    expect(flaggedCards).toContain('Some Game Changer')
  })

  it('a deck with a non-soft tutor escalates to at least bracket 3', () => {
    const deck = [tagged('Demonic Tutor', ['tutor'])]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBeGreaterThanOrEqual(3)
  })

  it('a deck with non-safe fast mana escalates to at least bracket 3', () => {
    const deck = [tagged('Mana Crypt', ['fast_mana'])]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBeGreaterThanOrEqual(3)
  })

  it('Sol Ring alone does NOT escalate (it is a safe rock)', () => {
    const deck = [tagged('Sol Ring', ['fast_mana'])]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBe(1)
  })

  it('4+ tutors escalates to bracket 4', () => {
    const deck = [
      tagged('Demonic Tutor',   ['tutor']),
      tagged('Vampiric Tutor',  ['tutor']),
      tagged('Mystical Tutor',  ['tutor']),
      tagged('Imperial Seal',   ['tutor']),
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBeGreaterThanOrEqual(4)
  })

  it('any combo present escalates to bracket 4', () => {
    const combos = [{ cards: ['A', 'B'], description: 'test', minimumBracket: 4 }]
    const { actualBracket } = computeActualBracket([], combos)
    expect(actualBracket).toBeGreaterThanOrEqual(4)
  })

  it('2+ combos escalates to bracket 5', () => {
    const combos = [
      { cards: ['A', 'B'], description: 'one', minimumBracket: 4 },
      { cards: ['C', 'D'], description: 'two', minimumBracket: 4 },
    ]
    const { actualBracket } = computeActualBracket([], combos)
    expect(actualBracket).toBe(5)
  })

  it('flagged cards are deduplicated', () => {
    const deck = [
      tagged('Demonic Tutor', ['tutor']),
      tagged('Demonic Tutor', ['tutor']),
    ]
    const { flaggedCards } = computeActualBracket(deck, [])
    const dups = flaggedCards.filter(n => n === 'Demonic Tutor')
    expect(dups).toHaveLength(1)
  })

  it('3 or fewer game changers stay at bracket 3 (within WotC cap)', () => {
    const deck = [
      tagged('GC One',   ['game_changer']),
      tagged('GC Two',   ['game_changer']),
      tagged('GC Three', ['game_changer']),
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBe(3)
  })

  it('more than 3 game changers escalates from B3 to B4', () => {
    const deck = [
      tagged('GC One',   ['game_changer']),
      tagged('GC Two',   ['game_changer']),
      tagged('GC Three', ['game_changer']),
      tagged('GC Four',  ['game_changer']),
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBeGreaterThanOrEqual(4)
  })

  it('4 or fewer Tier-C cEDH-core cards stays within B4', () => {
    // Each card is a Tier-C cEDH-core piece. 4 of them is at the cap.
    // Tag as fast_mana so they bump bracket to 3, but should NOT escalate
    // further to 5 from the Tier-C cap.
    const deck = [
      tagged('Mana Crypt',         ['fast_mana']),
      tagged('Chrome Mox',         ['fast_mana']),
      tagged('Mox Diamond',        ['fast_mana']),
      tagged('Lotus Petal',        ['fast_mana']),
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    // 4 Tier-C cards alone ALSO bump tutors/fast_mana logic (4+ fast mana → B4)
    // but NOT to B5. Acceptable to stop at B4.
    expect(actualBracket).toBeLessThanOrEqual(4)
  })

  it('more than 4 Tier-C cEDH-core cards escalates B4 → B5', () => {
    const deck = [
      tagged('Mana Crypt',     ['fast_mana']),
      tagged('Mana Vault',     ['fast_mana']),
      tagged('Chrome Mox',     ['fast_mana']),
      tagged('Mox Diamond',    ['fast_mana']),
      tagged('Lotus Petal',    ['fast_mana']),
      tagged('Force of Will',  ['game_changer']),  // 5th Tier-C → over cap
    ]
    const { actualBracket } = computeActualBracket(deck, [])
    expect(actualBracket).toBe(5)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// REGRESSION + EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════
describe('Regression + edge cases', () => {
  it('a card with fast_mana AND tutor tags is blocked at B1 (any blocked tag triggers)', () => {
    const c = card({ name: 'Hypothetical', tags: ['fast_mana', 'tutor'] })
    expect(isBracketAllowed(c, 1)).toBe(false)
  })

  it('cards with no tags pass every bracket\'s eligibility', () => {
    const c = card({ name: 'Plain Card', tags: [], roles: [] })
    for (const b of [1, 2, 3, 4, 5]) {
      expect(isBracketAllowed(c, b)).toBe(true)
    }
  })

  it('targetLandCount produces a strictly-decreasing-or-equal sequence 1→5', () => {
    // Lands shouldn't get HIGHER as bracket goes up
    let prev = Infinity
    for (const b of [1, 2, 3, 4, 5]) {
      const n = targetLandCount(b)
      expect(n).toBeLessThanOrEqual(prev)
      prev = n
    }
  })

  it('CMC target gap between adjacent brackets is reasonable (no big jumps)', () => {
    for (const b of [1, 2, 3, 4]) {
      const drop = targetAvgCmc(b) - targetAvgCmc(b + 1)
      expect(drop).toBeGreaterThan(0)
      expect(drop).toBeLessThanOrEqual(1.0)  // no more than 1.0 CMC drop per bracket
    }
  })
})
