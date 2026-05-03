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
 */
export function classifyQualitySignals({
  bracket,
  fillerCount,
  fillerCap,
  wincons,
  detectedWincons,
  executionScore,
  executionThreshold,
}) {
  const issues = []

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

  return issues
}

/**
 * Apply the clamp to an LLM eval result given quality signals.
 *
 * @param {object} evalResult — raw output from the LLM evaluator (must
 *   include numeric `score` and string `summary`).
 * @param {object} signals    — same shape as classifyQualitySignals input
 * @returns {object} new eval result; score may be clamped, summary may
 *   be prefixed with the clamp reason. Original input is not mutated.
 */
export function clampEvalScore(evalResult, signals) {
  if (!evalResult || typeof evalResult.score !== 'number') return evalResult
  const issues = classifyQualitySignals(signals)
  if (issues.length === 0) return evalResult

  const fatal  = issues.filter(i => i.severity === 'fatal')
  const severe = issues.filter(i => i.severity === 'severe')

  let cap = Infinity
  if (fatal.length  > 0) cap = Math.min(cap, 5)
  if (severe.length > 0) cap = Math.min(cap, 6)

  if (evalResult.score <= cap) {
    // Already at or below the cap — the LLM's score is honest. Return
    // the original (no need to mutate).
    return evalResult
  }

  // Clamp the score and prepend a clamp note to the summary.
  const reasons = [...fatal, ...severe].map(i => i.detail).join('; ')
  return {
    ...evalResult,
    score: cap,
    summary: `[score clamped from ${evalResult.score} to ${cap}: ${reasons}] ${evalResult.summary ?? ''}`.trim(),
    _clampedFrom: evalResult.score,
    _clampReasons: issues,
  }
}
