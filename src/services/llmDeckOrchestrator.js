// Hybrid LLM-assisted deck generator.
//
// Flow:
//   1. Load commander + collection.
//   2. Pre-filter the collection into a legal card pool (legality + color identity + banned).
//   3. Annotate roles/tags.
//   4. Apply bracket filter so the LLM cannot suggest cards that violate the bracket.
//   5. Build the prompt and call the LLM service.
//   6. Validate the LLM's response — every card must exist in the pool/collection
//      and pass color identity, banned, and singleton checks.
//   7. If the LLM response is short or has rejections, fall back to the heuristic
//      generator to fill the missing slots.
//   8. If the LLM is unavailable entirely, fall back to the heuristic generator.
//   9. Run the final deck through the same post-processing the heuristic generator does:
//      combo detection, actual-bracket calculation, and validateDeck().
//
// The LOCAL rules engine is the final authority. The LLM only ever suggests.

import { getSelectedCommander, getCollection } from '../utils/localStorage'
import { filterLegalCards } from '../rules/commanderRules'
import { assignRoles } from '../rules/cardRoles'
import { isBracketAllowed, targetLandCount, targetRoleCounts, computeActualBracket, BRACKET_LABELS, isSafeRock, isSoftTutor } from '../rules/bracketRules'
import { validateDeck, countRoles } from '../rules/deckValidator'
import { detectCombos, getAllCombos } from '../rules/comboRules'
import { detectArchetypes } from '../rules/archetypeRules'
import { extractCommanderMechanicTags, commanderToCardTagBoosts } from '../rules/commanderMechanics'
import { isLand, isBasicLand, getBasicLandsForCommander, avgCmc } from '../utils/cardHelpers'
import { generateDeck } from '../rules/deckGenerator'
import { scoreCard } from '../rules/deckScorer'
import { cardMatchesArchetype } from '../rules/archetypeRules'
import { generateDeckWithLLM, critiqueDeck } from './llmDeckService'
import { validateLLMDeckResponse } from '../rules/llmDeckValidator'
import { solveManaBase } from '../rules/manaBaseSolver'
import { buildSkeleton, buildSkeletonFromMoxfield, mergeSkeletons, skeletonRoleCounts } from '../rules/deckSkeleton'
import { buildBracketStaples, getStapleCoverage } from '../rules/bracketStaples'
import { fetchEdhrecCommander } from '../utils/edhrecApi'
import { fetchMoxfieldConsensus } from '../utils/moxfieldApi'

// Adaptive cap on the pool sent to the LLM. Two layers:
//   1. Below the threshold (≤ 500 cards): send EVERYTHING — small collections
//      shouldn't lose any candidates.
//   2. Above the threshold: cap PER ROLE, not globally. The old single-bucket
//      cap of 250 let universal-role cards (ramp/removal/draw/etc.) eat the
//      whole budget when the collection was heavy in any one role, leaving
//      the synergy bucket to fight for a tiny remainder. That's how high-
//      impact creatures (Klauth, Terror of the Peaks, etc.) ended up trimmed
//      before the LLM ever saw them.
// Per-role caps comfortably exceed the deck's actual need for that role
// (e.g. cap ramp at 30 when the deck only takes ~10) so the LLM has 3× headroom
// per slot. Heuristic fallback still receives the full uncapped pool.
const LLM_POOL_CAP_THRESHOLD = 500
const ROLE_CAPS = {
  land:           50,
  ramp:           30,
  draw:           25,
  removal:        30,
  wipe:           12,
  protection:     15,
  tutor:          10,
  win_condition:  15,
  synergy:        70,
  filler:         25,
}
const DEFAULT_ROLE_CAP = 15

export async function generateDeckWithLLMAssist(bracket = 3, primaryArchetypeId = null, options = {}) {
  const { twoPass = false, onProgress = null } = options
  const commander = getSelectedCommander()
  if (!commander) return { error: 'No commander selected.' }

  const rawCollection = getCollection()
  if (rawCollection.length === 0) return { error: 'Your collection is empty.' }

  const explanation = []
  const warnings = []

  // 1. Pre-filter for legality + color identity + banned + commander itself.
  const { legal, excluded: illegalExcluded } = filterLegalCards(rawCollection, commander)
  explanation.push(`Pre-filtered collection: ${legal.length} legal cards (excluded ${illegalExcluded.length}).`)

  // 2. Detect archetypes (broad strategic shape) AND commander mechanic tags
  // (granular ability synergies). Both signals stack in scoring — archetypes
  // capture "this is a tribal/aristocrats/spellslinger deck"; mechanic tags
  // capture "this commander cares about sacrifice/tokens/etc." which boosts
  // cards tagged with the corresponding card-level mechanics.
  const archetypes = detectArchetypes(commander)
  const commanderMechanicTags = extractCommanderMechanicTags(commander)
  const commanderTagBoosts = commanderToCardTagBoosts(commanderMechanicTags)
  if (commanderMechanicTags.length > 0) {
    explanation.push(`Commander mechanics: ${commanderMechanicTags.map(t => t.replace('cares_about_', '')).join(', ')}.`)
  }

  // 3. Annotate roles/tags.
  const annotated = legal.map(card => {
    const { roles, tags } = assignRoles(card, commander, {
      anchorNames: new Set(),
      commanderTypes: extractCreatureSubtypes(commander),
    })
    return { ...card, roles, tags }
  })

  // 4. Bracket filter — prevents the LLM from even seeing cards that violate
  // the target bracket (e.g. game-changers at bracket 1).
  const bracketExcluded = []
  const legalCardPool = annotated.filter(card => {
    if (!isBracketAllowed(card, bracket)) {
      bracketExcluded.push({ ...card, excludeReason: `Excluded for bracket ${bracket} target` })
      return false
    }
    return true
  })
  explanation.push(`Bracket ${bracket} filter: ${legalCardPool.length} candidates remain.`)

  // 4b. Solve the mana base BEFORE the LLM call. The LLM is bad at land
  // selection — it picks gates over shocks and weights tapped lands too
  // generously. The deterministic solver picks the strongest 37-ish lands
  // available and we hand the LLM a non-land pool so it focuses on the 62
  // spells where its judgment matters.
  const legalLands    = legalCardPool.filter(c => isLand(c))
  const legalNonLands = legalCardPool.filter(c => !isLand(c))
  const manaBaseSolution = solveManaBase({
    commander,
    legalLands,
    targetLandCount: targetLandCount(bracket),
    bracket,
  })
  for (const e of manaBaseSolution.explanation) explanation.push(e)
  const lockedLands = manaBaseSolution.lands       // 37-ish Card objects (basics + non-basics)

  // 4c. Build the skeleton. Two data sources:
  //   - EDHREC inclusion: cards in ≥40% of all decks for this commander.
  //     Bracket-agnostic but high signal for "real meta picks."
  //   - Moxfield consensus: cards appearing in ≥4 of the top 10 most-viewed
  //     decks. Bracket-relevant — top-viewed decks tend to cluster in the
  //     upper-middle range.
  // Both fetched in parallel (best-effort). Merged: cards in BOTH sources get
  // priority and a confidence boost. If both unreachable, skeleton is empty
  // and LLM picks normally.
  const [edhrecData, moxfieldData] = await Promise.all([
    fetchEdhrecCommander(commander).catch(() => ({ topCards: [], themes: [] })),
    fetchMoxfieldConsensus(commander).catch(() => ({ decksAnalyzed: 0, totalDecksFound: 0, cards: [] })),
  ])
  if (edhrecData.topCards.length > 0) {
    explanation.push(`Loaded ${edhrecData.topCards.length} EDHREC top cards for ${commander.name}.`)
  }
  if (moxfieldData.decksAnalyzed > 0) {
    explanation.push(`Analyzed ${moxfieldData.decksAnalyzed} top Moxfield decks for ${commander.name}.`)
  }
  const edhrecSkeleton = buildSkeleton({
    edhrecTopCards: edhrecData.topCards,
    legalCardPool: legalNonLands,
  })
  const moxfieldSkeleton = buildSkeletonFromMoxfield({
    moxfieldCards: moxfieldData.cards,
    legalCardPool: legalNonLands,
  })
  const skeleton = mergeSkeletons(edhrecSkeleton, moxfieldSkeleton)
  for (const e of skeleton.explanation) explanation.push(e)

  // 4d. Bracket staples — for B4/B5, force-include curated cEDH-tier picks
  // (Mana Crypt, Force of Will, Demonic Tutor, etc.) the user owns. EDHREC's
  // top-cards data is bracket-agnostic, so for casual commanders played at
  // high brackets the skeleton skews casual. Bracket staples enforce
  // bracket-fit regardless of commander. Dedup against skeleton so a card
  // present in both isn't double-locked.
  const skeletonNames = new Set(skeleton.staples.map(c => c.name.toLowerCase()))
  const bracketStaples = buildBracketStaples({
    bracket,
    legalNonLands,
    alreadyLockedNames: skeletonNames,
  })
  if (bracketStaples.length > 0) {
    explanation.push(`Bracket-${bracket} staples force-locked: ${bracketStaples.length} additional cards (${bracketStaples.slice(0, 5).map(c => c.name).join(', ')}${bracketStaples.length > 5 ? `, +${bracketStaples.length - 5} more` : ''}).`)
  }

  // Surface bracket-staple coverage so the user knows when their collection
  // is the bottleneck. A B5 deck can only feel like B5 if the user owns
  // enough cEDH staples; if not, no algorithm change can fix it.
  const stapleCoverage = getStapleCoverage({
    bracket,
    collectionNames: rawCollection.map(c => c.name),
  })
  if (stapleCoverage.total > 0) {
    const pct = Math.round((stapleCoverage.owned / stapleCoverage.total) * 100)
    explanation.push(`Bracket-${bracket} staple coverage: you own ${stapleCoverage.owned}/${stapleCoverage.total} curated staples for this bracket (${pct}%).`)
    if (bracket >= 4 && stapleCoverage.missing.length > 0) {
      const topMissing = stapleCoverage.missing.slice(0, 12).join(', ')
      explanation.push(`  Missing high-value B${bracket}+ cards: ${topMissing}${stapleCoverage.missing.length > 12 ? `, +${stapleCoverage.missing.length - 12} more` : ''}.`)
      // Only warn when the gap is big enough to genuinely affect bracket fit.
      if (pct < 50) {
        warnings.push({
          severity: 'warning',
          message: `Your collection has only ${stapleCoverage.owned}/${stapleCoverage.total} bracket-${bracket} staples (${pct}%). The deck will lean closer to bracket ${Math.max(1, bracket - 1)} in practice. Acquiring cards like ${stapleCoverage.missing.slice(0, 5).join(', ')} would meaningfully strengthen it.`,
        })
      }
    }
  }
  const allLockedNames = new Set([
    ...skeletonNames,
    ...bracketStaples.map(c => c.name.toLowerCase()),
  ])

  // Strip locked names from the LLM pool so the LLM doesn't waste prompt
  // budget on cards it isn't allowed to pick.
  const llmCandidatePool = legalNonLands.filter(c => !allLockedNames.has(c.name.toLowerCase()))

  const totalLockedNonLands = skeleton.staples.length + bracketStaples.length
  const nonLandSlots = 99 - lockedLands.length
  const llmSlots = nonLandSlots - totalLockedNonLands    // what the LLM still needs to pick

  // 5. Build deck-rule context for the prompt.
  const deckRules = {
    landTarget: lockedLands.length,
    nonLandSlots,
    llmSlots,                                               // how many cards the LLM still picks
    targetCounts: targetRoleCounts(bracket, commander, archetypes),
    manaBaseStats: manaBaseSolution.stats,
    skeletonStats: {
      size: skeleton.staples.length,
      roleCounts: skeletonRoleCounts(skeleton.staples),
    },
  }
  const strategyContext = {
    archetypes,
    primaryArchetypeId: archetypes.some(a => a.id === primaryArchetypeId) ? primaryArchetypeId : null,
    skeleton: skeleton.staples,
    skeletonStrong: skeleton.strong,
    commanderMechanicTags,
    commanderTagBoosts,
  }

  // 5b. Cap the LLM-candidate pool (non-lands MINUS skeleton). Heuristic
  // fallback receives the full pool. Lands and skeleton picks are excluded —
  // both are already locked.
  const llmPool = capPoolForLLM(llmCandidatePool, commander, bracket, strategyContext)
  if (llmPool.length < llmCandidatePool.length) {
    explanation.push(
      `Capped LLM pool to top ${llmPool.length} of ${llmCandidatePool.length} non-land/non-skeleton candidates ` +
      `(prevents prompt timeout / context-limit failures).`
    )
  }

  // 6. Call the LLM (mocked for now). If it throws, drop straight to heuristic fallback.
  let llmResponse = null
  let llmFailed = false
  try {
    llmResponse = await generateDeckWithLLM({
      commander,
      legalCardPool: llmPool,
      bracket,
      deckRules,
      strategyContext,
      twoPass,
      onProgress,
    })
    const passLabel = llmResponse._meta?.twoPass ? ' (two-pass)' : ''
    explanation.push(`LLM responded with ${llmResponse.deck?.length ?? 0} card suggestions${passLabel} (mode: ${llmResponse._meta?.mode}).`)
  } catch (err) {
    llmFailed = true
    warnings.push({
      severity: 'warning',
      message: `LLM unavailable (${err.message}). Falling back to standard heuristic generator.`,
    })
    explanation.push(`LLM call failed: ${err.message}. Using heuristic fallback.`)
  }

  // 7. If the LLM is unavailable entirely, return the heuristic generator's
  // output — but FIRST run the bracket-downgrade backstop on it. Otherwise
  // an LLM 504 means the user gets a deck that bypasses every safety check
  // and frequently overshoots the target bracket (B3 → actual B5, etc.).
  if (llmFailed || !llmResponse) {
    const heuristic = await generateDeck(bracket, primaryArchetypeId)
    if (heuristic.error) return heuristic

    // Apply bracket downgrade to the heuristic deck. Same logic as the
    // post-critique step in the main path — combo pieces, excess tutors,
    // excess fast mana get swapped out. Runs at B1-B4 because at B4 the
    // 2+ combos bump pushes actual to B5 (over target).
    let fallbackDowngradeSwaps = []
    if (bracket <= 4) {
      const heuristicUsedNames = new Set([commander.name.toLowerCase()])
      for (const card of heuristic.mainDeck) {
        if (!card.isBasicLand) heuristicUsedNames.add(card.name.toLowerCase())
      }
      fallbackDowngradeSwaps = downgradeBracketIfOverShot({
        deck: heuristic.mainDeck,
        targetBracket: bracket,
        legalNonLands,
        usedNames: heuristicUsedNames,
      })
    }

    // Re-compute bracket analysis after the downgrade since the heuristic
    // generator's bracketAnalysis is now stale.
    const updatedCombos = detectCombos(heuristic.mainDeck.map(c => c.name))
    const { actualBracket: updatedActual, flaggedCards: updatedFlagged } =
      computeActualBracket(heuristic.mainDeck, updatedCombos)

    if (fallbackDowngradeSwaps.length > 0) {
      explanation.push(
        `Heuristic-fallback bracket-fit: applied ${fallbackDowngradeSwaps.length} swap${fallbackDowngradeSwaps.length === 1 ? '' : 's'} to bring actual bracket back to target B${bracket}.`
      )
      for (const s of fallbackDowngradeSwaps) {
        explanation.push(`  Downgrade: -${s.out} → +${s.in} (${s.reason})`)
      }
    }

    // Filter stale "Deck is actually bracket X" warnings from the heuristic
    // generator — they reflect pre-downgrade state. Keep only if our
    // downgrade actually failed to bring the bracket back to target.
    const filteredHeuristicWarnings = (heuristic.warnings ?? []).filter(w => {
      const msg = typeof w === 'object' ? w.message : w
      if (typeof msg === 'string' && /Deck is actually bracket/.test(msg)) {
        return updatedActual > bracket
      }
      return true
    })

    return {
      ...heuristic,
      mainDeck: heuristic.mainDeck,   // mutated in place by downgrade
      bracketAnalysis: { targetBracket: bracket, actualBracket: updatedActual, flaggedCards: updatedFlagged },
      combos: updatedCombos,
      generationMode: 'heuristic-fallback',
      explanation: [...explanation, ...(heuristic.explanation ?? [])],
      warnings: [...warnings, ...filteredHeuristicWarnings],
      llmStrategy: null,
    }
  }

  // 8. Validate the LLM response against the authoritative rules. Pass the
  // full pool (including lands) so the validator can correctly classify any
  // land the LLM tried to pick (even though we asked it not to).
  const validation = validateLLMDeckResponse({
    llmDeck: llmResponse,
    commander,
    legalCardPool,
    collection: rawCollection,
    bracket,
    expectedDeckSize: llmSlots,   // we only asked for the slots not covered by skeleton
  })

  for (const w of validation.warnings) {
    warnings.push({ severity: 'warning', message: `LLM validation: ${w}` })
  }
  for (const c of validation.invalidCards) {
    explanation.push(`Rejected "${c.name}" — ${c.rejectionReason}`)
  }

  // 9. Build the deck:
  //   - Mana base (locked by solver)
  //   - Skeleton (locked by EDHREC inclusion %)
  //   - LLM picks (non-land, non-skeleton)
  // If the LLM tried to pick a land or a skeleton card despite being told not
  // to, skip it — those slots are already filled.
  const deck = lockedLands.map(l => ({ ...l, quantity: 1, fromManaSolver: true }))
  const usedNames = new Set([commander.name.toLowerCase()])
  for (const card of deck) {
    if (!card.isBasicLand) usedNames.add(card.name.toLowerCase())
  }
  for (const card of skeleton.staples) {
    if (deck.length >= 99) break
    deck.push({ ...card, quantity: 1, fromSkeleton: true })
    usedNames.add(card.name.toLowerCase())
  }
  for (const card of bracketStaples) {
    if (deck.length >= 99) break
    if (usedNames.has(card.name.toLowerCase())) continue   // belt + suspenders against skeleton overlap
    deck.push({ ...card, quantity: 1, fromBracketStaples: true })
    usedNames.add(card.name.toLowerCase())
  }
  for (const v of validation.validCards) {
    if (deck.length >= 99) break
    if (isLand(v.card)) continue                                   // solver owns lands
    if (usedNames.has(v.card.name.toLowerCase())) continue          // already in skeleton
    deck.push({ ...v.card, quantity: 1, llmReason: v.reason, llmRole: v.role })
    usedNames.add(v.card.name.toLowerCase())
  }

  // 10. Fill missing NON-LAND slots from the heuristic generator. We run the
  // heuristic separately and pull cards that the LLM didn't already pick.
  //
  // CRITICAL: skip every land in the heuristic's output. The mana base is
  // owned by the solver in step 4b — exactly 37 lands, period. The heuristic
  // generator produces its OWN 99-card deck (including its own 37-land mana
  // base), so without this filter we'd add solver lands + heuristic lands and
  // ship 43+ land decks. Lands belong to the solver; non-lands are what we
  // need from this fallback.
  //
  // Two-pass fill: first round prefers on-theme cards (matching detected
  // archetypes) and universal-role staples (ramp/draw/removal/etc.). Second
  // round picks off-theme cards only if the deck is still under 99. This
  // prevents the heuristic from defaulting to random artifacts (Liar's
  // Pendulum, Idol of False Gods, etc.) when better on-theme alternatives
  // exist in the user's collection.
  if (deck.length < 99) {
    const heuristicSource = await generateDeck(bracket, primaryArchetypeId)
    if (!heuristicSource.error) {
      const beforeFill = deck.length
      const UNIVERSAL_FILL_ROLES = new Set(['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition'])
      const detectedArchs = strategyContext.archetypes ?? []
      const isOnThemeOrUniversal = (card) => {
        const isUniversal = (card.roles ?? []).some(r => UNIVERSAL_FILL_ROLES.has(r))
        if (isUniversal) return true
        if (detectedArchs.length === 0) return true   // no archetypes → don't filter
        return detectedArchs.some(a => cardMatchesArchetype(card, a))
      }
      // Pass 1: on-theme + universal only.
      for (const card of heuristicSource.mainDeck) {
        if (deck.length >= 99) break
        if (isLand(card)) continue
        if (!isOnThemeOrUniversal(card)) continue
        const key = card.name.toLowerCase()
        if (usedNames.has(key)) continue
        deck.push({ ...card, quantity: 1, fromFallback: true })
        usedNames.add(key)
      }
      // Pass 2: off-theme cards as last resort if we still need bodies.
      if (deck.length < 99) {
        for (const card of heuristicSource.mainDeck) {
          if (deck.length >= 99) break
          if (isLand(card)) continue
          const key = card.name.toLowerCase()
          if (usedNames.has(key)) continue
          deck.push({ ...card, quantity: 1, fromFallback: true })
          usedNames.add(key)
        }
      }
      const filled = deck.length - beforeFill
      if (filled > 0) {
        explanation.push(`Filled ${filled} remaining slot${filled === 1 ? '' : 's'} from the heuristic generator (on-theme + universal preferred).`)
        warnings.push({
          severity: 'info',
          message: 'AI suggestion was adjusted to follow Commander rules and meet deck-structure targets.',
        })
      }
    }
  }

  // 10b. Wincon backstop — every deck needs at least 2 win conditions. If
  // skeleton + LLM picks + heuristic fill all under-delivered, force-add the
  // best available wincons from the legal pool, kicking out the lowest-priority
  // non-skeleton/non-mana-base picks to make room.
  const MIN_WINCONS = 2
  const isWincon = (c) => (c.roles ?? []).includes('win_condition') ||
                          (c.tags ?? []).includes('explosive_finisher')
  const winconCount = deck.filter(isWincon).length
  if (winconCount < MIN_WINCONS) {
    const winconCandidates = legalNonLands
      .filter(c => isWincon(c) && !usedNames.has(c.name.toLowerCase()))
      // Prefer cards in the strong-recommendations list, then by EDHREC rank
      .sort((a, b) => {
        const aStrong = skeleton.strong.some(s => s.name === a.name) ? 1 : 0
        const bStrong = skeleton.strong.some(s => s.name === b.name) ? 1 : 0
        if (aStrong !== bStrong) return bStrong - aStrong
        return (a.edhrecRank ?? 9999) - (b.edhrecRank ?? 9999)
      })

    let addedWincons = 0
    for (const wc of winconCandidates) {
      if (winconCount + addedWincons >= MIN_WINCONS) break
      // Find a swappable slot: not skeleton, not mana base, and not already a wincon.
      // Pick from the END of the deck (lowest-priority heuristic fill first).
      let swapIdx = -1
      for (let i = deck.length - 1; i >= 0; i--) {
        const c = deck[i]
        if (c.fromManaSolver) continue
        if (c.fromSkeleton) continue
        if (c.fromBracketStaples) continue   // bracket staples are locked; never swap them
        if (c.fromTribalFloor) continue      // tribal-floor adds are also locked
        if (isWincon(c)) continue
        swapIdx = i
        break
      }
      if (swapIdx === -1) {
        // No room to swap — append if we're under 99. Shouldn't happen often.
        if (deck.length < 99) {
          deck.push({ ...wc, quantity: 1, fromWinconBackstop: true })
          usedNames.add(wc.name.toLowerCase())
          addedWincons++
        }
        continue
      }
      const removed = deck[swapIdx]
      usedNames.delete(removed.name.toLowerCase())
      deck[swapIdx] = { ...wc, quantity: 1, fromWinconBackstop: true }
      usedNames.add(wc.name.toLowerCase())
      addedWincons++
    }
    if (addedWincons > 0) {
      explanation.push(`Wincon backstop: forced ${addedWincons} win condition${addedWincons === 1 ? '' : 's'} into the deck (had only ${winconCount} after LLM/heuristic).`)
      warnings.push({
        severity: 'info',
        message: `Added ${addedWincons} win condition${addedWincons === 1 ? '' : 's'} so the deck has a clear way to close games.`,
      })
    } else if (winconCandidates.length === 0) {
      warnings.push({
        severity: 'warning',
        message: `Your collection has no clear win conditions for this commander — deck may struggle to close games. Consider adding a Craterhoof Behemoth, Triumph of the Hordes, or similar finisher.`,
      })
    }
  }

  // 10c. Tribal density floor — for tribal commanders, ensure the deck has
  // a meaningful count of on-tribe creatures. Without this, the heuristic
  // critique can correctly optimize for cEDH staples (Vampiric Tutor scores
  // higher than a vanilla dragon) and leave a "tribal" deck with only 2-3
  // tribe members. Force-swap low-priority picks for owned tribal creatures
  // until we hit the floor or exhaust the user's pool.
  const tribalArchetype = strategyContext.archetypes?.find(a => a.tribe)
  if (tribalArchetype) {
    const TRIBAL_FLOOR = 18
    const tribe = tribalArchetype.tribe
    const isOnTribe = (c) => (c.type_line ?? '').toLowerCase().includes(tribe)
    const inDeckTribal = deck.filter(isOnTribe).length

    if (inDeckTribal < TRIBAL_FLOOR) {
      const needed = TRIBAL_FLOOR - inDeckTribal
      const inDeckNames = new Set(deck.map(c => c.name.toLowerCase()))
      // On-tribe candidates from the legal pool not yet in deck.
      const tribalCandidates = legalNonLands.filter(c =>
        isOnTribe(c) && !inDeckNames.has(c.name.toLowerCase())
      )

      let added = 0
      for (const tribal of tribalCandidates) {
        if (added >= needed) break
        // Find a swappable slot: not locked, not on-tribe (don't swap
        // tribal-for-tribal), starting from end of deck (lowest-priority).
        let swapIdx = -1
        for (let i = deck.length - 1; i >= 0; i--) {
          const c = deck[i]
          if (c.fromManaSolver || c.fromSkeleton || c.fromBracketStaples) continue
          if (isOnTribe(c)) continue
          swapIdx = i
          break
        }
        if (swapIdx === -1) break    // no more swappable slots — stop

        const removed = deck[swapIdx]
        usedNames.delete(removed.name.toLowerCase())
        deck[swapIdx] = { ...tribal, quantity: 1, fromTribalFloor: true }
        usedNames.add(tribal.name.toLowerCase())
        added++
      }

      if (added > 0) {
        explanation.push(`Tribal density floor: forced ${added} ${tribe} creature${added === 1 ? '' : 's'} into the deck (was ${inDeckTribal}/${TRIBAL_FLOOR}, now ${inDeckTribal + added}).`)
        warnings.push({
          severity: 'info',
          message: `Added ${added} on-tribe ${tribe} creature${added === 1 ? '' : 's'} so the deck reflects its tribal commander.`,
        })
      } else if (tribalCandidates.length === 0 && inDeckTribal < TRIBAL_FLOOR) {
        warnings.push({
          severity: 'warning',
          message: `Only ${inDeckTribal} ${tribe} creatures in deck (target ${TRIBAL_FLOOR}+). Your collection lacks more ${tribe}s — consider acquiring some for a stronger tribal feel.`,
        })
      }
    }
  }

  // The bracket-downgrade step (formerly 10d) was moved to AFTER the
  // critique passes — see step 11c below. Critique passes can re-introduce
  // combo pieces (the heuristic critique optimizes for score, the LLM
  // critique optimizes for the model's judgment, neither cares about
  // bracket fit). Running downgrade after them ensures nothing else can
  // re-bump the bracket before the final return.

  // 11. Hard backstop — if we still don't have 99, pad with basics so the
  // deck is at least well-formed for the validator. This shouldn't trigger
  // in practice unless the collection is tiny.
  if (deck.length < 99) {
    const basicNames = getBasicLandsForCommander(commander)
    let i = 0
    while (deck.length < 99 && basicNames.length > 0) {
      const name = basicNames[i % basicNames.length]
      deck.push(syntheticBasic(name, deck.length))
      i++
    }
    if (deck.length < 99) {
      warnings.push({ severity: 'error', message: `Could only assemble ${deck.length} cards — collection too small.` })
    }
  }

  while (deck.length > 99) deck.pop()

  // 11a. Heuristic critique — deterministic score-based swaps. Walks every
  // unlocked deck card and the available pool, scores both with the same
  // scoreCard the heuristic generator uses, and swaps deck cards for pool
  // cards that score significantly higher (≥12 points). No LLM judgment
  // involved — pure "stronger card replaces weaker card" within the user's
  // own collection. Catches the weak-removal/filler problem that the LLM
  // critique can't fix because it tries to suggest cards (Damnation, Swords,
  // etc.) the user doesn't own.
  {
    const heuristicSwaps = runHeuristicCritique({
      deck,
      legalNonLands,
      commander,
      bracket,
      strategyContext,
      edhrecData,
    })
    if (heuristicSwaps.length > 0) {
      explanation.push(`Heuristic critique: applied ${heuristicSwaps.length} score-based swap${heuristicSwaps.length === 1 ? '' : 's'}.`)
      for (const s of heuristicSwaps) {
        explanation.push(`  Swap: -${s.out} (score ${s.outScore}) → +${s.in} (score ${s.inScore}, +${s.delta})`)
      }
      // Update usedNames so the LLM critique that runs next doesn't try to
      // re-suggest swapped-in cards.
      usedNames.clear()
      usedNames.add(commander.name.toLowerCase())
      for (const c of deck) if (!c.isBasicLand) usedNames.add(c.name.toLowerCase())
    }
  }

  // 11b. Critique pass (Pass 3) — iterate until approved or limit hit.
  //
  // The model evaluates the assembled deck and proposes swaps. We apply
  // valid swaps (locked cards untouchable), then re-critique the improved
  // deck. The deck only ships once the model returns approved=true OR we
  // hit MAX_ITERATIONS.
  //
  // Anti-oscillation: cards swapped OUT in any prior iteration are blocked
  // from being swapped IN later — prevents the model from undoing a previous
  // improvement (A→B then B→A). Cards swapped IN are also tracked so the
  // model can't propose redundant swaps to cards already added.
  //
  // Caps:
  //   MAX_ITERATIONS — hard cap on total LLM calls (each is ~30s of latency)
  //   STAGNATION_LIMIT — break early if N consecutive iterations land 0 swaps
  //                      (model can't improve further from this collection)
  let critiqueResult = null
  let critiqueIterations = 0
  const MAX_ITERATIONS = 4
  const STAGNATION_LIMIT = 1
  const allAppliedSwaps = []
  const allRejectedSwaps = []
  const swappedOutNames = new Set()    // cards we've removed — never swap back IN

  if (!llmFailed) {
    let stagnantStreak = 0
    let approved = false

    while (critiqueIterations < MAX_ITERATIONS && !approved) {
      critiqueIterations++

      const deckForCritique = deck.map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        locked: !!c.fromManaSolver || !!c.fromSkeleton || !!c.fromBracketStaples || !!c.fromTribalFloor,
        source: c.fromManaSolver ? 'manaSolver' : c.fromSkeleton ? 'skeleton' : c.fromBracketStaples ? 'bracketStaples' : c.fromTribalFloor ? 'tribalFloor' : c.fromFallback ? 'heuristic' : c.fromWinconBackstop ? 'winconBackstop' : c.fromCritique ? 'critique' : c.fromHeuristicCritique ? 'heuristicCritique' : 'llm',
      }))
      const inDeckNames = new Set(deck.map(c => c.name.toLowerCase()))
      const availablePool = legalNonLands.filter(c =>
        !inDeckNames.has(c.name.toLowerCase()) && !swappedOutNames.has(c.name.toLowerCase())
      )
      const chosenStrategy = llmResponse?.chosenStrategy ?? llmResponse?.strategySummary?.primaryStrategy ?? ''

      const iterResult = await critiqueDeck({
        commander,
        bracket,
        deck: deckForCritique,
        availablePool,
        chosenStrategy,
        onProgress,
      })
      if (!iterResult) {
        // Critique call failed entirely — bail and ship the deck as-is.
        explanation.push(`Critique pass ${critiqueIterations}: LLM call failed; shipping current deck.`)
        break
      }
      critiqueResult = iterResult   // remember the latest for the return payload
      approved = !!iterResult.approved

      const { applied, rejected } = applyCritiqueSwaps(deck, iterResult.swaps ?? [], availablePool, usedNames)
      for (const s of applied) {
        swappedOutNames.add(s.out.toLowerCase())     // anti-oscillation
        allAppliedSwaps.push({ ...s, iteration: critiqueIterations })
      }
      for (const r of rejected) allRejectedSwaps.push({ ...r, iteration: critiqueIterations })

      if (approved) {
        explanation.push(`Critique pass ${critiqueIterations}: APPROVED. ${iterResult.summary ?? ''}`)
        break
      } else if (applied.length > 0) {
        explanation.push(`Critique pass ${critiqueIterations}: not approved — applied ${applied.length} swap${applied.length === 1 ? '' : 's'}. ${iterResult.summary ?? ''}`)
        for (const s of applied) explanation.push(`  Swap: -${s.out} → +${s.in} (${s.reason})`)
        stagnantStreak = 0
      } else {
        // Zero swaps applied — model proposed only invalid swaps. Likely
        // can't improve further from this collection.
        stagnantStreak++
        explanation.push(`Critique pass ${critiqueIterations}: not approved but no valid swaps proposed (stagnant ${stagnantStreak}/${STAGNATION_LIMIT}). ${iterResult.summary ?? ''}`)
        if (stagnantStreak >= STAGNATION_LIMIT) {
          explanation.push(`  Stopping critique — further iterations unlikely to help.`)
          break
        }
      }
    }

    if (allRejectedSwaps.length > 0) {
      explanation.push(`Critique rejected swaps (across all iterations):`)
      for (const r of allRejectedSwaps) {
        explanation.push(`  [iter ${r.iteration}] -${r.out} → +${r.in} (${r.reason})`)
      }
    }
    if (critiqueIterations === MAX_ITERATIONS && !approved) {
      explanation.push(`Critique pass: hit max ${MAX_ITERATIONS} iterations without final approval. Shipping deck with ${allAppliedSwaps.length} total swaps applied.`)
      warnings.push({
        severity: 'info',
        message: `Critique loop hit its iteration cap. The deck shipped with ${allAppliedSwaps.length} swap${allAppliedSwaps.length === 1 ? '' : 's'} applied — additional improvements may require expanding your collection.`,
      })
    } else if (allAppliedSwaps.length > 0) {
      warnings.push({
        severity: 'info',
        message: `Final critique made ${allAppliedSwaps.length} swap${allAppliedSwaps.length === 1 ? '' : 's'} across ${critiqueIterations} iteration${critiqueIterations === 1 ? '' : 's'} to upgrade the deck.`,
      })
    }
  }

  // 11c. Bracket-downgrade backstop — final step before post-processing.
  // If the assembled deck's actual computed bracket exceeds the user's
  // target, swap out the offending cards (combo pieces, excess tutors,
  // excess fast mana). Runs AFTER critique passes so nothing later can
  // re-introduce bracket-bumping cards.
  //
  // Fires at B1-B4. At B4 the 2+ combo bump pushes actual to B5 (over
  // target), so we need to break combos until count ≤ 1. At B5 we don't
  // run downgrade — optimization pushing actual bracket up is the goal.
  // Mana-base + bracket-staples are protected; skeleton CAN be swapped
  // (bracket fidelity > skeleton fidelity).
  if (bracket <= 4) {
    const downgradeSwaps = downgradeBracketIfOverShot({
      deck, targetBracket: bracket, legalNonLands, usedNames,
    })
    if (downgradeSwaps.length > 0) {
      explanation.push(`Bracket-fit pass: applied ${downgradeSwaps.length} swap${downgradeSwaps.length === 1 ? '' : 's'} to bring actual bracket back to target B${bracket}.`)
      for (const s of downgradeSwaps) {
        explanation.push(`  Downgrade: -${s.out} → +${s.in} (${s.reason})`)
      }
      warnings.push({
        severity: 'info',
        message: `Bracket-fit pass swapped ${downgradeSwaps.length} card${downgradeSwaps.length === 1 ? '' : 's'} so the deck plays at the bracket you targeted.`,
      })
    }
  }

  // 12. Post-processing — same as the heuristic generator does.
  const combos = detectCombos(deck.map(c => c.name))
  const { actualBracket, flaggedCards } = computeActualBracket(deck, combos)
  const { errors, warnings: validationWarnings } = validateDeck(deck, commander)

  if (actualBracket > bracket) {
    warnings.push({
      severity: 'warning',
      message:
        `Deck is actually bracket ${actualBracket} (${BRACKET_LABELS[actualBracket]}), ` +
        `but you targeted bracket ${bracket} (${BRACKET_LABELS[bracket]}). ` +
        `Flagged cards: ${flaggedCards.join(', ') || 'none'}.`,
    })
  }
  for (const e of errors) warnings.push({ severity: 'error', message: e })
  for (const v of validationWarnings) warnings.push({ severity: 'warning', message: v })
  for (const c of combos) warnings.push({ severity: 'info', message: `Combo detected: ${c.cards.join(' + ')} — ${c.description}` })

  // 13. Stats + excluded list, in the shape the existing UI already renders.
  const roleCounts = countRoles(deck)
  const stats = {
    totalCards: deck.length + 1,
    landCount: roleCounts.land,
    roleCounts,
    avgCmc: avgCmc(deck),
    colorBreakdown: colorBreakdown(deck),
  }

  const excludedCards = [
    ...illegalExcluded,
    ...bracketExcluded,
    ...validation.invalidCards.map(c => ({
      name: c.name,
      excludeReason: `LLM suggested but rejected: ${c.rejectionReason}`,
    })),
  ]

  return {
    commander,
    mainDeck: deck,
    excludedCards,
    warnings,
    stats,
    bracketAnalysis: { targetBracket: bracket, actualBracket, flaggedCards },
    combos,
    archetypes,
    explanation,

    // LLM-specific extras the UI can show but doesn't have to.
    generationMode: 'llm-assisted',
    llmStrategy: {
      chosenStrategy:    llmResponse.chosenStrategy ?? '',
      primaryStrategy:   llmResponse.strategySummary?.primaryStrategy ?? '',
      secondaryStrategy: llmResponse.strategySummary?.secondaryStrategy ?? '',
      winPlan:           llmResponse.strategySummary?.winPlan ?? '',
      coreEngine:          llmResponse.coreEngine ?? [],
      deckStats:           llmResponse.deckStats ?? null,
      weakIncludes:        llmResponse.weakIncludes ?? [],
      winConditionDetails: llmResponse.winConditionDetails ?? [],
      llmWarnings:         llmResponse.warnings ?? [],
      mode:              llmResponse._meta?.mode,
      promptTokens:      llmResponse._meta?.promptTokens,
    },
    llmValidation: {
      isValid:        validation.isValid,
      validCount:     validation.validCards.length,
      invalidCount:   validation.invalidCards.length,
      duplicateCount: validation.duplicateCards.length,
      missingCount:   validation.missingCards,
      invalidCards:   validation.invalidCards,
    },
    critique: critiqueResult ? {
      approved:        !!critiqueResult.approved,
      summary:         critiqueResult.summary ?? '',
      iterations:      critiqueIterations,
      swapsApplied:    allAppliedSwaps.map(s => ({
        out: s.out, in: s.in, reason: s.reason, iteration: s.iteration,
      })),
      swapsRejected:   allRejectedSwaps.map(r => ({
        out: r.out, in: r.in, reason: r.reason, iteration: r.iteration,
      })),
    } : null,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Heuristic (non-LLM) critique. Walks the unlocked deck cards and the
// available pool, scores both with the same scoreCard the heuristic
// generator uses, and swaps deck cards for pool cards that score ≥12 points
// higher. Mutates `deck` in place. Returns the applied swaps so the
// orchestrator can log them.
//
// Why this exists: the LLM critique frequently identifies weak picks
// correctly but proposes upgrades the user doesn't own (Damnation, Swords,
// etc. — textbook answers from the model's training data). Heuristic
// critique only proposes swaps within the user's actual collection, so
// every swap is guaranteed to be a real improvement they can use.
//
// Constraints:
//   - Locked cards (mana base + skeleton) are never swapped out
//   - Cap at 8 swaps per generation to prevent over-aggressive rewrites
//   - Min score delta of 12 — swap only when the upgrade is meaningful
// Bracket-downgrade backstop. Walks the deck post-assembly. If the actual
// computed bracket exceeds the target (e.g., user asked for B3 but the
// deck plays at B5 due to combos), repeatedly swap out offending cards
// for non-offending alternatives until actual bracket matches target —
// or we run out of swap candidates.
//
// Order of priorities (highest impact first):
//   1. Combo components — break combos by removing the card that appears
//      in the most combos
//   2. Excess tutors (≥4 non-soft tutors at B3 → bracket bumps to B4)
//   3. Excess non-safe-rock fast mana (≥3 at B3 → bracket bumps to B4)
//
// Locked cards: mana-base solver picks and bracket-staples are protected
// (bracket-staples are already bracket-aware so they shouldn't be the
// problem). Skeleton picks CAN be swapped — if the skeleton gave us a
// combo piece at B3, bracket fit beats EDHREC fidelity.
function downgradeBracketIfOverShot({ deck, targetBracket, legalNonLands, usedNames }) {
  const swaps = []
  const MAX_ATTEMPTS = 25

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const deckNames = deck.map(c => c.name)
    const combos = detectCombos(deckNames)
    const { actualBracket } = computeActualBracket(deck, combos)
    if (actualBracket <= targetBracket) break

    const swap = pickDowngradeSwap({ deck, combos, targetBracket, legalNonLands })
    if (!swap) break    // can't fix it from this collection

    const idx = deck.findIndex(c => c.name === swap.out)
    if (idx === -1) break
    const removed = deck[idx]
    usedNames.delete(removed.name.toLowerCase())
    deck[idx] = { ...swap.in, quantity: 1, fromBracketDowngrade: true }
    usedNames.add(swap.in.name.toLowerCase())
    swaps.push({ out: removed.name, in: swap.in.name, reason: swap.reason })
  }

  return swaps
}

// Build a set of card names that are RISKY to add to the deck — any card
// that's part of a known combo where another piece of that combo is already
// in the deck. Adding any of these cards completes the combo and bumps
// the bracket. Used as a replacement filter so swaps don't accidentally
// trade one combo for another.
function getRiskyComboCards(deck) {
  const risky = new Set()
  const deckSet = new Set(deck.map(c => c.name.toLowerCase()))
  for (const combo of getAllCombos()) {
    const pieces = (combo.cards ?? []).map(c => c.toLowerCase())
    if (pieces.some(p => deckSet.has(p))) {
      // At least one piece of this combo is in the deck — every other
      // piece is risky to add (would complete the combo).
      for (const p of pieces) risky.add(p)
    }
  }
  return risky
}

function pickDowngradeSwap({ deck, combos, targetBracket, legalNonLands }) {
  // Build the "risky" combo-piece set ONCE per call. Any card in the
  // global combo list whose other-half is already in the deck is risky:
  // adding it completes a combo. The replacement filter blocks risky
  // cards so we don't trade one combo for another.
  const riskyCombosCards = getRiskyComboCards(deck)

  // Common "no-go" filter for ALL replacements: must not be a tutor (above
  // soft), fast mana (above safe rock), or game changer at the target
  // bracket. Without this we can swap a combo piece for a tutor and still
  // bump the bracket on the next iteration.
  const isReplacementSafeAtBracket = (c) => {
    const tags = c.tags ?? []
    if (riskyCombosCards.has(c.name.toLowerCase())) return false
    if (targetBracket <= 3) {
      if (tags.includes('fast_mana') && !isSafeRock(c.name)) return false
      if (tags.includes('tutor')     && !isSoftTutor(c.name)) return false
    }
    if (targetBracket <= 2) {
      if (tags.includes('game_changer')) return false
    }
    return true
  }

  // PRIORITY 1: break a combo if any are detected
  if (combos.length > 0) {
    const cardComboCount = new Map()
    for (const combo of combos) {
      for (const cardName of combo.cards) {
        const key = cardName.toLowerCase()
        cardComboCount.set(key, (cardComboCount.get(key) ?? 0) + 1)
      }
    }
    const swap = pickSwap(deck, legalNonLands, {
      isOffender:    (c) => cardComboCount.has(c.name.toLowerCase()),
      isReplacement: isReplacementSafeAtBracket,
      offenderRank:  (c) => cardComboCount.get(c.name.toLowerCase()) ?? 0,
      reasonText:    (c) => `combo piece (in ${cardComboCount.get(c.name.toLowerCase()) ?? 1} known combo${(cardComboCount.get(c.name.toLowerCase()) ?? 1) === 1 ? '' : 's'})`,
    })
    if (swap) return swap
  }

  // PRIORITY 2: too many non-soft tutors (4+ bumps to B4)
  if (targetBracket < 4) {
    const tutorCount = deck.filter(c => (c.tags ?? []).includes('tutor') && !isSoftTutor(c.name)).length
    if (tutorCount >= 4) {
      const swap = pickSwap(deck, legalNonLands, {
        isOffender:    (c) => (c.tags ?? []).includes('tutor') && !isSoftTutor(c.name),
        isReplacement: (c) => isReplacementSafeAtBracket(c) && !(c.tags ?? []).includes('tutor'),
        offenderRank:  () => 1,
        reasonText:    () => 'excess tutor (B3 cap is 3 non-soft tutors)',
      })
      if (swap) return swap
    }
  }

  // PRIORITY 3: too much non-safe-rock fast mana (3+ bumps to B4)
  if (targetBracket < 4) {
    const fastCount = deck.filter(c => (c.tags ?? []).includes('fast_mana') && !isSafeRock(c.name)).length
    if (fastCount >= 3) {
      const swap = pickSwap(deck, legalNonLands, {
        isOffender:    (c) => (c.tags ?? []).includes('fast_mana') && !isSafeRock(c.name),
        isReplacement: (c) => isReplacementSafeAtBracket(c) && !(c.tags ?? []).includes('fast_mana'),
        offenderRank:  () => 1,
        reasonText:    () => 'excess fast mana (B3 cap is 2 non-safe-rock pieces)',
      })
      if (swap) return swap
    }
  }

  // PRIORITY 4: at B1-B2 specifically, game_changer cards bump bracket to 3
  if (targetBracket <= 2) {
    const gcCount = deck.filter(c => (c.tags ?? []).includes('game_changer')).length
    if (gcCount > 0) {
      const swap = pickSwap(deck, legalNonLands, {
        isOffender:    (c) => (c.tags ?? []).includes('game_changer'),
        isReplacement: (c) => isReplacementSafeAtBracket(c) && !(c.tags ?? []).includes('game_changer'),
        offenderRank:  () => 1,
        reasonText:    () => 'game changer (excluded at B1-B2)',
      })
      if (swap) return swap
    }
  }

  // PRIORITY 5: at B1, ANY tutor (even soft) and ANY fast mana (even safe)
  // bumps bracket. Strict cleanup.
  if (targetBracket === 1) {
    const swap = pickSwap(deck, legalNonLands, {
      isOffender:    (c) => (c.tags ?? []).includes('tutor') || (c.tags ?? []).includes('fast_mana'),
      isReplacement: (c) => isReplacementSafeAtBracket(c) && !(c.tags ?? []).includes('tutor') && !(c.tags ?? []).includes('fast_mana'),
      offenderRank:  () => 1,
      reasonText:    () => 'tutor or fast mana (excluded at B1)',
    })
    if (swap) return swap
  }

  return null
}

// Shared swap-selector for the bracket-downgrade pass. Picks the highest-
// ranked offender in the deck (by `offenderRank`) that's swappable, finds a
// matching-role replacement from the pool that isn't itself an offender.
function pickSwap(deck, legalNonLands, { isOffender, isReplacement, offenderRank, reasonText }) {
  // Find swap-out: in deck, is offender, NOT mana-solver/bracket-staple/tribal-floor
  const candidates = deck.filter(c =>
    isOffender(c) &&
    !c.fromManaSolver && !c.fromBracketStaples && !c.fromTribalFloor
  )
  if (candidates.length === 0) return null

  // Sort by offender rank desc (most impactful to swap first)
  candidates.sort((a, b) => offenderRank(b) - offenderRank(a))
  const out = candidates[0]

  // Find swap-in: not in deck, not an offender, prefer same role for slot fidelity
  const inDeckNames = new Set(deck.map(c => c.name.toLowerCase()))
  const replacements = legalNonLands.filter(c =>
    !inDeckNames.has(c.name.toLowerCase()) && isReplacement(c)
  )
  if (replacements.length === 0) return null

  const outRole = (out.roles ?? ['filler'])[0]
  const sameRole = replacements.filter(c => (c.roles ?? ['filler'])[0] === outRole)
  const inCard = sameRole[0] ?? replacements[0]

  return { out: out.name, in: inCard, reason: reasonText(out) }
}

function runHeuristicCritique({ deck, legalNonLands, commander, bracket, strategyContext, edhrecData }) {
  // Score-delta threshold for triggering a swap. Lower at high brackets where
  // every point of optimization matters; higher at low brackets where we
  // want to preserve the user's chosen casual feel.
  const MIN_DELTA = bracket >= 5 ? 4  : bracket >= 4 ? 8  : 12
  // MAX_SWAPS — at B5 we want unrestricted clean-up since users targeting
  // cEDH expect aggressive optimization. The MIN_DELTA gate naturally caps
  // total swaps to "real upgrades only", so a high MAX_SWAPS at B5 doesn't
  // run away.
  const MAX_SWAPS = bracket >= 5 ? 25 : bracket >= 4 ? 15 : 8

  // Off-theme penalty applied during scoring. A card that matches NO detected
  // archetype AND isn't a universal-role staple (ramp/draw/removal/etc.) is
  // almost always filler with no business in the deck. Heavy penalty so the
  // critique aggressively swaps these for on-theme alternatives.
  //
  // Without this, an off-theme filler scored only ~12 points lower than an
  // on-theme dragon — right at B3's swap threshold, often missed. Liar's
  // Pendulum could ride into a Tiamat dragon deck. With this penalty,
  // off-theme cards score ~40+ lower so the swap is unambiguous.
  const UNIVERSAL_ROLES = new Set(['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition'])
  const detectedArchetypes = strategyContext.archetypes ?? []
  const isOffTheme = (card) => {
    const isUniversal = (card.roles ?? []).some(r => UNIVERSAL_ROLES.has(r))
    if (isUniversal) return false
    if (detectedArchetypes.length === 0) return false
    return !detectedArchetypes.some(a => cardMatchesArchetype(card, a))
  }
  const OFF_THEME_PENALTY = 30

  // Build a lightweight scoring context. EDHREC rank is the most important
  // signal; combos and primary archetype matter too.
  const edhrecRank = new Map()
  ;(edhrecData?.topCards ?? []).forEach((c, i) => edhrecRank.set(c.name, i + 1))

  const allCombos = getAllCombos()
  const candidateNames = new Set(legalNonLands.map(c => c.name.toLowerCase()))
  candidateNames.add(commander.name.toLowerCase())
  const relevantCombos = allCombos.filter(combo =>
    combo.cards.some(name => candidateNames.has(name.toLowerCase()))
  )

  const scoringContext = {
    archetypes: strategyContext.archetypes ?? [],
    primaryArchetypeId: strategyContext.primaryArchetypeId ?? null,
    combos: relevantCombos,
    pickedNames: new Set(deck.map(c => c.name.toLowerCase())),
    edhrecRank,
    edhrecRankTotal: Math.max(edhrecData?.topCards?.length ?? 1, 1),
    commanderTagBoosts: strategyContext.commanderTagBoosts,
  }
  const scoreFor = (card) => {
    let s = scoreCard(card, (card.roles ?? ['filler'])[0], commander, bracket, scoringContext)
    if (isOffTheme(card)) s -= OFF_THEME_PENALTY
    return s
  }

  // Available pool: legal non-lands not currently in the deck. ALSO exclude
  // off-theme cards from swap candidates — without this, the critique
  // happily swaps one piece of off-theme filler for another (e.g.,
  // -Idol of False Gods → +Liar's Pendulum, where both are random
  // artifacts with no relation to the dragon theme). That's not an
  // upgrade. Off-theme cards just shouldn't be swap-in candidates at all.
  const inDeckNames = new Set(deck.map(c => c.name.toLowerCase()))
  const pool = legalNonLands.filter(c =>
    !inDeckNames.has(c.name.toLowerCase()) && !isOffTheme(c)
  )

  // Score the deck (unlocked only) and pool. Sort: deck weakest first, pool
  // strongest first.
  const swappableDeck = deck
    .map((c, idx) => ({ idx, card: c, score: scoreFor(c) }))
    .filter(({ card }) => !card.fromManaSolver && !card.fromSkeleton && !card.fromBracketStaples && !card.fromTribalFloor)
    .sort((a, b) => a.score - b.score)

  const scoredPool = pool
    .map(c => ({ card: c, score: scoreFor(c) }))
    .sort((a, b) => b.score - a.score)

  const swaps = []
  const usedPoolNames = new Set()

  for (const { idx, card: deckCard, score: deckScore } of swappableDeck) {
    if (swaps.length >= MAX_SWAPS) break

    for (const { card: poolCard, score: poolScore } of scoredPool) {
      if (usedPoolNames.has(poolCard.name.toLowerCase())) continue
      const delta = poolScore - deckScore
      if (delta < MIN_DELTA) break   // pool sorted desc — no remaining card can help

      // Swap in place. Tag the new card so downstream code knows it came from
      // the heuristic critique (useful for diagnostics + debug UI later).
      deck[idx] = { ...poolCard, quantity: 1, fromHeuristicCritique: true, critiqueDelta: delta }
      swaps.push({
        out: deckCard.name,
        in: poolCard.name,
        outScore: deckScore,
        inScore: poolScore,
        delta,
      })
      usedPoolNames.add(poolCard.name.toLowerCase())
      break
    }
  }

  return swaps
}

// Apply the swaps returned by the critique pass. Each swap is validated:
//   - `out` must be a card currently in the deck AND not locked (mana base
//     or skeleton). Locked cards stay regardless of LLM opinion.
//   - `in` must be a card in the available pool (not already in deck).
// Caps at 5 swaps total. Returns { applied, rejected } so callers can log
// what happened.
function applyCritiqueSwaps(deck, swaps, availablePool, usedNames) {
  const applied = []
  const rejected = []
  if (!Array.isArray(swaps) || swaps.length === 0) return { applied, rejected }

  const poolByName = new Map()
  for (const c of availablePool) poolByName.set(c.name.toLowerCase(), c)

  const MAX_SWAPS = 5
  for (const swap of swaps.slice(0, MAX_SWAPS)) {
    const outName = swap?.out
    const inName  = swap?.in
    const reason  = swap?.reason ?? ''
    if (!outName || !inName) {
      rejected.push({ out: outName, in: inName, reason: 'malformed swap (missing name)' })
      continue
    }

    const outIdx = deck.findIndex(c => c.name.toLowerCase() === outName.toLowerCase())
    if (outIdx === -1) {
      rejected.push({ out: outName, in: inName, reason: 'out-card not in deck' })
      continue
    }
    const outCard = deck[outIdx]
    if (outCard.fromManaSolver || outCard.fromSkeleton || outCard.fromBracketStaples || outCard.fromTribalFloor) {
      rejected.push({ out: outName, in: inName, reason: 'out-card is locked (mana base, skeleton, bracket staple, or tribal floor)' })
      continue
    }

    const inCard = poolByName.get(inName.toLowerCase())
    if (!inCard) {
      rejected.push({ out: outName, in: inName, reason: 'in-card not in available pool' })
      continue
    }
    if (usedNames.has(inName.toLowerCase())) {
      rejected.push({ out: outName, in: inName, reason: 'in-card already in deck' })
      continue
    }

    // Apply the swap
    usedNames.delete(outName.toLowerCase())
    deck[outIdx] = { ...inCard, quantity: 1, fromCritique: true, critiqueReason: reason }
    usedNames.add(inName.toLowerCase())
    applied.push({ out: outName, in: inName, reason })
    // Pull the in-card out of the pool so subsequent swaps don't re-suggest it
    poolByName.delete(inName.toLowerCase())
  }

  return { applied, rejected }
}


// Cap the pool sent to the LLM with PER-ROLE caps. Each card is bucketed by
// its primary role and only competes for slots in that bucket — so a
// collection with 80 ramp cards no longer crowds out the synergy/wincon
// picks the deck actually needs.
//
// Adaptive: small collections (≤ THRESHOLD legal cards) skip the cap entirely
// — there's no token-budget reason to drop cards when the prompt fits anyway.
function capPoolForLLM(legalCardPool, commander, bracket, strategyContext) {
  if (legalCardPool.length <= LLM_POOL_CAP_THRESHOLD) return legalCardPool

  const scoringContext = {
    archetypes: strategyContext.archetypes,
    primaryArchetypeId: strategyContext.primaryArchetypeId,
    commanderTagBoosts: strategyContext.commanderTagBoosts,
  }
  const primary = strategyContext.primaryArchetypeId
    ? strategyContext.archetypes?.find(a => a.id === strategyContext.primaryArchetypeId)
    : null

  // Bucket each card by its primary role. Multi-role cards still surface
  // their secondary roles to the LLM via the roles array — the bucket is
  // only used for cap accounting here.
  //
  // Three score adjustments before the per-role top-N selection:
  //   1. Archetype bias: cards matching the locked primary get +25; cards
  //      matching any detected archetype get +15. Without this, a Tiamat
  //      dragon pool would mix dragons with random artifacts equally.
  //   2. Off-theme penalty: cards that DON'T match any detected archetype
  //      AND aren't a universal-role staple get -30. This stops Tragedy
  //      Feaster, Twilight Prophet, and similar filler from surviving the
  //      per-role cap. Previously the penalty only fired in the heuristic
  //      critique step (post-LLM-pick), so the LLM still saw filler as
  //      good options and frequently picked them.
  //
  // Universal-role cards (ramp/draw/removal/wipe/protection/tutor/
  // win_condition) bypass the off-theme penalty — Sol Ring goes in every
  // deck regardless of archetype.
  const UNIVERSAL_ROLES = new Set(['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition'])
  const detectedArchetypes = strategyContext.archetypes ?? []
  const isOffTheme = (card) => {
    const isUniversal = (card.roles ?? []).some(r => UNIVERSAL_ROLES.has(r))
    if (isUniversal) return false
    if (detectedArchetypes.length === 0) return false
    return !detectedArchetypes.some(a => cardMatchesArchetype(card, a))
  }
  const OFF_THEME_PENALTY = 30

  const buckets = new Map()
  for (const card of legalCardPool) {
    const role = card.roles?.[0] ?? 'filler'
    let score = scoreCard(card, role, commander, bracket, scoringContext)
    if (primary && cardMatchesArchetype(card, primary)) {
      score += 25
    } else if (detectedArchetypes.length > 0 && detectedArchetypes.some(a => cardMatchesArchetype(card, a))) {
      score += 15
    }
    if (isOffTheme(card)) {
      score -= OFF_THEME_PENALTY
    }
    if (!buckets.has(role)) buckets.set(role, [])
    buckets.get(role).push({ card, score })
  }

  const out = []
  for (const [role, items] of buckets) {
    items.sort((a, b) => b.score - a.score)
    const cap = ROLE_CAPS[role] ?? DEFAULT_ROLE_CAP
    for (const item of items.slice(0, cap)) out.push(item.card)
  }
  return out
}

function extractCreatureSubtypes(commander) {
  const tl = commander?.type_line ?? ''
  const dashIdx = tl.indexOf('—')
  if (dashIdx === -1) return []
  return tl.slice(dashIdx + 1).trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function syntheticBasic(name, idx) {
  return {
    id: `basic_${name.toLowerCase().replace(/\s/g, '_')}_${idx}`,
    name,
    type_line: 'Basic Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal' },
    image_uris: null,
    card_faces: null,
    isBasicLand: true,
    roles: ['land'],
    tags: [],
    quantity: 1,
  }
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

// Re-export so call sites can import from one place.
export { isBasicLand }
