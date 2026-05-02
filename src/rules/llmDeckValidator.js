// Authoritative validator for LLM-suggested decks.
//
// The LLM is NEVER trusted blindly. Every card it returns is checked against:
//   - the legal card pool (already pre-filtered for legality + bracket)
//   - the user's actual collection (LLM cannot suggest cards we don't own)
//   - color identity (defense-in-depth — pre-filter should already block this)
//   - banned-in-Commander list (same)
//   - singleton rule (basic lands exempt)
//
// The result tells the orchestrator exactly which cards survived, which need
// to be replaced, and what slot is now empty.

import { colorIdentityLegal, isCommanderLegal, isBasicLand } from '../utils/cardHelpers'

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

function nameKey(name) { return (name ?? '').trim().toLowerCase() }

/**
 * Validate an LLM-generated deck response.
 *
 * @param {object} args
 * @param {object} args.llmDeck         — the parsed JSON returned by the LLM
 *                                        (expects shape { deck: [{name, role, reason}, ...], ... })
 * @param {object} args.commander
 * @param {Array}  args.legalCardPool   — pool we sent to the LLM (already legality + bracket filtered)
 * @param {Array}  args.collection      — full user collection (the source of truth for ownership)
 * @param {number} args.bracket
 *
 * @returns {{
 *   isValid: boolean,
 *   validCards: Array<{name: string, role: string, reason: string, card: object}>,
 *   invalidCards: Array<{name: string, role: string, reason: string, rejectionReason: string}>,
 *   missingCards: number,            // how many slots short of 99
 *   duplicateCards: Array<{name: string, count: number}>,
 *   warnings: string[]
 * }}
 */
export function validateLLMDeckResponse({
  llmDeck,
  commander,
  legalCardPool,
  collection,
  expectedDeckSize = 99,    // when mana base is solver-locked, this is 99 - lockedLands
}) {
  const validCards = []
  const invalidCards = []
  const duplicateCards = []
  const warnings = []

  if (!llmDeck || !Array.isArray(llmDeck.deck)) {
    return {
      isValid: false,
      validCards: [],
      invalidCards: [],
      missingCards: expectedDeckSize,
      duplicateCards: [],
      warnings: ['LLM response missing or has no "deck" array.'],
    }
  }

  // Index the pool and collection by lowercased name for fast lookup.
  const poolByName = new Map()
  for (const c of legalCardPool) poolByName.set(nameKey(c.name), c)

  const collectionNames = new Set()
  for (const c of collection) collectionNames.add(nameKey(c.name))

  const seenNonBasic = new Map() // lowercased name → count, for singleton check

  const commanderKey = nameKey(commander?.name)

  for (const entry of llmDeck.deck) {
    const name = entry?.name
    const role = entry?.role ?? 'filler'
    const reason = entry?.reason ?? ''

    if (!name || typeof name !== 'string') {
      invalidCards.push({ name: String(name), role, reason, rejectionReason: 'Missing or non-string name.' })
      continue
    }

    const key = nameKey(name)

    // The LLM must never return the commander itself in the 99.
    if (key === commanderKey) {
      invalidCards.push({ name, role, reason, rejectionReason: 'Card is the commander — not allowed in the 99.' })
      continue
    }

    const card = poolByName.get(key)

    // 1. Must be in the legal pool we sent.
    if (!card) {
      // Distinguish "not in pool" from "not in collection" so the orchestrator
      // can surface a useful warning.
      if (!collectionNames.has(key)) {
        invalidCards.push({ name, role, reason, rejectionReason: 'Not in user collection (LLM hallucinated or suggested an upgrade).' })
      } else {
        invalidCards.push({ name, role, reason, rejectionReason: 'In collection but excluded from legal pool (illegal, off-color, or bracket-filtered).' })
      }
      continue
    }

    // 2. Defense-in-depth: re-check color identity even though pre-filter ran.
    if (!colorIdentityLegal(card, commander)) {
      invalidCards.push({ name, role, reason, rejectionReason: `Outside commander color identity (${(commander.color_identity ?? []).join('') || 'colorless'}).` })
      continue
    }

    // 3. Defense-in-depth: banned-list check.
    if (!isCommanderLegal(card)) {
      invalidCards.push({ name, role, reason, rejectionReason: 'Banned in Commander.' })
      continue
    }

    // 4. Singleton: basic lands may repeat, nothing else may.
    const isBasic = isBasicLand(card) || BASIC_LAND_NAMES.has(card.name)
    if (!isBasic) {
      const count = (seenNonBasic.get(key) ?? 0) + 1
      seenNonBasic.set(key, count)
      if (count > 1) {
        invalidCards.push({ name, role, reason, rejectionReason: 'Duplicate non-basic card (singleton violation).' })
        continue
      }
    }

    validCards.push({ name: card.name, role, reason, card })
  }

  // Roll up duplicates that we rejected so the orchestrator can report them.
  for (const [key, count] of seenNonBasic.entries()) {
    if (count > 1) duplicateCards.push({ name: key, count })
  }

  // Slot accounting — anything short of expected needs to be filled by the
  // heuristic fallback. expectedDeckSize is 99 by default, or 99 - lockedLands
  // when the orchestrator pre-solved the mana base.
  const missingCards = Math.max(0, expectedDeckSize - validCards.length)

  if (missingCards > 0) {
    warnings.push(`LLM returned ${validCards.length} valid cards — need to fill ${missingCards} more slots from the heuristic fallback.`)
  }
  if (invalidCards.length > 0) {
    warnings.push(`Rejected ${invalidCards.length} card${invalidCards.length === 1 ? '' : 's'} from the LLM response (see invalidCards for reasons).`)
  }
  if (duplicateCards.length > 0) {
    warnings.push(`LLM returned duplicates of ${duplicateCards.length} non-basic card${duplicateCards.length === 1 ? '' : 's'} — singleton enforced.`)
  }

  // Light role-balance feedback (purely informational; the heuristic fallback
  // is what actually fixes underweight roles). Skip the land warning when the
  // orchestrator solved the mana base separately — the LLM was correctly told
  // not to pick lands.
  const roleCounts = {}
  for (const v of validCards) roleCounts[v.role] = (roleCounts[v.role] ?? 0) + 1
  if (expectedDeckSize === 99 && (roleCounts.land ?? 0) < 33) {
    warnings.push(`Only ${roleCounts.land ?? 0} lands — likely mana issues.`)
  }
  if ((roleCounts.ramp ?? 0) < 6)         warnings.push(`Only ${roleCounts.ramp ?? 0} ramp pieces — deck may be slow.`)
  if ((roleCounts.removal ?? 0) < 5)      warnings.push(`Only ${roleCounts.removal ?? 0} removal — may struggle to answer threats.`)

  const isValid =
    invalidCards.length === 0 &&
    duplicateCards.length === 0 &&
    missingCards === 0

  return {
    isValid,
    validCards,
    invalidCards,
    missingCards,
    duplicateCards,
    warnings,
  }
}
