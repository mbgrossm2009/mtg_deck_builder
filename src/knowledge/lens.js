// Lens framework — pluggable scorers that read profiles + a deck and
// return structured output (not just numbers).
//
// PHASE 3 of the knowledge-layer migration (see docs/architecture.md).
//
// A lens answers ONE question about a deck. Multiple lenses can be
// composed to evaluate a deck across many dimensions (bracket fit,
// commander execution, win plan completeness, mana base quality, etc.).
//
// All lenses share an interface:
//   evaluate({ deck, commanderProfile, context }) → LensResult
//
// LensResult is structured (not just a numeric score):
//   {
//     name:    string                — short id of this lens
//     score:   number | null         — 0-1 fraction (or null if N/A)
//     verdict: 'pass' | 'warn' | 'fail' | 'info'
//     summary: string                — one-line human-readable
//     evidence: Array<EvidenceItem>  — supporting facts
//     suggestions: Array<string>     — actionable improvements
//   }
//
// EvidenceItem:
//   { kind: string, card?: string, detail: string }
//
// Why structured output: the orchestrator + UI + eval prompt all need
// different views of the same lens data. A single `score: 0.45` doesn't
// support "show me which cards are off-plan" or "explain why this deck
// is B4 not B3." Evidence does.

/**
 * @typedef {object} EvidenceItem
 * @property {string} kind      — category ('on_plan', 'off_plan', 'offender', etc.)
 * @property {string} [card]    — card name when applicable
 * @property {string} detail    — human-readable explanation
 */

/**
 * @typedef {object} LensResult
 * @property {string} name
 * @property {number|null} score
 * @property {'pass'|'warn'|'fail'|'info'} verdict
 * @property {string} summary
 * @property {EvidenceItem[]} evidence
 * @property {string[]} suggestions
 */

/**
 * @typedef {object} LensInput
 * @property {Array}  deck             — the 99-card mainDeck
 * @property {object} commanderProfile — output of extractCommanderProfile
 * @property {object} [context]        — optional extra context (target bracket, etc.)
 * @property {Function} [getCardProfile] — function to look up a CardProfile
 *   by card object (defaults to extractCardProfile, but the orchestrator
 *   can pass a pre-computed cache for speed)
 */

/**
 * Compose multiple lenses and return their results in a flat array.
 * @param {Array<{evaluate: (input: LensInput) => LensResult}>} lenses
 * @param {LensInput} input
 * @returns {LensResult[]}
 */
export function evaluateLenses(lenses, input) {
  return lenses.map(lens => lens.evaluate(input))
}

/**
 * Helper: convert a numeric 0-1 score into a verdict using bracket
 * thresholds. Used by lenses that have a clear "is this good enough?"
 * threshold (CommanderExecutionLens, BracketFitLens at low brackets).
 */
export function scoreToVerdict(score, threshold) {
  if (score === null || score === undefined) return 'info'
  if (score >= threshold) return 'pass'
  if (score >= threshold * 0.5) return 'warn'
  return 'fail'
}
