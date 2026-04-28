const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

const BASIC_LAND_COLOR_MAP = {
  W: ['Plains', 'Snow-Covered Plains'],
  U: ['Island', 'Snow-Covered Island'],
  B: ['Swamp', 'Snow-Covered Swamp'],
  R: ['Mountain', 'Snow-Covered Mountain'],
  G: ['Forest', 'Snow-Covered Forest'],
}

export function isBasicLand(card) {
  if (!card.type_line) return false
  return /\bBasic\b/.test(card.type_line) && /\bLand\b/.test(card.type_line)
}

export function isLand(card) {
  return card.type_line ? /\bLand\b/.test(card.type_line) : false
}

export function getBasicLandsForCommander(commander) {
  const identity = commander.color_identity ?? []
  const basics = []
  for (const color of identity) {
    const names = BASIC_LAND_COLOR_MAP[color] ?? []
    basics.push(...names)
  }
  if (identity.length === 0) basics.push('Wastes')
  return basics
}

export function colorIdentityLegal(card, commander) {
  const commanderColors = new Set(commander.color_identity ?? [])
  const cardColors = card.color_identity ?? []
  return cardColors.every(c => commanderColors.has(c))
}

export function isCommanderLegal(card) {
  if (!card.legalities) return true
  return card.legalities.commander === 'legal' || card.legalities.commander === 'restricted'
}

export function hasValidData(card) {
  return !card.needsValidation && !card.validationFailed && !!card.type_line
}

export function getOracleText(card) {
  if (card.oracle_text) return card.oracle_text.toLowerCase()
  if (card.card_faces) {
    return card.card_faces.map(f => f.oracle_text ?? '').join(' ').toLowerCase()
  }
  return ''
}

export function deduplicateByName(cards) {
  const seen = new Set()
  return cards.filter(c => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function avgCmc(cards) {
  const nonLands = cards.filter(c => !isLand(c))
  if (nonLands.length === 0) return 0
  const total = nonLands.reduce((s, c) => s + (c.cmc ?? 0), 0)
  return Math.round((total / nonLands.length) * 10) / 10
}
