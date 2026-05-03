// Far Fortune regression tests.
//
// Background: in the 2026-05-03 random-3 commanders eval, Far Fortune was
// listed in plannedCommanders but absent from the visible commanders[].
// Investigation found:
//   - The JSON paste was visually truncated (Far Fortune likely DID run
//     but the entries were inside collapsed [Pasted text #N] blocks).
//   - Far Fortune is a niche post-2025 commander (Aetherdrift, EDHREC
//     rank 13428) using brand-new keywords "Start your engines!" and
//     "Max speed" — exactly the kind of oracle text that could crash a
//     regex-based role/mechanic detector.
//
// These tests pin down that Far Fortune (and commanders with similar
// novel oracle text) build successfully end-to-end without crashing.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mockState,
  resetMockState,
  makeLocalStorageMock,
  makeEdhrecMock,
  makeMoxfieldMock,
  makeLLMServiceMock,
} from '../test/fixtures/mocks'

vi.mock('../utils/localStorage', () => makeLocalStorageMock())
vi.mock('../utils/edhrecApi',     () => makeEdhrecMock())
vi.mock('../utils/moxfieldApi',   () => makeMoxfieldMock())
vi.mock('./llmDeckService',       () => makeLLMServiceMock())

import { generateDeckWithLLMAssist } from './llmDeckOrchestrator'
import { FAR_FORTUNE } from '../test/fixtures/commanders'
import { buildRichCollection } from '../test/fixtures/cards'
import { extractCommanderMechanicTags } from '../rules/commanderMechanics'
import { detectArchetypes } from '../rules/archetypeRules'

beforeEach(() => {
  resetMockState()
})

async function buildDeck(commander, bracket) {
  mockState.commander = commander
  mockState.collection = buildRichCollection()
  mockState.edhrecTopCards = []
  mockState.moxfieldCards = []
  return await generateDeckWithLLMAssist(bracket, null, { twoPass: false })
}

describe('Far Fortune — orchestrator survives novel oracle text', () => {
  it.each([1, 2, 3, 4, 5])('builds a 99-card deck at B%d without crashing', async (bracket) => {
    const result = await buildDeck(FAR_FORTUNE, bracket)
    expect(result.error).toBeUndefined()
    expect(result.mainDeck).toBeDefined()
    expect(result.mainDeck.length).toBe(99)
  })

  it('respects BR color identity (no white/blue/green cards)', async () => {
    const result = await buildDeck(FAR_FORTUNE, 3)
    const allowed = new Set(['B', 'R'])
    for (const card of result.mainDeck) {
      for (const color of card.color_identity ?? []) {
        expect(allowed.has(color), `${card.name} has ${color}`).toBe(true)
      }
    }
  })
})

describe('Far Fortune — mechanic detection on novel keywords', () => {
  it('extractCommanderMechanicTags executes without throwing', () => {
    const tags = extractCommanderMechanicTags(FAR_FORTUNE)
    expect(Array.isArray(tags)).toBe(true)
  })

  it('detects cares_about_attacks from "Whenever you attack" trigger', () => {
    // Far Fortune's middle line: "Whenever you attack, Far Fortune deals 1
    // damage to each opponent." This is a clear attack trigger.
    const tags = extractCommanderMechanicTags(FAR_FORTUNE)
    expect(tags).toContain('cares_about_attacks')
  })

  it('detects cares_about_lifeloss from "Start your engines" speed mechanic', () => {
    // Far Fortune's reminder text: "It increases once on each of your turns
    // when an opponent loses life." That's a lifeloss trigger.
    const tags = extractCommanderMechanicTags(FAR_FORTUNE)
    expect(tags).toContain('cares_about_lifeloss')
  })

  it('does NOT detect tribal_human or tribal_mercenary from creature type', () => {
    // Far Fortune is a Human Mercenary but oracle text says nothing about
    // Humans or Mercenaries. Must NOT enforce tribal floor.
    const tags = extractCommanderMechanicTags(FAR_FORTUNE)
    expect(tags.filter(t => t.startsWith('tribal_'))).toEqual([])
  })

  it('detectArchetypes executes without throwing and stays under cap', () => {
    const result = detectArchetypes(FAR_FORTUNE)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('does NOT detect tribal archetypes (Human Mercenary type alone)', () => {
    const archetypes = detectArchetypes(FAR_FORTUNE)
    const ids = archetypes.map(a => a.id)
    expect(ids).not.toContain('tribal_human')
    expect(ids).not.toContain('tribal_mercenary')
  })
})

describe('Far Fortune — deck structure for an attack-trigger commander', () => {
  let result
  beforeEach(async () => {
    result = await buildDeck(FAR_FORTUNE, 3)
  })

  it('does NOT inflate Human or Mercenary creature density', async () => {
    // No tribal floor for Far Fortune — natural distribution only.
    const humans = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('human')
    ).length
    const mercenaries = result.mainDeck.filter(c =>
      (c.type_line ?? '').toLowerCase().includes('mercenary')
    ).length
    expect(humans).toBeLessThan(18)
    expect(mercenaries).toBeLessThan(18)
  })

  it('filler count is within realistic range (post-counting-bug-fix)', async () => {
    const trueFiller = result.mainDeck.filter(c =>
      (c.roles ?? [])[0] === 'filler'
    ).length
    // Defensive: pre-fix the bug produced 60+ on real decks. Even niche
    // commanders post-fix should stay well under 25.
    expect(trueFiller).toBeLessThan(25)
  })
})
