// Deck Doctor service.
//
// Evaluates a user-supplied decklist against the lens framework — no
// deck building required. This is the SECOND use case of the knowledge
// layer (the first being the deck builder). It demonstrates that
// understanding decks and building decks are separable concerns.
//
// Workflow:
//   1. Caller provides a commander and an array of card objects (the
//      "decklist"). Cards must have at least { name, type_line,
//      oracle_text, color_identity }; richer data is fine.
//   2. We extract the CommanderProfile, then enrich each card with its
//      role + tag info via assignRoles (so the lenses have what they
//      need). This is the same enrichment the orchestrator does pre-build.
//   3. Run all lenses. Return their structured results plus a top-level
//      summary verdict (worst-of all lens verdicts).
//
// What the caller gets back:
//   {
//     commanderProfile: CommanderProfile,
//     lensResults:      LensResult[],
//     overall: {
//       verdict: 'pass' | 'warn' | 'fail',
//       passCount, warnCount, failCount,
//       summary: string,
//     },
//   }

import { extractCommanderProfile } from '../knowledge/commanderProfile'
import { evaluateLenses } from '../knowledge/lens'
import { CommanderExecutionLens } from '../knowledge/lenses/commanderExecutionLens'
import { WinPlanLens }            from '../knowledge/lenses/winPlanLens'
import { BracketFitLens }         from '../knowledge/lenses/bracketFitLens'
import { ManaBaseLens }           from '../knowledge/lenses/manaBaseLens'
import { assignRoles } from '../rules/cardRoles'
import { anchorNamesFor } from '../rules/archetypeRules'

const DEFAULT_LENSES = [
  CommanderExecutionLens,
  WinPlanLens,
  BracketFitLens,
  ManaBaseLens,
]

/**
 * @param {object} args
 * @param {object} args.commander    — commander card
 * @param {Array}  args.cards        — array of card objects (the 99-card decklist)
 * @param {number} [args.bracket]    — target bracket for evaluation (default 3)
 * @param {Array}  [args.lenses]     — override the default lens set
 * @returns {{ commanderProfile, lensResults, overall }}
 */
export function evaluateDecklist({ commander, cards, bracket = 3, lenses = DEFAULT_LENSES }) {
  if (!commander) throw new Error('evaluateDecklist: commander is required')
  if (!Array.isArray(cards)) throw new Error('evaluateDecklist: cards must be an array')

  const commanderProfile = extractCommanderProfile(commander)

  // Enrich every card with roles/tags. Many flow paths (uploaded decklists,
  // Moxfield imports) supply only name + type_line + oracle_text — the
  // lenses need the role array to count ramp/draw/etc.
  const anchorNames = anchorNamesFor(commanderProfile.archetypes)
  const commanderTypes = (commander.type_line ?? '')
    .toLowerCase()
    .split('—')[1]
    ?.trim()
    .split(/\s+/) ?? []
  const enrichedDeck = cards.map(card => {
    if (Array.isArray(card.roles) && card.roles.length > 0) return card
    const { roles, tags } = assignRoles(card, commander, { anchorNames, commanderTypes })
    return { ...card, roles, tags: [...(card.tags ?? []), ...tags] }
  })

  const lensResults = evaluateLenses(lenses, {
    deck: enrichedDeck,
    commanderProfile,
    context: { targetBracket: bracket },
  })

  const overall = summarizeLensResults(lensResults)

  return { commanderProfile, lensResults, overall, enrichedDeck }
}

function summarizeLensResults(lensResults) {
  let passCount = 0, warnCount = 0, failCount = 0, infoCount = 0
  for (const r of lensResults) {
    if (r.verdict === 'pass') passCount++
    else if (r.verdict === 'warn') warnCount++
    else if (r.verdict === 'fail') failCount++
    else infoCount++
  }

  // Worst-of verdict: any fail → fail; any warn (no fail) → warn; else pass.
  const verdict = failCount > 0 ? 'fail'
                : warnCount > 0 ? 'warn'
                : passCount > 0 ? 'pass'
                : 'info'

  const summary =
    failCount > 0 ? `${failCount} dimension${failCount === 1 ? '' : 's'} failing — deck has structural problems`
  : warnCount > 0 ? `${warnCount} dimension${warnCount === 1 ? '' : 's'} flagged — deck is workable but has weaknesses`
  :                  'Deck looks healthy across all evaluated dimensions'

  return { verdict, passCount, warnCount, failCount, infoCount, summary }
}
