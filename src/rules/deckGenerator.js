import { getSelectedCommander, getCollection } from '../utils/localStorage'
import { avgCmc, isLand, isBasicLand, getBasicLandsForCommander } from '../utils/cardHelpers'
import { fetchSpellbookCombos } from '../utils/commanderSpellbook'
import { fetchEdhrecCommander } from '../utils/edhrecApi'
import { filterLegalCards } from './commanderRules'
import { assignRoles } from './cardRoles'
import { isBracketAllowed, computeActualBracket, targetLandCount, targetRoleCounts, targetAvgCmc, BRACKET_LABELS } from './bracketRules'
import { scoreCard } from './deckScorer'
import { solveManaBase } from './manaBaseSolver'
import { detectCombos, registerCombos, getAllCombos } from './comboRules'
import { detectArchetypes, anchorNamesFor, themesToArchetypes, mergeArchetypes, cardMatchesArchetype } from './archetypeRules'
import { extractCommanderMechanicTags, commanderToCardTagBoosts } from './commanderMechanics'
import { validateDeckAtBracket, countRoles } from './deckValidator'

export async function generateDeck(bracket = 3, primaryArchetypeId = null) {
  const commander = getSelectedCommander()
  if (!commander) return { error: 'No commander selected.' }

  const rawCollection = getCollection()
  if (rawCollection.length === 0) return { error: 'Your collection is empty.' }

  // 1. Filter legal cards
  const { legal, excluded: illegalExcluded } = filterLegalCards(rawCollection, commander)

  // 2. Fetch EDHREC data for the commander (top cards + themes). Best-effort —
  //    failures degrade the generator to regex-only archetype detection.
  const explanation = []
  let edhrec = { topCards: [], themes: [] }
  try {
    edhrec = await fetchEdhrecCommander(commander)
    if (edhrec.topCards.length > 0) {
      explanation.push(`Loaded ${edhrec.topCards.length} EDHREC top cards for ${commander.name}.`)
    }
  } catch {
    // edhrecApi already logs; just continue without the data
  }

  // 3. Detect commander archetypes — regex-based first, then merge in EDHREC themes.
  const regexArchetypes = detectArchetypes(commander)
  const themeArchetypes = themesToArchetypes(edhrec.themes)
  const archetypes      = mergeArchetypes(regexArchetypes, themeArchetypes)
  const anchorNames     = anchorNamesFor(archetypes)
  const commanderTypes  = extractCreatureSubtypes(commander)

  // 3. Annotate every card with roles/tags, then apply bracket filter
  const annotated = legal.map(card => {
    const { roles, tags } = assignRoles(card, commander, { anchorNames, commanderTypes })
    return { ...card, roles, tags }
  })

  const bracketExcluded = []
  const candidates = annotated.filter(card => {
    if (!isBracketAllowed(card, bracket)) {
      bracketExcluded.push({ ...card, excludeReason: `Excluded for bracket ${bracket} target` })
      return false
    }
    return true
  })

  // 4. Pull additional combos from Commander Spellbook (best-effort, cached)
  try {
    const spellbookCombos = await fetchSpellbookCombos(commander, legal)
    if (spellbookCombos.length > 0) {
      registerCombos(spellbookCombos)
      explanation.push(`Loaded ${spellbookCombos.length} extra combo${spellbookCombos.length !== 1 ? 's' : ''} from Commander Spellbook.`)
    }
  } catch {
    // commanderSpellbook already logs failures; degrade silently
  }

  if (archetypes.length > 0) {
    explanation.push(
      `Commander archetypes detected: ${archetypes.map(a => a.label).join(', ')}.`
    )
    if (primaryArchetypeId) {
      const primary = archetypes.find(a => a.id === primaryArchetypeId)
      if (primary) {
        explanation.push(`Primary strategy: ${primary.label} (others reduced to 40% weight).`)
      }
    }
  }

  // 5. Set up scoring context. pickedNames is mutated as we add cards, so the
  //    scorer sees an ever-growing partner set when we re-score between passes.
  const usedNames = new Set([commander.name.toLowerCase()])
  const allCombos = getAllCombos()
  // Trim combos to ones that could actually involve cards in our candidate pool
  // (or the commander) — keeps the scorer's inner loop tight.
  const candidateNames = new Set(candidates.map(c => c.name.toLowerCase()))
  candidateNames.add(commander.name.toLowerCase())
  const relevantCombos = allCombos.filter(combo =>
    combo.cards.some(name => candidateNames.has(name.toLowerCase()))
  )

  // EDHREC top cards → name → rank Map. Lower rank = more important.
  const edhrecRank = new Map()
  edhrec.topCards.forEach((c, i) => edhrecRank.set(c.name, i + 1))

  // Scoring breakdowns are written into this Map by scoreCard each pass.
  // Last write wins, so the diagnostics reflect the final scoring state.
  const breakdowns = new Map()

  // Commander mechanic tags — boost cards tagged for what the commander
  // cares about (sacrifice → sac_outlet, tokens → token_producer, etc.).
  const commanderMechanicTags = extractCommanderMechanicTags(commander)
  const commanderTagBoosts    = commanderToCardTagBoosts(commanderMechanicTags)

  const scoringContext = {
    archetypes,
    primaryArchetypeId: archetypes.some(a => a.id === primaryArchetypeId) ? primaryArchetypeId : null,
    combos: relevantCombos,
    pickedNames: usedNames,
    edhrecRank,
    edhrecRankTotal: Math.max(edhrec.topCards.length, 1),
    commanderTagBoosts,
    breakdowns,
  }

  // Re-scoring helper — recomputes scores for every candidate against the
  // current scoringContext. Re-called between fill passes so that:
  //   1. Combo-completion bonuses snap on the moment a partner lands in usedNames
  //   2. CMC scoring sees the running deck average and amplifies penalties when
  //      the deck has drifted heavy
  const rescore = (cards) => {
    scoringContext.runningCmcOverTarget = computeRunningCmcOverTarget(deck, bracket)
    return cards.map(card => ({
      ...card,
      score: scoreCard(card, card.roles[0] ?? 'filler', commander, bracket, scoringContext),
    }))
  }

  // 6. Initial scoring + bucket build
  const deck = []
  let scored = rescore(candidates)
  let buckets = buildBuckets(scored)

  // 7. Fill: lands, then utility roles in priority order, then filler.
  //    Re-score before each pass so combo-completion AND running-CMC bonuses
  //    snap to the deck's current state.
  const targetCounts = targetRoleCounts(bracket, commander, archetypes)
  const landTarget = targetLandCount(bracket)

  // Solve the mana base deterministically — same logic the LLM orchestrator
  // uses, so the heuristic and LLM paths produce structurally identical mana
  // bases. Picks fetches/shocks/etc. by tier and skips weak lands at B3+.
  const manaBaseSolution = solveManaBase({
    commander,
    legalLands: candidates.filter(c => isLand(c) && !isBasicLand(c)),
    targetLandCount: landTarget,
    bracket,
  })
  for (const land of manaBaseSolution.lands) {
    deck.push({ ...land, quantity: 1 })
    if (!land.isBasicLand) usedNames.add(land.name.toLowerCase())
  }
  for (const e of manaBaseSolution.explanation) explanation.push(e)

  const roleOrder = ['ramp', 'draw', 'removal', 'wipe', 'protection', 'win_condition', 'tutor', 'synergy']
  for (const role of roleOrder) {
    const target = targetCounts[role] ?? 0
    if (target === 0) continue

    scored = rescore(candidates)
    buckets = buildBuckets(scored)

    const added = fillRole(deck, usedNames, buckets, role, target, explanation, scoringContext)
    if (added < target) {
      explanation.push(`Could only find ${added} ${role} cards in your collection (wanted ${target}).`)
    }
  }

  // Filler last — re-score so leftovers favor archetype + combo fit + curve
  const remaining = 99 - deck.length
  if (remaining > 0) {
    scored = rescore(candidates)
    buckets = buildBuckets(scored)
    const fillerAdded = fillRole(deck, usedNames, buckets, 'filler', remaining, explanation, scoringContext)
    if (fillerAdded < remaining) {
      // Pull from any role bucket as overflow so we still hit 99
      for (const role of roleOrder) {
        if (deck.length >= 99) break
        fillRole(deck, usedNames, buckets, role, 99 - deck.length, explanation, scoringContext)
      }
    }
    if (deck.length < 99) {
      explanation.push(`Collection too small to fill all ${99 - deck.length} remaining slots.`)
    }
  }

  while (deck.length > 99) deck.pop()

  // ── EDHREC replacement pass ──
  // Any EDHREC match in collection that didn't land tries to swap in for the
  // lowest-scored non-EDHREC pick currently in the deck. This rescues mid-tier
  // EDHREC cards (Talismans, Greaves, etc.) that lost saturated role buckets.
  // Iterate until no more improvements possible.
  {
    const isInDeck = (name) => deck.some(c => c.name === name)
    const isEdhrec = (name) => edhrecRank.has(name)
    let pass = 0
    const MAX_PASSES = 50
    while (pass++ < MAX_PASSES) {
      // Highest-priority EDHREC card not yet in deck (lowest rank wins)
      const bestMissByRank = edhrec.topCards.find(c =>
        !isInDeck(c.name) &&
        candidates.some(card => card.name === c.name)
      )
      if (!bestMissByRank) break

      const replacement = candidates.find(card => card.name === bestMissByRank.name)
      if (!replacement) break
      const replacementIsLand = (replacement.roles ?? []).includes('land')
      const replacementScore = scoreCard(
        replacement,
        replacement.roles?.[0] ?? 'filler',
        commander, bracket, scoringContext,
      )

      // Replace the lowest-scored non-EDHREC slot. Lock the swap to category:
      //   - non-land replacement → only kick out a non-land deck card
      //   - land replacement     → only kick out a non-EDHREC, non-basic land
      // This preserves the 37-land count exactly.
      let weakestIdx = -1
      let weakestScore = Infinity
      for (let i = 0; i < deck.length; i++) {
        const c = deck[i]
        if (c.isBasicLand) continue
        if (isEdhrec(c.name)) continue
        const cIsLand = (c.roles ?? []).includes('land') || isLand(c)
        if (replacementIsLand !== cIsLand) continue
        if ((c.score ?? 0) < weakestScore) {
          weakestScore = c.score ?? 0
          weakestIdx = i
        }
      }
      if (weakestIdx === -1) break
      if (replacementScore <= weakestScore) break

      // Commit the swap
      const removed = deck[weakestIdx]
      usedNames.delete(removed.name.toLowerCase())
      deck[weakestIdx] = { ...replacement, score: replacementScore, quantity: 1 }
      usedNames.add(replacement.name.toLowerCase())
    }
    if (pass > 1) explanation.push(`Replacement pass swapped ${pass - 1} card${pass - 1 !== 1 ? 's' : ''} for higher-priority EDHREC picks.`)
  }

  // 8. Post-processing
  const combos = detectCombos(deck.map(c => c.name))
  const { actualBracket, flaggedCards } = computeActualBracket(deck, combos)
  const { errors, warnings: validationWarnings } = validateDeckAtBracket(deck, commander, bracket)

  const bracketWarnings = []
  if (actualBracket > bracket) {
    bracketWarnings.push(
      `Deck is actually bracket ${actualBracket} (${BRACKET_LABELS[actualBracket]}), ` +
      `but you targeted bracket ${bracket} (${BRACKET_LABELS[bracket]}). ` +
      `Flagged cards: ${flaggedCards.join(', ') || 'none'}.`
    )
  }

  const comboWarnings = combos.map(
    c => `Combo detected: ${c.cards.join(' + ')} — ${c.description}`
  )

  const allWarnings = [
    ...errors.map(e => ({ severity: 'error', message: e })),
    ...validationWarnings.map(w => ({ severity: 'warning', message: w })),
    ...bracketWarnings.map(w => ({ severity: 'warning', message: w })),
    ...comboWarnings.map(w => ({ severity: 'info', message: w })),
  ]

  const allExcluded = [
    ...illegalExcluded,
    ...bracketExcluded,
    ...getUnused(scored, usedNames),
  ]

  const roleCounts = countRoles(deck)
  const stats = {
    totalCards: deck.length + 1,
    landCount: roleCounts.land,
    roleCounts,
    avgCmc: avgCmc(deck),
    colorBreakdown: colorBreakdown(deck),
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────
  // Every legal candidate gets a record: final score, the role we evaluated for,
  // its breakdown, and (if not picked) which cards beat it for that role bucket.
  const pickedDeckNames = new Set(deck.map(c => c.name.toLowerCase()))
  const finalScored = rescore(candidates)  // one more pass with full picked-set state
  const finalBuckets = buildBuckets(finalScored)
  const cardDiagnostics = finalScored.map(card => {
    const role = card.roles?.[0] ?? 'filler'
    const breakdown = breakdowns.get(`${card.name}:${role}`) ?? []
    const picked = pickedDeckNames.has(card.name.toLowerCase())
    let beatBy = []
    if (!picked) {
      const bucket = finalBuckets[role] ?? []
      const myIdx = bucket.findIndex(c => c.name === card.name)
      const target = (role === 'land') ? landTarget : (targetCounts[role] ?? 0)
      // Cards above me in the sorted bucket that DID get picked (within target slots)
      beatBy = bucket
        .slice(0, Math.max(myIdx, target))
        .filter(c => pickedDeckNames.has(c.name.toLowerCase()) && c.name !== card.name)
        .slice(0, 5)
        .map(c => ({ name: c.name, score: c.score }))
    }
    return {
      name: card.name,
      role,
      score: card.score,
      breakdown,
      picked,
      edhrecRank: edhrecRank.get(card.name) ?? null,
      beatBy,
    }
  })

  // EDHREC coverage: how many of EDHREC's top cards do we actually have in the
  // legal candidate pool? Low coverage with high topCardCount means name-matching
  // is broken (DFC formatting, accents, etc.) — surface it so we can fix it.
  const candidateNameSet = new Set(candidates.map(c => c.name))
  const collectionNameSet = new Set(legal.map(c => c.name))
  const deckNameSet = new Set(deck.map(c => c.name))
  const bracketExcludedNameSet = new Set(bracketExcluded.map(c => c.name))

  const edhrecMatchedInCollection = edhrec.topCards.filter(c => collectionNameSet.has(c.name)).length
  const edhrecCollectionMatches = edhrec.topCards.filter(c => collectionNameSet.has(c.name)).map(c => c.name)
  const edhrecPickedFromTop = deck.filter(c => edhrec.topCards.some(t => t.name === c.name)).length

  // EDHREC matches that did NOT land in the deck — with the most likely reason.
  // This is the "why is Thassa's Oracle missing?" question, fully answered.
  const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'])
  const edhrecMisses = edhrec.topCards
    .filter(c => collectionNameSet.has(c.name) && !deckNameSet.has(c.name))
    .filter(c => !BASIC_LAND_NAMES.has(c.name))   // synthesized basics are in deck under fresh IDs
    .map(c => {
      let reason = 'Lost to higher-scored picks in its role bucket'
      if (bracketExcludedNameSet.has(c.name)) reason = `Excluded by bracket ${bracket} filter`
      else if (!candidateNameSet.has(c.name))  reason = 'Not in candidate pool (legality / data issue)'
      const candidate = candidates.find(card => card.name === c.name)
      const role = candidate?.roles?.[0] ?? 'unknown'
      return { name: c.name, rank: edhrec.topCards.findIndex(t => t.name === c.name) + 1, role, reason }
    })
    .slice(0, 30)

  const dataSources = {
    edhrec: {
      loaded: edhrec.topCards.length > 0,
      topCardCount: edhrec.topCards.length,
      themeCount: edhrec.themes.length,
      matchedInCollection: edhrecMatchedInCollection,
      pickedFromTop: edhrecPickedFromTop,
      sampleMatches: edhrecCollectionMatches.slice(0, 8),
      misses: edhrecMisses,
    },
    spellbook: { combosRegistered: relevantCombos.length },
  }

  const diagnostics = {
    dataSources,
    archetypes,
    primaryArchetypeId: scoringContext.primaryArchetypeId,
    bracketTargets: { lands: landTarget, ...targetCounts },
    cardDiagnostics,
    deckSize: deck.length + 1,
  }

  return {
    commander,
    mainDeck: deck,
    diagnostics,
    excludedCards: allExcluded,
    warnings: allWarnings,
    stats,
    bracketAnalysis: { targetBracket: bracket, actualBracket, flaggedCards },
    combos,
    archetypes,
    explanation,
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

// How far over the bracket's target avg CMC the deck currently sits, looking
// only at non-land cards. Returns 0 if the deck is at or below target. The
// scorer reads this and amplifies CMC penalties when the deck has drifted
// heavy, so later picks lean cheaper to drag the curve back to target.
function computeRunningCmcOverTarget(deck, bracket) {
  const nonLands = deck.filter(c => !(c.roles ?? []).includes('land'))
  if (nonLands.length === 0) return 0
  const totalCmc = nonLands.reduce((s, c) => s + (c.cmc ?? 0), 0)
  const avg = totalCmc / nonLands.length
  const target = targetAvgCmc(bracket)
  return Math.max(0, avg - target)
}

// "Legendary Creature — Serpent God" → ['serpent', 'god']
// Used so commander creature subtypes count as synergy keywords (Koma's Serpent
// theme catches generic serpent payoffs even when oracle text overlap is thin).
function extractCreatureSubtypes(commander) {
  const tl = commander?.type_line ?? ''
  const dashIdx = tl.indexOf('—')
  if (dashIdx === -1) return []
  return tl.slice(dashIdx + 1).trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function buildBuckets(cards) {
  const buckets = {}
  for (const card of cards) {
    for (const role of (card.roles ?? ['filler'])) {
      if (!buckets[role]) buckets[role] = []
      buckets[role].push(card)
    }
  }
  for (const role of Object.keys(buckets)) {
    buckets[role].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }
  return buckets
}

// scoringContext (optional) carries archetypes + primaryArchetypeId. When
// the user has locked a primary archetype AND we're filling a synergy/filler
// slot, we run a two-pass fill: first 70% of slots are reserved for cards
// that match the primary archetype, then the remaining 30% (or any unfilled
// portion of the reservation) draws from the full pool. Without this, the
// scoring penalty alone isn't always enough to keep "premium off-archetype
// staples" out of synergy slots.
function fillRole(deck, usedNames, buckets, role, target, explanation, scoringContext = null) {
  const pool = buckets[role] ?? []
  if (pool.length === 0 || target === 0) return 0

  const locked      = !!scoringContext?.primaryArchetypeId
  const isSoftRole  = role === 'synergy' || role === 'filler'
  const useTwoPass  = locked && isSoftRole

  let added = 0
  const tryPick = (card) => {
    if (deck.length >= 99) return false
    if (added >= target) return false
    if (usedNames.has(card.name.toLowerCase())) return false
    deck.push({ ...card, quantity: 1 })
    usedNames.add(card.name.toLowerCase())
    added++
    return true
  }

  if (useTwoPass) {
    const primary = scoringContext.archetypes?.find(a => a.id === scoringContext.primaryArchetypeId)
    const onArchetype = pool.filter(c => cardMatchesArchetype(c, primary))
    // Reserve 70% — but not more than we can actually fill from on-archetype cards.
    const reservation = Math.min(Math.ceil(target * 0.7), onArchetype.length)

    // Pass 1: fill up to the reservation with on-archetype picks.
    for (const card of onArchetype) {
      if (added >= reservation) break
      tryPick(card)
    }

    // Pass 2: fill the rest from the full pool (highest-scored first, on-archetype
    // cards already considered will be skipped by the usedNames check).
    for (const card of pool) {
      if (added >= target) break
      tryPick(card)
    }

    if (added > 0) {
      const onCount = added - Math.max(0, added - reservation)
      explanation.push(
        `Added ${added} ${role} card${added !== 1 ? 's' : ''} ` +
        `(${onCount} on-archetype, ${added - onCount} other).`
      )
    }
    return added
  }

  // Standard single-pass fill — original behavior preserved for everything
  // except synergy/filler under a locked archetype.
  for (const card of pool) {
    if (!tryPick(card)) {
      if (deck.length >= 99 || added >= target) break
    }
  }
  if (added > 0) explanation.push(`Added ${added} ${role} card${added !== 1 ? 's' : ''}.`)
  return added
}

function getUnused(allCards, usedNames) {
  return allCards
    .filter(c => !usedNames.has(c.name.toLowerCase()) && !isBasicLand(c))
    .map(c => ({ ...c, excludeReason: 'Not selected — slot targets already met' }))
}

function colorBreakdown(deck) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  for (const card of deck) {
    const colors = card.colors ?? []
    if (colors.length === 0 && !isLand(card)) counts.C++
    for (const c of colors) { if (c in counts) counts[c]++ }
  }
  return counts
}
