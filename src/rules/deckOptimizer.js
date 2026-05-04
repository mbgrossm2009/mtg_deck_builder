import { maxRampCount } from './bracketRules'
import { countRoles } from './deckValidator'

// Mirror of constants from deckValidator.js — kept here so the optimizer
// and validator agree on what "passing" means. If you change one, change
// the other.
const INTERACTION_FLOOR = { 1: 4, 2: 5, 3: 7, 4: 8, 5: 10 }
const FILLER_THRESHOLD  = { 1: 12, 2: 9, 3: 6, 4: 5, 5: 3 }

// Default lock flags. Cards carrying any of these were placed by an
// upstream backstop (mana solver, bracket staples, tribal floor, wincon
// floor) and must not be removed by the optimizer — doing so would
// undo the work of the pass that placed them. The orchestrator can
// extend this list via the `lockFlags` option.
const DEFAULT_LOCK_FLAGS = [
  'fromManaSolver',
  'fromBracketStaples',
  'fromTribalFloor',
  'fromWinconBackstop',
]

// Role-membership test. The validator's `countRoles` and the
// orchestrator's wincon backstop both treat `tags.includes('explosive_finisher')`
// as a wincon — the optimizer follows the same rule so cards like
// Craterhoof Behemoth count toward the wincon floor.
function hasRole(card, role) {
  if ((card.roles ?? []).includes(role)) return true
  if (role === 'win_condition' && (card.tags ?? []).includes('explosive_finisher')) return true
  return false
}

// Count-based gaps between the current deck and the validator's
// floors/caps. Both this function and validateDeckAtBracket read from
// countRoles, so they stay aligned without string-parsing warnings.
//
// `winConFloor` defaults to 1 (matches the base validator). Callers
// with stricter floors — e.g. the orchestrator's MIN_WINCONS (B4=3,
// B5=2) — pass that through so the optimizer enforces the same bar.
//
// Out of scope: execution-score / lens-quality issues — those aren't
// fixable by mechanical role swaps.
export function computeValidationGaps(deck, commander, bracket, targetCounts = {}, options = {}) {
  const counts = countRoles(deck)
  const fastMana = deck.filter(c => (c.tags ?? []).includes('fast_mana')).length
  const landRamp = (counts.ramp ?? 0) - fastMana
  const interaction = (counts.removal ?? 0) + (counts.wipe ?? 0)
  const interactionFloor = INTERACTION_FLOOR[bracket] ?? 0
  const fillerCap        = FILLER_THRESHOLD[bracket] ?? Infinity
  const rampCap          = maxRampCount(bracket, commander)
  const winConFloor      = options.winConFloor ?? 1

  // Wincon count uses the broader hasRole (role OR explosive_finisher
  // tag) so a deck whose only wincon is Craterhoof isn't reported as
  // wincon-deficient.
  const winconCount = deck.filter(c => hasRole(c, 'win_condition')).length

  const deficits = {}
  if (interaction < interactionFloor) {
    deficits.removal = interactionFloor - interaction
  }
  for (const role of ['ramp', 'draw', 'win_condition', 'protection']) {
    const target = targetCounts[role] ?? 0
    const have   = role === 'win_condition' ? winconCount : (counts[role] ?? 0)
    if (target > have) deficits[role] = target - have
  }
  if (winconCount < winConFloor) {
    const gap = winConFloor - winconCount
    deficits.win_condition = Math.max(deficits.win_condition ?? 0, gap)
  }

  const surpluses = {}
  if ((counts.filler ?? 0) > fillerCap) surpluses.filler = counts.filler - fillerCap
  const rampOverCap = Math.max(0, landRamp - rampCap)
  if (rampOverCap > 0) surpluses.land_ramp = rampOverCap

  return { deficits, surpluses, counts }
}

// Validate-and-retry loop. Each pass:
//   1. compute gaps
//   2. for each deficit role, build a tiered "removable" list:
//        Tier 1: filler-primary cards (always removable, no score guard
//                — filler is by definition the lowest-priority slot)
//        Tier 2: excess land-ramp cards when surplus declared (also no
//                score guard — over-cap ramp is excess by definition)
//        Tier 3: any unlocked non-land card NOT carrying the deficit
//                role; score-guarded so we don't regress overall quality
//      then swap lowest-scored removable for highest-scored unused
//      candidate carrying the deficit role
//   3. if filler / land-ramp surpluses still remain after deficit pass,
//      run a trim-surplus pass: swap each excess filler / land-ramp slot
//      for the highest-scored non-surplus-role unused candidate. This
//      brings the deck under cap even when no role has a deficit.
//   4. exit when no gaps remain or no swap was possible
//
// rescore is the caller's scoring function — re-invoked between passes
// so swap-in scores reflect current deck state.
//
// Mutates: deck, usedNames, explanation. Returns total swap count.
export function optimizeDeckToValidation({
  deck,
  candidates,
  commander,
  bracket,
  targetCounts,
  rescore,
  usedNames,
  explanation,
  maxPasses = 5,
  lockFlags = [],
  winConFloor,
}) {
  const allLockFlags = [...DEFAULT_LOCK_FLAGS, ...lockFlags]
  const isLocked = (card) => allLockFlags.some(f => card[f])
  const isLandLike = (card) => card.isBasicLand || (card.roles ?? []).includes('land')

  let totalSwaps = 0

  // Apply a single swap pair, mutating deck/usedNames/explanation.
  const commitSwap = (incoming, outgoing, outIdx, role, outScore) => {
    usedNames.delete(outgoing.name.toLowerCase())
    deck[outIdx] = { ...incoming, score: incoming.score, quantity: 1, fromValidationOptimizer: true }
    usedNames.add(incoming.name.toLowerCase())
    explanation.push(
      `Optimizer swap (B${bracket}, ${role}): ${outgoing.name} (${outgoing.roles?.[0] ?? 'filler'}, ${outScore.toFixed(1)}) → ${incoming.name} (${(incoming.score ?? 0).toFixed(1)}).`
    )
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const { deficits, surpluses } = computeValidationGaps(
      deck, commander, bracket, targetCounts, { winConFloor }
    )
    if (Object.keys(deficits).length === 0 && Object.keys(surpluses).length === 0) break

    const scoredNow = rescore(candidates)
    const scoredDeck = rescore(deck)
    let swappedThisPass = 0

    // ─── Phase A: fill role deficits ─────────────────────────────────
    for (const [role, needed] of Object.entries(deficits)) {
      if (needed <= 0) continue

      const incoming = scoredNow
        .filter(c => hasRole(c, role))
        .filter(c => !usedNames.has(c.name.toLowerCase()))
        .filter(c => !isLandLike(c))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

      if (incoming.length === 0) continue

      // Don't remove a card that already carries the deficit role
      // (no-op or regression), and don't touch lands or locked cards.
      const baseFilter = ({ c }) =>
        !isLandLike(c) &&
        !hasRole(c, role) &&
        !isLocked(c)

      const indexed = scoredDeck.map((c, i) => ({ c, i, score: c.score ?? 0 }))
      const tier1 = indexed.filter(x => baseFilter(x) && (x.c.roles?.[0] ?? 'filler') === 'filler')
      const tier2 = surpluses.land_ramp > 0
        ? indexed.filter(x => baseFilter(x)
            && (x.c.roles?.[0] ?? 'filler') !== 'filler'
            && (x.c.roles ?? []).includes('ramp')
            && !(x.c.tags ?? []).includes('fast_mana'))
        : []
      const tier12Set = new Set([...tier1, ...tier2].map(x => x.i))
      const tier3 = indexed.filter(x => baseFilter(x) && !tier12Set.has(x.i))

      const sortAsc = (a, b) => a.score - b.score
      // Tier 1 + Tier 2: no score guard. Tier 3: score guard applied at
      // swap time. Track tier boundary so we know when to start guarding.
      const tier12 = [...tier1.sort(sortAsc), ...tier2.sort(sortAsc)]
      const tier3Sorted = tier3.sort(sortAsc)
      const tier12Count = tier12.length
      const removable = [...tier12, ...tier3Sorted]

      let pickedIdx = 0
      let removableIdx = 0
      while (
        pickedIdx < needed &&
        pickedIdx < incoming.length &&
        removableIdx < removable.length
      ) {
        const inc = incoming[pickedIdx]
        const { c: out, i: outIdx, score: outScore } = removable[removableIdx]
        const inTier3 = removableIdx >= tier12Count
        if (inTier3 && (inc.score ?? 0) < outScore) {
          // Tier-3 score guard: don't regress. Tier-3 removable list is
          // sorted asc; if even this lowest card outscores the candidate,
          // every later card will too — skip the rest of tier 3.
          break
        }
        commitSwap(inc, out, outIdx, role, outScore)
        pickedIdx++
        removableIdx++
        swappedThisPass++
      }
    }

    // ─── Phase B: trim surpluses standalone ──────────────────────────
    // Recompute gaps after Phase A — surpluses may have shrunk.
    const postA = computeValidationGaps(deck, commander, bracket, targetCounts, { winConFloor })

    if (Object.keys(postA.surpluses).length > 0) {
      const scoredAfterA = rescore(deck)
      const indexedA = scoredAfterA.map((c, i) => ({ c, i, score: c.score ?? 0 }))

      // Build pool of valuable swap-in candidates: any unused non-land,
      // non-filler-primary card. We're not chasing a specific role —
      // anything with a meaningful primary role is an upgrade over filler.
      // Re-rescore candidates fresh (deck state may have changed in A).
      const candidatePool = rescore(candidates)
        .filter(c => !usedNames.has(c.name.toLowerCase()))
        .filter(c => !isLandLike(c))
        .filter(c => (c.roles?.[0] ?? 'filler') !== 'filler')
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

      // Excess filler-primary slots, lowest score first.
      const excessFiller = postA.surpluses.filler > 0
        ? indexedA
            .filter(x => !isLandLike(x.c) && !isLocked(x.c) && (x.c.roles?.[0] ?? 'filler') === 'filler')
            .sort((a, b) => a.score - b.score)
            .slice(0, postA.surpluses.filler)
        : []
      // Excess land-ramp slots, lowest score first.
      const excessLandRamp = postA.surpluses.land_ramp > 0
        ? indexedA
            .filter(x => !isLandLike(x.c) && !isLocked(x.c)
              && (x.c.roles ?? []).includes('ramp')
              && !(x.c.tags ?? []).includes('fast_mana'))
            .sort((a, b) => a.score - b.score)
            .slice(0, postA.surpluses.land_ramp)
        : []

      const trimSlots = [...excessFiller, ...excessLandRamp]
      let candidateIdx = 0
      for (const slot of trimSlots) {
        if (candidateIdx >= candidatePool.length) break
        const inc = candidatePool[candidateIdx]
        // Skip candidates that share the surplus type we're trimming —
        // swapping land-ramp for more land-ramp is a no-op.
        const isLandRampCand = (inc.roles ?? []).includes('ramp') && !(inc.tags ?? []).includes('fast_mana')
        const isFillerCand = (inc.roles?.[0] ?? 'filler') === 'filler'
        if (isFillerCand) { candidateIdx++; continue }
        if ((slot.c.roles ?? []).includes('ramp') && isLandRampCand) { candidateIdx++; continue }
        commitSwap(inc, slot.c, slot.i, 'trim', slot.score)
        candidateIdx++
        swappedThisPass++
      }
    }

    totalSwaps += swappedThisPass
    if (swappedThisPass === 0) break
  }

  return totalSwaps
}
