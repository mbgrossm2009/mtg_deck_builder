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
  // Mono-color life-gain / value commanders. Daxos B5 evals consistently
  // shipped with 1 wincon and 7 interaction (well below cEDH floor of 10)
  // because mono-W simply lacks the tutor / counter / combo density to
  // sustain B5. Building at B4 honestly is better than producing a
  // pretend-B5 deck and getting eval-clamped.
  "daxos, blessed by the sun",
  "amalia benavides aguirre",   // BW life-gain; same shape as Daxos
  "sorin of house markov",       // BW life-gain; same shape as Daxos
  // Other BW life-gain commanders without a cEDH plan.
  // (Heliod, Sun-Crowned NOT included — he has the Walking Ballista combo,
  // which is a real cEDH wincon.)
  "karlov of the ghost council",
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
