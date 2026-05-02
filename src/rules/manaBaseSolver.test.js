import { describe, it, expect } from 'vitest'
import { solveManaBase } from './manaBaseSolver'

const land = (overrides) => ({
  type_line: 'Land',
  oracle_text: '',
  color_identity: [],
  isBasicLand: false,
  legalities: { commander: 'legal' },
  ...overrides,
})

const COMMANDER_GR  = { name: 'Klauth', color_identity: ['G', 'R'] }
const COMMANDER_5C  = { name: 'Atraxa, Grand Unifier', color_identity: ['W', 'U', 'B', 'R', 'G'] }
const COMMANDER_GRU = { name: 'Riku', color_identity: ['G', 'R', 'U'] }
const COMMANDER_C   = { name: 'Kozilek', color_identity: [] }

describe('solveManaBase — colorless commander', () => {
  it('returns all Wastes for a colorless commander', () => {
    const { lands } = solveManaBase({ commander: COMMANDER_C, legalLands: [], targetLandCount: 37 })
    expect(lands.length).toBe(37)
    expect(lands.every(l => l.name === 'Wastes')).toBe(true)
  })
})

describe('solveManaBase — empty land collection', () => {
  it('fills entirely with basics when user owns no non-basic lands', () => {
    const { lands } = solveManaBase({ commander: COMMANDER_GR, legalLands: [], targetLandCount: 37 })
    expect(lands.length).toBe(37)
    expect(lands.every(l => l.isBasicLand)).toBe(true)
    // Should include both Forest and Mountain.
    const names = new Set(lands.map(l => l.name))
    expect(names.has('Forest')).toBe(true)
    expect(names.has('Mountain')).toBe(true)
  })
})

describe('solveManaBase — premium picks beat weak picks', () => {
  it('picks shocks over guildgates when both are available', () => {
    const legalLands = [
      land({ name: 'Stomping Ground', oracle_text: '{T}: Add {R} or {G}.' }),
      land({ name: 'Gruul Guildgate', oracle_text: 'Gruul Guildgate enters tapped. {T}: Add {R} or {G}.' }),
    ]
    const { lands } = solveManaBase({ commander: COMMANDER_GR, legalLands, targetLandCount: 37, bracket: 3 })
    const names = lands.map(l => l.name)
    expect(names).toContain('Stomping Ground')
    expect(names).not.toContain('Gruul Guildgate')  // bracket 3 excludes weak
  })

  it('skips weak lands entirely at bracket 3+', () => {
    const legalLands = [
      land({ name: 'Akoum Refuge', oracle_text: 'Akoum Refuge enters tapped. When it enters, you gain 1 life. {T}: Add {B} or {R}.' }),
      land({ name: 'Frontier Bivouac', oracle_text: 'Frontier Bivouac enters tapped. {T}: Add {G}, {U}, or {R}.' }),
    ]
    const { lands } = solveManaBase({ commander: COMMANDER_GRU, legalLands, targetLandCount: 37, bracket: 3 })
    const names = lands.map(l => l.name)
    expect(names).not.toContain('Akoum Refuge')
    expect(names).not.toContain('Frontier Bivouac')
  })
})

describe('solveManaBase — color demand satisfied', () => {
  it('hits color floors via basics when non-basics are scarce', () => {
    const legalLands = []  // no non-basics
    const { stats } = solveManaBase({ commander: COMMANDER_GR, legalLands, targetLandCount: 37, bracket: 3 })
    expect(stats.sourcesPerColor.R).toBeGreaterThanOrEqual(14)
    expect(stats.sourcesPerColor.G).toBeGreaterThanOrEqual(14)
  })

  it('balances 5-color demand across basics', () => {
    const legalLands = []
    const { stats } = solveManaBase({ commander: COMMANDER_5C, legalLands, targetLandCount: 37, bracket: 3 })
    // Each color should have at least some sources — no color is starved.
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      expect(stats.sourcesPerColor[c]).toBeGreaterThan(0)
    }
  })
})

describe('solveManaBase — bracket-aware non-basic count', () => {
  it('B1 keeps non-basics low (≤6)', () => {
    const legalLands = Array.from({ length: 30 }, (_, i) =>
      land({
        name: `Untapped Dual ${i}`,
        oracle_text: '{T}: Add {R} or {G}.',
      })
    )
    const { lands } = solveManaBase({ commander: COMMANDER_GR, legalLands, targetLandCount: 37, bracket: 1 })
    const nonBasic = lands.filter(l => !l.isBasicLand)
    expect(nonBasic.length).toBeLessThanOrEqual(6)
  })

  it('B5 reaches for many non-basics (~30)', () => {
    // Make all premium so the solver actually wants them.
    const legalLands = [
      land({ name: 'Steam Vents', oracle_text: '{T}: Add {U} or {R}.' }),
      land({ name: 'Stomping Ground', oracle_text: '{T}: Add {R} or {G}.' }),
      land({ name: 'Breeding Pool', oracle_text: '{T}: Add {G} or {U}.' }),
      land({ name: 'Wooded Foothills', oracle_text: '{T}, sacrifice this: Search your library for a Mountain or Forest card.' }),
      land({ name: 'Misty Rainforest', oracle_text: '{T}, sacrifice this: Search your library for a Forest or Island card.' }),
      land({ name: 'Scalding Tarn', oracle_text: '{T}, sacrifice this: Search your library for an Island or Mountain card.' }),
      land({ name: 'Volcanic Island', oracle_text: '{T}: Add {U} or {R}.' }),
      land({ name: 'Tropical Island', oracle_text: '{T}: Add {G} or {U}.' }),
      land({ name: 'Taiga', oracle_text: '{T}: Add {R} or {G}.' }),
      land({ name: 'Indatha Triome', oracle_text: '{T}: Add {W}, {B}, or {G}. Cycling {3}' }),
      land({ name: 'Ketria Triome', oracle_text: '{T}: Add {G}, {U}, or {R}. Cycling {3}' }),
    ]
    const { lands } = solveManaBase({ commander: COMMANDER_GRU, legalLands, targetLandCount: 37, bracket: 5 })
    const nonBasic = lands.filter(l => !l.isBasicLand)
    // Should include most/all of the premium lands provided.
    expect(nonBasic.length).toBeGreaterThanOrEqual(8)
  })
})

describe('solveManaBase — output integrity', () => {
  it('returns exactly targetLandCount lands', () => {
    const { lands } = solveManaBase({ commander: COMMANDER_GR, legalLands: [], targetLandCount: 35 })
    expect(lands.length).toBe(35)
  })

  it('includes explanation strings', () => {
    const { explanation } = solveManaBase({ commander: COMMANDER_GR, legalLands: [], targetLandCount: 37 })
    expect(explanation.length).toBeGreaterThan(0)
    expect(explanation.some(e => /mana base/i.test(e))).toBe(true)
  })

  it('reports tier breakdown in stats', () => {
    const legalLands = [
      land({ name: 'Steam Vents', oracle_text: '{T}: Add {U} or {R}.' }),
      land({ name: 'Underground River', oracle_text: '{T}: Add {C}, {U}, or {B}.' }),
    ]
    const { stats } = solveManaBase({
      commander: { name: 'Test', color_identity: ['U', 'R'] },
      legalLands,
      targetLandCount: 37,
      bracket: 3,
    })
    expect(stats.byTier).toHaveProperty('basic')
    expect(stats.byTier.basic).toBeGreaterThan(0)
  })
})
