import { isBasicLand, colorIdentityLegal, isCommanderLegal, hasValidData, deduplicateByName } from '../utils/cardHelpers'

// Cards legal in Commander regardless of their printed legality field
const ALWAYS_LEGAL = new Set(['Relentless Rats', 'Shadowborn Apostle', 'Rat Colony', 'Persistent Petitioners', 'Seven Dwarves'])

export function filterLegalCards(collection, commander) {
  const legal = []
  const excluded = []

  for (const card of collection) {
    const reason = getLegalityReason(card, commander)
    if (reason) {
      excluded.push({ ...card, excludeReason: reason })
    } else {
      legal.push({ ...card, isBasicLand: isBasicLand(card) })
    }
  }

  return { legal: deduplicateByName(legal), excluded }
}

function getLegalityReason(card, commander) {
  if (!hasValidData(card)) return 'Missing card data — needs Scryfall validation'
  if (!isCommanderLegal(card) && !ALWAYS_LEGAL.has(card.name)) return 'Banned in Commander'
  if (!colorIdentityLegal(card, commander)) return `Outside color identity (${commander.color_identity.join('')})`
  if (card.name.toLowerCase() === commander.name.toLowerCase()) return 'Is the commander'
  return null
}
