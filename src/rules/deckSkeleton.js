// Skeleton-first deck construction.
//
// Instead of asking the LLM to build a deck from scratch, we hand it a
// pre-locked "skeleton" of cards that the meta has already proven work for
// this commander. The skeleton comes from EDHREC's inclusion data — what %
// of real decks for this commander run each card. Cards above a threshold
// AND in the user's collection AND legal at the target bracket get locked
// into the deck before the LLM is even called.
//
// The LLM's job changes from "build a deck (open-ended creative problem,
// LLMs hedge)" to "pick the remaining ~30 cards to round out this real deck
// (narrow, constrained problem, LLMs are good at it)."
//
// Why this works: the user's complaint pattern ("feels like B2 instead of
// B3") is impossible if the skeleton already contains the cards real B3
// decks for this commander run. We're not predicting power level — we're
// matching it from data.

import { isLand } from '../utils/cardHelpers'

// Thresholds for splitting EDHREC inclusion into tiers. A card included in
// ≥40% of real decks for this commander is a STAPLE — non-negotiable. A card
// in 20-40% is a STRONG recommendation but not locked. Below 20% is "niche"
// and we let the LLM pick from the remaining pool.
const STAPLE_THRESHOLD = 0.40
const STRONG_THRESHOLD = 0.20

// Cap the locked skeleton size so the LLM still has meaningful agency over
// the deck. Above this we'd be telling the LLM "here's 70 locked cards, pick
// 8 more" — at which point the LLM contributes nothing.
const MAX_SKELETON_SIZE = 35

export function buildSkeleton({
  edhrecTopCards = [],
  legalCardPool = [],
  options = {},
}) {
  const stripLands = options.stripLands ?? true   // mana-base solver owns lands

  if (edhrecTopCards.length === 0) {
    return {
      staples: [],
      strong: [],
      explanation: ['No EDHREC data available — skeleton empty.'],
      stats: { skeletonSize: 0, strongCount: 0, source: 'edhrec' },
    }
  }

  const poolByName = new Map()
  for (const c of legalCardPool) poolByName.set(c.name.toLowerCase(), c)

  const staples = []
  const strong = []
  const seen = new Set()

  for (let rank = 0; rank < edhrecTopCards.length; rank++) {
    const top = edhrecTopCards[rank]
    if (!top?.name) continue
    const key = top.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const card = poolByName.get(key)
    if (!card) continue                          // not in user's legal pool
    if (stripLands && isLand(card)) continue     // mana base solver owns lands

    const inclusion = normalizeInclusion(top.inclusion)
    if (inclusion == null) continue              // EDHREC didn't give us a signal — skip

    const annotated = {
      ...card,
      edhrecInclusion: inclusion,
      edhrecRank: rank + 1,
      edhrecSynergy: top.synergy ?? null,
    }

    if (inclusion >= STAPLE_THRESHOLD && staples.length < MAX_SKELETON_SIZE) {
      staples.push(annotated)
    } else if (inclusion >= STRONG_THRESHOLD) {
      strong.push(annotated)
    }
  }

  const explanation = [
    `Skeleton: ${staples.length} EDHREC staples locked (≥${Math.round(STAPLE_THRESHOLD * 100)}% inclusion in real decks for this commander).`,
  ]
  if (strong.length > 0) {
    explanation.push(`+ ${strong.length} strong recommendations (${Math.round(STRONG_THRESHOLD * 100)}-${Math.round(STAPLE_THRESHOLD * 100)}% inclusion) surfaced to LLM.`)
  }

  return {
    staples,
    strong,
    explanation,
    stats: {
      skeletonSize: staples.length,
      strongCount: strong.length,
      source: 'edhrec',
    },
  }
}

// EDHREC's inclusion field shape is unstable — sometimes 0-1 decimal, sometimes
// 0-100 percentage. Normalize to 0-1.
function normalizeInclusion(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null
  if (value < 0) return null
  if (value <= 1) return value
  if (value <= 100) return value / 100
  return null   // out of expected range
}

// Counts skeleton cards by primary role. Used by the prompt builder to tell
// the LLM "you don't need to add more ramp — the skeleton already has 8."
export function skeletonRoleCounts(staples) {
  const counts = {}
  for (const card of staples) {
    const role = (card.roles ?? ['filler'])[0]
    counts[role] = (counts[role] ?? 0) + 1
  }
  return counts
}
