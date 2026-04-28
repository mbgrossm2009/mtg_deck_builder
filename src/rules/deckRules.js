// MTG Commander rules logic — to be built out
// e.g. 100-card limit, singleton rule, color identity enforcement

export function isValidDeckSize(deck) {
  return deck.length === 100
}

export function isSingleton(deck) {
  const names = deck.map(card => card.name)
  const unique = new Set(names)
  return unique.size === deck.length
}


const DECK_SIZE = 100

// export function isDeckValid(deck) {
//   return deck.length === DECK_SIZE
// }

// export function isColorIdentityLegal(card, commander) {
//   return card.color_identity.every((c) => commander.color_identity.includes(c))
// }

// export function hasSingletons(deck) {
//   const names = deck.map((c) => c.name)
//   const unique = new Set(names)
//   return unique.size === names.length
// }
