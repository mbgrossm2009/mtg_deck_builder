// Bracket-specific must-include staples.
//
// Why this exists: EDHREC's per-commander top cards are bracket-agnostic.
// For a casual commander like Tiamat, the top 30 EDHREC picks are all
// casual staples — even when the user targets bracket 5 (cEDH). The
// resulting skeleton then biases the deck toward casual feel regardless of
// the bracket setting. That's how a B5 generation came out feeling like B2.
//
// Bracket staples solve this with a curated list: cards every B4+ deck
// wants if available. They're force-locked into the deck after the EDHREC/
// Moxfield skeleton (deduplicated against it), so the skeleton can stay
// commander-specific while the bracket-staples enforce bracket fit.
//
// Cards here are NOT bracket-illegal at lower brackets — they get filtered
// by bracketRules.js before this module ever sees them. Mana Crypt is
// excluded at B1-B3 by bracket eligibility, so even though it's on this
// list, it won't end up in a B3 deck.

// UNIVERSAL — cards every commander deck wants if owned, AT EVERY BRACKET.
// These are the "if you own it, it goes in" staples — anyone playing
// commander would put Sol Ring in their deck regardless of strategy or
// power level. Lands are NOT in this list (the mana-base solver owns
// lands; Bojuka Bog, Command Tower, Reliquary Tower etc. get picked
// there).
//
// Bracket eligibility downstream filters out anything inappropriate at
// the target bracket — Cyclonic Rift is a game-changer at B1 so it gets
// excluded by the bracket filter before this module sees it. We don't
// have to maintain bracket-specific lists for these — the existing
// bracketRules.isBracketAllowed handles the gating.
const UNIVERSAL_STAPLES = [
  // Universal mana rocks (Sol Ring is in basically every precon)
  'Sol Ring', 'Arcane Signet', 'Mind Stone', 'Fellwar Stone', 'Thought Vessel',
  // "Safe" non-fast ramp
  "Wayfarer's Bauble", 'Solemn Simulacrum', 'Burnished Hart',
  // Universal protection equipment
  'Lightning Greaves', 'Swiftfoot Boots',
  // Universal artifact draw / utility
  'Skullclamp', "Sensei's Divining Top", "Lifecrafter's Bestiary",
  // Single-color staples that go in every deck of that color
  // White
  'Swords to Plowshares', 'Path to Exile', 'Generous Gift',
  // Blue
  'Counterspell', 'Cyclonic Rift',
  // Black
  'Toxic Deluge',
  // Green
  'Cultivate', "Kodama's Reach", 'Rampant Growth', "Nature's Lore",
  'Beast Within', 'Heroic Intervention', 'Eternal Witness',
  // Multi-color universal removal/protection
  'Anguished Unmaking', "Assassin's Trophy",
]

const B4_PLUS_STAPLES = [
  // Fast mana — every cEDH deck wants these
  'Mana Crypt', 'Mana Vault', 'Grim Monolith',
  'Mox Diamond', 'Chrome Mox', 'Mox Opal', 'Mox Amber', 'Lotus Petal',
  'Jeweled Lotus', 'Jeweled Amulet', 'Dockside Extortionist', 'Ancient Tomb',
  'Lion\'s Eye Diamond',
  // Talismans (10) — every multi-color cEDH deck runs the on-color ones
  'Talisman of Conviction', 'Talisman of Creativity', 'Talisman of Curiosity',
  'Talisman of Dominance', 'Talisman of Hierarchy', 'Talisman of Impulse',
  'Talisman of Indulgence', 'Talisman of Progress', 'Talisman of Resilience',
  'Talisman of Unity',
  // Signets (10) — same role as Talismans, equally universal
  'Azorius Signet', 'Boros Signet', 'Dimir Signet', 'Golgari Signet',
  'Gruul Signet', 'Izzet Signet', 'Orzhov Signet', 'Rakdos Signet',
  'Selesnya Signet', 'Simic Signet',
  // Other essential 2-mana fixing
  'Coalition Relic', 'Chromatic Lantern',
  // High-tier tutors
  'Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Mystical Tutor',
  'Enlightened Tutor', 'Worldly Tutor', "Green Sun's Zenith",
  'Chord of Calling', 'Birthing Pod', 'Survival of the Fittest',
  'Idyllic Tutor', 'Eladamri\'s Call', 'Finale of Devastation',
  'Natural Order',
  // Card-advantage engines
  'Rhystic Study', 'Mystic Remora', 'Necropotence', 'Sylvan Library',
  'Esper Sentinel', 'Smothering Tithe', 'Sylvan Tutor',
  'Brainstorm', 'Ponder', 'Preordain', 'Consider', 'Dig Through Time',
  'Treasure Cruise', 'Night\'s Whisper', 'Sign in Blood',
  // Top-tier interaction (free / cheap)
  'Force of Will', 'Force of Negation', 'Pact of Negation', 'Mana Drain',
  'Flusterstorm', "Teferi's Protection", 'Mental Misstep',
  'Daze', 'Spell Pierce', 'Dispel', 'Swan Song',
  'Snapcaster Mage', 'Cyclonic Rift',
]

// B5 adds explicit cEDH wincon enablers. These tend to be off-strategy at
// B4 (turn the deck into a combo deck) but are core at B5.
const B5_EXTRA_STAPLES = [
  "Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact',
  'Laboratory Maniac', 'Jace, Wielder of Mysteries',
  'Underworld Breach', 'Yawgmoth, Thran Physician',
  'Opposition Agent', 'Drannith Magistrate',
  // Free counterspells that matter only at the highest bracket
  'Force of Vigor', 'Veil of Summer', 'Autumn\'s Veil',
]

export function getBracketStapleNames(bracket) {
  if (bracket >= 5) return [...UNIVERSAL_STAPLES, ...B4_PLUS_STAPLES, ...B5_EXTRA_STAPLES]
  if (bracket >= 4) return [...UNIVERSAL_STAPLES, ...B4_PLUS_STAPLES]
  // B1-B3 still get universal staples — Sol Ring goes in every precon. The
  // bracket eligibility filter (applied to legalNonLands BEFORE this module
  // runs) drops anything inappropriate at the target bracket.
  return UNIVERSAL_STAPLES
}

// Returns the actual Card objects (annotated with role/tag from the legal
// pool) for staples the user owns at this bracket. Cards already covered by
// the EDHREC/Moxfield skeleton are skipped — no double-counting. Lands are
// also excluded — the mana base solver owns the mana base, not this module.
export function buildBracketStaples({ bracket, legalNonLands, alreadyLockedNames = new Set() }) {
  const stapleNames = getBracketStapleNames(bracket)
  if (stapleNames.length === 0) return []

  const poolByName = new Map()
  for (const c of legalNonLands) poolByName.set(c.name.toLowerCase(), c)

  const found = []
  const seen = new Set()
  for (const name of stapleNames) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (alreadyLockedNames.has(key)) continue   // already in skeleton
    const card = poolByName.get(key)
    if (!card) continue                         // user doesn't own it (or off-color, or bracket-filtered)
    seen.add(key)
    found.push({ ...card, fromBracketStaples: true })
  }
  return found
}

// Returns coverage stats: how many of the bracket's curated staples the user
// actually owns, plus a list of the missing high-value cards. Used by the
// orchestrator to surface "your collection is missing X cEDH staples" so the
// user knows when their B5 deck can't truly hit B5 because the source material
// isn't there.
export function getStapleCoverage({ bracket, collectionNames, commanderColorIdentity = [] }) {
  const stapleNames = getBracketStapleNames(bracket)
  if (stapleNames.length === 0) {
    return { total: 0, owned: 0, missing: [] }
  }
  const ownedSet = new Set(collectionNames.map(n => n.toLowerCase()))
  const owned = []
  const missing = []
  for (const name of stapleNames) {
    if (ownedSet.has(name.toLowerCase())) owned.push(name)
    else missing.push(name)
  }
  return {
    total:   stapleNames.length,
    owned:   owned.length,
    ownedNames: owned,
    missing: missing,
  }
}
