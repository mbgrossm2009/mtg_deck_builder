import { colorIdentityLegal, isCommanderLegal } from '../utils/cardHelpers'

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
// validateDeck is a backstop; this wrapper applies the bracket norm:
//   B1 ≤ 18  — casual decks tolerate plenty of off-plan cards
//   B2 ≤ 12  — precon-tier — some filler expected
//   B3 ≤ 8   — focused upgraded deck
//   B4 ≤ 5   — optimized — almost no off-plan
//   B5 ≤ 3   — cEDH — tight, but not zero (Drannith Magistrate, Opposition
//              Agent etc. count as "filler" by role tag but earn their slot)
//
// We don't replace validateDeck because it's used in many places that
// don't know the bracket. This wrapper produces an extended warning list
// when the bracket is known.
const FILLER_THRESHOLD_BY_BRACKET = {
  1: 18,
  2: 12,
  3: 8,
  4: 5,
  5: 3,
}

export function validateDeckAtBracket(mainDeck, commander, bracket) {
  const { errors, warnings } = validateDeck(mainDeck, commander)

  // Strip the flat-threshold filler warning from the base output — we'll
  // emit our own bracket-scaled one instead. Keep all other warnings.
  const filtered = warnings.filter(w => !/filler cards/.test(w))

  const counts = countRoles(mainDeck)
  const threshold = FILLER_THRESHOLD_BY_BRACKET[bracket]
  if (threshold !== undefined && counts.filler > threshold) {
    filtered.push(
      `${counts.filler} filler cards at B${bracket} (target ≤ ${threshold}). ` +
      `Many slots aren't advancing the deck's plan.`
    )
  }

  return { errors, warnings: filtered }
}

export function countRoles(cards) {
  const counts = { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, protection: 0, win_condition: 0, tutor: 0, synergy: 0, filler: 0 }
  for (const card of cards) {
    for (const role of (card.roles ?? [])) {
      if (role in counts) counts[role]++
    }
  }
  return counts
}
