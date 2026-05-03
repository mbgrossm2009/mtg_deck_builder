import { colorIdentityLegal, isCommanderLegal } from '../utils/cardHelpers'
import { maxRampCount } from './bracketRules'

export function validateDeck(mainDeck, commander) {
  const errors = []
  const warnings = []

  if (mainDeck.length !== 99) {
    errors.push(`Deck has ${mainDeck.length} cards. Needs exactly 99 (plus commander).`)
  }

  // Singleton check (basic lands exempt)
  const nameCounts = {}
  for (const card of mainDeck) {
    if (card.isBasicLand) continue
    const key = card.name.toLowerCase()
    nameCounts[key] = (nameCounts[key] ?? 0) + 1
  }
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count > 1) errors.push(`"${name}" appears ${count} times. Singleton violation.`)
  }

  // Color identity
  for (const card of mainDeck) {
    if (!colorIdentityLegal(card, commander)) {
      errors.push(`${card.name} is outside the commander's color identity.`)
    }
  }

  // Banned cards
  for (const card of mainDeck) {
    if (!isCommanderLegal(card)) {
      errors.push(`${card.name} is banned in Commander.`)
    }
  }

  // Role balance warnings
  const roleCounts = countRoles(mainDeck)
  if (roleCounts.land < 33)         warnings.push(`Only ${roleCounts.land} lands. Deck may have mana problems.`)
  if (roleCounts.ramp < 6)          warnings.push(`Only ${roleCounts.ramp} ramp pieces. Deck may be slow.`)
  if (roleCounts.draw < 6)          warnings.push(`Only ${roleCounts.draw} draw sources. You may run out of cards.`)
  if (roleCounts.removal < 5)       warnings.push(`Only ${roleCounts.removal} removal spells. May struggle to answer threats.`)
  if (roleCounts.win_condition < 1) warnings.push('No clear win conditions found. How does this deck plan to win?')

  // Filler warning — flag if a substantial portion of the deck is tagged
  // as filler (the role assigned by cardRoles.js when nothing else fits).
  // Threshold of 12 means roughly 12% of non-land slots are off-plan;
  // anything above that suggests the deck pool was thin or the LLM picked
  // generic cards over synergy.
  if (roleCounts.filler > 12) {
    warnings.push(`${roleCounts.filler} filler cards. Many slots aren't advancing the deck's plan.`)
  }

  return { errors, warnings }
}

// Bracket-scaled filler thresholds. The flat 12-card threshold in
// validateDeck is a backstop; this wrapper applies the bracket norm.
//
// Definition: filler = cards whose PRIMARY role is 'filler' (i.e., no
// other role detected by assignRoles). Not the slot-bucket fallback tag
// that appears on every non-land card — see countRoles in this file.
//
// Thresholds tightened (2026-05-03) from earlier 18/12/8/5/3 set after
// the filler-counting bug fix exposed how few cards are TRUE filler in
// real decks. Then RELAXED at B4/B5 after eval data showed honest decks
// were hitting 5-7 filler at B5 — fatal-clamping every one was punitive.
//   B1 ≤ 12  — casual decks tolerate off-plan cards
//   B2 ≤ 9   — precon-tier
//   B3 ≤ 6   — focused upgraded deck
//   B4 ≤ 5   — optimized; some utility/protection cards don't share commander keywords
//   B5 ≤ 3   — cEDH; every slot must earn it but staple stax (Defense Grid,
//              Grafdigger's Cage, Drannith Magistrate) don't share keywords
//              with most commanders
//
// Keep in sync with FILLER_CAP_BY_BRACKET in src/services/llmDeckService.js.
//
// We don't replace validateDeck because it's used in many places that
// don't know the bracket. This wrapper produces an extended warning list
// when the bracket is known.
const FILLER_THRESHOLD_BY_BRACKET = {
  1: 12,
  2:  9,
  3:  6,
  4:  5,
  5:  3,
}

export function validateDeckAtBracket(mainDeck, commander, bracket) {
  const { errors, warnings } = validateDeck(mainDeck, commander)

  // Strip the flat-threshold filler warning AND the flat-threshold land
  // warning from the base output — we emit our own bracket-and-context
  // aware versions below. Keep all other warnings.
  const filtered = warnings.filter(w => {
    if (/filler cards/.test(w)) return false
    if (/Only \d+ lands/.test(w)) return false
    return true
  })

  const counts = countRoles(mainDeck)
  const threshold = FILLER_THRESHOLD_BY_BRACKET[bracket]
  if (threshold !== undefined && counts.filler > threshold) {
    filtered.push(
      `${counts.filler} filler cards at B${bracket} (target ≤ ${threshold}). ` +
      `Many slots aren't advancing the deck's plan.`
    )
  }

  // Context-aware land warning. The flat "deck < 33 lands" rule is wrong
  // at B5 (cEDH lists run 24-28 lands routinely) and even at B4 it depends
  // on whether the deck has fast mana + low curve to compensate.
  //
  // Rules:
  //   - B5 with 26-28 lands is FINE if the deck has fast_mana >= 8 AND
  //     ramp >= 12 AND avg nonland CMC <= 2.6 (cEDH-shaped).
  //   - B5 with 28 lands but high curve (>3.0) gets warned.
  //   - B4 keeps the 32-land floor unless the same fast-mana exception
  //     applies.
  //   - B1-B3 keep the strict 33-land floor (no fast-mana shortcut).
  const fastManaCount = mainDeck.filter(c => (c.tags ?? []).includes('fast_mana')).length
  const rampCount     = counts.ramp
  const nonLands      = mainDeck.filter(c => !(c.type_line ?? '').toLowerCase().includes('land'))
  const avgCmc        = nonLands.length === 0 ? 0
                      : nonLands.reduce((a, c) => a + (c.cmc ?? 0), 0) / nonLands.length

  const STRICT_FLOOR = { 1: 33, 2: 33, 3: 33, 4: 32, 5: 26 }
  const strictFloor = STRICT_FLOOR[bracket] ?? 33
  const hasFastManaShape = fastManaCount >= 8 && rampCount >= 12 && avgCmc <= 2.6

  if (counts.land < strictFloor) {
    filtered.push(`Only ${counts.land} lands at B${bracket} (target ≥ ${strictFloor}). Deck may have mana problems.`)
  } else if (bracket >= 4 && counts.land < 32 && !hasFastManaShape) {
    // 26-31 lands at B4/B5 only OK with the fast-mana shape — otherwise warn.
    filtered.push(
      `${counts.land} lands at B${bracket} without compensating fast mana ` +
      `(have ${fastManaCount}, need 8+) or low curve (avg CMC ${avgCmc.toFixed(1)}, need ≤ 2.6). ` +
      `Deck may have mana problems.`
    )
  }

  // Ramp upper-cap warning. Excess ramp crowds out interaction/draw —
  // typical eval failure mode where the deck has 19 ramp and 6 removal.
  const rampCap = maxRampCount(bracket, commander)
  if (rampCount > rampCap) {
    filtered.push(
      `${rampCount} ramp pieces at B${bracket} (cap ≈ ${rampCap}). ` +
      `Excess ramp crowds out interaction / draw / synergy — consider ` +
      `swapping the weakest ramp slots for removal or wincon support.`
    )
  }

  // Interaction floor warning. Counts removal + wipe + counterspells
  // (cardRoles tags counters as `removal`). Floors match the orchestrator's
  // REMOVAL_FLOOR_BY_BRACKET; the orchestrator tries to add interaction up
  // to the floor, but if the user's collection doesn't have more, we still
  // want the deck-quality warning.
  const INTERACTION_FLOOR = { 1: 4, 2: 5, 3: 7, 4: 8, 5: 10 }
  const interactionCount = (counts.removal ?? 0) + (counts.wipe ?? 0)
  const interactionFloor = INTERACTION_FLOOR[bracket]
  if (interactionFloor && interactionCount < interactionFloor) {
    filtered.push(
      `Only ${interactionCount} interaction pieces at B${bracket} ` +
      `(floor ${interactionFloor}+). Includes removal, wipes, and counterspells. ` +
      `Deck may struggle to answer threats or protect its plan.`
    )
  }

  return { errors, warnings: filtered }
}

export function countRoles(cards) {
  const counts = { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, protection: 0, win_condition: 0, tutor: 0, synergy: 0, filler: 0 }
  for (const card of cards) {
    const roles = card.roles ?? []
    // Count every detected role normally — except filler.
    //
    // Filler is a SLOT-BUCKET tag that cardRoles.js appends to every
    // non-land card as a fallback so the deckGenerator slot-fill has a
    // catch-all bucket. A card tagged ['ramp', 'filler'] is intended to
    // mean "primary role: ramp, also eligible for filler slots if ramp
    // bucket is full." Counting it as filler here would produce 60+
    // filler counts on real decks even when most cards have meaningful
    // roles — every non-land card is "in" the filler bucket by design.
    //
    // For COUNTING purposes (warnings + UI), filler should mean cards
    // with NO meaningful role detected. assignRoles always pushes filler
    // last, so filler being the FIRST/primary role means no other role
    // matched.
    for (const role of roles) {
      if (role !== 'filler' && role in counts) counts[role]++
    }
    if (roles[0] === 'filler') counts.filler++
  }
  return counts
}
