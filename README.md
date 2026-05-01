# Deckify

Commander deck builder for Magic: The Gathering. Import your collection, pick
a commander, generate a power-tuned 99-card deck. AI-assisted (OpenAI) or
pure heuristic.

## Local development

```bash
npm install
npm run dev          # vite dev server (Scryfall calls work via vite proxy)
vercel dev           # full local dev with serverless functions (/api/llm needs OPENAI_API_KEY in .env.local)
```

## Tests

```bash
npm test             # run the full suite once
npm run test:watch   # rerun on file change
```

The suite uses Vitest. It covers the deterministic, side-effect-free parts of
the rules engine and import pipeline:

- `src/utils/cardHelpers.test.js` — type checks, color identity, basics, dedup, avg CMC
- `src/utils/cardImportParser.test.js` — CSV/TXT parsing edge cases (Moxfield, Archidekt, MTGO formats)
- `src/rules/cardRoles.test.js` — `assignRoles` regex classification (lands, ramp, draw, removal, wipes, protection, win-cons, mechanic tags, tribal)
- `src/rules/archetypeRules.test.js` — archetype detection, matching, scoring (with and without primary lock), EDHREC theme mapping, anchor lookups
- `src/rules/commanderRules.test.js` — `filterLegalCards` (color identity, banned list, ALWAYS_LEGAL exceptions, dedup, commander-self exclusion)
- `src/rules/comboRules.test.js` — combo detection, incomplete combos, registration
- `src/rules/deckValidator.test.js` — 99-card check, singleton (basics excepted), color identity, banned, role-balance warnings

Not covered (intentionally — too coupled, network-dependent, or AI-driven):
the deck generator, deck scorer, bracket rules, LLM service/orchestrator/validator,
storage layer (Supabase), and external API wrappers.

## Build / deploy

```bash
npm run build        # vite build → dist/
git push             # Vercel auto-deploys main
```

Required Vercel env vars: `OPENAI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
