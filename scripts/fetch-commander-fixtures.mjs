// One-time fetch script. Pulls 100 curated commanders from Scryfall and
// writes a trimmed JSON fixture to src/test/fixtures/top100commanders.json.
//
// The list is curated for MECHANIC SHAPE diversity, not just popularity.
// Each commander represents a distinct strategic profile so the test suite
// exercises every codepath in archetype/mechanic-tag detection.
//
// Usage:  node scripts/fetch-commander-fixtures.mjs
// Re-run only when the curated list changes.

import fs from 'node:fs/promises'
import path from 'node:path'

// 100 commanders bucketed by mechanic shape. Comments flag what each one
// is supposed to test — keep this in sync with the test-suite expectations.
const COMMANDER_NAMES = [
  // === TRIBAL — oracle text references the type (18) ===
  'Tiamat',                                  // dragons + tutor
  'Edgar Markov',                            // vampires + tokens
  'Krenko, Mob Boss',                        // goblins + tokens
  'Marwyn, the Nurturer',                    // elves + +1/+1 counters + ramp
  'The Ur-Dragon',                           // dragons + cost reduction + cascade
  'Lathril, Blade of the Elves',             // elves + lifedrain + tokens
  'Sliver Hivelord',                         // slivers + indestructible
  'Sliver Legion',                           // slivers + anthem
  'The First Sliver',                        // slivers + cascade
  'Wilhelt, the Rotcleaver',                 // zombies + tokens + sac
  'Ezuri, Renegade Leader',                  // elves + overrun
  'Goreclaw, Terror of Qal Sisma',           // creatures cost reduction (4+ power)
  'Kaalia of the Vast',                      // angels/dragons/demons cheat
  'Animar, Soul of Elements',                // creatures cost reduction + counters
  'Atla Palani, Nest Tender',                // creatures cheat from eggs
  'Toski, Bearer of Secrets',                // squirrels + draw on combat damage
  'Galadriel of Lothlórien',                 // elves + tokens
  'Lathliss, Dragon Queen',                  // dragons + tokens

  // === NON-TRIBAL with tribal creature type (5) — should NOT enforce tribal ===
  'Winter, Cynical Opportunist',             // Human Warlock — text doesn't say so
  'Esika, God of the Tree',                  // 5-color value (DFC; front face)
  'Yarok, the Desecrated',                   // Nightmare Horror — ETB doubler
  'Kykar, Wind\'s Fury',                     // Bird Wizard — instant/sorcery payoff
  'Talrand, Sky Summoner',                   // Merfolk Wizard — instant/sorcery tokens

  // === DRAW / LIFEGAIN / LIFELOSS punishment (8) ===
  'Sheoldred, the Apocalypse',               // draw triggers life swap
  'K\'rrik, Son of Yawgmoth',                // pay-life mono-black
  'Oloro, Ageless Ascetic',                  // lifegain incremental
  'Vito, Thorn of the Dusk Rose',            // lifegain converts to drain
  'Elenda, the Dusk Rose',                   // lifegain + tokens on death
  'Karlov of the Ghost Council',             // lifegain counters
  'Heliod, Sun-Crowned',                     // lifegain triggers counters
  'Greven, Predator Captain',                // lifeloss + draw

  // === ARISTOCRATS / SACRIFICE (8) ===
  'Meren of Clan Nel Toth',                  // graveyard + sacrifice + experience
  'Ertai, the Corrupted',                    // sac + counterspell control
  'Korvold, Fae-Cursed King',                // sacrifice + draw + counters
  'Yahenni, Undying Partisan',               // sac outlet + indestructible
  'Yawgmoth, Thran Physician',               // sac + draw + -1/-1 counters
  'Teysa Karlov',                            // double death triggers
  'Judith, the Scourge Diva',                // creatures dying + anthem
  'Mazirek, Kraul Death Priest',             // sacrifice → +1/+1 counters

  // === SPELLSLINGER (6) ===
  'Niv-Mizzet, Parun',                       // draw → damage
  'Mizzix of the Izmagnus',                  // experience cost reduction for spells
  'Veyran, Voice of Duality',                // spell triggers double + magecraft
  'Kalamax, the Stormsire',                  // first instant copies
  'Mishra, Eminent One',                     // historic spells trigger
  'Krark, the Thumbless',                    // coin flip + spell return

  // === TOKEN (5) ===
  'Adrix and Nev, Twincasters',              // tokens double
  'Rhys the Redeemed',                       // double tokens (active)
  'Ghave, Guru of Spores',                   // counters + tokens + sac
  'Skrelv, Defector Mite',                   // toxic + protection
  'Saskia the Unyielding',                   // double damage to chosen player

  // === VOLTRON / COMBAT (6) ===
  'Najeela, the Blade-Blossom',              // combat extra-step combo
  'Uril, the Miststalker',                   // auras + +2/+2
  'Light-Paws, Emperor\'s Voice',            // auras tutor + cast
  'Akiri, Fearless Voyager',                 // equipment draw
  'Halvar, God of Battle',                   // equipment swap (DFC; front face)
  'Skullbriar, the Walking Grave',           // counters persist through zones

  // === COMBO (6) ===
  'Kinnan, Bonder Prodigy',                  // mana doubler nonland tap
  'Urza, Lord High Artificer',               // artifact mana + impulse
  'Thrasios, Triton Hero',                   // partner — pay 4 to scry/draw
  'Tymna the Weaver',                        // partner — combat damage draw
  'Yidris, Maelstrom Wielder',               // cascade after combat
  'Kenrith, the Returned King',              // five activated abilities

  // === STAX / CONTROL (6) ===
  'Tergrid, God of Fright',                  // discard/sac → steal (DFC; front face)
  'Derevi, Empyrial Tactician',              // tap/untap + free recur
  'Winota, Joiner of Forces',                // non-Human attack → cheat Humans
  'Sen Triplets',                            // play opponent's hand
  'Grand Arbiter Augustin IV',               // cost-reduction stax
  'Yuriko, the Tiger\'s Shadow',             // ninjutsu + top-of-library damage

  // === LANDS (5) ===
  'Lord Windgrace',                          // landfall recursion
  'Tatyova, Benthic Druid',                  // landfall draw
  'Omnath, Locus of Creation',               // landfall mana cascade
  'Aesi, Tyrant of Gyre Strait',             // landfall draw + extra land
  'Borborygmos and Fblthp',                  // lands as cards in hand

  // === COUNTERS / +1/+1 (6) ===
  'Atraxa, Praetors\' Voice',                // proliferate + 4-color
  'Chulane, Teller of Tales',                // creatures ETB → draw + bounce land
  'Hamza, Guardian of Arashin',              // counters cost-reduction
  'Pir, Imaginative Rascal',                 // +1/+1 counters get +1
  'Vorel of the Hull Clade',                 // double counters
  'Ezuri, Claw of Progress',                 // experience + +1/+1 counters

  // === GRAVEYARD / RECURSION (6) ===
  'Muldrotha, the Gravetide',                // play permanents from graveyard
  'Karador, Ghost Chieftain',                // creatures from graveyard
  'Kess, Dissident Mage',                    // cast instant/sorcery from graveyard
  'Sidisi, Brood Tyrant',                    // mill + zombie tokens
  'Tasigur, the Golden Fang',                // recursion + delve
  'The Mimeoplasm',                          // graveyard hybrid

  // === COST REDUCTION / CASCADE (3) ===
  'Inalla, Archmage Ritualist',              // wizard ETB token + experience
  'Edric, Spymaster of Trest',               // attack triggers draw
  'Maelstrom Wanderer',                      // cascade ×2 + haste

  // === ENCHANTMENTS (3) ===
  'Sythis, Harvest\'s Hand',                 // enchantment ETB → draw + life
  'Tuvasa the Sunlit',                       // enchantment count → +1/+1 + draw
  'Kestia, the Cultivator',                  // enchantments + bestow draw

  // === ROUND OUT TO 100 (9 more) ===
  'Niv-Mizzet Reborn',                       // 5-color multicolor draw
  'Sisay, Weatherlight Captain',             // legendary tutor
  'Captain Sisay',                           // older legendary tutor
  'Slimefoot, the Stowaway',                 // saproling tribal + drain
  'Daretti, Scrap Savant',                   // artifacts + discard reanimator
  'Brago, King Eternal',                     // blink ETB
  'Gishath, Sun\'s Avatar',                  // dinosaur tribal cheat
  'Nekusar, the Mindrazer',                  // wheels + damage
  'Atarka, World Render',                    // dragon tribal aggro double strike
]

console.log(`Curated list: ${COMMANDER_NAMES.length} commanders`)

if (COMMANDER_NAMES.length !== 100) {
  console.error(`Expected exactly 100 commanders, got ${COMMANDER_NAMES.length}`)
  process.exit(1)
}

// Scryfall /cards/collection accepts up to 75 identifiers per request.
// Split into 2 batches.
const BATCH_SIZE = 75
const batches = []
for (let i = 0; i < COMMANDER_NAMES.length; i += BATCH_SIZE) {
  batches.push(COMMANDER_NAMES.slice(i, i + BATCH_SIZE))
}

const allCards = []
const notFound = []

for (let bi = 0; bi < batches.length; bi++) {
  const batch = batches[bi]
  console.log(`Fetching batch ${bi + 1}/${batches.length} (${batch.length} cards)...`)

  const body = JSON.stringify({
    identifiers: batch.map(name => ({ name })),
  })

  const res = await fetch('https://api.scryfall.com/cards/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body,
  })

  if (!res.ok) {
    console.error(`Scryfall returned ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data = await res.json()
  if (data.data) allCards.push(...data.data)
  if (data.not_found) notFound.push(...data.not_found.map(nf => nf.name))

  // Polite delay between batches.
  if (bi < batches.length - 1) {
    await new Promise(r => setTimeout(r, 200))
  }
}

if (notFound.length > 0) {
  console.warn(`Not found (${notFound.length}):`, notFound)
}
console.log(`Fetched ${allCards.length} of ${COMMANDER_NAMES.length} cards`)

// Trim to the fields the test suite cares about. Match the shape used by
// existing fixtures (src/test/fixtures/commanders.js).
const trimmed = allCards.map(c => ({
  name: c.name,
  type_line: c.type_line ?? '',
  oracle_text: c.oracle_text ?? extractOracleFromFaces(c) ?? '',
  mana_cost: c.mana_cost ?? '',
  cmc: c.cmc ?? 0,
  colors: c.colors ?? [],
  color_identity: c.color_identity ?? [],
  legalities: { commander: c.legalities?.commander ?? 'unknown' },
  rarity: c.rarity ?? 'unknown',
  edhrec_rank: c.edhrec_rank ?? null,
  // Keep card_faces so DFC / split commanders (Esika, Halvar, Tergrid) are intact.
  card_faces: c.card_faces ?? null,
  image_uris: null,
  quantity: 1,
}))

// Sort by edhrec_rank for stable output (commanders without rank go last).
trimmed.sort((a, b) => {
  const ar = a.edhrec_rank ?? Infinity
  const br = b.edhrec_rank ?? Infinity
  return ar - br
})

function extractOracleFromFaces(card) {
  if (!Array.isArray(card.card_faces)) return null
  return card.card_faces.map(f => f.oracle_text ?? '').filter(Boolean).join('\n//\n')
}

const outPath = path.join('src', 'test', 'fixtures', 'top100commanders.json')
await fs.writeFile(outPath, JSON.stringify(trimmed, null, 2) + '\n', 'utf8')
console.log(`Wrote ${outPath} (${trimmed.length} commanders)`)
