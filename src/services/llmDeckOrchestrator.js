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
import { isBracketAllowed, targetLandCount, targetRoleCounts, computeActualBracket, BRACKET_LABELS } from '../rules/bracketRules'
import { validateDeck, countRoles } from '../rules/deckValidator'
import { detectCombos } from '../rules/comboRules'
import { detectArchetypes } from '../rules/archetypeRules'
import { isLand, isBasicLand, getBasicLandsForCommander, avgCmc } from '../utils/cardHelpers'
import { generateDeck } from '../rules/deckGenerator'
import { scoreCard } from '../rules/deckScorer'
import { cardMatchesArchetype } from '../rules/archetypeRules'
import { generateDeckWithLLM } from './llmDeckService'
import { validateLLMDeckResponse } from '../rules/llmDeckValidator'

// Cap the pool sent to the LLM. Without this, large collections (~500+ legal
// cards) push the prompt past Vercel's 60s function timeout and OpenAI's
// 128k context window. We rank by heuristic score and take the top N — the
// LLM gets the strongest candidates, the heuristic fallback still has access
// to the full pool for slot-filling later. 250 + truncated oracle_text keeps
// the prompt around ~20k tokens so OpenAI responds in 10-20s, comfortably
// inside the function timeout.
const LLM_POOL_CAP = 250

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

  // 2. Detect archetypes (regex-based — no network) so we can pass strategy hints.
  const archetypes = detectArchetypes(commander)

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

  // 5. Build deck-rule context for the prompt.
  const deckRules = {
    landTarget: targetLandCount(bracket),
    targetCounts: targetRoleCounts(bracket, commander, archetypes),
  }
  const strategyContext = {
    archetypes,
    primaryArchetypeId: archetypes.some(a => a.id === primaryArchetypeId) ? primaryArchetypeId : null,
  }

  // 5b. Cap the pool sent to the LLM. Heuristic fallback receives the full pool.
  const llmPool = capPoolForLLM(legalCardPool, commander, bracket, strategyContext)
  if (llmPool.length < legalCardPool.length) {
    explanation.push(
      `Capped LLM pool to top ${llmPool.length} of ${legalCardPool.length} candidates ` +
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

  // 7. If the LLM is unavailable entirely, return the heuristic generator's output.
  if (llmFailed || !llmResponse) {
    const heuristic = await generateDeck(bracket, primaryArchetypeId)
    if (heuristic.error) return heuristic
    return {
      ...heuristic,
      generationMode: 'heuristic-fallback',
      explanation: [...explanation, ...(heuristic.explanation ?? [])],
      warnings: [...warnings, ...(heuristic.warnings ?? [])],
      llmStrategy: null,
    }
  }

  // 8. Validate the LLM response against the authoritative rules.
  const validation = validateLLMDeckResponse({
    llmDeck: llmResponse,
    commander,
    legalCardPool,
    collection: rawCollection,
    bracket,
  })

  for (const w of validation.warnings) {
    warnings.push({ severity: 'warning', message: `LLM validation: ${w}` })
  }
  for (const c of validation.invalidCards) {
    explanation.push(`Rejected "${c.name}" — ${c.rejectionReason}`)
  }

  // 9. Build the deck from valid LLM picks.
  const deck = []
  const usedNames = new Set([commander.name.toLowerCase()])
  for (const v of validation.validCards) {
    if (deck.length >= 99) break
    deck.push({ ...v.card, quantity: 1, llmReason: v.reason, llmRole: v.role })
    usedNames.add(v.card.name.toLowerCase())
  }

  // 10. Fill missing slots from the heuristic generator. We run the heuristic
  // separately and pull cards that the LLM didn't already pick. This guarantees
  // the final deck respects role targets even when the LLM under-delivers.
  if (deck.length < 99) {
    const heuristicSource = await generateDeck(bracket, primaryArchetypeId)
    if (!heuristicSource.error) {
      const beforeFill = deck.length
      for (const card of heuristicSource.mainDeck) {
        if (deck.length >= 99) break
        const key = card.name.toLowerCase()
        // Allow basic lands to repeat — basics in the heuristic deck are
        // already individual entries, so they slot in cleanly.
        if (!card.isBasicLand && usedNames.has(key)) continue
        deck.push({ ...card, quantity: 1, fromFallback: true })
        if (!card.isBasicLand) usedNames.add(key)
      }
      const filled = deck.length - beforeFill
      if (filled > 0) {
        explanation.push(`Filled ${filled} remaining slot${filled === 1 ? '' : 's'} from the heuristic generator.`)
        warnings.push({
          severity: 'info',
          message: 'AI suggestion was adjusted to follow Commander rules and meet deck-structure targets.',
        })
      }
    }
  }

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
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Score every legal card and return the top LLM_POOL_CAP. Always preserves
// every universal-role card (lands/ramp/draw/removal/wipe/protection/tutor/
// win_condition) so the LLM never runs out of staples to fill required slots,
// even if a primary archetype lock would otherwise crowd them out.
function capPoolForLLM(legalCardPool, commander, bracket, strategyContext) {
  if (legalCardPool.length <= LLM_POOL_CAP) return legalCardPool

  const UNIVERSAL_ROLES = new Set([
    'land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'tutor', 'win_condition',
  ])
  const scoringContext = {
    archetypes: strategyContext.archetypes,
    primaryArchetypeId: strategyContext.primaryArchetypeId,
  }

  const universal = []
  const candidates = []

  for (const card of legalCardPool) {
    const roles = card.roles ?? []
    if (roles.some(r => UNIVERSAL_ROLES.has(r))) {
      universal.push(card)
    } else {
      const score = scoreCard(card, roles[0] ?? 'filler', commander, bracket, scoringContext)
      candidates.push({ card, score })
    }
  }

  // If a primary is locked, give on-archetype non-universal cards a hard
  // tiebreak so the cap doesn't accidentally drop them in favor of a slightly
  // higher-scored off-archetype card.
  const primary = strategyContext.primaryArchetypeId
    ? strategyContext.archetypes?.find(a => a.id === strategyContext.primaryArchetypeId)
    : null
  if (primary) {
    for (const c of candidates) {
      if (cardMatchesArchetype(c.card, primary)) c.score += 25
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const remaining = Math.max(0, LLM_POOL_CAP - universal.length)
  return [...universal, ...candidates.slice(0, remaining).map(c => c.card)]
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
