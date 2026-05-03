import { describe, it, expect } from 'vitest'
import { assignRoles } from './cardRoles'

// Minimal commander used for most tests where commander text doesn't matter.
const VANILLA_COMMANDER = {
  name: 'Generic Commander',
  type_line: 'Legendary Creature — Human',
  oracle_text: '',
  color_identity: ['G'],
}

// Helper to make a card without typing out boilerplate every time
function card({ name = 'Test Card', type_line = 'Sorcery', oracle_text = '' } = {}) {
  return { name, type_line, oracle_text }
}

// ─── Lands always short-circuit ──────────────────────────────────────────────
describe('assignRoles — lands', () => {
  it('returns role: land for basics', () => {
    const { roles, tags } = assignRoles(
      { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
      VANILLA_COMMANDER
    )
    expect(roles).toEqual(['land'])
    expect(tags).toEqual([])
  })

  it('returns role: land for non-basic lands', () => {
    const { roles, tags } = assignRoles(
      { name: 'Command Tower', type_line: 'Land', oracle_text: 'Add one mana of any color in your commander\'s color identity.' },
      VANILLA_COMMANDER
    )
    expect(roles).toEqual(['land'])
    expect(tags).toEqual([])
  })

  it('returns role: land for legendary lands', () => {
    const { roles } = assignRoles(
      { name: 'Cabal Coffers', type_line: 'Legendary Land', oracle_text: '' },
      VANILLA_COMMANDER
    )
    expect(roles).toContain('land')
  })
})

// ─── Hardcoded fast mana ─────────────────────────────────────────────────────
describe('assignRoles — fast mana tag', () => {
  it('tags Sol Ring as fast_mana', () => {
    const { tags } = assignRoles(
      card({ name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('fast_mana')
  })

  it('tags Mana Crypt as fast_mana', () => {
    const { tags } = assignRoles(
      card({ name: 'Mana Crypt', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('fast_mana')
  })

  it('does not tag generic mana rocks as fast_mana', () => {
    const { tags } = assignRoles(
      card({ name: 'Commander\'s Sphere', type_line: 'Artifact', oracle_text: '{T}: Add one mana of any color.' }),
      VANILLA_COMMANDER
    )
    expect(tags).not.toContain('fast_mana')
  })
})

// ─── Hardcoded tutors + regex tutors ─────────────────────────────────────────
describe('assignRoles — tutor detection', () => {
  it('tags Demonic Tutor (hardcoded)', () => {
    const { tags, roles } = assignRoles(
      card({ name: 'Demonic Tutor', type_line: 'Sorcery', oracle_text: 'Search your library for a card and put that card into your hand.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('tutor')
    expect(roles).toContain('tutor')
  })

  it('detects type-specific tutors via regex', () => {
    const { tags } = assignRoles(
      card({ name: 'Diabolic Intent', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature. Search your library for a creature card.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('tutor')
  })

  it('detects mana-value tutors (Birthing Pod-style)', () => {
    const { tags } = assignRoles(
      card({ name: 'Eldritch Evolution', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature. Search your library for a creature card with converted mana cost less than or equal to 2 plus the sacrificed creature\'s converted mana cost.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('tutor')
  })

  it('does NOT tag land tutors as tutor (those are ramp)', () => {
    const { tags, roles } = assignRoles(
      card({ name: 'Cultivate', type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand.' }),
      VANILLA_COMMANDER
    )
    expect(tags).not.toContain('tutor')
    expect(roles).toContain('ramp')
  })

  it('detects tribal tutors', () => {
    const { tags } = assignRoles(
      card({ name: 'Goblin Matron', type_line: 'Creature — Goblin', oracle_text: 'When this creature enters, you may search your library for a goblin creature card.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('tutor')
  })
})

// ─── Hardcoded win cons + regex win cons ─────────────────────────────────────
describe('assignRoles — win condition', () => {
  it('roles Thassa\'s Oracle as win_condition (hardcoded)', () => {
    const { roles } = assignRoles(
      card({ name: 'Thassa\'s Oracle', type_line: 'Creature — Merfolk Wizard', oracle_text: 'When this creature enters, look at the top X cards of your library...' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('win_condition')
  })

  it('detects "you win the game" regex', () => {
    const { roles } = assignRoles(
      card({ name: 'Custom Wincon', type_line: 'Enchantment', oracle_text: 'At the beginning of your upkeep, if you control five floops, you win the game.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('win_condition')
  })

  it('detects "each opponent loses the game" regex', () => {
    const { roles } = assignRoles(
      card({ name: 'Custom Doom', type_line: 'Sorcery', oracle_text: 'Each opponent loses the game.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('win_condition')
  })

  it('does not duplicate win_condition role when both list and regex match', () => {
    // Thassa's Oracle is in WIN_CONDITIONS list AND its text matches. Should appear once.
    const { roles } = assignRoles(
      card({ name: 'Thassa\'s Oracle', type_line: 'Creature', oracle_text: 'When ~ enters, you win the game.' }),
      VANILLA_COMMANDER
    )
    const winCount = roles.filter(r => r === 'win_condition').length
    expect(winCount).toBe(1)
  })
})

// ─── Ramp ────────────────────────────────────────────────────────────────────
describe('assignRoles — ramp', () => {
  it('rolls "add {G}" mana producers as ramp', () => {
    const { roles } = assignRoles(
      card({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('ramp')
  })

  it('rolls land tutors (Cultivate) as ramp', () => {
    const { roles } = assignRoles(
      card({ name: 'Cultivate', type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('ramp')
  })

  it('rolls "additional land" effects as ramp', () => {
    const { roles } = assignRoles(
      card({ name: 'Exploration', type_line: 'Enchantment', oracle_text: 'You may play an additional land each turn.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('ramp')
  })

  it('rolls treasure-producing artifacts as ramp', () => {
    const { roles } = assignRoles(
      card({ name: 'Smothering Tithe', type_line: 'Enchantment', oracle_text: 'Whenever an opponent draws a card, unless they pay {2}, you create a Treasure token.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('ramp')
  })
})

// ─── Draw ────────────────────────────────────────────────────────────────────
describe('assignRoles — draw', () => {
  it('rolls "draw a card" as draw', () => {
    const { roles } = assignRoles(
      card({ name: 'Brainstorm', type_line: 'Instant', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('draw')
  })

  it('rolls "draw two cards" as draw', () => {
    const { roles } = assignRoles(
      card({ name: 'Read the Bones', type_line: 'Sorcery', oracle_text: 'Scry 2, then draw two cards. You lose 2 life.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('draw')
  })

  it('rolls "draw three cards" as draw', () => {
    const { roles } = assignRoles(
      card({ name: 'Harmonize', type_line: 'Sorcery', oracle_text: 'Draw three cards.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('draw')
  })
})

// ─── Removal ─────────────────────────────────────────────────────────────────
describe('assignRoles — removal', () => {
  it('rolls "destroy target" as removal', () => {
    const { roles } = assignRoles(
      card({ name: 'Beast Within', type_line: 'Instant', oracle_text: 'Destroy target permanent.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('removal')
  })

  it('rolls "exile target" as removal', () => {
    const { roles } = assignRoles(
      card({ name: 'Swords to Plowshares', type_line: 'Instant', oracle_text: 'Exile target creature.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('removal')
  })

  it('rolls counterspells as removal (intentional design choice)', () => {
    const { roles } = assignRoles(
      card({ name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('removal')
  })

  it('rolls -X/-X effects as removal', () => {
    const { roles } = assignRoles(
      card({ name: 'Snuff Out', type_line: 'Instant', oracle_text: 'Target nonblack creature gets -4/-4 until end of turn.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('removal')
  })
})

// ─── Board wipes ─────────────────────────────────────────────────────────────
describe('assignRoles — board wipe', () => {
  it('rolls "destroy all" as wipe', () => {
    const { roles } = assignRoles(
      card({ name: 'Wrath of God', type_line: 'Sorcery', oracle_text: 'Destroy all creatures. They can\'t be regenerated.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('wipe')
  })

  it('rolls "exile all" as wipe', () => {
    const { roles } = assignRoles(
      card({ name: 'Farewell', type_line: 'Sorcery', oracle_text: 'Choose any number of the following: exile all artifacts, exile all creatures...' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('wipe')
  })

  it('rolls -X/-X mass effects as wipe', () => {
    const { roles } = assignRoles(
      card({ name: 'Toxic Deluge', type_line: 'Sorcery', oracle_text: 'All creatures get -X/-X until end of turn.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('wipe')
  })
})

// ─── Protection (keyword-based, NOT counterspells) ───────────────────────────
describe('assignRoles — protection', () => {
  it('rolls hexproof grants as protection', () => {
    const { roles } = assignRoles(
      card({ name: 'Asceticism', type_line: 'Enchantment', oracle_text: 'Creatures you control have hexproof.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('protection')
  })

  it('rolls indestructible grants as protection', () => {
    const { roles } = assignRoles(
      card({ name: 'Avacyn, Angel of Hope', type_line: 'Legendary Creature — Angel', oracle_text: 'Other permanents you control have indestructible.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('protection')
  })

  it('rolls "can\'t be countered" effects as protection', () => {
    const { roles } = assignRoles(
      card({ name: 'Allosaurus Shepherd', type_line: 'Creature — Elf', oracle_text: 'Green spells you cast can\'t be countered.' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('protection')
  })

  it('does not roll counterspells as protection (those are removal)', () => {
    const { roles } = assignRoles(
      card({ name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.' }),
      VANILLA_COMMANDER
    )
    expect(roles).not.toContain('protection')
    expect(roles).toContain('removal')
  })
})

// ─── Mechanic tags ───────────────────────────────────────────────────────────
describe('assignRoles — mechanic tags', () => {
  it('tags token producers', () => {
    const { tags } = assignRoles(
      card({ name: 'Bitterblossom', type_line: 'Tribal Enchantment', oracle_text: 'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('token_producer')
  })

  it('tags token doublers separately', () => {
    const { tags } = assignRoles(
      card({ name: 'Anointed Procession', type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('token_doubler')
  })

  it('tags sacrifice outlets', () => {
    const { tags } = assignRoles(
      card({ name: 'Phyrexian Altar', type_line: 'Artifact', oracle_text: 'Sacrifice a creature: Add one mana of any color.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('sac_outlet')
  })

  it('tags +1/+1 counter payoffs', () => {
    const { tags } = assignRoles(
      card({ name: 'Hardened Scales', type_line: 'Enchantment', oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('counters_payoff')
    expect(tags).toContain('counters_doubler')
  })

  it('tags proliferate cards', () => {
    const { tags } = assignRoles(
      card({ name: 'Inexorable Tide', type_line: 'Enchantment', oracle_text: 'Whenever you cast a spell, proliferate.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('proliferate')
  })

  it('tags recursion', () => {
    const { tags } = assignRoles(
      card({ name: 'Reanimate', type_line: 'Sorcery', oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control.' }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('recursion')
  })

  it('tags graveyard hate', () => {
    const { tags } = assignRoles(
      card({ name: 'Bojuka Bog', type_line: 'Land', oracle_text: 'When this land enters, exile target player\'s graveyard.' }),
      // Bog is a land so it short-circuits. Use a non-land for this test.
      VANILLA_COMMANDER
    )
    // Lands return early — need a non-land grave-hate
    const nonLand = card({
      name: 'Tormod\'s Crypt',
      type_line: 'Artifact',
      oracle_text: '{T}, Sacrifice this artifact: Exile all cards from target player\'s graveyard.',
    })
    const result = assignRoles(nonLand, VANILLA_COMMANDER)
    expect(result.tags).toContain('graveyard_hate')
  })
})

// ─── Tribal tag from commander subtypes ──────────────────────────────────────
describe('assignRoles — tribal tag', () => {
  it('tags creatures matching a commander subtype', () => {
    const elfCommander = {
      name: 'Marwyn, the Nurturer',
      type_line: 'Legendary Creature — Elf Druid',
      oracle_text: '',
      color_identity: ['G'],
    }
    const { tags } = assignRoles(
      card({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.' }),
      elfCommander,
      { commanderTypes: ['elf', 'druid'] }
    )
    expect(tags.some(t => t.startsWith('tribal_'))).toBe(true)
  })

  it('does NOT add tribal tag to non-creatures even if name matches', () => {
    const elfCommander = { name: 'Marwyn', type_line: 'Legendary Creature — Elf', oracle_text: '', color_identity: ['G'] }
    const { tags } = assignRoles(
      card({ name: 'Elvish Bard', type_line: 'Sorcery', oracle_text: 'Counter target spell.' }),
      elfCommander,
      { commanderTypes: ['elf'] }
    )
    expect(tags.some(t => t.startsWith('tribal_'))).toBe(false)
  })
})

// ─── Anchor name promotion ───────────────────────────────────────────────────
describe('assignRoles — anchor names → synergy', () => {
  it('promotes a card to synergy if it matches an anchor name', () => {
    const anchorNames = new Set(['Doubling Season'])
    const { roles } = assignRoles(
      card({
        name: 'Doubling Season',
        type_line: 'Enchantment',
        // Important: give it text that wouldn't trigger any other synergy detection
        oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      }),
      // Commander text that has zero overlap with the card's text
      { name: 'Nothing', type_line: 'Legendary Creature', oracle_text: '', color_identity: [] },
      { anchorNames }
    )
    expect(roles).toContain('synergy')
  })
})

// ─── Tag-based synergy (commander mechanic-tag boosts) ───────────────────────
describe('assignRoles — commanderTagBoosts → synergy', () => {
  it('Sanguine Bond on a lifegain commander gets the synergy role via tag match', () => {
    // Sanguine Bond text triggers off lifegain and shares no SYNERGY_KEYWORDS
    // with a typical lifegain commander's text. Without tag-based promotion,
    // it ends up as filler — the regression that surfaced on Sorin BW.
    const sanguineBond = card({
      name: 'Sanguine Bond',
      type_line: 'Enchantment',
      oracle_text: 'Whenever you gain life, target opponent loses that much life.',
    })
    // A lifegain commander whose text doesn't share SYNERGY_KEYWORDS with the card.
    const lifegainCmdr = {
      name: 'Lifegain Cmdr', type_line: 'Legendary Creature', color_identity: ['B', 'W'],
      oracle_text: 'Whenever you gain life, put a +1/+1 counter on Lifegain Cmdr.',
    }
    // Boosts that would be computed by commanderToCardTagBoosts(cares_about_lifegain).
    const commanderTagBoosts = new Set(['lifegain', 'lifegain_payoff'])

    const { roles } = assignRoles(sanguineBond, lifegainCmdr, { commanderTagBoosts })
    expect(roles).toContain('synergy')
    expect(roles[0]).not.toBe('filler')
  })

  it('does NOT promote a card whose tags do not match the boosts', () => {
    // A vanilla creature has no mechanic tags → no tag-based promotion.
    const vanillaBear = card({
      name: 'Plain Bear', type_line: 'Creature — Bear', oracle_text: '',
    })
    const lifegainCmdr = {
      name: 'Lifegain Cmdr', type_line: 'Legendary Creature', color_identity: ['B', 'W'],
      oracle_text: 'Whenever you gain life, put a +1/+1 counter on Lifegain Cmdr.',
    }
    const commanderTagBoosts = new Set(['lifegain', 'lifegain_payoff'])

    const { roles } = assignRoles(vanillaBear, lifegainCmdr, { commanderTagBoosts })
    expect(roles).not.toContain('synergy')
  })

  it('omitted commanderTagBoosts does not crash and falls back to keyword overlap', () => {
    const sanguineBond = card({
      name: 'Sanguine Bond', type_line: 'Enchantment',
      oracle_text: 'Whenever you gain life, target opponent loses that much life.',
    })
    const lifegainCmdr = {
      name: 'X', type_line: 'Legendary Creature', color_identity: ['B'],
      oracle_text: 'Whenever you gain life, draw a card.',
    }
    // No boosts passed — should not throw.
    expect(() => assignRoles(sanguineBond, lifegainCmdr, {})).not.toThrow()
  })
})

// ─── Filler fallback ─────────────────────────────────────────────────────────
describe('assignRoles — filler fallback', () => {
  it('puts unclassified non-land cards in filler', () => {
    const { roles } = assignRoles(
      card({ name: 'Some Vanilla Creature', type_line: 'Creature — Bear', oracle_text: '' }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('filler')
  })

  it('does not put lands in filler', () => {
    const { roles } = assignRoles(
      { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
      VANILLA_COMMANDER
    )
    expect(roles).not.toContain('filler')
  })
})

// ─── Multi-role cards ────────────────────────────────────────────────────────
describe('assignRoles — multi-role classification', () => {
  it('Eternal Witness gets recursion + filler/synergy', () => {
    const { roles, tags } = assignRoles(
      card({
        name: 'Eternal Witness',
        type_line: 'Creature — Human Shaman',
        oracle_text: 'When this creature enters, you may return target card from your graveyard to your hand.',
      }),
      VANILLA_COMMANDER
    )
    expect(tags).toContain('recursion')
    // Has at least one classification
    expect(roles.length).toBeGreaterThan(0)
  })

  it('Mind\'s Eye gets draw role', () => {
    const { roles } = assignRoles(
      card({
        name: 'Mind\'s Eye',
        type_line: 'Artifact',
        oracle_text: 'Whenever an opponent draws a card, you may pay {1}. If you do, you draw a card.',
      }),
      VANILLA_COMMANDER
    )
    expect(roles).toContain('draw')
  })
})
