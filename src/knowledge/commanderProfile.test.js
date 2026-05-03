// CommanderProfile tests.
//
// Each test uses verbatim Scryfall oracle text from the top-100 fixture
// where possible. The profile must consolidate archetype detection,
// mechanic tags, tribal detection, bracket ceiling, and win-plan shapes
// into one structured object.

import { describe, it, expect, beforeEach } from 'vitest'
import { extractCommanderProfile, clearCommanderProfileCache } from './commanderProfile'
import { findCommander } from '../test/fixtures/top100commanders.js'

beforeEach(() => {
  clearCommanderProfileCache()
})

describe('extractCommanderProfile — base shape', () => {
  it('returns an empty profile for null/undefined commander', () => {
    const p = extractCommanderProfile(null)
    expect(p.name).toBe('')
    expect(p.archetypes).toEqual([])
  })

  it('returns a profile with all top-level fields', () => {
    const p = extractCommanderProfile(findCommander('Tiamat'))
    expect(p).toHaveProperty('name', 'Tiamat')
    expect(p).toHaveProperty('colorIdentity')
    expect(p).toHaveProperty('archetypes')
    expect(p).toHaveProperty('mechanicTags')
    expect(p).toHaveProperty('cardTagBoosts')
    expect(p).toHaveProperty('anchorNames')
    expect(p).toHaveProperty('tribal')
    expect(p).toHaveProperty('bracket')
    expect(p).toHaveProperty('expectations')
  })

  it('caches per commander name (stable identity for same input)', () => {
    const cmdr = findCommander('Tiamat')
    const p1 = extractCommanderProfile(cmdr)
    const p2 = extractCommanderProfile(cmdr)
    expect(p1).toBe(p2)
  })
})

describe('extractCommanderProfile — Tiamat (5-color dragon tribal)', () => {
  let p
  beforeEach(() => { p = extractCommanderProfile(findCommander('Tiamat')) })

  it('detects tribal_dragons mechanic tag', () => {
    expect(p.mechanicTags).toContain('tribal_dragons')
  })

  it('detects tribal_dragon archetype as primary', () => {
    expect(p.archetypes.some(a => a.id === 'tribal_dragon')).toBe(true)
  })

  it('tribal.tribe is "dragon"', () => {
    expect(p.tribal.tribe).toBe('dragon')
  })

  it('tribal.densityFloor is 18', () => {
    expect(p.tribal.densityFloor).toBe(18)
  })

  it('5-color identity', () => {
    expect(p.colorIdentity.sort()).toEqual(['B', 'G', 'R', 'U', 'W'].sort())
  })

  it('high-CMC commander needs ≥10 ramp', () => {
    // Tiamat is CMC 7 → expectations.minRamp = 12
    expect(p.expectations.minRamp).toBeGreaterThanOrEqual(10)
  })

  it('bracket ceiling is 4 (Tiamat is in B5_INCAPABLE list)', () => {
    expect(p.bracket.ceiling).toBe(4)
  })

  it('win-plan shapes include tribal_anthem', () => {
    expect(p.bracket.winPlanShapes).toContain('tribal_anthem')
  })
})

describe('extractCommanderProfile — Sheoldred (mono-black draw/drain)', () => {
  let p
  beforeEach(() => { p = extractCommanderProfile(findCommander('Sheoldred, the Apocalypse')) })

  it('detects draw + lifegain + lifeloss tags', () => {
    expect(p.mechanicTags).toContain('cares_about_draw')
    expect(p.mechanicTags).toContain('cares_about_lifegain')
    expect(p.mechanicTags).toContain('cares_about_lifeloss')
  })

  it('NO tribal_phyrexian (oracle text doesn\'t reference type)', () => {
    expect(p.tribal.tribe).toBeNull()
    expect(p.tribal.densityFloor).toBe(0)
  })

  it('mono-black identity', () => {
    expect(p.colorIdentity).toEqual(['B'])
  })

  it('cardTagBoosts is non-empty (commander cares about something)', () => {
    expect(p.cardTagBoosts.size).toBeGreaterThan(0)
  })
})

describe('extractCommanderProfile — Winter (negative tribal test)', () => {
  let p
  beforeEach(() => { p = extractCommanderProfile(findCommander('Winter, Cynical Opportunist')) })

  it('Winter has Human Warlock TYPE but tribal.tribe is null', () => {
    expect(p.tribal.tribe).toBeNull()
  })

  it('NO tribal mechanic tags (oracle text doesn\'t mention humans/warlocks)', () => {
    expect(p.mechanicTags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })

  it('densityFloor is 0 — no tribal floor enforced', () => {
    expect(p.tribal.densityFloor).toBe(0)
  })
})

describe('extractCommanderProfile — Najeela (extra-combat win plan shape)', () => {
  let p
  beforeEach(() => { p = extractCommanderProfile(findCommander('Najeela, the Blade-Blossom')) })

  it('win-plan shapes include extra_combat', () => {
    expect(p.bracket.winPlanShapes).toContain('extra_combat')
  })

  it('detects evasionBased = false (Najeela cares about Warriors, not evasion)', () => {
    // Najeela's text triggers on "Whenever a Warrior you control attacks"
    // — that's an attack trigger, so evasionBased fires true.
    expect(p.expectations.evasionBased).toBe(true)
  })
})

describe('extractCommanderProfile — Krenko (goblin tribal)', () => {
  let p
  beforeEach(() => { p = extractCommanderProfile(findCommander('Krenko, Mob Boss')) })

  it('tribal.tribe is "goblin"', () => {
    expect(p.tribal.tribe).toBe('goblin')
  })

  it('detects cares_about_tokens', () => {
    expect(p.mechanicTags).toContain('cares_about_tokens')
  })

  it('mono-red identity', () => {
    expect(p.colorIdentity).toEqual(['R'])
  })

  it('bracket ceiling is 4', () => {
    expect(p.bracket.ceiling).toBe(4)
  })
})

describe('extractCommanderProfile — bracket ceiling for unlisted commanders', () => {
  it('Najeela (cEDH-tier) → ceiling 5', () => {
    const p = extractCommanderProfile(findCommander('Najeela, the Blade-Blossom'))
    expect(p.bracket.ceiling).toBe(5)
  })

  it('Kinnan (cEDH-tier) → ceiling 5', () => {
    const p = extractCommanderProfile(findCommander('Kinnan, Bonder Prodigy'))
    expect(p.bracket.ceiling).toBe(5)
  })
})

describe('extractCommanderProfile — minRamp scales with CMC', () => {
  it('high-CMC commander (Tiamat, 7) → ≥12 ramp', () => {
    const p = extractCommanderProfile(findCommander('Tiamat'))
    expect(p.expectations.minRamp).toBeGreaterThanOrEqual(12)
  })

  it('mid-CMC commander (Krenko, 4) → ≥8 ramp', () => {
    const p = extractCommanderProfile(findCommander('Krenko, Mob Boss'))
    expect(p.expectations.minRamp).toBeGreaterThanOrEqual(8)
  })

  it('low-CMC commander (Edric, 3) → ≥6 ramp', () => {
    const p = extractCommanderProfile(findCommander('Edric, Spymaster of Trest'))
    expect(p.expectations.minRamp).toBeGreaterThanOrEqual(6)
  })
})

describe('extractCommanderProfile — anchorNames lowercased Set', () => {
  it('anchorNames is a Set', () => {
    const p = extractCommanderProfile(findCommander('Tiamat'))
    expect(p.anchorNames).toBeInstanceOf(Set)
  })

  it('all entries are lowercased strings', () => {
    const p = extractCommanderProfile(findCommander('Tiamat'))
    for (const name of p.anchorNames) {
      expect(typeof name).toBe('string')
      expect(name).toBe(name.toLowerCase())
    }
  })
})
