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

  const archetypes = strategyContext.archetypes ?? []
  const primaryArchetypeId = strategyContext.primaryArchetypeId ?? null
  const primaryArchetype = archetypes.find(a => a.id === primaryArchetypeId) ?? null

  const system = `You are an expert Magic: The Gathering Commander deck builder.

Your task is to build a highly optimized Commander deck using ONLY the cards provided.

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

STEP 6 — BRACKET RULES

Respect the target bracket:

Bracket 1–2:
- avoid tutors
- avoid fast mana
- avoid combos

Bracket 3:
- moderate optimization
- limited tutors allowed
- combos discouraged

Bracket 4–5:
- optimized play
- tutors allowed
- fast mana allowed
- combos allowed

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
    deck_structure_targets: {
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

  const system = `You are an expert Magic: The Gathering Commander deck builder.

This is PASS 1 of a TWO-PASS deck-build process.

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
  pass1Output,
}) {
  const bracketLabel   = BRACKET_LABELS[bracket] ?? 'Unknown'
  const bracketMeaning = BRACKET_DESCRIPTIONS[bracket] ?? ''
  const targets        = deckRules.targetCounts ?? {}
  const landTarget     = deckRules.landTarget ?? 37

  const system = `You are an expert Magic: The Gathering Commander deck builder.

This is PASS 2 of a two-pass deck-build process. Pass 1 already determined the strategy and selected the core engine. Your job is to BUILD THE FULL 99-CARD DECK around those locked-in choices.

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

Fill the remaining slots in this order:

1. Ramp (target ~10) — prefer cards in pass1.cardsToPrioritize first, then anything else from the pool.
2. Card draw (target ~10)
3. Removal (target 8–10)
4. Board wipes (target 2–4)
5. Protection (target 2–5)
6. Win conditions (target 2–4) — note that some core engine cards may already be wincons.
7. Lands (target ~37)
8. Remaining slots — high-synergy cards from pass1.cardsToPrioritize that aren't already in.

DO NOT include random off-theme cards just to hit 99. Every slot must serve the chosen strategy or fill a critical role gap.

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
- ALWAYS include every card from pass1.coreEngine.
- The "deck" array must contain exactly 99 entries (commander is the 100th, not in this list).
- Singleton: each non-basic card appears at most once. Basic lands may repeat.

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
    deck_structure_targets: {
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

  return { system, user }
}

// Coarse token estimate (chars / 4). Useful for deciding whether the pool
// needs trimming before we ship the prompt to a real model with a context cap.
export function estimatePromptTokens({ system, user }) {
  const text = system + JSON.stringify(user)
  return Math.ceil(text.length / 4)
}
