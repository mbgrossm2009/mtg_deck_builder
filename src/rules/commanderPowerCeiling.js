// Per-commander bracket ceiling.
//
// Some commanders genuinely cannot hit B5 (cEDH-tier optimization) regardless
// of how many staples and tutors you cram in. The eval evaluator recognizes
// this — Krenko at "B5" gets scored as B3 because its game plan IS B3 (token
// up, swing wide). Rather than building a fake B5 deck and getting evaluated
// as B3, cap the request and tell the user honestly.

const B5_INCAPABLE_COMMANDERS = new Set([
  // Pure tribal beatdown — no built-in combo angle.
  "krenko, mob boss",
  "edgar markov",
  "marwyn, the nurturer",
  "lathril, blade of the elves",
  "tiamat",
  "the ur-dragon",
  "karrthus, tyrant of jund",
  "gishath, sun's avatar",
  "wilhelt, the rotcleaver",
  "lord windgrace",
  "omnath, locus of creation",
  "queen marchesa",
  "ghave, guru of spores",
  "meren of clan nel toth",
  "muldrotha, the gravetide",
  "atraxa, praetors' voice",
  "kaalia of the vast",
  "koma, cosmos serpent",
  "wort, boggart auntie",
  "olivia voldaren",
  "gisa and geralf",
  "sliver overlord",
  "sliver hivelord",
  "the first sliver",
])

const B5_CAPABLE_COMMANDERS = new Set([
  "thrasios, triton hero",
  "tymna the weaver",
  "kraum, ludevic's opus",
  "tevesh szat, doom of fools",
  "najeela, the blade-blossom",
  "kinnan, bonder prodigy",
  "urza, lord high artificer",
  "rograkh, son of rohgahh",
  "tasigur, the golden fang",
  "derevi, empyrial tactician",
  "malcolm, keen-eyed navigator",
  "kodama of the east tree",
  "animar, soul of elements",
  "godo, bandit warlord",
  "jhoira, weatherlight captain",
  "winota, joiner of forces",
  "yuriko, the tiger's shadow",
  "k'rrik, son of yawgmoth",
  "sisay, weatherlight captain",
])

/**
 * Returns the realistic max bracket for a commander.
 * Defaults to 5 (no cap) for unknowns — false positives (capping a deck
 * that COULD hit B5) are worse than false negatives.
 */
export function getCommanderBracketCeiling(commander) {
  if (!commander?.name) return 5
  const name = commander.name.toLowerCase()
  if (B5_INCAPABLE_COMMANDERS.has(name)) return 4
  return 5
}

export function applyCommanderBracketCap(commander, requested) {
  const ceiling = getCommanderBracketCeiling(commander)
  if (requested > ceiling) {
    return { effective: ceiling, capped: true, ceiling }
  }
  return { effective: requested, capped: false, ceiling }
}

export const _internal = {
  B5_INCAPABLE_COMMANDERS,
  B5_CAPABLE_COMMANDERS,
}
