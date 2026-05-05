// Eval score clamp.
//
// The LLM evaluator (gpt-4o-mini) sometimes returns inflated scores that
// contradict the deck-quality signals we compute. A deck with 71 true
// filler cards, zero detected wincons, or 10% commander execution should
// not score 8 just because the LLM was generous.
//
// This module post-processes the raw LLM eval and clamps the score down
// when SEVERE quality issues are present. Mild issues are left alone —
// the LLM's judgment on borderline decks is still useful.
//
// Design philosophy: clamp only when the math is clearly wrong, not when
// it's borderline. Borderline cases stay at the LLM's reading.

/**
 * Severity classification of a deck quality signal.
 *   'fatal'  → always clamp to ≤5, summary should call it out
 *   'severe' → clamp to ≤6, signal-aware summary
 *   'mild'   → no clamp, just informational
 *
 * Phase 2 expansion: added ramp/interaction/wincon hard score gates.
 * Eval data showed the LLM giving a 9 to a deck with 30 ramp and 0
 * interaction — score-cap rules close that trust gap. The lens/warning
 * system already flags these issues; the clamp turns flags into score.
 */
export function classifyQualitySignals({
  bracket,
  fillerCount,
  fillerCap,
  wincons,
  detectedWincons,
  executionScore,
  executionThreshold,
  rampCount,
  rampCap,
  interactionCount,
  interactionFloor,
  // High-CMC commanders need more ramp to function — Maelstrom Wanderer
  // (8 CMC) running 16 land-ramp is correct strategy, not a runaway.
  // When commanderCmc is provided, we relax the ramp_high and
  // ramp_runaway thresholds so the eval doesn't ding intentional shape.
  commanderCmc = 0,
}) {
  const issues = []
  // Bonus headroom on ramp thresholds. Mirrors the maxRampCount bonus
  // ladder in bracketRules.js: CMC ≥ 7 gets +4, CMC ≥ 5 gets +2.
  const rampBonus = commanderCmc >= 7 ? 4 : commanderCmc >= 5 ? 2 : 0
  const effectiveRampCap = (typeof rampCap === 'number') ? rampCap + rampBonus : rampCap

  // FATAL: true filler is more than 2× the bracket cap.
  if (typeof fillerCap === 'number' && fillerCount > fillerCap * 2) {
    issues.push({
      severity: 'fatal',
      kind: 'filler_runaway',
      detail: `${fillerCount} true-filler cards (cap for B${bracket} is ${fillerCap})`,
    })
  }

  // FATAL: zero wincons of any kind at B3+ — the deck has no win plan.
  const totalWincons = (wincons ?? 0) + ((detectedWincons ?? []).length)
  if (bracket >= 3 && totalWincons === 0) {
    issues.push({
      severity: 'fatal',
      kind: 'no_win_plan',
      detail: `B${bracket} deck has no detected single-card wincon AND no multi-card pattern`,
    })
  }

  // FATAL: ramp is more than 1.5× the cap. The LLM was scoring decks
  // with 30 ramp (Slicer B5) at 9. Hard gate prevents that. Uses
  // effectiveRampCap (with high-CMC bonus) so an 8-CMC commander isn't
  // clamped for running 18 land-ramp.
  if (typeof effectiveRampCap === 'number' && typeof rampCount === 'number' &&
      rampCount > effectiveRampCap * 1.5) {
    issues.push({
      severity: 'fatal',
      kind: 'ramp_runaway',
      detail: `${rampCount} ramp pieces (cap for B${bracket} is ~${effectiveRampCap}${rampBonus > 0 ? ` with +${rampBonus} for ${commanderCmc}-CMC commander` : ''}). Excess ramp crowds out interaction and wincons.`,
    })
  }

  // SEVERE: execution score is less than half the bracket threshold —
  // the deck barely represents the commander.
  if (typeof executionScore === 'number' && typeof executionThreshold === 'number') {
    if (executionScore < executionThreshold * 0.5) {
      issues.push({
        severity: 'severe',
        kind: 'execution_low',
        detail: `Commander execution ${(executionScore * 100).toFixed(0)}% is < half the B${bracket} target ${(executionThreshold * 100).toFixed(0)}%`,
      })
    }
  }

  // SEVERE: filler is over (but not 2×) the bracket cap.
  if (typeof fillerCap === 'number' &&
      fillerCount > fillerCap &&
      fillerCount <= fillerCap * 2) {
    issues.push({
      severity: 'severe',
      kind: 'filler_high',
      detail: `${fillerCount} true-filler cards (cap for B${bracket} is ${fillerCap})`,
    })
  }

  // SEVERE: ramp is over the cap but within 1.5×. Excess ramp = trust
  // breakage but not a fully broken deck. Uses effectiveRampCap so
  // high-CMC commanders get the same bonus as the runaway gate above.
  if (typeof effectiveRampCap === 'number' && typeof rampCount === 'number' &&
      rampCount > effectiveRampCap && rampCount <= effectiveRampCap * 1.5) {
    issues.push({
      severity: 'severe',
      kind: 'ramp_high',
      detail: `${rampCount} ramp pieces (cap for B${bracket} is ~${effectiveRampCap}${rampBonus > 0 ? ` with +${rampBonus} for ${commanderCmc}-CMC commander` : ''}). Excess ramp crowds out interaction and wincons.`,
    })
  }

  // SEVERE: interaction below floor. Eval data showed B4/B5 decks with
  // <floor interaction getting 8s. Cap to 6 — the deck can't credibly
  // play through interaction at the target bracket.
  if (typeof interactionFloor === 'number' && typeof interactionCount === 'number' &&
      interactionCount < interactionFloor) {
    issues.push({
      severity: 'severe',
      kind: 'interaction_low',
      detail: `${interactionCount} interaction pieces (floor for B${bracket} is ${interactionFloor}+). Deck may struggle to answer threats.`,
    })
  }

  // SEVERE: named wincons below the bracket floor. Patterns DON'T count
  // here — patterns are surfaced separately to the lens; the score cap
  // is about NAMED wincon density (deck redundancy in sustained
  // pressure). A deck with 0 named wincons + a strong pattern still gets
  // its lens-pass, but the score reflects the lack of redundancy.
  const WINCON_FLOOR_BY_BRACKET = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 2 }
  const winconFloor = WINCON_FLOOR_BY_BRACKET[bracket]
  if (winconFloor && typeof wincons === 'number' && wincons < winconFloor) {
    issues.push({
      severity: 'severe',
      kind: 'wincons_low',
      detail: `${wincons} named wincons (floor for B${bracket} is ${winconFloor}+). Multi-card patterns can compensate but the deck lacks redundancy.`,
    })
  }

  return issues
}

/**
 * Aggregate the quality signals into a single deck-viability verdict.
 * Used by UI to render a single status badge ("Valid" / "Unstable" /
 * "Non-competitive") without parsing the full clamp-reasons array.
 *
 * Mapping:
 *   - non-competitive → any FATAL issue (filler runaway, ramp runaway,
 *                      no win plan). Deck functions but won't perform at
 *                      the target bracket.
 *   - unstable        → any SEVERE issue (filler-high, ramp-high,
 *                      interaction-low, execution-low, wincons-low).
 *                      Deck has structural concerns but can still play.
 *   - valid           → no issues. Deck meets all bracket-floor checks.
 */
export function classifyDeckViability(signals) {
  const issues = classifyQualitySignals(signals)
  if (issues.some(i => i.severity === 'fatal'))  return 'non-competitive'
  if (issues.some(i => i.severity === 'severe')) return 'unstable'
  return 'valid'
}

/**
 * Apply the clamp to an LLM eval result given quality signals.
 *
 * @param {object} evalResult — raw output from the LLM evaluator (must
 *   include numeric `score` and string `summary`).
 * @param {object} signals    — same shape as classifyQualitySignals input
 * @returns {object} new eval result; score may be clamped, summary may
 *   be prefixed with the clamp reason. Original input is not mutated.
 *   Always sets `deckViability` ('valid' | 'unstable' | 'non-competitive')
 *   regardless of whether the score itself was clamped.
 */
export function clampEvalScore(evalResult, signals) {
  if (!evalResult || typeof evalResult.score !== 'number') return evalResult
  const issues = classifyQualitySignals(signals)
  const viability = classifyDeckViability(signals)

  if (issues.length === 0) {
    // No structural issues — keep the LLM's score, but still surface
    // the (positive) viability flag for downstream consumers.
    return { ...evalResult, deckViability: viability }
  }

  const fatal  = issues.filter(i => i.severity === 'fatal')
  const severe = issues.filter(i => i.severity === 'severe')

  let cap = Infinity
  if (fatal.length  > 0) cap = Math.min(cap, 5)
  if (severe.length > 0) cap = Math.min(cap, 6)

  if (evalResult.score <= cap) {
    // Already at or below the cap — the LLM's score is honest. Still
    // attach the viability flag for the UI.
    return { ...evalResult, deckViability: viability }
  }

  // Clamp the score and prepend a clamp note to the summary.
  const reasons = [...fatal, ...severe].map(i => i.detail).join('; ')
  return {
    ...evalResult,
    score: cap,
    summary: `[score clamped from ${evalResult.score} to ${cap}: ${reasons}] ${evalResult.summary ?? ''}`.trim(),
    _clampedFrom: evalResult.score,
    _clampReasons: issues,
    deckViability: viability,
  }
}
