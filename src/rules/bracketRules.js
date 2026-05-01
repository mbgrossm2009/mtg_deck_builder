export const BRACKET_LABELS = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'Competitive',
}

// What each bracket prohibits during card selection. Restructured to make
// each bracket's policy explicit:
//   B1: no game changers, no fast mana, no tutors, no infinite wincons
//   B2: same as B1 EXCEPT safe rocks (Sol Ring etc.) and soft tutors (land
//       ramp) are exempt — even though Sol Ring is officially a "game changer"
//       in WotC's bracket spec, every precon ships with it, so blocking it at
//       B2 (precon power level) would be absurd
//   B3: elite fast mana still blocked (smooths the B3→B4 power curve)
//   B4 + B5: anything goes
export function isBracketAllowed(card, bracket) {
  const { tags = [], roles = [] } = card

  if (bracket === 1) {
    if (tags.includes('game_changer')) return false
    if (tags.includes('fast_mana'))    return false
    if (tags.includes('tutor'))        return false
    if (roles.includes('win_condition') && isInfiniteWinCon(card.name)) return false
  }

  if (bracket === 2) {
    // Safe rocks (Sol Ring, etc.) and soft tutors (land ramp) bypass the
    // game-changer / fast_mana / tutor blocks. They are bracket-2 staples.
    if (tags.includes('game_changer') && !isSafeRock(card.name) && !isSoftTutor(card.name)) return false
    if (tags.includes('fast_mana')    && !isSafeRock(card.name))     return false
    if (tags.includes('tutor')        && !isSoftTutor(card.name))    return false
    if (roles.includes('win_condition') && isInfiniteWinCon(card.name)) return false
  }

  if (bracket === 3) {
    // B3 (Upgraded) allows tutors and most fast mana, but holds back the
    // elite cEDH-tier acceleration so it doesn't feel like a power spike.
    if (tags.includes('fast_mana') && isEliteFastMana(card.name)) return false
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

// Elite cEDH-tier fast mana — held back until B4. Everything else with the
// fast_mana tag (Talismans, Signets, Sol Ring, etc.) is allowed at B3.
function isEliteFastMana(name) {
  return [
    'Mana Crypt', 'Mana Vault', 'Grim Monolith',
    'Mox Diamond', 'Chrome Mox', 'Mox Opal', 'Mox Amber',
    'Lotus Petal', 'Jeweled Lotus', 'Dockside Extortionist',
  ].includes(name)
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

// Target land count varies by bracket. cEDH (5) drops significantly because
// games end T3-T5 and rituals/fast mana fill in for missed land drops.
// Bracket 5 calibrated against three real cEDH lists (Atraxa GU, Najeela, Rograkh+Silas)
// which all ran 24-28 lands.
export function targetLandCount(bracket) {
  if (bracket <= 2) return 38
  if (bracket === 3) return 37
  if (bracket === 4) return 36
  return 28  // bracket 5 — cEDH (was 31; lowered after empirical testing)
}

// Target average CMC of NON-LAND cards per bracket. Used by deckScorer to bias
// card selection toward the bracket's expected curve. Casual brackets allow
// big splashy 5+ drops; cEDH must average 2.0 or below to win on T3-T5.
//
// These are TARGETS, not caps. The scorer applies a soft penalty as a card's
// CMC exceeds the target, scaled to how far over it goes.
export function targetAvgCmc(bracket) {
  if (bracket === 1) return 4.0   // exhibition — big splashy plays welcome
  if (bracket === 2) return 3.7   // core / precon
  if (bracket === 3) return 3.3   // upgraded
  if (bracket === 4) return 2.8   // optimized
  return 2.0                       // cEDH — must combo by T3-T5
}

// Target counts per role per bracket. Optional `commander` and `archetypes` let us
// reshape the targets for the deck's actual identity:
//   - high-CMC commanders need more ramp (a 7-drop wants 13-15 pieces, not 10)
//   - tribal commanders want way more synergy slots (Slivers/Elves/etc. run 30-40 tribe)
export function targetRoleCounts(bracket, commander = null, archetypes = []) {
  // cEDH (bracket 5) has a fundamentally different deck shape from optimized
  // (bracket 4): heavy tutors, minimal removal/wipes, very few wincons, lots
  // of protection. Branch out early — none of the brackets-1-through-4 logic
  // applies. Tribal expansion is intentionally skipped here: even tribal cEDH
  // commanders (Najeela, Sliver Overlord) run combo packages, not 35-card
  // tribal swarms.
  // Bracket 5 (cEDH) numbers calibrated against three real cEDH lists:
  //   Atraxa GU:       28L 16R  9D  17 rem(spot+counter)  0W 6P 2WC 10T 15S
  //   Najeela:         28L 21R  5D  13 rem                0W 5P 4WC 15T 10S
  //   Rograkh+Silas:   24L 22R 10D  15 rem                0W 3P 4WC 11T 12S
  // Median: 28L / 19R / 8D / floor 5R + counters / 0-1W / 5P / 3WC / 12T / 12S.
  // High-CMC commander ramp bonus IS applied at bracket 5 — Atraxa GU is a 7-drop
  // and needs the +4 boost to reach the 20+ ramp the real list runs.
  if (bracket === 5) {
    const cmc = commander?.cmc ?? 0
    let ramp = 18
    if (cmc >= 7)      ramp += 4   // Atraxa GU territory
    else if (cmc >= 5) ramp += 2   // Yidris, Yawgmoth-tier
    return {
      ramp,
      draw:          8,    // cantrips + draw engines; most cEDH lists run 5-12
      // Interaction is bundled — counterspells get classified as 'removal' by
      // cardRoles.js, so the removal bucket holds spot removal + every counter
      // the deck owns. Targeting 10 here pulls the full interaction package
      // (~5 spot + ~5 counters) and combines with protection (4) for a total
      // interaction count of 14 — squarely in the real cEDH range of 10-14.
      removal:       10,
      wipe:          1,    // wipes are too slow at cEDH speed
      protection:    4,    // targeted protection; counters above are the bulk
      win_condition: 3,    // counterintuitive: cEDH has FEW named wincons; tutors find them
      tutor:         12,   // single biggest defining feature of cEDH (range 10-15)
      synergy:       12,   // engine pieces; remaining slots fall to filler
      filler:        99,
    }
  }

  let ramp = bracket >= 4 ? 12 : 10
  const cmc = commander?.cmc ?? 0
  if (cmc >= 7)      ramp += 4
  else if (cmc >= 5) ramp += 2

  const isTribal = archetypes.some(a => a.id?.startsWith('tribal_'))
  let synergy = 20
  let draw    = bracket >= 4 ? 12 : 10
  let removal = bracket <= 2 ? 8 : 9
  // Bracket 4 (optimized) bumped 5 → 7 tutors; real bracket 4 lists run 6-8.
  let tutor   = bracket <= 1 ? 0 : bracket === 2 ? 1 : bracket === 3 ? 3 : 7
  if (isTribal) {
    // Tribal lords/anthems/payoffs all live in synergy. Steal from draw/removal/tutor
    // because tribal decks lean on combat damage and tribal-specific effects.
    // Cap at 28 (was 35) — 35 left no room for interaction. 28 still gives a
    // meaningful tribal commitment (8 above the 20 baseline) without crowding
    // wipes / protection / win-cons out of the deck.
    synergy = 28
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
