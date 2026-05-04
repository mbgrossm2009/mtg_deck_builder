// Builds the prompt sent to the LLM for deck generation.
//
// The LLM is the strategy/selection brain. Everything authoritative
// (legality, color identity, singleton, banned list, exact 99) is enforced
// by the local rules engine BEFORE and AFTER the call. The pool we pass in
// is already pre-filtered to legal cards for this commander/bracket, so
// the LLM cannot pick anything illegal even if it tries.

import { BRACKET_LABELS } from '../rules/bracketRules'

const BRACKET_DESCRIPTIONS = {
  1: 'Exhibition — ultra-casual, no fast mana, no tutors, no game-changers, no infinite combos.',
  2: 'Core — casual precon power. Limited tutors (land tutors only) and a few safe mana rocks (Sol Ring, Signet, Mind Stone).',
  3: 'Upgraded — FOCUSED, EFFICIENT, AND BUILT TO WIN. This is "upgraded precon", not "casual precon". A few tutors and game-changers are allowed. Prefer high-impact removal (Anguished Unmaking, Assassin\'s Trophy, Swords to Plowshares) over filler removal (Murder, Cancel, Naturalize). Prefer untapped color-fixing (shocks, fast lands, original duals, triomes) over always-tapped lands (gates, gain lands, tri-lands, bounce lands). Combos discouraged unless they double as the deck\'s win condition.',
  4: 'Optimized — high-power. Strong tutors, fast mana, and 2-card combos allowed.',
  5: 'Competitive (cEDH) — fastest viable lines, every tutor and combo on the table.',
}

// Catch-all role labels that the local classifier dumps most cards into.
// Sending these to the LLM creates false signal — the model can't tell what's
// core vs garbage when ~everything is "synergy" or "filler". Stripped before
// the pool is sent; the model evaluates uncategorized cards from oracle_text + tags.
const UNINFORMATIVE_ROLES = new Set(['synergy', 'filler'])

function meaningfulRoles(roles) {
  return (roles ?? []).filter(r => !UNINFORMATIVE_ROLES.has(r))
}

// Project the legal pool down to just the fields the LLM actually needs.
// Keeping each card lean keeps the prompt under context limits AND under
// Vercel's 60s function timeout. Oracle text is the biggest contributor —
// modal cards like Cryptic Command run 400+ chars; truncating to ~180
// preserves the first effect (which is usually the relevant one) while
// cutting prompt tokens roughly 60%. The roles/tags arrays already capture
// the gameplay shape — the LLM uses oracle_text mostly for tiebreakers.
const ORACLE_TEXT_BUDGET = 180

function compactCard(card) {
  const oracle = card.oracle_text ?? ''
  const out = {
    name: card.name,
    type_line: card.type_line ?? '',
    mana_cost: card.mana_cost ?? '',
    cmc: card.cmc ?? 0,
    color_identity: card.color_identity ?? [],
    oracle_text: oracle.length > ORACLE_TEXT_BUDGET
      ? oracle.slice(0, ORACLE_TEXT_BUDGET) + '…'
      : oracle,
  }
  const roles = meaningfulRoles(card.roles)
  if (roles.length > 0) out.roles = roles
  if (card.tags?.length > 0) out.tags = card.tags
  return out
}

// "ramp: 8, draw: 5, removal: 6" — used in skeleton context message so the
// LLM knows which roles are already covered.
function formatRoleCounts(counts) {
  if (!counts || Object.keys(counts).length === 0) return '(none)'
  return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')
}

function compactCommander(commander) {
  return {
    name: commander.name,
    type_line: commander.type_line ?? '',
    mana_cost: commander.mana_cost ?? '',
    cmc: commander.cmc ?? 0,
    color_identity: commander.color_identity ?? [],
    oracle_text: commander.oracle_text ?? '',
  }
}

// Detect commanders whose ability grants creature types to your board.
// With these, every tribal lord becomes a global anthem — Lord of Atlantis is
// "Other creatures you control get +1/+1" because every creature is a Merfolk.
// We surface this to the LLM as a flag so it knows to abuse tribal_lord cards.
function isTypeChangingCommander(commander) {
  const text = (commander?.oracle_text ?? '').toLowerCase()
  return (
    /are every creature type/.test(text) ||
    /is every creature type/.test(text) ||
    /(?:each|all) (?:other )?creatures? (?:you control )?(?:are|is) (?:all|every|a)/.test(text) ||
    /choose a creature type[^.]*creatures? you control (?:are|is)/.test(text)
  )
}

export function buildDeckGenerationPrompt({
  commander,
  legalCardPool,
  bracket,
  deckRules = {},
  strategyContext = {},
}) {
  const bracketLabel = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''

  const targets = deckRules.targetCounts ?? {}
  const landTarget = deckRules.landTarget ?? 37
  const nonLandSlots = deckRules.nonLandSlots ?? null   // when set, mana base is solver-locked
  const llmSlots     = deckRules.llmSlots ?? nonLandSlots   // slots after skeleton is locked
  const manaBaseStats = deckRules.manaBaseStats ?? null
  const skeletonStats = deckRules.skeletonStats ?? null

  const archetypes = strategyContext.archetypes ?? []
  const primaryArchetypeId = strategyContext.primaryArchetypeId ?? null
  const primaryArchetype = archetypes.find(a => a.id === primaryArchetypeId) ?? null
  const skeleton       = strategyContext.skeleton ?? []
  const skeletonStrong = strategyContext.skeletonStrong ?? []

  const manaBaseClause = nonLandSlots
    ? `\n\nMANA BASE LOCKED: The mana base for this deck (${landTarget} lands) has already been built deterministically by a constraint solver. You MUST NOT include any land in your "deck" output. The legal_card_pool below contains only spells.`
    : ''

  const skeletonClause = (skeletonStats?.size > 0)
    ? `\n\nSKELETON LOCKED (${skeletonStats.size} cards): A deck skeleton has been pre-built from two data sources: (1) EDHREC inclusion data — cards in 40%+ of all decks for this commander; (2) Moxfield consensus — cards appearing in 4+ of the 10 most-viewed top decks for this commander. These are real, vetted meta picks. They are LOCKED into the final deck. You MUST NOT include any of these in your output (the skeleton goes in automatically). Your job is to pick the remaining ${llmSlots} cards to round out the deck around them. The skeleton already covers: ${formatRoleCounts(skeletonStats.roleCounts)}. Cards confirmed by BOTH sources are the highest-confidence picks. Adjust your role targets accordingly — you only need to fill the gaps.`
    : ''

  const system = `You are an expert Magic: The Gathering Commander deck builder.

Your task is to build a highly optimized Commander deck using ONLY the cards provided.${manaBaseClause}${skeletonClause}

---

CRITICAL RULE (NON-NEGOTIABLE):

You may ONLY select cards from the provided "legal_card_pool".

- If a card is NOT in the legal_card_pool, you MUST NOT include it.
- Do NOT suggest upgrades outside the collection.
- Do NOT invent card names.
- Do NOT assume access to any cards not listed.

If the pool is weak or incomplete:
- still build the BEST possible deck from ONLY these cards
- explain weaknesses in the output

---

INPUTS:

You will receive:

1. Commander:
- name
- color_identity
- type_line
- oracle_text

2. Target Bracket (1–5)

3. Deck Structure Targets:
- lands (36–38)
- ramp (~10)
- draw (~10)
- removal (8–10)
- board wipes (2–4)
- protection (2–5)
- win conditions (2–4)

4. legal_card_pool:
Each card includes:
- name
- type_line
- oracle_text
- mana_cost
- cmc
- color_identity
- roles (optional)

---

STEP 1 — DETERMINE STRATEGY (MANDATORY)

Before choosing any cards, determine:

- primaryStrategy
- secondaryStrategy
- winPlan
- cardsToPrioritize
- cardsToAvoid

Use:
- commander abilities
- creature types
- patterns in the card pool

You MUST explicitly declare your chosen strategy before building the deck:

"Chosen Strategy: <clear 1–2 sentence plan>"

Put this exact statement in the "chosenStrategy" field of the output JSON.

If your final deck does not clearly follow this plan, it is incorrect.

---

STEP 2 — COMMIT TO ONE STRATEGY

You MUST commit to a single primary strategy.

RULE:
At least 60% of NON-LAND cards must directly support the primary strategy.

A card supports the strategy if it:
- synergizes with the commander
- advances the win condition
- supports the core mechanic
- protects the strategy
- enables the engine

If a card does NOT support the strategy:
→ DO NOT INCLUDE IT unless absolutely required

---

STEP 3 — BUILD CORE ENGINE

Select 15–25 core cards BEFORE building the full deck.

These should:
- strongly support the strategy
- synergize with each other
- represent the deck's identity

---

STEP 4 — BUILD THE DECK (ORDER)

Build in this order:

1. Core engine
2. Ramp
3. Card draw
4. Removal
5. Board wipes
6. Protection
7. Win conditions
8. Lands
9. Fill remaining slots ONLY with high-synergy cards

DO NOT:
- include random cards just to hit 99
- include off-theme filler
- include weak cards without synergy

---

STEP 5 — UNCATEGORIZED CARDS

Cards in the pool with no "roles" field are NOT pre-classified.

Evaluate them on their oracle_text, type_line, and tags.
- Include them ONLY if they advance the primary strategy or fill a critical role gap.
- A card without a clear role is presumed weak unless its text proves otherwise.
- Do NOT include uncategorized cards just to hit 99 — prefer leaving slots empty for the build order to handle.

---

STEP 6 — BRACKET RULES (HARD LIMITS — VIOLATIONS GET SWAPPED OUT)

The legal_card_pool you receive has ALREADY been filtered by bracket. If a
card you want isn't in the pool, that's intentional — the pool excluded it
because it overshoots the target bracket. DO NOT invent cards to fill gaps.

Bracket 1 (Exhibition):
- NO game changers, NO fast mana, NO tutors, NO infinite combos
- Casual / janky decks; fun > optimization

Bracket 2 (Core / precon):
- NO game changers (Sol Ring/Arcane Signet exempt — they're in every precon)
- NO fast mana beyond Sol Ring
- NO tutors except land tutors (Cultivate, Farseek, etc.)
- NO infinite combos

Bracket 3 (Upgraded — most common bracket):
- HARD CAP: 3 game changers max per WotC's bracket spec.
  Common B3 game-changer staples (Smothering Tithe, Fierce Guardianship,
  Drannith Magistrate, etc.) — pick at most 3 across the entire deck.
- HARD CAP: 2 non-safe-rock fast-mana pieces max.
  (Sol Ring + Arcane Signet are always allowed; pieces like Mind Stone /
  Talismans / Signets count as "safe.")
- HARD CAP: 3 non-soft tutors max.
- NO 2-card infinite combos, NO mass land destruction without an immediate
  win, NO chained extra-turn loops.
- Demonic Tutor / Vampiric Tutor / Force of Will / Mana Drain / Rhystic
  Study are ALREADY filtered out at B3 — they belong to B4+.

Bracket 4 (Optimized):
- Tutors allowed (target 6-8). Fast mana allowed (target 6-10).
- Combos allowed if the deck is built around protecting them.
- Premium B4 staples (Force of Will, Mana Drain, Rhystic Study, Demonic
  Tutor, Vampiric Tutor) ARE in the pool — use them when on-strategy.

Bracket 5 (cEDH):
- Maximize tutors (10-15), fast mana (10-12), and protected combo wincons.
- Lower land count (24-28) is correct — fast mana + rituals fill the gap.
- Every slot must earn it; no off-plan goodstuff.

---

STEP 7 — OPTIMIZATION

Do NOT return the first valid deck.

Internally consider multiple builds and return the BEST one.

Optimize for:
- synergy density
- strategy clarity
- role balance
- mana curve
- bracket fit
- win consistency

---

STEP 8 — CUT PASS (MANDATORY)

After building your deck, do NOT stop. Run a brutal cleanup pass.

Walk through every NON-LAND card you included and ask:

1. Does this card directly advance the Chosen Strategy?
2. If not, does it fill a critical role (ramp / draw / removal / wipe / protection / win condition) that nothing better can?
3. If neither: CUT IT.

For every card you cut:
- Replace it with a higher-synergy card from the legal_card_pool, OR
- Replace it with a basic land if no better option exists in the pool.

Be ruthless. A focused 95-card deck padded with 4 basics beats a 99-card pile of "good cards."

Cards that survive the cut pass MUST be in your final "deck" output.
Cards that were cut MUST NOT appear anywhere in the output.

If you couldn't find a strong replacement for a cut, list the gap in "warnings".

---

STEP 9 — WIN CONDITION VALIDATION (MANDATORY)

For each win condition included, you MUST prove it is real.

Explain EXACTLY how the deck wins using it. Include:
- required board state
- number of turns to win (estimate)
- key supporting cards

If a win condition is vague, inconsistent, or unrealistic:
→ REMOVE IT and replace it with a real one.

A deck without a clear and executable win plan is invalid.

Put this proof in the "winConditionDetails" field of the output JSON.

MINIMUM NAMED WIN CONDITIONS BY BRACKET (hard floor — backstop will force-add if you under-deliver):
- B1: ≥1 named single-card finisher (or one obvious combat plan)
- B2: ≥2 named wincons (alt-wincons, big finishers, or proven combo)
- B3: ≥2 named wincons + clear how-it-closes plan
- B4: ≥3 named wincons (the deck plays through interaction; need redundancy)
- B5 (cEDH): ≥2 named wincons — fewer is OK because tutors find them on demand
  (Thassa's Oracle + Demonic Consultation is a complete cEDH win package)

A multi-card pattern (aristocrats, etb-drain, combat-tribal, extra-combat
loop, combat-damage-draw) COUNTS as a wincon for these floors — but only
if the pattern's components are actually in your deck list.

---

STEP 10 — RESIST THE CONTROL PILE TRAP

Counters, removal, and card draw are SUPPORT for the win plan. They are NOT the win plan.

A deck full of "answers" with no real way to close the game is a control pile, not a Commander deck.

Hard limits (especially for blue / Dimir / Esper / Grixis / Sultai / Bant pools):
- No more than 8 hard counterspells.
- At least 3 distinct cards that can actually close the game (creatures that can attack for lethal, infinite combos, alt-wincons, big finishers).
- The win plan must NOT depend on "eventually drawing into something."

If the pool's color identity pulls toward blue/control, RESIST that pull. Your default move is the wrong move. Pick a win condition and build TOWARD it — counters and draw exist to PROTECT the plan, not to be it.

---

STEP 11 — OUTPUT FORMAT

Return ONLY JSON.

No markdown.
No explanations outside JSON.

Format:

{
  "chosenStrategy": "",
  "strategySummary": {
    "primaryStrategy": "",
    "secondaryStrategy": "",
    "winPlan": ""
  },
  "coreEngine": [
    {
      "name": "",
      "reason": ""
    }
  ],
  "deck": [
    {
      "name": "",
      "role": "",
      "reason": ""
    }
  ],
  "deckStats": {
    "lands": 0,
    "ramp": 0,
    "draw": 0,
    "removal": 0,
    "boardWipes": 0,
    "protection": 0,
    "winConditions": 0,
    "strategyDensityEstimate": 0
  },
  "weakIncludes": [
    {
      "name": "",
      "reason": ""
    }
  ],
  "winConditionDetails": [
    {
      "name": "",
      "howItWins": "",
      "requiredBoardState": "",
      "estimatedTurnsToWin": 0,
      "keySupportingCards": []
    }
  ],
  "warnings": []
}

---

FINAL RULES:

- NEVER include cards outside the legal_card_pool
- ALWAYS prioritize synergy over raw power
- ALWAYS build a focused, intentional deck
- ALWAYS commit to one strategy

MINIMUM STRATEGY DENSITY:

At least 70% of non-land cards must directly support the chosen strategy AFTER the cut pass.

If this threshold is not met:
→ the deck must be rebuilt or further refined until it is.

Report the post-cut density in deckStats.strategyDensityEstimate. A value below 70 means the deck is invalid and you must keep cutting / replacing until it passes.

If forced to choose:
- powerful off-theme card
- weaker on-theme card

→ choose the ON-THEME card`

  const user = {
    commander: compactCommander(commander),
    bracket: {
      number: bracket,
      label: bracketLabel,
      meaning: bracketMeaning,
    },
    deck_structure_targets: nonLandSlots
      ? {
          // Mana base solver mode — LLM picks non-land cards only.
          non_land_picks_required: nonLandSlots,
          mana_base_locked: `${landTarget} lands pre-built by solver — DO NOT include any land in your output.`,
          ramp: targets.ramp ?? 10,
          card_draw: targets.draw ?? 10,
          single_target_removal: targets.removal ?? 9,
          board_wipes: targets.wipe ?? 4,
          protection: targets.protection ?? 3,
          win_conditions: targets.win_condition ?? 2,
          tutors_allowed: targets.tutor ?? 0,
          synergy_pieces: targets.synergy ?? 20,
          notes: 'Hit non-role targets within ±2. The mana base is solver-locked — do NOT include lands.',
        }
      : {
          total_cards: 99,
          lands: landTarget,
          ramp: targets.ramp ?? 10,
          card_draw: targets.draw ?? 10,
          single_target_removal: targets.removal ?? 9,
          board_wipes: targets.wipe ?? 4,
          protection: targets.protection ?? 3,
          win_conditions: targets.win_condition ?? 2,
          tutors_allowed: targets.tutor ?? 0,
          synergy_pieces: targets.synergy ?? 20,
          notes: 'Targets are guidance, not exact. Hit them within ±2 unless your strategy demands otherwise (e.g. tribal decks lean heavy on synergy).',
        },
    detected_archetypes: archetypes.map(a => ({
      id: a.id,
      label: a.label,
      strength: a.strength ?? null,
      isPrimary: primaryArchetype?.id === a.id,
    })),
    legal_card_pool: legalCardPool.map(compactCard),
    pool_size: legalCardPool.length,
  }

  if (manaBaseStats) {
    user.solved_mana_base = {
      land_count: landTarget,
      sources_per_color: manaBaseStats.sourcesPerColor,
      tier_breakdown: manaBaseStats.byTier,
      note: 'These mana sources are guaranteed. Use them when reasoning about color requirements for spells.',
    }
  }

  if (skeleton.length > 0) {
    user.locked_skeleton = {
      count: skeleton.length,
      cards: skeleton.map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        edhrec_inclusion_pct:    c.edhrecInclusion    != null ? Math.round(c.edhrecInclusion    * 100) : null,
        moxfield_top_decks_pct:  c.moxfieldFrequency  != null ? Math.round(c.moxfieldFrequency  * 100) : null,
        sources: c.sources ?? null,
      })),
      note: 'These cards are LOCKED into the final deck. DO NOT include them in your output — they are added automatically. Build around them.',
    }
  }
  if (skeletonStrong.length > 0) {
    user.skeleton_strong_recommendations = {
      count: skeletonStrong.length,
      note: 'Cards with 20-40% inclusion in real decks for this commander. Strongly preferred but not locked — pick from these first when filling role gaps.',
      cards: skeletonStrong.slice(0, 30).map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        edhrec_inclusion_pct:    c.edhrecInclusion    != null ? Math.round(c.edhrecInclusion    * 100) : null,
        moxfield_top_decks_pct:  c.moxfieldFrequency  != null ? Math.round(c.moxfieldFrequency  * 100) : null,
        sources: c.sources ?? null,
      })),
    }
  }

  // Strategy directive: only include when the user has explicitly locked one.
  // When unlocked, leave it out entirely so STEP 1 of the prompt drives strategy
  // determination — a vague "do your best" line here would undermine that step
  // and make the model hedge.
  if (primaryArchetype) {
    user.primary_strategy = `PRIMARY STRATEGY (LOCKED BY USER): ${primaryArchetype.label}. Build the deck around this. At least 60% of NON-LAND cards must directly support it. Other detected archetypes are secondary at most.`
  }

  return { system, user }
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO-PASS GENERATION
// ─────────────────────────────────────────────────────────────────────────────
// The single-pass prompt above asks the LLM to do everything in one shot:
// determine strategy, build the engine, build the 99, validate, cut. In practice
// the model hedges on strategy mid-build, drifts off-theme, and produces "safe"
// piles of good cards.
//
// Two-pass forces the model to commit before it builds:
//   Pass 1: pick the strategy + 15-25 core engine cards + cards to avoid.
//   Pass 2: build the full 99 with Pass 1's choices LOCKED IN as constraints.
//
// The model can't waffle on strategy in Pass 2 because the strategy is fixed
// input, not something it's still deciding.

// Pass 1 — strategy commitment + core engine selection.
// Short prompt, simpler ask, lower hedge risk.
export function buildPass1Prompt({
  commander,
  legalCardPool,
  bracket,
  strategyContext = {},
}) {
  const bracketLabel   = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''

  const archetypes        = strategyContext.archetypes ?? []
  const primaryArchetypeId = strategyContext.primaryArchetypeId ?? null
  const primaryArchetype  = archetypes.find(a => a.id === primaryArchetypeId) ?? null
  const typeChanging      = isTypeChangingCommander(commander)
  const skeleton          = strategyContext.skeleton ?? []

  const skeletonClause1 = (skeleton.length > 0)
    ? `\n\nDECK SKELETON ALREADY LOCKED (${skeleton.length} cards): The system has pre-locked ${skeleton.length} cards from EDHREC inclusion data + Moxfield top-deck consensus — these are real meta picks for this commander that will appear in the final deck regardless of your output. Use this as context when choosing your strategy and core engine. Your coreEngine list should COMPLEMENT the skeleton (don't re-list cards already locked) — pick the strategic anchors that the skeleton doesn't cover.`
    : ''

  const system = `You are an expert Magic: The Gathering Commander deck builder.

This is PASS 1 of a TWO-PASS deck-build process.${skeletonClause1}

You are NOT building the full 99-card deck yet. Your only job in Pass 1 is to:
- DECIDE the strategy
- SELECT the core engine
- IDENTIFY the cards that should be prioritized and the cards that should be avoided

Pass 2 will build the full deck around the choices you make here. Your Pass 1 output becomes LOCKED INPUT for Pass 2 — be deliberate.

---

CRITICAL RULE (NON-NEGOTIABLE):

You may ONLY reference cards from the provided "legal_card_pool".
- Do NOT invent cards.
- Do NOT recommend cards outside the pool.

---

INPUTS:

1. Commander (name, color_identity, type_line, oracle_text)
2. Target Bracket (1–5)
3. detected_archetypes — hints from the local classifier (advisory only)
4. legal_card_pool — every card has name, type_line, oracle_text, mana_cost, cmc, color_identity. Cards may have "roles" (deck-structure roles like ramp/draw/removal/wipe) and "tags" (mechanic tags like token_producer, sac_outlet, recursion, etc.). Use the tags as strong signal — they are precomputed mechanic detections.

---

STEP 1 — DETERMINE STRATEGY (MANDATORY)

Examine the commander's abilities, type, and the patterns in the legal_card_pool. Determine:

- primaryStrategy
- secondaryStrategy
- winPlan
- cardsToPrioritize (categories, not card names — you'll list specific cards in STEP 3)
- cardsToAvoid (categories — you'll list specific cards in STEP 4)

Then declare your commitment:

"Chosen Strategy: <clear 1–2 sentence plan>"

Put this exact statement in the "chosenStrategy" field of the output JSON.

If your plan hedges, is generic, or doesn't commit — it is incorrect. Pick something specific the deck can be measured against.

---

STEP 2 — SELECT CORE ENGINE (15–25 CARDS)

Pick the 15-25 cards from the legal_card_pool that BEST represent the deck's identity. These are non-negotiable inclusions — Pass 2 will be required to put them in the deck.

Each core engine card MUST satisfy at least one of:
- It wins the game on its own or in combination with the commander.
- It is a tier-1 piece of the chosen engine that the deck cannot function without.
- It costs ≤3 mana and generates recurring value (cantrip ramp, draw engine, sac outlet, etc.).

NO "FINE" CARDS IN THE CORE ENGINE.
- A 4-mana 4/4 vanilla creature is not core. A 4-mana finisher that ends the game IS core.
- A generic 1-card draw spell is not core. A draw engine that recurs every turn IS core.
- "Playable" is not enough. "Critical" is the bar.

REQUIRED CORE ENGINE FLOOR (apply when applicable to the strategy):
- ≥1 card tagged "explosive_finisher" or "mass_pump" — every deck needs an "I win now" moment, not just inevitability.
- ≥3 cards tagged "commander_protection" if the deck depends on the commander to function (most do). The deck slows HARD when the commander dies repeatedly.
- ≥5 cards tagged "tribal_lord" if the commander grants creature types to your board (Omo, Maskwood Nexus, Mistform Ultimus, Arcane Adaptation). With type-changing commanders, every "Other Goblins you control get +1/+1" effect becomes a global anthem — these are the abuse cards that make the commander broken.

Use the "tags" field on each card in the pool to find these — the tags are precomputed mechanic detections, not guesses.

Do NOT pick generic good-stuff. Every core engine card should make sense in THIS deck and only this deck.

---

STEP 3 — PRIORITIZE NEXT-TIER CARDS (30–60)

List the next tier of cards from the pool that strongly support the chosen strategy and should be considered for the 99 in Pass 2. These are not locked in — Pass 2 chooses among them. Don't try to fit 99 cards here. Just rank what's important.

For each, give a short reason ("strong on-theme", "covers a role gap", "anti-meta tech", etc).

---

STEP 4 — IDENTIFY CARDS TO AVOID

List specific cards from the legal_card_pool that look tempting but should NOT be in the final deck. Reasons can include:
- off-strategy (tempting but doesn't advance the plan)
- weaker than alternatives in the same role
- pulls the deck toward a control pile when a wincon is needed
- conflicts with the chosen strategy

Pass 2 will be told to exclude these.

---

STEP 5 — RESIST THE CONTROL PILE TRAP

If the commander's color identity leans blue / Dimir / Esper / Grixis / Sultai / Bant, the natural pull is toward counters + draw + stall with no real win plan. RESIST this pull.

Your chosenStrategy must include a CONCRETE WIN CONDITION. Counters and draw are SUPPORT, not the plan. If your chosenStrategy reads "control the board with counters and draw to inevitability," it is wrong — name the inevitability.

---

OUTPUT FORMAT (JSON only — no markdown, no commentary):

{
  "chosenStrategy": "",
  "strategySummary": {
    "primaryStrategy": "",
    "secondaryStrategy": "",
    "winPlan": ""
  },
  "coreEngine": [
    { "name": "", "reason": "" }
  ],
  "cardsToPrioritize": [
    { "name": "", "reason": "" }
  ],
  "cardsToAvoid": [
    { "name": "", "reason": "" }
  ],
  "warnings": []
}

---

FINAL RULES:

- Every "name" in coreEngine, cardsToPrioritize, and cardsToAvoid MUST appear verbatim in legal_card_pool.
- coreEngine MUST contain 15–25 cards.
- cardsToPrioritize MUST contain 30–60 cards.
- chosenStrategy MUST commit to a specific plan. If you can't, the pool can't support a deck and you should say so in warnings.`

  const user = {
    commander: compactCommander(commander),
    bracket: {
      number: bracket,
      label: bracketLabel,
      meaning: bracketMeaning,
    },
    detected_archetypes: archetypes.map(a => ({
      id: a.id,
      label: a.label,
      strength: a.strength ?? null,
      isPrimary: primaryArchetype?.id === a.id,
    })),
    legal_card_pool: legalCardPool.map(compactCard),
    pool_size: legalCardPool.length,
  }

  if (skeleton.length > 0) {
    user.locked_skeleton = {
      count: skeleton.length,
      cards: skeleton.map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        edhrec_inclusion_pct:    c.edhrecInclusion    != null ? Math.round(c.edhrecInclusion    * 100) : null,
        moxfield_top_decks_pct:  c.moxfieldFrequency  != null ? Math.round(c.moxfieldFrequency  * 100) : null,
        sources: c.sources ?? null,
      })),
      note: 'These cards are LOCKED into the final deck. Build your strategy and core engine around them.',
    }
  }

  if (primaryArchetype) {
    user.primary_strategy = `PRIMARY STRATEGY (LOCKED BY USER): ${primaryArchetype.label}. Your chosenStrategy must commit to this archetype. coreEngine must reflect it.`
  }

  if (typeChanging) {
    user.commander_type_changing = `TYPE-CHANGING COMMANDER: this commander grants creature types to your board. Every "Other [type]s you control get +X/+X" effect (cards tagged "tribal_lord") becomes a global anthem. Tribal lords are abuse cards here — your coreEngine MUST contain ≥5 of them. Find them by filtering legal_card_pool for tags including "tribal_lord".`
  }

  return { system, user }
}

// Pass 2 — build the full 99 with Pass 1's choices locked in.
// Takes the parsed Pass 1 JSON and folds it in as fixed constraints.
export function buildPass2Prompt({
  commander,
  legalCardPool,
  bracket,
  deckRules = {},
  strategyContext = {},
  pass1Output,
}) {
  const bracketLabel   = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''
  const targets        = deckRules.targetCounts ?? {}
  const landTarget     = deckRules.landTarget ?? 37
  const nonLandSlots   = deckRules.nonLandSlots ?? null
  const llmSlots       = deckRules.llmSlots ?? nonLandSlots
  const manaBaseStats  = deckRules.manaBaseStats ?? null
  const skeletonStats  = deckRules.skeletonStats ?? null
  const skeleton       = strategyContext.skeleton ?? []
  const skeletonStrong = strategyContext.skeletonStrong ?? []

  const manaBaseClause = nonLandSlots
    ? `\n\nMANA BASE LOCKED: A constraint solver has already built the mana base (${landTarget} lands). You MUST NOT include any land in your output. The legal_card_pool below contains only spells.`
    : ''

  const skeletonClause = (skeletonStats?.size > 0)
    ? `\n\nSKELETON LOCKED (${skeletonStats.size} cards): A deck skeleton has been pre-built from EDHREC inclusion data + Moxfield top-deck consensus. These are real, vetted meta picks for this commander. They are LOCKED into the final deck. You MUST NOT include any of these in your output (they're added automatically). Your job is to pick the remaining ${llmSlots} cards. The skeleton already covers: ${formatRoleCounts(skeletonStats.roleCounts)}. Adjust your role targets — you only need to fill the gaps.`
    : ''

  const system = `You are an expert Magic: The Gathering Commander deck builder.

This is PASS 2 of a two-pass deck-build process. Pass 1 already determined the strategy and selected the core engine. Your job is to BUILD ${llmSlots ? `THE ${llmSlots} REMAINING CARDS` : 'THE FULL 99-CARD DECK'} around those locked-in choices.${manaBaseClause}${skeletonClause}

---

LOCKED INPUTS FROM PASS 1 (YOU CANNOT CHANGE THESE):

- chosenStrategy — your deck must clearly follow this plan.
- coreEngine — every card in this list MUST appear in your final deck. No exceptions.
- cardsToAvoid — none of these cards may appear in the deck.

If you disagree with Pass 1's choices, build the best deck you can within them anyway. You may NOT renegotiate the strategy or substitute core engine cards. Re-running Pass 1 is the user's responsibility, not yours.

---

CRITICAL RULE (NON-NEGOTIABLE):

You may ONLY pick cards from the provided "legal_card_pool".
- Do NOT invent cards.
- Do NOT include cards outside the pool.
- Do NOT include cards from cardsToAvoid.

---

INPUTS:

1. Commander
2. Target Bracket
3. Deck Structure Targets (lands ~37, ramp ~10, draw ~10, removal 8–10, wipes 2–4, protection 2–5, wincons 2–4)
4. legal_card_pool (with mechanic tags)
5. pass1 — the locked output from Pass 1 (chosenStrategy, coreEngine, cardsToPrioritize, cardsToAvoid)

---

STEP 1 — VERIFY THE LOCKED STRATEGY

Read pass1.chosenStrategy. Internally restate it. Every choice you make must serve this plan.

If pass1 is missing or malformed, return a warning and stop.

---

STEP 2 — SEED THE DECK WITH THE CORE ENGINE

Place every card from pass1.coreEngine into the deck FIRST. These are locked in. Do NOT skip any. If a core engine card isn't in the legal_card_pool (shouldn't happen, but check), surface it in warnings.

After this step, you should have ~15-25 cards committed and ~74-84 slots remaining.

---

STEP 3 — FILL ROLE GAPS (BUILD ORDER)

Fill the remaining NON-LAND slots in this order:

1. Ramp (target ~10) — prefer cards in pass1.cardsToPrioritize first, then anything else from the pool.
2. Card draw (target ~10)
3. Removal (target 8–10)
4. Board wipes (target 2–4)
5. Protection (target 2–5)
6. Win conditions (target 2–4) — note that some core engine cards may already be wincons.
7. Remaining slots — high-synergy cards from pass1.cardsToPrioritize that aren't already in.

The mana base is built separately by a deterministic solver. DO NOT include any land in your output — the legal_card_pool below contains only spells.

DO NOT include random off-theme cards just to hit the slot count. Every slot must serve the chosen strategy or fill a critical role gap.

---

STEP 4 — BRACKET RULES

Bracket 1–2: avoid tutors, fast mana, combos.
Bracket 3:   FOCUSED AND EFFICIENT — "upgraded precon", not "casual precon". Up to 3 tutors. A few game-changers allowed. Prefer high-impact removal (Anguished Unmaking, Assassin's Trophy, Swords to Plowshares, Beast Within) over filler (Murder, Cancel, Naturalize, Scorching Dragonfire). Combos discouraged unless they double as the wincon.
Bracket 4–5: tutors, fast mana, and combos allowed. Optimize aggressively.

LAND QUALITY (applies at every bracket above 1):
Prefer UNTAPPED color-fixing — fetches, shocks, original duals, fast lands, triomes, painlands — over always-tapped fixing — guildgates, gain lands ("X Refuge"), tri-lands, bounce lands ("Karoos"). Tapped lands are fine when they bring real value (scry, draw, recursion, search). Tapped lands that only produce mana are a downgrade vs. a basic — pick the basic.

---

STEP 5 — CUT PASS (MANDATORY)

After building, walk every NON-LAND, NON-CORE-ENGINE card and ask:
1. Does this card directly advance the chosenStrategy?
2. If not, does it fill a critical role gap that nothing better in the pool can?
3. If neither: CUT IT and replace with a better card from pass1.cardsToPrioritize, or a basic land if nothing fits.

A focused 95-card deck padded with 4 basics beats a 99-card pile of "good cards."

Cards that survive the cut pass MUST be in your final "deck" output. Cards that were cut MUST NOT appear anywhere in the output.

---

STEP 6 — WIN CONDITION VALIDATION

For every win condition in the deck, prove it. Required board state, estimated turns to win, key supporting cards. A deck without an executable win plan is invalid. Put proofs in winConditionDetails.

---

STEP 7 — RESIST THE CONTROL PILE TRAP

≤8 hard counterspells. ≥3 distinct cards that can actually close the game. Win plan must NOT depend on "eventually drawing into something." Pass 1 already chose a real wincon — make sure the deck can execute it.

---

STEP 8 — OUTPUT FORMAT (JSON ONLY)

{
  "chosenStrategy": "",
  "strategySummary": {
    "primaryStrategy": "",
    "secondaryStrategy": "",
    "winPlan": ""
  },
  "coreEngine": [
    { "name": "", "reason": "" }
  ],
  "deck": [
    { "name": "", "role": "", "reason": "" }
  ],
  "deckStats": {
    "lands": 0,
    "ramp": 0,
    "draw": 0,
    "removal": 0,
    "boardWipes": 0,
    "protection": 0,
    "winConditions": 0,
    "strategyDensityEstimate": 0
  },
  "weakIncludes": [
    { "name": "", "reason": "" }
  ],
  "winConditionDetails": [
    {
      "name": "",
      "howItWins": "",
      "requiredBoardState": "",
      "estimatedTurnsToWin": 0,
      "keySupportingCards": []
    }
  ],
  "warnings": []
}

The chosenStrategy and coreEngine fields in the output should be IDENTICAL to pass1's. Echoing them back proves you respected the lock.

---

FINAL RULES:

- NEVER include cards outside legal_card_pool.
- NEVER include cards from pass1.cardsToAvoid.
- NEVER include any land in your output — the mana base is solver-locked.
- ALWAYS include every card from pass1.coreEngine.
- The "deck" array must contain exactly the non_land_picks_required count from deck_structure_targets (when present), otherwise 99.
- Singleton: each non-basic card appears at most once.

MINIMUM STRATEGY DENSITY:

At least 70% of non-land cards must directly support the chosenStrategy after the cut pass.

If below 70 → keep cutting / replacing until it passes. Report the post-cut density in deckStats.strategyDensityEstimate.`

  const user = {
    commander: compactCommander(commander),
    bracket: {
      number: bracket,
      label: bracketLabel,
      meaning: bracketMeaning,
    },
    deck_structure_targets: nonLandSlots
      ? {
          non_land_picks_required: nonLandSlots,
          mana_base_locked: `${landTarget} lands pre-built by solver — DO NOT include any land in your output.`,
          ramp: targets.ramp ?? 10,
          card_draw: targets.draw ?? 10,
          single_target_removal: targets.removal ?? 9,
          board_wipes: targets.wipe ?? 4,
          protection: targets.protection ?? 3,
          win_conditions: targets.win_condition ?? 2,
          tutors_allowed: targets.tutor ?? 0,
          synergy_pieces: targets.synergy ?? 20,
          notes: 'Hit non-role targets within ±2. The mana base is solver-locked — do NOT include lands.',
        }
      : {
          total_cards: 99,
          lands: landTarget,
          ramp: targets.ramp ?? 10,
          card_draw: targets.draw ?? 10,
          single_target_removal: targets.removal ?? 9,
          board_wipes: targets.wipe ?? 4,
          protection: targets.protection ?? 3,
          win_conditions: targets.win_condition ?? 2,
          tutors_allowed: targets.tutor ?? 0,
          synergy_pieces: targets.synergy ?? 20,
          notes: 'Targets are guidance, not exact. Hit them within ±2 unless your strategy demands otherwise.',
        },
    pass1: pass1Output,
    legal_card_pool: legalCardPool.map(compactCard),
    pool_size: legalCardPool.length,
  }

  if (manaBaseStats) {
    user.solved_mana_base = {
      land_count: landTarget,
      sources_per_color: manaBaseStats.sourcesPerColor,
      tier_breakdown: manaBaseStats.byTier,
      note: 'These mana sources are guaranteed. Use them when reasoning about color requirements for spells.',
    }
  }

  if (skeleton.length > 0) {
    user.locked_skeleton = {
      count: skeleton.length,
      cards: skeleton.map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        edhrec_inclusion_pct:    c.edhrecInclusion    != null ? Math.round(c.edhrecInclusion    * 100) : null,
        moxfield_top_decks_pct:  c.moxfieldFrequency  != null ? Math.round(c.moxfieldFrequency  * 100) : null,
        sources: c.sources ?? null,
      })),
      note: 'These cards are LOCKED into the final deck. DO NOT include them in your output — they are added automatically.',
    }
  }
  if (skeletonStrong.length > 0) {
    user.skeleton_strong_recommendations = {
      count: skeletonStrong.length,
      note: 'Cards with 20-40% inclusion in real decks. Pick from these first when filling role gaps.',
      cards: skeletonStrong.slice(0, 30).map(c => ({
        name: c.name,
        role: (c.roles ?? ['filler'])[0],
        edhrec_inclusion_pct:    c.edhrecInclusion    != null ? Math.round(c.edhrecInclusion    * 100) : null,
        moxfield_top_decks_pct:  c.moxfieldFrequency  != null ? Math.round(c.moxfieldFrequency  * 100) : null,
        sources: c.sources ?? null,
      })),
    }
  }

  return { system, user }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 — CRITIQUE
// ─────────────────────────────────────────────────────────────────────────────
// Self-evaluation pass. The deck has been assembled (mana base + skeleton +
// LLM picks + heuristic fill + wincon backstop). Now we ask the model: "is
// this a strong deck for this commander at this bracket?" If no, it returns
// up to 5 specific swaps. We validate every swap (in pool, not already in
// deck, not swapping out a locked card) and apply the valid ones.
//
// Single-shot only — no iteration. Iterating could oscillate (swap A→B
// then on next pass swap B→A). One pass catches the worst picks; further
// refinement is the user's call.

export function buildCritiquePrompt({
  commander,
  bracket,
  deck,                 // [{ name, role, locked: bool, source?: 'manaSolver'|'skeleton'|'llm'|'fallback' }]
  availablePool,        // cards in user's legal collection but NOT in the deck
  chosenStrategy = '',
}) {
  const bracketLabel   = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''

  const system = `You are an expert Magic: The Gathering Commander deck evaluator.

A 99-card deck has been built for the commander below. The mana base, EDHREC
staples, and core role slots are already filled. Your job is to perform a
final critique pass.

EVALUATE THE DECK against these questions:
  1. Does this look like a strong, focused ${bracketLabel} deck for this commander?
  2. Are there low-impact filler cards that should be replaced with better picks
     from the available_pool? (Murder vs. Anguished Unmaking, Cancel vs.
     Counterspell, Final Punishment vs. Damnation, etc.)
  3. Does the deck have a clear win condition? Will it actually close games?
  4. Are there obvious synergy gaps the deck should fill?
  5. Are there cards that are off-strategy and should be cut for on-theme picks?

OUTPUT ONE OF TWO SHAPES:

If the deck is strong as-is:
{
  "approved": true,
  "summary": "<1-2 sentence positive evaluation>"
}

If the deck has issues:
{
  "approved": false,
  "summary": "<1-2 sentence diagnosis>",
  "swaps": [
    { "out": "<card name in deck>", "in": "<card name from available_pool>", "reason": "<why this is an upgrade>" }
  ]
}

CRITICAL CONSTRAINTS ON SWAPS:
- Maximum 5 swaps total. Quality over quantity. Pick the highest-impact ones.
- "out" MUST be a card currently in the deck. Check the deck list below.
- "out" MUST NOT have locked: true. Locked cards (mana base + EDHREC skeleton)
  stay in the deck — do not propose swapping them out.
- "in" MUST be a card from available_pool. Do NOT invent cards or suggest
  upgrades the user doesn't own.
- "in" MUST NOT already be in the deck.
- Each swap should be a CLEAR upgrade for the deck's strategy and bracket
  target. If you can't justify a swap with a concrete reason, don't propose it.

If you can't find any high-confidence swaps, return approved: true. A clean
"this deck is fine" is more useful than 5 marginal swaps that don't actually
improve the deck.

Return ONLY JSON. No markdown.`

  const user = {
    commander: compactCommander(commander),
    bracket: {
      number: bracket,
      label: bracketLabel,
      meaning: bracketMeaning,
    },
    chosen_strategy: chosenStrategy || '(strategy was not declared)',
    deck: deck.map(c => ({
      name: c.name,
      role: c.role ?? (c.roles ?? ['filler'])[0],
      locked: !!c.locked,
      source: c.source ?? null,
    })),
    available_pool: availablePool.map(compactCard),
    available_pool_size: availablePool.length,
  }

  return { system, user }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVALUATION (separate from CRITIQUE)
// ─────────────────────────────────────────────────────────────────────────────
// Critique tries to FIX a deck (proposes swaps). Evaluation just SCORES it
// and reports strengths/weaknesses. Used by the eval harness to grade
// many generations across many commanders without trying to mutate them.

export function buildEvaluationPrompt({ commander, bracket, deck, lensResults }) {
  const bracketLabel   = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''

  const system = `You are an expert Magic: The Gathering Commander deck evaluator.

A 99-card deck has been built for the commander below at the target bracket.
Your job: SCORE the deck and identify its strengths and weaknesses. You are
NOT proposing swaps — only judging.

═══════════════════════════════════════════════════════════════════════════
USE THE \`lens_verdicts\` BLOCK AT THE TOP OF THE USER PAYLOAD.
The deck-builder already analyzed this deck across multiple dimensions
(commander_execution, win_plan, bracket_fit, mana_base) and produced
verdicts with evidence (per-card facts) and suggestions. DO NOT recount
tutors, wincons, removal, or anything else by reading the card list
yourself — your eyeball count consistently misses soft tutors and
multi-card patterns.

If \`win_plan\` lists a detected pattern in its evidence
("aristocrats: sac outlet + Blood Artist" or "etb-drain: token producer
+ Impact Tremors" or "combat-tribal: 4 lords + 22 vampires"), the deck
HAS a win plan. Do NOT write "no clear win condition" — describe the
pattern as the win plan instead.

If \`commander_execution\` reports 65% on-plan, do NOT invent a lower
number from your own card-list eyeball.

WRONG (do NOT do this):
  lens reports score 0.65, but evaluator writes:
    "Only 4 cards advance the strategy" (invented from card-name eyeball)
  ❌

RIGHT:
  lens reports score 0.65 with evidence "24 of 37 on plan", evaluator:
    "65% commander-relevant — solid for B3, room to push higher for B5"
  ✓ Trusts the lens evidence, focuses critique on actual gaps.
═══════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════
LENS VERDICTS — the user payload includes a \`lens_verdicts\` array at
the top. Each entry is a structured verdict from one analysis lens
(commander_execution, win_plan, bracket_fit, mana_base) that our system
has ALREADY computed. Each verdict includes:

  - lens:        which lens
  - verdict:     'pass' | 'warn' | 'fail' | 'info'
  - score:       0-1 fraction
  - summary:     one-line human-readable
  - evidence:    per-card facts ({ kind, card?, detail })
  - suggestions: actionable improvements

Your job as evaluator is to GRADE OUR ANALYSIS, not redo it from scratch.
If \`win_plan.verdict === 'fail'\`, the deck genuinely has no plan — your
score must reflect that. If \`bracket_fit.verdict === 'fail'\`, the deck
overshoots its target bracket — call that out. The lens evidence array
gives you specific cards to cite — use those names directly.

WRONG: ignoring a 'fail' verdict and writing "this deck looks well-tuned."
RIGHT: "the bracket_fit lens flags X cards bumping this deck to bracket
        Y; the deck does not meet the requested bracket."

LENS-HONESTY HARD RULES — violating any of these makes the eval invalid:

  - If \`win_plan.verdict\` is 'fail' OR detected_wincon_patterns is empty
    AND singleCardWincons === 0, you CANNOT praise "clear win plan",
    "multiple win conditions", or "robust win plan" anywhere in summary,
    topStrength, or strengths. Say "no detected win plan" instead.
  - If \`win_plan.verdict\` is 'fail', that fact MUST appear in weaknesses.
  - If \`mana_base.verdict\` is 'fail' or 'warn' for low lands, you CANNOT
    call the mana base "solid" or "well-tuned" — describe the actual issue.
  - If \`bracket_fit.verdict\` is 'fail', the bracket mismatch MUST appear
    in weaknesses AND bracketFitNotes.
  - If \`commander_execution\` score is below threshold, you CANNOT say
    "strong synergy" or "high commander relevance" — quote the actual %.
  - If the eval result is later score-clamped (you'll see _clampedFrom
    in retrospect), the clamp REASON must already be implicit in your
    weaknesses. Translation: write weaknesses that justify a low score
    when the lens data warrants one — don't write "8/10, lots of strengths"
    when win_plan failed.

CARDS-LEGAL-AT-BRACKET RULE (HARD CONSTRAINT — violations make the eval invalid):

If \`bracket_fit.verdict === 'pass'\`, the deck is bracket-legal. PERIOD.
You are FORBIDDEN from claiming any card pushes the deck above bracket
when the lens verdict is 'pass'. The bracket-fit math has already been
done — Tier-C caps, game-changer counts, fast-mana density, tutor counts
have all been validated. Repeating "Chrome Mox / Mox Diamond / Demonic
Tutor pushes this above bracket" when bracket_fit passed is a
hallucination — those cards are EXPLICITLY ALLOWED at B4 (and B5).

What you CAN say when bracket_fit passes:
  - density observations: "8 Tier-C cards is on the upper edge for B4"
  - strategy mismatch: "Mana Vault doesn't fit a slow lifegain plan"
  - missing tools: "no protection package for Felidar Sovereign"

What you CANNOT say when bracket_fit passes:
  - "Card X pushes this above bracket"
  - "This deck is over its target bracket"
  - "Slightly over-tuned for B4/B5"
  - "These powerful cards make it feel more like B5"

What to say ONLY when bracket_fit.verdict === 'fail' OR
actualBracket > targetBracket:
  - "bracket_fit lens flags X cards bumping this to bracket Y"
  - "Tier-C count of N exceeds the B4 cap of 4"

CONSISTENCY RULE — do NOT praise what the lenses flag.
If a stat appears as a problem in any lens evidence (mana_base flags
ramp count, win_plan flags missing wincons, commander_execution flags
low on-plan %), you CANNOT describe that same stat as a strength.

WRONG (do NOT do this):
  mana_base lens evidence: "ramp_count: 22 (cap 16) — excess crowds out roles"
  evaluator strength: "well-constructed mana base with 22 ramp sources" ❌
  (Self-contradiction — the lens flagged 22 ramp as a problem, you can't
   praise it as a strength a sentence later.)

RIGHT:
  Same lens evidence, evaluator weakness:
    "22 ramp pieces vs cap 16 — 6 excess slots that should go to interaction"
  evaluator strength elsewhere:
    "well-tuned interaction package: Counterspell + Swords + Cyclonic Rift"
  ✓ Praise things the lenses LIKE; describe flagged things as the
    weaknesses they are.

Specific anti-patterns to avoid:
  - lens flags excess ramp → don't write "solid ramp package"
  - lens flags low interaction → don't write "decent removal package"
  - lens flags filler runaway → don't write "diverse card selection"
  - lens flags low commander execution → don't write "high synergy"
  (Cite the lens evidence specifically, by name.)

WRONG (do NOT do this):
  Target B4, bracket_fit verdict is 'pass', actualBracket=4, evaluator writes:
    "Chrome Mox and Mox Diamond push this above bracket"  ❌
RIGHT:
  Same input, evaluator writes:
    "Strong B4 fast-mana package: Chrome Mox + Mox Diamond + Sol Ring"  ✓
  OR (if there's a real concern):
    "Mana Vault fits poorly with the lifegain strategy — fast-mana on a
     deck that wants to play to turn 8+"  ✓
═══════════════════════════════════════════════════════════════════════════

EVALUATION RUBRIC:

  Score 9-10 (excellent):
    - Deck is a strong representative of its target bracket
    - Mana base is appropriate (premium fixing for high brackets, basic-leaning for low)
    - Card quality matches the bracket (cEDH staples at B5; precon-tier at B2)
    - Strong commander synergy — most non-staple slots advance the strategy
    - Clear, executable win plan

  Score 7-8 (good):
    - Most of the above, but with 2-3 weak picks or a thin spot
    - Mana base or removal package slightly off-pace for the bracket

  Score 5-6 (mediocre):
    - Functional but feels like the wrong bracket (B5 deck plays like B3, etc.)
    - Generic synergy, lots of filler
    - Win plan vague or slow

  Score 3-4 (poor):
    - Lots of off-strategy picks
    - Mana base actively hurts (slow, color-screwed)
    - No clear win plan

  Score 1-2 (broken):
    - Deck doesn't function — random pile of cards

═══════════════════════════════════════════════════════════════════════════
NEVER CALL THESE CARDS "FILLER" — they are universal Commander staples
that go in nearly every deck of their color identity. Calling Sol Ring or
Birds of Paradise "filler" is wrong; even if a more optimal alternative
exists, these cards are objectively strong picks. List them as STRENGTHS,
not weaknesses. They may be SUBOPTIMAL at very high brackets if a better
specific card exists, but they are not "filler".
═══════════════════════════════════════════════════════════════════════════

UNIVERSAL MANA ROCKS (any color):
Sol Ring, Arcane Signet, Mind Stone, Fellwar Stone, Thought Vessel,
Wayfarer's Bauble, Mana Vault, Mana Crypt, Chromatic Lantern, Coalition Relic,
Lightning Greaves, Swiftfoot Boots, Skullclamp, Sensei's Divining Top,
Lifecrafter's Bestiary, Solemn Simulacrum, Burnished Hart, Pilgrim's Eye,
Mox Diamond, Chrome Mox, Mox Opal, Mox Amber, Mox Tantalite, Lotus Petal,
Jeweled Lotus, Jeweled Amulet, Ancient Tomb, Grim Monolith, Lion's Eye Diamond

ALL TALISMANS AND ALL SIGNETS — every Talisman of X and every X Signet
(Azorius, Dimir, Rakdos, Gruul, Selesnya, Orzhov, Izzet, Golgari, Boros,
Simic) is a universal 2-color mana fixer.

UNIVERSAL MANA DORKS:
Birds of Paradise (THE classic — 1-mana 1/1 flying mana of any color),
Llanowar Elves, Elvish Mystic, Fyndhorn Elves, Boreal Druid,
Avacyn's Pilgrim, Noble Hierarch, Ignoble Hierarch, Arbor Elf,
Bloom Tender, Faeburrow Elder, Priest of Titania, Heritage Druid,
Wirewood Symbiote, Devoted Druid, Llanowar Visionary, Beast Whisperer,
Selvala Heart of the Wilds, Selvala Explorer Returned

UNIVERSAL REMOVAL — single-target:
Swords to Plowshares, Path to Exile, Generous Gift, Beast Within,
Chaos Warp, Anguished Unmaking, Assassin's Trophy, Despark, Mortify,
Putrefy, Vindicate, Vanishing Verse, Krosan Grip, Nature's Claim,
Naturalize, Disenchant, Aura Shards, Banishing Light, Oblivion Ring,
Wear // Tear, Return to Dust, Boros Charm, Unexpectedly Absent

UNIVERSAL REMOVAL — board wipes / mass:
Cyclonic Rift, Toxic Deluge, Damnation, Wrath of God, Day of Judgment,
Blasphemous Act, Crux of Fate, Hour of Devastation, Farewell, Damn,
Supreme Verdict, Akroma's Will, Heroic Intervention, Teferi's Protection,
Flawless Maneuver, Kindred Charge, Austere Command

UNIVERSAL COUNTERSPELLS:
Counterspell, Mana Drain, Force of Will, Force of Negation, Pact of Negation,
Mana Leak, Negate, Swan Song, Arcane Denial, Dovin's Veto, Mental Misstep,
Spell Pierce, Dispel, Flusterstorm, Fierce Guardianship, Deflecting Swat,
Drannith Magistrate, Snapcaster Mage

UNIVERSAL CARD DRAW ENGINES:
Rhystic Study, Mystic Remora, Necropotence, Sylvan Library, Phyrexian Arena,
Esper Sentinel, Smothering Tithe, Mind's Eye, Greater Good, Garruk's Uprising,
Beast Whisperer, Guardian Project, Toski Bearer of Secrets, Lifecrafter's Bestiary,
Sensei's Divining Top, Skullclamp, Reconnaissance Mission, Bident of Thassa,
Coastal Piracy

UNIVERSAL CANTRIPS / CARD ADVANTAGE:
Brainstorm, Ponder, Preordain, Consider, Opt, Serum Visions, Mishra's Bauble,
Frantic Search, Dig Through Time, Treasure Cruise, Night's Whisper,
Sign in Blood, Painful Truths, Read the Bones, Ambition's Cost, Demand Answers,
Faithless Looting, Cathartic Reunion, Tormenting Voice, Big Score, Underworld Breach

UNIVERSAL TUTORS:
Demonic Tutor, Vampiric Tutor, Imperial Seal, Mystical Tutor, Enlightened Tutor,
Worldly Tutor, Green Sun's Zenith, Chord of Calling, Birthing Pod,
Survival of the Fittest, Diabolic Intent, Diabolic Tutor, Eladamri's Call,
Idyllic Tutor, Eldritch Evolution, Fauna Shaman, Wishclaw Talisman,
Beseech the Mirror, Profane Tutor, Grim Tutor, Cruel Tutor, Personal Tutor,
Sterling Grove, Wargate, Dark Petition, Yisan the Wanderer Bard

UNIVERSAL RAMP:
Cultivate, Kodama's Reach, Rampant Growth, Nature's Lore, Three Visits,
Skyshroud Claim, Farseek, Sakura-Tribe Elder, Wood Elves, Farhaven Elf,
Oracle of Mul Daya, Azusa Lost but Seeking, Dryad of the Ilysian Grove,
Burgeoning, Exploration, Tireless Provisioner, Crop Rotation,
Search for Tomorrow, Cultivator's Caravan

UNIVERSAL RECURSION / GRAVEYARD VALUE:
Eternal Witness, Reclamation Sage, Reflector Mage, Acidic Slime, Mulldrifter,
Sun Titan, Karmic Guide, Body Double, Conjurer's Closet, Soulherder,
Reanimate, Animate Dead, Necromancy, Persist, Victimize, Living Death,
Patriarch's Bidding, Dread Return, Entomb, Buried Alive, Tortured Existence,
Underworld Breach, Yawgmoth Thran Physician, Meren of Clan Nel Toth

UNIVERSAL COMBO WINCONS (cEDH):
Thassa's Oracle + Demonic Consultation, Thassa's Oracle + Tainted Pact,
Laboratory Maniac + same, Jace Wielder of Mysteries + same,
Heliod Sun-Crowned + Walking Ballista, Exquisite Blood + Sanguine Bond,
Aetherflux Reservoir + Bolas's Citadel, Kiki-Jiki + Restoration Angel,
Splinter Twin + Deceiver Exarch, Isochron Scepter + Dramatic Reversal,
Demonic Consultation, Tainted Pact (combo enablers — even alone they are
recognized cEDH staples for their combo potential)

UNIVERSAL TOKEN PRODUCERS / DOUBLERS:
Bitterblossom, Dockside Extortionist, Smothering Tithe, Anointed Procession,
Parallel Lives, Doubling Season, Adrix and Nev, Mondrak Glory Dominus,
Pir's Whim, Wedding Ritual, Storm Herd

UNIVERSAL COUNTERS PAYOFFS:
Doubling Season, Hardened Scales, Branching Evolution, Innkeeper's Talent,
Conclave Mentor, Pir Imaginative Rascal, Toothy Imaginary Friend,
Master Biomancer, Inspiring Call, Ozolith Shattered Spire

UNIVERSAL SACRIFICE / ARISTOCRATS PAYOFFS:
Blood Artist, Zulaport Cutthroat, Cruel Celebrant, Disciple of the Vault,
Pawn of Ulamog, Ashnod's Altar, Phyrexian Altar, Viscera Seer, Carrion Feeder,
Pitiless Plunderer, Yawgmoth Thran Physician, Dictate of Erebos, Grave Pact,
Butcher of Malakir, Reassembling Skeleton, Bloodghast

UNIVERSAL ETB / FLICKER ENGINE:
Eternal Witness, Reflector Mage, Acidic Slime, Mulldrifter, Sun Titan,
Karmic Guide, Conjurer's Closet, Soulherder, Brago King Eternal,
Charming Prince, Restoration Angel, Felidar Guardian, Eldrazi Displacer

UNIVERSAL UTILITY LANDS:
Command Tower, Reflecting Pool, City of Brass, Mana Confluence, Exotic Orchard,
Ancient Tomb, Cabal Coffers, Urborg Tomb of Yawgmoth, Field of the Dead,
Strip Mine, Wasteland, Ghost Quarter, Maze of Ith, Boseiju Who Endures,
Otawara Soaring City, Eiganjo Seat of the Empire, Takenuma Abandoned Mire,
Sokenzan Crucible of Defiance, Bojuka Bog, Reliquary Tower

═══════════════════════════════════════════════════════════════════════════
TRIBAL PAYOFFS — when the commander grants creature types or is a tribal
lord, creatures of that tribe are ON-THEME, NOT FILLER. A 4-5 mana
vampire payoff in a vampire deck is a CORE inclusion, not "off-pace."
Tribal decks NEED these payoffs — they ARE the win plan. The LLM has
a tendency to call high-CMC tribal payoffs "filler" because cEDH lists
don't include them. EDH bracket 3-4 decks DO include them, and that's
correct.
═══════════════════════════════════════════════════════════════════════════

VAMPIRES (for Edgar Markov, Anowon, Olivia, Strefan, etc.):
Bloodthirsty Conqueror, Twilight Prophet, Necropolis Regent, Vampire Nocturnus,
Captivating Vampire, Bloodline Keeper, Bloodlord of Vaasgoth, Vish Kal Blood Arbiter,
Sangromancer, Stromkirk Captain, Drana Liberator of Malakir, Defiant Bloodlord,
Anowon Ruin Thief, Olivia Crimson Bride, Patron of the Vein, Bloodghast,
Champion of Dusk, Sanctum Seeker, Indulgent Aristocrat, Bloodhusk Ritualist,
Yahenni Undying Partisan, Mavren Fein Dusk Apostle, Edgar's Civil War,
Skeletal Vampire, Bloodtracker, Fell Stinger

DRAGONS (for Tiamat, The Ur-Dragon, Karrthus, Bladewing, Korlessa, etc.):
Atarka World Render, Balefire Dragon, Bladewing the Risen, Goldspan Dragon,
Hellkite Tyrant, Klauth Unrivaled Ancient, Lathliss Dragon Queen, Old Gnawbone,
Terror of the Peaks, Utvara Hellkite, Dragon Tempest, Dragon's Hoard,
Dragonlord's Servant, Dragonspeaker Shaman, Crucible of Fire, Scion of Draco,
Niv-Mizzet Parun, Niv-Mizzet Reborn, Karrthus Tyrant of Jund, Wasitora Nekoru Queen,
Hellkite Charger, Savage Ventmaw, Skithiryx Blight Dragon, Bogardan Hellkite,
Scourge of Valkas, Sarkhan Soul Aflame, Sarkhan Fireblood, Crux of Fate,
Urza's Incubator, Knollspine Dragon, Furnace Dragon, Thrakkus the Butcher

GOBLINS (for Krenko, Wort Boggart Auntie, Muxus, Grenzo, Zada, etc.):
Goblin Chieftain, Goblin King, Goblin Warchief, Goblin Lackey, Goblin Recruiter,
Goblin Matron, Goblin Piledriver, Skirk Prospector, Mogg War Marshal,
Krenko Mob Boss, Krenko Tin Street Kingpin, Muxus Goblin Grandee,
Goblin Sharpshooter, Pashalik Mons, Voracious Dragon, Goblin Bombardment,
Impact Tremors, Purphoros God of the Forge, Goblin Welder, Squee Goblin Nabob,
Conspicuous Snoop, Marton Stromgald, Nim Deathmantle, Goblin Engineer,
Hordeling Outburst, Empty the Warrens, Dragon Fodder

ELVES (for Marwyn, Ezuri, Lathril, Eladamri, Yeva, etc.):
Priest of Titania, Heritage Druid, Wirewood Symbiote, Ezuri Renegade Leader,
Marwyn the Nurturer, Elvish Archdruid, Elvish Champion, Imperious Perfect,
Joraga Warcaller, Drove of Elves, Elvish Mystic, Llanowar Elves, Fyndhorn Elves,
Boreal Druid, Avenger of Zendikar, Beast Whisperer, Realmwalker, Lathril Blade of the Elves,
Wellwisher, Elvish Promenade, Eladamri Lord of Leaves, Quirion Ranger,
Glimpse of Nature, Skemfar Elderhall, Skemfar Avenger, Lys Alana Huntmaster

SLIVERS (for Sliver Overlord, The First Sliver, Sliver Hivelord, etc.):
Sliver Hive, Sliver Hivelord, Sliver Overlord, Sliver Legion, Crystalline Sliver,
Heart Sliver, Galerider Sliver, Predatory Sliver, Manaweft Sliver, Gemhide Sliver,
Hibernation Sliver, Sliver Queen, The First Sliver, Sliver Gravemother,
Diffusion Sliver, Striking Sliver, Necrotic Sliver, Realmwalker, Cavern of Souls,
Synapse Sliver, Spiteful Sliver, Bonescythe Sliver, Cloudshredder Sliver,
Lavabelly Sliver, Brood Sliver, Crystalline Resonance, Coat of Arms

ZOMBIES (for Wilhelt, Sidisi, Gisa, Scarab God, Varina, etc.):
Cryptbreaker, Diregraf Captain, Death Baron, Lord of the Undead, Lord of the Accursed,
Gravecrawler, Bloodghast, Reassembling Skeleton, Dread Summons, Endless Ranks of the Dead,
Open the Graves, Death Baron, Cemetery Reaper, Wilhelt the Rotcleaver,
Liliana Dreadhorde General, Liliana Death's Majesty, Wonder, Patriarch's Bidding

SERPENTS / SEA CREATURES (for Koma, Sygg, Kopala, etc.):
Lorthos the Tidemaker, Stormtide Leviathan, Quest for Ula's Temple, Coralhelm Commander,
Inkwell Leviathan, Tromokratis, Pearl-Ear Imperial Magistrate, Empress Galina,
Slinn Voda, Patron of the Moon, Stormsurge Kraken

EQUIPMENT / VOLTRON PAYOFFS (for Uril, Sram, Halvar, Akiri, etc.):
Sword of Feast and Famine, Sword of Fire and Ice, Sword of Light and Shadow,
Sword of Truth and Justice, Sword of Body and Mind, Sword of War and Peace,
Sword of Hearth and Home, Sword of Sinew and Steel, Sword of Forge and Frontier,
Sword of Vengeance, Argentum Armor, Embercleave, Hammer of Nazahn, Stoneforge Mystic,
Stonehewer Giant, Puresteel Paladin, Sigarda's Aid, Bruenor Battlehammer

ARTIFACT / ARTIFACT-MATTERS (for Urza, Breya, Daretti, etc.):
Inspiring Statuary, Sai Master Thopterist, Saheeli Sublime Artificer,
Reckless Fireweaver, Foundry Inspector, Etherium Sculptor,
Goblin Welder, Daretti Scrap Savant, Tezzeret the Schemer

═══════════════════════════════════════════════════════════════════════════
COMMANDER SYNERGY RULE — examine the commander's type_line and
oracle_text BEFORE judging cards. Tribal commanders (creature type
matters), token commanders, spellslinger commanders, etc. — cards that
support the commander's stated theme are CORRECTLY INCLUDED, even if
they're 4-5 CMC creatures. cEDH speed expectations don't apply to B3
and B4 decks. Most B3-B4 decks WIN by attacking with creatures.
═══════════════════════════════════════════════════════════════════════════

OUTPUT FORMAT (JSON only — no markdown):

{
  "score": <integer 1-10>,
  "summary": "<1-2 sentence overall judgment>",
  "topStrength": "<the SINGLE most notable strength — one short headline that
    a player would brag about. Pick the one thing this deck does best, not a
    generic 'mana base is fine'. e.g. 'aggressive 18-tutor cEDH package built
    around Thoracle' or 'tribal density of 24 vampires + 5 lords closes via
    combat'. This is the headline; the strengths array is the supporting list.>",
  "strengths": [
    "<concrete observation about a strong aspect — e.g., 'mana base is well-tuned for B5 with 10 fast mana sources and untapped fixing'>"
  ],
  "weaknesses": [
    "<concrete observation about a weakness — e.g., 'only 2 tutors in a B5 deck — should be 8-12'>"
  ],
  "bracketFitVerdict": "<one of: 'within_band' | 'low_end' | 'high_end' | 'over_target' | 'needs_tuning'>",
  "bracketFitNotes": "<does this deck actually feel like ${bracketLabel}? what's off?>"
}

bracketFitVerdict is a STRUCTURED enum that downstream UI can render as
a chip / badge without parsing prose. Pick exactly one:
  - "within_band":   deck is squarely at the target bracket, no concerns
  - "low_end":       deck functions at target but is on the casual edge
                     (could comfortably play a bracket lower)
  - "high_end":      deck functions at target but is on the spicy edge
                     (could comfortably play a bracket higher)
  - "over_target":   actualBracket > targetBracket per the lens. Use only
                     when bracket_fit.verdict === 'fail'. The lens math is
                     authoritative — don't pick this when verdict === 'pass'.
  - "needs_tuning":  deck has structural issues (under-interaction,
                     missing wincons, ramp crowding) regardless of which
                     bracket it lands in. Pair with bracketFitNotes.

The prose bracketFitNotes still gives you room to explain — the enum
just lets the UI show consistent bracket-status badges.

The topStrength field is REQUIRED — pick the single best thing about this
deck and write one short, concrete sentence. It MUST be a paraphrased
headline, not a verbatim copy of the first item in the strengths array.

Aim for 3 strengths and 3 weaknesses. If the deck genuinely has fewer of
either, fewer is fine — don't pad.

Be concrete. "The deck is good" is useless. "This deck has Cyclonic Rift,
Force of Will, and Mana Drain — strong B5 interaction package" is useful.

When listing weaknesses, NEVER include cards from the universal staples
list above unless the SPECIFIC reason they're weak is bracket-relevant
(e.g., "Birds of Paradise is fine, but at B5 a Bloom Tender or Esper
Sentinel would be a stronger pick"). Even then, prefer to identify
genuinely weak cards over good cards.

NAME-ONLY-DECK-LIST-CARDS RULE — when you reference a specific card name
in summary, topStrength, strengths, weaknesses, or bracketFitNotes,
that name MUST appear verbatim in the \`deck\` array of the user payload
above. Do NOT name a card from training data or "what a typical
B4 deck has" — only cards in the deck list this evaluation is judging.

WRONG (do NOT do this):
  Deck list does not contain Imperial Seal, evaluator writes:
    "Cards like Imperial Seal push this above bracket"  ❌
  (The card isn't in the deck. Naming it is a hallucination.)
RIGHT:
  Either don't name a specific card, or name one that IS in the deck:
    "The deck includes 5 Tier-C fast-mana pieces (Mana Crypt, Chrome
     Mox, Mox Diamond, ...) — 1 over the B4 cap of 4."  ✓
  (All named cards are in the deck array.)

If you want to make a power-level point, cite a count or category
("8 Tier-C cards") rather than naming individual cards you can't
verify are present.

═══════════════════════════════════════════════════════════════════════════
PRECOMPUTED COUNTS — when the user payload includes \`counts\` and
\`detected_wincon_patterns\`, TRUST THEM. The orchestrator already counted
tutors, removal, ramp, etc. by tag — including soft tutors (Goblin Matron,
Eladamri's Call, Diabolic Intent) and pattern-based wincons that aren't
tagged on any single card. Do NOT recount from card names and complain
"only 3 tutors" when \`counts.tutors\` says 8. Do NOT say "no clear win
condition" when \`detected_wincon_patterns\` lists a pattern like
"aristocrats: sac outlet + Blood Artist" or "etb-drain: token producer +
Impact Tremors" — those ARE the win plan.
═══════════════════════════════════════════════════════════════════════════

Return ONLY JSON.`

  // Knowledge-layer lens results FIRST — these are the structured
  // verdicts our system has already computed. The LLM should grade our
  // analysis (or augment it), not rebuild it from card names. Each lens
  // result includes evidence (per-card facts) and suggestions (actionable
  // improvements) — the LLM gets to see the WHY behind every verdict.
  //
  // Phase 8: legacy `counts`, `detected_wincon_patterns`, and
  // `commander_execution` fields removed. The same data lives inside
  // each lens's `evidence` and `_raw` — the LLM should consume
  // `lens_verdicts` as the single source of truth.
  const user = {
    lens_verdicts: (lensResults ?? []).map(r => ({
      lens:        r.name,
      verdict:     r.verdict,
      score:       r.score,
      summary:     r.summary,
      evidence:    r.evidence ?? [],
      suggestions: r.suggestions ?? [],
    })),

    commander: compactCommander(commander),
    bracket: { number: bracket, label: bracketLabel, meaning: bracketMeaning },
    deck_size: deck.length,
    deck: deck.map(c => ({
      name: c.name,
      role: (c.roles ?? ['filler'])[0],
      cmc:  c.cmc ?? 0,
      type_line: c.type_line ?? '',
      source: c.fromManaSolver ? 'mana-solver'
            : c.fromSkeleton ? 'skeleton'
            : c.fromBracketStaples ? 'bracket-staples'
            : c.fromTribalFloor ? 'tribal-floor'
            : c.fromTutorFloor ? 'tutor-floor'
            : c.fromRemovalFloor ? 'removal-floor'
            : c.fromWinconBackstop ? 'wincon-backstop'
            : 'llm-pick',
    })),
  }

  return { system, user }
}

// Coarse token estimate (chars / 4). Useful for deciding whether the pool
// needs trimming before we ship the prompt to a real model with a context cap.
export function estimatePromptTokens({ system, user }) {
  const text = system + JSON.stringify(user)
  return Math.ceil(text.length / 4)
}
