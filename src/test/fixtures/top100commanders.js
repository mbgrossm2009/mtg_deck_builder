// Fixture wrapper around top100commanders.json.
//
// 100 commanders curated for mechanic-shape diversity. Source data fetched
// once from Scryfall by scripts/fetch-commander-fixtures.mjs — the JSON is
// the source of truth for oracle text. Re-run that script to refresh.
//
// Use these fixtures any time you need REAL commander oracle text.
// Hand-paraphrased fixtures break the precision tests because Magic
// wording is load-bearing (see memory feedback_oracle_text_precision.md).

import data from './top100commanders.json' with { type: 'json' }

export const TOP_100_COMMANDERS = data

// Look up a commander by name. Tolerant of DFC suffix — "Tergrid" matches
// "Tergrid, God of Fright // Tergrid's Lantern".
export function findCommander(name) {
  const lower = name.toLowerCase()
  return TOP_100_COMMANDERS.find(c => {
    const cn = c.name.toLowerCase()
    if (cn === lower) return true
    // DFC: "Front // Back" — match by front face name OR by front-face prefix
    // (so "Tergrid" matches "Tergrid, God of Fright // Tergrid's Lantern").
    const front = cn.split(' // ')[0]
    if (front === lower) return true
    if (front.startsWith(lower + ',')) return true
    return false
  })
}

// Convenience exports for the commanders that have explicit per-commander
// tests. Spread the JSON object so tests can shape it further if needed.
export const TIAMAT_REAL = findCommander('Tiamat')
export const UR_DRAGON_REAL = findCommander('The Ur-Dragon')
export const SHEOLDRED_REAL = findCommander('Sheoldred, the Apocalypse')
export const ERTAI_REAL = findCommander('Ertai, the Corrupted')
export const WINTER_REAL = findCommander('Winter, Cynical Opportunist')
export const KRENKO_REAL = findCommander('Krenko, Mob Boss')
export const EDGAR_REAL = findCommander('Edgar Markov')
export const KOMA_REAL = null  // Koma not in top-100 list (mid-tier popularity)
export const NIVMIZZET_REAL = findCommander('Niv-Mizzet, Parun')
export const MEREN_REAL = findCommander('Meren of Clan Nel Toth')
export const KORVOLD_REAL = findCommander('Korvold, Fae-Cursed King')
export const KINNAN_REAL = findCommander('Kinnan, Bonder Prodigy')
export const NAJEELA_REAL = findCommander('Najeela, the Blade-Blossom')
export const ATRAXA_REAL = findCommander('Atraxa, Praetors\' Voice')
export const MULDROTHA_REAL = findCommander('Muldrotha, the Gravetide')
export const LORD_WINDGRACE_REAL = findCommander('Lord Windgrace')
export const SYTHIS_REAL = findCommander('Sythis, Harvest\'s Hand')
export const KAALIA_REAL = findCommander('Kaalia of the Vast')
export const KYKAR_REAL = findCommander('Kykar, Wind\'s Fury')
