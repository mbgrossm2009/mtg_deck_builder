export const BRACKET_LABELS = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'Competitive',
}

// What each bracket prohibits during card selection
export function isBracketAllowed(card, bracket) {
  const { tags = [], roles = [] } = card

  if (bracket <= 1) {
    if (tags.includes('fast_mana'))    return false
    if (tags.includes('tutor'))        return false
    if (tags.includes('game_changer')) return false
    if (roles.includes('win_condition') && isInfiniteWinCon(card.name)) return false
  }

  if (bracket <= 2) {
    if (tags.includes('fast_mana') && !isSafeRock(card.name)) return false
    if (tags.includes('tutor') && !isSoftTutor(card.name))    return false
  }

  if (bracket <= 3) {
    // Combos are excluded — handled in generator after combo detection
  }

  return true
}

// Bracket 2 allows a small set of "safe" rocks that are nearly ubiquitous
function isSafeRock(name) {
  return ['Sol Ring', 'Arcane Signet', 'Fellwar Stone', 'Mind Stone', 'Thought Vessel'].includes(name)
}

// Bracket 2 allows tutors that search specifically for lands (ramp, not combo enablers)
function isSoftTutor(name) {
  return ['Cultivate', 'Kodama\'s Reach', 'Farseek', 'Nature\'s Lore', 'Rampant Growth',
          'Three Visits', 'Skyshroud Claim', 'Tempt with Discovery'].includes(name)
}

function isInfiniteWinCon(name) {
  return ['Thassa\'s Oracle', 'Laboratory Maniac', 'Jace, Wielder of Mysteries',
          'Exquisite Blood', 'Sanguine Bond'].includes(name)
}

// Compute the actual bracket a finished deck belongs to
export function computeActualBracket(mainDeck, combos) {
  let bracket = 1
  const flagged = []

  for (const card of mainDeck) {
    const { tags = [], roles = [] } = card

    if (tags.includes('game_changer')) {
      if (bracket < 3) bracket = 3
      flagged.push(card.name)
    }
    if (tags.includes('tutor') && !isSoftTutor(card.name)) {
      if (bracket < 3) bracket = 3
      flagged.push(card.name)
    }
    if (tags.includes('fast_mana') && !isSafeRock(card.name)) {
      if (bracket < 3) bracket = 3
      flagged.push(card.name)
    }
  }

  const tutorCount = mainDeck.filter(c => (c.tags ?? []).includes('tutor')).length
  if (tutorCount >= 4 && bracket < 4) { bracket = 4 }

  const fastManaCount = mainDeck.filter(c => (c.tags ?? []).includes('fast_mana') && !isSafeRock(c.name)).length
  if (fastManaCount >= 3 && bracket < 4) { bracket = 4 }

  if (combos.length > 0 && bracket < 4) { bracket = 4 }
  if (combos.length >= 2 && bracket < 5) { bracket = 5 }

  return { actualBracket: bracket, flaggedCards: [...new Set(flagged)] }
}

// Target land count varies slightly by bracket
export function targetLandCount(bracket) {
  if (bracket <= 2) return 38
  if (bracket === 3) return 37
  return 36
}

// Target counts per role per bracket. Optional `commander` and `archetypes` let us
// reshape the targets for the deck's actual identity:
//   - high-CMC commanders need more ramp (a 7-drop wants 13-15 pieces, not 10)
//   - tribal commanders want way more synergy slots (Slivers/Elves/etc. run 30-40 tribe)
export function targetRoleCounts(bracket, commander = null, archetypes = []) {
  let ramp = bracket >= 4 ? 12 : 10
  const cmc = commander?.cmc ?? 0
  if (cmc >= 7)      ramp += 4
  else if (cmc >= 5) ramp += 2

  const isTribal = archetypes.some(a => a.id?.startsWith('tribal_'))
  let synergy = 20
  let draw    = bracket >= 4 ? 12 : 10
  let removal = bracket <= 2 ? 8 : 9
  let tutor   = bracket <= 1 ? 0 : bracket === 2 ? 1 : bracket === 3 ? 3 : 5
  if (isTribal) {
    // Tribal lords/anthems/payoffs all live in synergy. Steal from removal/draw/tutor
    // because tribal decks lean on combat damage and tribal-specific draw/tutor effects.
    synergy = 35
    draw    = Math.max(draw - 2, 7)
    removal = Math.max(removal - 1, 6)
    tutor   = Math.max(tutor - 1, 0)
  }

  return {
    ramp,
    draw,
    removal,
    wipe:         bracket <= 2 ? 3  : 4,
    protection:   bracket >= 4 ? 5  : 3,
    win_condition: bracket >= 4 ? 4  : 2,
    tutor,
    synergy,
    filler:       99, // fills whatever is left
  }
}
