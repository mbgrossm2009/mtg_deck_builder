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

  return { errors, warnings }
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
