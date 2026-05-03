// detectMultiCardWincons unit tests.
//
// The function recognizes win-plan patterns spread across multiple cards
// that don't tag any single card as a `win_condition`. These patterns
// are surfaced both to the wincon backstop (so it doesn't force a wincon
// when a pattern already exists) and to the eval prompt (so the LLM
// stops saying "no clear win condition" when the deck has Edric +
// evasive creatures).
//
// Patterns covered:
//   - aristocrats   — sac outlet + drain payoff
//   - etb-drain     — token producer + ETB damage trigger
//   - combat-tribal — 2+ tribal lords + 18+ on-tribe creatures
//   - extra-combat  — Najeela / Aurelia / Aggravated Assault patterns
//   - combat-damage-draw — Edric / Tymna / Toski / Grazilaxx + evasion

import { describe, it, expect } from 'vitest'
import { detectMultiCardWincons } from './llmDeckOrchestrator'

const cmdr = (text) => ({ name: 'Test Commander', oracle_text: text })
const card = ({ name, text = '', type = 'Creature', tags = [], roles = [] }) => ({
  name, oracle_text: text, type_line: type, tags, roles,
})

const evasiveBear = (i) => card({
  name: `Bear ${i}`,
  text: 'Flying.',
  type: 'Creature — Bear',
})

describe('detectMultiCardWincons — combat-damage-draw pattern', () => {
  it('Grazilaxx-style: commander draws on combat damage + evasive creatures → detected', () => {
    const grazilaxx = cmdr(
      'Whenever Grazilaxx, Illithid Scholar deals combat damage to a player, draw a card.'
    )
    const deck = Array.from({ length: 6 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, grazilaxx)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('Toski-style: "creature you control deals combat damage to a player, draw" → detected', () => {
    const toski = cmdr(
      'Whenever a creature you control deals combat damage to a player, draw a card.'
    )
    const deck = Array.from({ length: 5 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, toski)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('Edric-style commander triggers detection too', () => {
    const edric = cmdr(
      'Whenever a creature deals combat damage to one of your opponents, its controller may draw a card.'
    )
    const deck = Array.from({ length: 5 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, edric)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('NO commander trigger but 2+ deck payoffs (Bident + Coastal Piracy) + evasion → detected', () => {
    const generic = cmdr('Flying. {T}: Add {U}.')   // commander text irrelevant
    const deck = [
      ...Array.from({ length: 5 }, (_, i) => evasiveBear(i)),
      card({ name: 'Bident of Thassa', text: 'Whenever a creature you control deals combat damage to a player, you may draw a card.', type: 'Legendary Enchantment Artifact' }),
      card({ name: 'Coastal Piracy',   text: 'Whenever a creature you control deals combat damage to a player, you may draw a card.', type: 'Enchantment' }),
    ]
    const patterns = detectMultiCardWincons(deck, {}, generic)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('NEGATIVE: combat-damage-draw commander but only 4 evasive creatures → NOT detected', () => {
    // Below the ≥5 evasion threshold; the wincon plan is unreliable.
    const grazilaxx = cmdr(
      'Whenever Grazilaxx, Illithid Scholar deals combat damage to a player, draw a card.'
    )
    const deck = Array.from({ length: 4 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, grazilaxx)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(false)
  })

  it('NEGATIVE: combat-draw payoffs in deck but ZERO evasion → NOT detected', () => {
    const generic = cmdr('Flying.')
    // Vanilla 2/2 bears, no evasion at all.
    const vanillaBear = (i) => card({ name: `Vanilla ${i}`, text: '', type: 'Creature — Bear' })
    const deck = [
      ...Array.from({ length: 10 }, (_, i) => vanillaBear(i)),
      card({ name: 'Bident of Thassa', text: 'Whenever a creature you control deals combat damage to a player, draw a card.', type: 'Legendary Enchantment Artifact' }),
      card({ name: 'Coastal Piracy',   text: 'Whenever a creature you control deals combat damage to a player, draw a card.', type: 'Enchantment' }),
    ]
    const patterns = detectMultiCardWincons(deck, {}, generic)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(false)
  })

  it('NEGATIVE: evasion-heavy deck but NO combat-damage-draw payoffs → NOT detected', () => {
    // A deck of flyers without any draw-on-damage payoff isn't this pattern.
    const generic = cmdr('Whenever you cast a Spirit, draw a card.')
    const deck = Array.from({ length: 10 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, generic)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(false)
  })

  it('counts trample, menace, shadow, horsemanship as evasion (not just flying)', () => {
    const grazilaxx = cmdr(
      'Whenever Grazilaxx, Illithid Scholar deals combat damage to a player, draw a card.'
    )
    const deck = [
      card({ name: 'Trampler 1', text: 'Trample.',     type: 'Creature — Bear' }),
      card({ name: 'Trampler 2', text: 'Trample.',     type: 'Creature — Bear' }),
      card({ name: 'Menace 1',   text: 'Menace.',      type: 'Creature — Bear' }),
      card({ name: 'Shadow 1',   text: 'Shadow.',      type: 'Creature — Bear' }),
      card({ name: 'Horse 1',    text: 'Horsemanship.', type: 'Creature — Bear' }),
    ]
    const patterns = detectMultiCardWincons(deck, {}, grazilaxx)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('counts "can\'t be blocked" as evasion', () => {
    const grazilaxx = cmdr(
      'Whenever Grazilaxx, Illithid Scholar deals combat damage to a player, draw a card.'
    )
    const deck = [
      card({ name: 'U1', text: 'This creature can\'t be blocked.', type: 'Creature — Rogue' }),
      card({ name: 'U2', text: 'This creature can\'t be blocked.', type: 'Creature — Rogue' }),
      card({ name: 'U3', text: 'This creature can\'t be blocked.', type: 'Creature — Rogue' }),
      card({ name: 'U4', text: 'This creature can\'t be blocked.', type: 'Creature — Rogue' }),
      card({ name: 'U5', text: 'This creature can\'t be blocked.', type: 'Creature — Rogue' }),
    ]
    const patterns = detectMultiCardWincons(deck, {}, grazilaxx)
    expect(patterns.some(p => p.startsWith('combat-damage-draw'))).toBe(true)
  })

  it('null commander does not crash', () => {
    const deck = Array.from({ length: 5 }, (_, i) => evasiveBear(i))
    expect(() => detectMultiCardWincons(deck, {}, null)).not.toThrow()
  })
})

describe('detectMultiCardWincons — pattern descriptions are informative', () => {
  it('combat-damage-draw description includes evasive creature count', () => {
    const grazilaxx = cmdr(
      'Whenever Grazilaxx, Illithid Scholar deals combat damage to a player, draw a card.'
    )
    const deck = Array.from({ length: 7 }, (_, i) => evasiveBear(i))
    const patterns = detectMultiCardWincons(deck, {}, grazilaxx)
    const cdDraw = patterns.find(p => p.startsWith('combat-damage-draw'))
    expect(cdDraw).toBeDefined()
    expect(cdDraw).toMatch(/7 evasive/)
  })
})
