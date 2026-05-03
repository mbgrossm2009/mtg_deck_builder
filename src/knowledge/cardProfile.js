// CardProfile — the structured semantic understanding of a single card.
//
// PHASE 1 of the knowledge-layer migration (see docs/architecture.md).
//
// Why this exists: card-level knowledge was previously scattered across
// cardRoles.js (roles + tags), comboRules.js (combo participation), and
// inline regex inside the orchestrator (evasion, attack triggers, etc.).
// Adding a new lens or use case meant re-extracting the same knowledge
// from raw oracle text in a slightly different shape. Bugs followed.
//
// CardProfile consolidates everything we know about a card into one
// structured object, computed once per card and cached. Other modules
// query the profile instead of regex-scanning the oracle text. New
// information goes in one place.
//
// Design principles:
//   1. Computed from card data only (oracle text + type line + name +
//      curated lists). Not commander- or deck-specific. Commander-aware
//      synergy is computed at the deck-context layer.
//   2. Structured, not stringly-typed. `roles: ['ramp']` not
//      `description: 'ramps'`.
//   3. Additive. Adding a new field doesn't break existing consumers.
//   4. Cached by card name (cards are immutable for our purposes).

import { getOracleText } from '../utils/cardHelpers'
import { assignRoles } from '../rules/cardRoles'

/**
 * @typedef {object} CardProfile
 * @property {string} name
 * @property {string[]} roles      — primary deck-building buckets ('ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition', 'synergy', 'land', 'filler')
 * @property {string[]} tags       — granular mechanic tags ('token_producer', 'sac_outlet', 'fast_mana', 'tutor', 'game_changer', 'explosive_finisher', tribal_<type>, etc.)
 * @property {string[]} evasion    — keyword evasion this card has ('flying', 'menace', 'shadow', 'horsemanship', 'fear', 'intimidate', 'skulk', 'trample', 'unblockable', 'protection')
 * @property {object}   triggers   — what this card triggers on
 * @property {string[]} triggers.onAttack — abilities that fire on attack ('damage', 'draw', 'token', 'mana')
 * @property {string[]} triggers.onETB    — abilities that fire on enter the battlefield
 * @property {string[]} triggers.onDeath  — abilities that fire on death
 * @property {string[]} triggers.onCast   — abilities that fire on cast
 * @property {object}   power      — power-tier signals
 * @property {boolean}  power.fastMana
 * @property {boolean}  power.gameChanger
 * @property {boolean}  power.explosiveFinisher
 * @property {boolean}  power.commanderProtection
 * @property {'hard'|'soft'|null} power.tutorTier — null = not a tutor
 * @property {object}   wincon     — win-condition contributions
 * @property {boolean}  wincon.singleCard — has a built-in "you win the game" or named-list wincon
 * @property {string[]} wincon.contributes — wincon patterns this card supports ('etb_drain', 'aristocrats_drain', 'combat_damage_draw', 'extra_combat', 'tribal_anthem')
 */

// Module-level cache. Cards are effectively immutable (oracle text + type
// don't change between calls), so caching by name is safe and the win is
// big — assignRoles + regex passes run once per unique card across all
// commanders/decks.
const PROFILE_CACHE = new Map()

/**
 * Build a CardProfile for a card. Cached by name.
 *
 * @param {object} card  — raw card data (name, oracle_text, type_line, ...)
 * @param {object} [opts]
 * @param {object} [opts.commander]      — when provided, role detection
 *   uses commander-keyword overlap for the 'synergy' role. Profiles built
 *   with a commander are cached separately from generic ones.
 * @param {Set}    [opts.anchorNames]    — passed through to assignRoles
 * @param {string[]} [opts.commanderTypes] — passed through to assignRoles
 * @returns {CardProfile}
 */
export function extractCardProfile(card, opts = {}) {
  if (!card?.name) {
    return emptyProfile()
  }
  // Cache key: name + commander identity. Commander affects 'synergy'
  // role detection, so the same card has different profiles in different
  // commander contexts.
  const cacheKey = card.name + '||' + (opts.commander?.name ?? '')
  if (PROFILE_CACHE.has(cacheKey)) return PROFILE_CACHE.get(cacheKey)

  const text = getOracleText(card)
  const typeLine = (card.type_line ?? '').toLowerCase()

  // Roles + base tags from existing assignRoles (which is well-tested).
  // assignRoles internally calls getOracleText(commander); pass an empty
  // commander shape if none provided so synergy detection doesn't crash.
  const { roles, tags } = assignRoles(card, opts.commander ?? { oracle_text: '', type_line: '' }, {
    anchorNames: opts.anchorNames,
    commanderTypes: opts.commanderTypes,
  })

  const profile = {
    name: card.name,
    roles,
    tags,
    evasion: detectEvasion(text, typeLine),
    triggers: {
      onAttack: detectAttackTriggers(text),
      onETB:    detectETBTriggers(text),
      onDeath:  detectDeathTriggers(text),
      onCast:   detectCastTriggers(text),
    },
    power: {
      fastMana:            tags.includes('fast_mana'),
      gameChanger:         tags.includes('game_changer'),
      explosiveFinisher:   tags.includes('explosive_finisher'),
      commanderProtection: tags.includes('commander_protection'),
      tutorTier:           detectTutorTier(card, tags),
    },
    wincon: {
      singleCard:   roles.includes('win_condition') || tags.includes('explosive_finisher'),
      contributes:  detectWinconContributions(text, tags, card.name),
    },
  }

  PROFILE_CACHE.set(cacheKey, profile)
  return profile
}

function emptyProfile() {
  return {
    name: '',
    roles: [],
    tags: [],
    evasion: [],
    triggers: { onAttack: [], onETB: [], onDeath: [], onCast: [] },
    power: { fastMana: false, gameChanger: false, explosiveFinisher: false, commanderProtection: false, tutorTier: null },
    wincon: { singleCard: false, contributes: [] },
  }
}

// ─── Detectors ──────────────────────────────────────────────────────────────
// Note: getOracleText returns lowercased text, so all patterns are lowercase.

function detectEvasion(text, typeLine) {
  if (!typeLine.includes('creature') && !typeLine.includes('vehicle')) return []
  const out = []
  // Keyword evasion. Use word boundaries to avoid matching "flying" in
  // "flying creature" (false negative — that DOES have flying).
  if (/\bflying\b/.test(text))                                out.push('flying')
  if (/\bmenace\b/.test(text))                                out.push('menace')
  if (/\bshadow\b/.test(text))                                out.push('shadow')
  if (/\bhorsemanship\b/.test(text))                          out.push('horsemanship')
  if (/\bfear\b/.test(text))                                  out.push('fear')
  if (/\bintimidate\b/.test(text))                            out.push('intimidate')
  if (/\bskulk\b/.test(text))                                 out.push('skulk')
  if (/\btrample\b/.test(text))                               out.push('trample')
  if (/can't be blocked/.test(text))                          out.push('unblockable')
  if (/protection from/.test(text))                           out.push('protection')
  return out
}

function detectAttackTriggers(text) {
  const out = []
  // "Whenever ~ attacks, deals N damage to ..."  → damage trigger
  if (/whenever [^.]*\battacks?[^.]*\bdeals? \d+ damage/i.test(text))   out.push('damage')
  // "Whenever ~ attacks, draw a card"  → draw trigger
  if (/whenever [^.]*\battacks?[^.]*draw a card/i.test(text))           out.push('draw')
  // "Whenever ~ attacks, create a ... token"  → token trigger
  if (/whenever [^.]*\battacks?[^.]*create/i.test(text))                out.push('token')
  // "Whenever ~ attacks, add ... mana" or "untap" → mana trigger
  if (/whenever [^.]*\battacks?[^.]*\b(add|untap)/i.test(text))         out.push('mana')
  return out
}

function detectETBTriggers(text) {
  const out = []
  // "When ~ enters" or "When ~ enters the battlefield" — modern + classic.
  if (/when [^.]+ enters[^.]*\bdeals? \d+ damage/i.test(text))    out.push('damage')
  if (/when [^.]+ enters[^.]*draw/i.test(text))                   out.push('draw')
  if (/when [^.]+ enters[^.]*create/i.test(text))                 out.push('token')
  if (/when [^.]+ enters[^.]*search/i.test(text))                 out.push('tutor')
  if (/when [^.]+ enters[^.]*destroy|when [^.]+ enters[^.]*exile/i.test(text)) out.push('removal')
  return out
}

function detectDeathTriggers(text) {
  const out = []
  if (/whenever [^.]+ dies[^.]*draw/i.test(text))                 out.push('draw')
  if (/whenever [^.]+ dies[^.]*create/i.test(text))               out.push('token')
  if (/whenever [^.]+ dies[^.]*loses? \d+ life/i.test(text))      out.push('drain')
  if (/whenever [^.]+ dies[^.]*returns?/i.test(text))             out.push('recursion')
  return out
}

function detectCastTriggers(text) {
  const out = []
  if (/whenever you cast/i.test(text)) out.push('any')
  if (/whenever you cast[^.]*(instant|sorcery)/i.test(text)) out.push('spell')
  if (/whenever you cast[^.]*creature/i.test(text)) out.push('creature')
  return out
}

// Hard tutor: searches your library for a SPECIFIC named card or any card.
// Soft tutor: searches for a card with constraints (basic land, mana value,
// creature with X cmc, etc.) — narrower selection.
function detectTutorTier(card, tags) {
  if (!tags.includes('tutor')) return null
  // Hard tutor: searches for ANY card with no card-type restriction.
  // Soft tutor: type-restricted (creature only, instant/sorcery only,
  // mana-value-bounded, etc.). Mystical / Enlightened / Worldly are SOFT
  // because they restrict to instant-or-sorcery / artifact-or-enchantment
  // / creature respectively. Demonic / Vampiric / Imperial Seal are HARD
  // because they search for "a card" with no type restriction.
  const HARD_TUTORS = new Set([
    'demonic tutor', 'vampiric tutor', 'imperial seal',
    'grim tutor', 'diabolic tutor', 'cruel tutor',
    'beseech the queen', 'demonic consultation', 'tainted pact',
    'mastermind\'s acquisition', 'wishclaw talisman',
  ])
  return HARD_TUTORS.has((card.name ?? '').toLowerCase()) ? 'hard' : 'soft'
}

// Detect which multi-card wincon patterns this card CONTRIBUTES to.
// E.g., Impact Tremors contributes to 'etb_drain'; Blood Artist contributes
// to 'aristocrats_drain'; Aggravated Assault contributes to 'extra_combat'.
function detectWinconContributions(text, tags, name) {
  const out = []
  const lowerName = (name ?? '').toLowerCase()

  // ETB-damage payoffs.
  const ETB_DAMAGE_NAMES = new Set([
    'impact tremors', 'purphoros, god of the forge', 'warstorm surge',
    'terror of the peaks', 'hellrider', 'goblin bombardment',
    'outpost siege', 'pandemonium', 'witty roastmaster',
    'electrostatic field', 'firebrand archer', 'guttersnipe',
  ])
  if (ETB_DAMAGE_NAMES.has(lowerName)) out.push('etb_drain')

  // Aristocrats drain payoffs (Blood Artist class).
  const DRAIN_PAYOFF_NAMES = new Set([
    'blood artist', 'zulaport cutthroat', 'cruel celebrant',
    'bastion of remembrance', 'falkenrath noble', 'syr konrad the grim',
    'corpse knight', 'vindictive vampire', 'judith the scourge diva',
    'disciple of the vault', 'pawn of ulamog', 'marionette master',
    'massacre girl', 'bloodtracker', 'dread presence', 'sangromancer',
    'twilight prophet', 'bloodthirsty conqueror',
  ])
  if (DRAIN_PAYOFF_NAMES.has(lowerName)) out.push('aristocrats_drain')

  // Extra combat enablers.
  const EXTRA_COMBAT_NAMES = new Set([
    'aggravated assault', 'hellkite charger', 'combat celebrant',
    'scourge of the throne', 'aurelia, the warleader', 'moraug, fury of akoum',
    'breath of fury', 'world at war', 'savage beating', 'seize the day',
    'relentless assault', 'waves of aggression',
    'sword of feast and famine', 'port razer', 'godo, bandit warlord',
  ])
  if (EXTRA_COMBAT_NAMES.has(lowerName) ||
      /additional combat (?:phase|step)/i.test(text)) {
    out.push('extra_combat')
  }

  // Combat-damage-draw payoffs (Bident, Coastal Piracy, Reconnaissance Mission).
  const COMBAT_DRAW_NAMES = new Set([
    'edric, spymaster of trest', 'tymna the weaver', 'bident of thassa',
    'coastal piracy', 'reconnaissance mission', 'curiosity',
    'curious obsession', 'tandem lookout',
  ])
  if (COMBAT_DRAW_NAMES.has(lowerName) ||
      /\bcombat damage to [^.]*\b(?:players?|opponents?)\b[^.]*draw/i.test(text)) {
    out.push('combat_damage_draw')
  }

  // Tribal anthem (lord-style buff).
  if (tags.some(t => t.startsWith('tribal_')) &&
      /\+\d+\/\+\d+/.test(text) &&
      !/target (?:creature|[a-z]+) gets \+\d+/i.test(text) &&
      !/equipped creature gets \+\d+/i.test(text)) {
    out.push('tribal_anthem')
  }

  return out
}

// Test/dev hook to clear the cache between runs.
export function clearProfileCache() {
  PROFILE_CACHE.clear()
}
