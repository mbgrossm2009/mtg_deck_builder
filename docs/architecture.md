# Deckify architecture

This document describes the **knowledge-layer architecture** introduced
in May 2026 (commits `cf8399e` → `0aef8e1`). Read this first if you're
adding a new feature or trying to understand why a piece of code lives
where it does.

## The shift

The project moved from a **pipeline that builds decks** to a **knowledge
layer + use cases**. Old shape:

```
collection → pre-filter → archetype detection → role tagging
           → bracket filter → skeleton → LLM call → critique
           → bracket downgrade → 99 cards
```

Knowledge about cards, commanders, and decks was implicit. Adding a new
lens (e.g., commander execution score) required regex-scanning oracle
text in three different shapes. Every fix touched 3-5 files.

New shape:

```
                  ┌─────────────────────────┐
  raw card data → │  Knowledge Layer        │ → CardProfile
  raw commander → │                         │ → CommanderProfile
                  └─────────────────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
  deck + profile→ │  Lens Framework         │ → LensResult[]
                  │  (BracketFit, WinPlan,  │
                  │   CommanderExecution,   │
                  │   ManaBase, ...)        │
                  └─────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        Deck Builder      Eval Harness    Deck Doctor (future)
```

The deck builder is now ONE use case of the knowledge layer.

## Module map

```
src/
├── knowledge/                  # the knowledge layer (new)
│   ├── cardProfile.js          # CardProfile + extractCardProfile
│   ├── commanderProfile.js     # CommanderProfile + extractCommanderProfile
│   ├── lens.js                 # Lens framework + evaluateLenses
│   └── lenses/                 # individual lenses
│       ├── bracketFitLens.js
│       ├── commanderExecutionLens.js
│       ├── manaBaseLens.js
│       └── winPlanLens.js
│
├── rules/                      # legacy domain logic (still in use)
│   ├── cardRoles.js            # role + tag detection (used by CardProfile)
│   ├── archetypeRules.js       # archetype detection (used by CommanderProfile)
│   ├── commanderMechanics.js   # mechanic-tag detection (used by CommanderProfile)
│   ├── commanderPowerCeiling.js # bracket cap (used by CommanderProfile)
│   ├── commanderExecution.js   # execution score (used by CommanderExecutionLens)
│   ├── bracketRules.js         # computeActualBracket (used by BracketFitLens)
│   ├── comboRules.js           # combo detection (used by BracketFitLens)
│   ├── manaBaseSolver.js       # land selection
│   ├── deckScorer.js           # heuristic scoring
│   ├── deckGenerator.js        # heuristic deck builder (fallback)
│   ├── deckSkeleton.js         # EDHREC + Moxfield skeleton
│   ├── deckValidator.js        # validateDeck + validateDeckAtBracket
│   └── llmDeckValidator.js     # validates LLM responses
│
└── services/                   # use cases
    ├── llmDeckOrchestrator.js  # main deck-build pipeline (uses lenses)
    ├── llmDeckService.js       # LLM API calls (with retry/clamp)
    ├── llmPromptBuilder.js     # prompt construction
    ├── evalScoreClamp.js       # eval score clamp post-processing
    └── evalRunStore.js         # eval harness state machine
```

## Knowledge layer contracts

### CardProfile

Computed once per card by `extractCardProfile(card, opts)`. Cached by
`(cardName + commanderName)` so commander-specific synergy detection
works without re-extraction. Shape:

```js
{
  name: string,
  roles:    ['ramp', 'draw', 'removal', ...],     // primary deck-building buckets
  tags:     ['token_producer', 'sac_outlet', ...], // granular mechanic tags
  evasion:  ['flying', 'menace', 'shadow', ...],
  triggers: {
    onAttack: ['damage', 'draw', 'token', 'mana'],
    onETB:    ['damage', 'draw', 'token', 'tutor', 'removal'],
    onDeath:  ['draw', 'token', 'drain', 'recursion'],
    onCast:   ['any', 'spell', 'creature'],
  },
  power: {
    fastMana: boolean,
    gameChanger: boolean,
    explosiveFinisher: boolean,
    commanderProtection: boolean,
    tutorTier: 'hard' | 'soft' | null,
  },
  wincon: {
    singleCard: boolean,
    contributes: ['etb_drain', 'aristocrats_drain', 'extra_combat',
                  'combat_damage_draw', 'tribal_anthem'],
  },
}
```

### CommanderProfile

Computed once per commander by `extractCommanderProfile(commander)`.
Shape:

```js
{
  name: string,
  colorIdentity: string[],
  cmc: number,

  archetypes:        [{ id, label, strength, tribe? }, ...],
  primaryArchetype:  string | null,

  mechanicTags:      ['cares_about_sacrifice', 'tribal_dragons', ...],
  cardTagBoosts:     Set<string>,                  // card tags that get a synergy bonus

  anchorNames:       Set<string>,                  // lowercased

  tribal: {
    tribe: string | null,                          // null when oracle text doesn't reference a type
    densityFloor: number,                          // 0 when no tribe
  },

  bracket: {
    ceiling: number,                               // 1-5; capped per known commanders
    winPlanShapes: ['extra_combat', 'aristocrats', ...], // patterns this commander naturally supports
  },

  expectations: {
    minRamp: number,                               // scales with CMC
    evasionBased: boolean,                         // commander wants evasive creatures
  },
}
```

**Critical contract:** `tribal.tribe` is set ONLY when the commander's
oracle text references a creature type. Winter, Cynical Opportunist (a
Human Warlock) gets `tribal.tribe: null` because its text never mentions
either type. Don't infer tribal from creature type alone.

### Lens

A lens answers ONE question about a deck. Interface:

```js
interface Lens {
  name: string
  evaluate(input: LensInput): LensResult
}

interface LensInput {
  deck: Card[]
  commanderProfile: CommanderProfile
  context?: { targetBracket?: number, ... }
}

interface LensResult {
  name: string
  score: number | null              // 0-1 fraction
  verdict: 'pass' | 'warn' | 'fail' | 'info'
  summary: string                   // one-line human-readable
  evidence: EvidenceItem[]          // per-card supporting facts
  suggestions: string[]             // actionable improvements
}

interface EvidenceItem {
  kind: string                      // 'on_plan', 'offender', 'no_plan', etc.
  card?: string
  detail: string
}
```

**Why structured output:** the orchestrator + UI + eval prompt + future
deck doctor all need different views of the same lens data. A single
numeric score doesn't support "show me which cards are off-plan" or
"explain why this deck is B4 not B3." Evidence does.

Add a new lens:
1. Create `src/knowledge/lenses/yourLens.js` exporting `{ name, evaluate }`.
2. Test it in `src/knowledge/lens.test.js` (or its own file for big lenses).
3. Wire into the orchestrator's `evaluateLenses` call when ready.

## Migration status (May 2026)

| Phase | Status | Result |
|---|---|---|
| 1 — CardProfile | ✅ Done | `src/knowledge/cardProfile.js` + 28 tests |
| 2 — CommanderProfile | ✅ Done | `src/knowledge/commanderProfile.js` + 31 tests |
| 3 — Lens framework + 4 lenses | ✅ Done | `src/knowledge/lens.js` + lenses/ + 22 tests |
| 4 — Wire into orchestrator | ✅ Done | `result.lensResults` and `result.commanderProfile` in payload |
| 5 — Architecture doc | ✅ Done | this file |
| 6 — Eval prompt consumes lens output | ✅ Done | `lens_verdicts` is the single source of truth in the eval prompt |
| 7 — Deck Doctor page | ✅ Done | `/deck-doctor` route + `evaluateDecklist` service (10 tests) |
| 8 — Retire legacy inline fields | ✅ Done | `criticalCardCounts` / `detectedWincons` / `executionScore` removed from orchestrator return + eval prompt; helpers retained for internal use |

**Done.** All migration phases shipped. The system understands decks
across multiple analytical dimensions, surfaces per-card evidence and
actionable suggestions, and supports two end-user use cases (deck
builder + deck doctor) on the same knowledge layer.

## Testing philosophy

Per the project memory rule (oracle text wording is load-bearing):

- Knowledge-layer tests use **verbatim Scryfall oracle text** from
  `src/test/fixtures/top100commanders.json`. Paraphrasing breaks
  precision tests silently.
- Each detection rule has **positive AND negative cases**. Pattern
  changes that introduce false positives fail tests immediately.
- Lens tests verify **structured output shape** (not just numeric
  scores). The evidence and suggestions arrays are part of the contract.
- New mechanic understanding goes into `cardProfile.js` or
  `commanderProfile.js` first, with a test, then propagates through
  lenses as needed.

## Glossary

- **Profile** — structured semantic understanding of one entity (card or
  commander), computed once and cached.
- **Lens** — pluggable scorer that consumes a deck + profiles and
  returns one structured opinion about the deck.
- **Knowledge layer** — `src/knowledge/` — owns profiles + lenses.
- **Use case** — `src/services/` — owns workflows that consume
  knowledge (deck builder, eval harness, future deck doctor).
- **Win plan shape** — multi-card wincon pattern a commander naturally
  supports (`extra_combat`, `aristocrats`, etc.). Stored on the
  commander profile.
- **Tribal density floor** — the minimum on-tribe creature count enforced
  for tribal commanders. ONLY applies when the commander's oracle text
  references the creature type — never from the type_line alone.
