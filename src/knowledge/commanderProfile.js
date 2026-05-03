// CommanderProfile — strategic identity of a commander.
//
// PHASE 2 of the knowledge-layer migration (see docs/architecture.md).
//
// Why this exists: commander knowledge was scattered across detectArchetypes,
// extractCommanderMechanicTags, applyCommanderBracketCap, and inline tribal
// detection in the orchestrator. Adding a new commander-aware lens required
// recomputing the same things in slightly different shapes.
//
// CommanderProfile consolidates everything we strategically know about a
// commander into one structured object, computed once.

import { detectArchetypes, anchorNamesFor } from '../rules/archetypeRules'
import { extractCommanderMechanicTags, commanderToCardTagBoosts } from '../rules/commanderMechanics'
import { applyCommanderBracketCap, getCommanderBracketCeiling } from '../rules/commanderPowerCeiling'
import { getOracleText } from '../utils/cardHelpers'

/**
 * @typedef {object} CommanderProfile
 * @property {string} name
 * @property {string[]} colorIdentity
 * @property {number} cmc
 *
 * @property {object[]} archetypes — output of detectArchetypes (id, label, strength, tribe?)
 * @property {string|null} primaryArchetype  — id of the strongest archetype
 *
 * @property {string[]} mechanicTags — output of extractCommanderMechanicTags
 *   (cares_about_sacrifice, cares_about_tokens, tribal_dragons, ...)
 * @property {Set<string>} cardTagBoosts — set of card-level tags that get
 *   a synergy bonus given this commander's mechanic interests
 *
 * @property {Set<string>} anchorNames — lowercased set of must-include
 *   anchor card names from the detected archetypes
 *
 * @property {object} tribal
 * @property {string|null} tribal.tribe — singular tribe name ('dragon',
 *   'goblin', etc.) when the commander's text references a creature type;
 *   null otherwise. NOT inferred from creature type alone.
 * @property {number} tribal.densityFloor — recommended minimum on-tribe
 *   creature count when tribe is set (0 when no tribe)
 *
 * @property {object} bracket
 * @property {number} bracket.ceiling     — realistic max bracket (1-5)
 * @property {string[]} bracket.winPlanShapes — multi-card wincon patterns
 *   this commander naturally supports ('extra_combat', 'combat_damage_draw',
 *   'aristocrats', 'etb_drain', 'tribal_anthem')
 *
 * @property {object} expectations
 * @property {number} expectations.minRamp — recommended ramp count, scaled
 *   by CMC (high-CMC commanders need more)
 * @property {boolean} expectations.evasionBased — commander wants evasive
 *   creatures (combat-damage triggers, voltron, etc.)
 */

const PROFILE_CACHE = new Map()

/**
 * Build a CommanderProfile for a commander. Cached by name.
 * @param {object} commander
 * @returns {CommanderProfile}
 */
export function extractCommanderProfile(commander) {
  if (!commander?.name) return emptyProfile()
  const key = commander.name
  if (PROFILE_CACHE.has(key)) return PROFILE_CACHE.get(key)

  const text = getOracleText(commander)
  const archetypes = detectArchetypes(commander)
  const mechanicTags = extractCommanderMechanicTags(commander)
  const cardTagBoosts = commanderToCardTagBoosts(mechanicTags)
  // Lowercase the anchor set — consumers (execution score, deck doctor)
  // do case-insensitive lookups against card names. Normalizing once at
  // the knowledge-layer boundary saves every consumer from doing it.
  const rawAnchors = anchorNamesFor(archetypes)
  const anchorNames = new Set(Array.from(rawAnchors).map(n => n.toLowerCase()))
  const ceiling = getCommanderBracketCeiling(commander)

  const tribalArchetype = archetypes.find(a => a.tribe)
  const tribal = tribalArchetype
    ? { tribe: tribalArchetype.tribe, densityFloor: 18 }
    : { tribe: null, densityFloor: 0 }

  const profile = {
    name: commander.name,
    colorIdentity: commander.color_identity ?? commander.colors ?? [],
    cmc: commander.cmc ?? 0,
    // Oracle text exposed so consumers (e.g., WinPlanLens) can pass a
    // commander shape into detectMultiCardWincons without re-fetching.
    oracleText: text,

    archetypes,
    primaryArchetype: archetypes[0]?.id ?? null,

    mechanicTags,
    cardTagBoosts,

    anchorNames,

    tribal,

    bracket: {
      ceiling,
      winPlanShapes: detectWinPlanShapes(commander, mechanicTags, archetypes, text),
    },

    expectations: {
      minRamp: minRampForCmc(commander.cmc ?? 4),
      evasionBased: detectEvasionBased(text),
    },
  }

  PROFILE_CACHE.set(key, profile)
  return profile
}

function emptyProfile() {
  return {
    name: '',
    colorIdentity: [],
    cmc: 0,
    archetypes: [],
    primaryArchetype: null,
    mechanicTags: [],
    cardTagBoosts: new Set(),
    anchorNames: new Set(),
    tribal: { tribe: null, densityFloor: 0 },
    bracket: { ceiling: 5, winPlanShapes: [] },
    expectations: { minRamp: 6, evasionBased: false },
  }
}

// Apply the bracket cap to a requested bracket using the cached profile.
// Convenience wrapper so callers don't need to import both modules.
export function effectiveBracketFor(commander, requestedBracket) {
  const profile = extractCommanderProfile(commander)
  return applyCommanderBracketCap(commander, requestedBracket).effective
}

// Detect which multi-card wincon patterns the commander NATURALLY supports
// based on its oracle text + detected mechanics. This is the "what could
// this commander win with?" question — separate from "what does this deck
// actually have?" (which is the WinPlanLens's job).
function detectWinPlanShapes(commander, mechanicTags, archetypes, text) {
  const shapes = []
  // Extra-combat: commander grants additional combat phases
  if (/additional combat (?:phase|step)/i.test(text)) shapes.push('extra_combat')
  // Combat-damage-draw: commander triggers a draw on combat damage
  if (/\bcombat damage to [^.]*\b(?:players?|opponents?)\b[^.]*draw/i.test(text)) {
    shapes.push('combat_damage_draw')
  }
  // ETB-drain: commander cares about tokens or ETBs (deck can pair with Impact Tremors)
  if (mechanicTags.includes('cares_about_tokens') ||
      mechanicTags.includes('cares_about_etb')) {
    shapes.push('etb_drain')
  }
  // Aristocrats: commander cares about sacrifice
  if (mechanicTags.includes('cares_about_sacrifice')) {
    shapes.push('aristocrats')
  }
  // Tribal anthem: commander has a tribal mechanic tag
  if (mechanicTags.some(t => t.startsWith('tribal_'))) {
    shapes.push('tribal_anthem')
  }
  return shapes
}

function minRampForCmc(cmc) {
  // Higher-CMC commanders need more ramp to consistently hit them on curve.
  if (cmc >= 7) return 12
  if (cmc >= 5) return 10
  if (cmc >= 4) return 8
  return 6
}

function detectEvasionBased(text) {
  // Commander cares about combat damage / attacking — wants evasive creatures.
  if (/whenever [^.]*deals combat damage/i.test(text)) return true
  if (/whenever [^.]*\battacks?\b/i.test(text)) return true
  return false
}

export function clearCommanderProfileCache() {
  PROFILE_CACHE.clear()
}
