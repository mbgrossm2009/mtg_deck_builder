// Known deck-list section headers to skip
const SECTION_HEADERS = new Set([
  'commander', 'companion', 'creatures', 'creature', 'instants', 'instant',
  'sorceries', 'sorcery', 'artifacts', 'artifact', 'enchantments', 'enchantment',
  'lands', 'land', 'planeswalkers', 'planeswalker', 'sideboard', 'maybeboard',
  'spells', 'other spells', 'nonland', 'nonlands',
])

// Known finish/treatment suffixes that appear after the card name in various export formats
const FINISH_PATTERN = /\s*\((?:foil|etched|extended art|borderless|showcase|retro|golden age|alt art|alternate art|promo|textured|halo|step-and-compleat|galaxy|surge|oil slick|raised foil|double rainbow|gilded|neon ink)\)/gi

// Strip trailing set code annotations and foil/finish markers from an extracted name.
// Handles: "(CMM) 400", "[C21]", "*F*", "(Foil)", "Card - MH1 - Five Color", etc.
function stripSetInfo(str) {
  return str
    // Strip everything after a " - " separator (TCGPlayer/CK exports often append
    // " - SET - Category" suffixes like "- MH1 - Five Color"). Magic card names
    // don't contain " - " so this is safe.
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s*\d*/g, '')   // (CMM) 400  — case-insensitive set code
    .replace(/\s+\[[A-Za-z0-9]{2,6}\]\s*\d*/g, '')    // [C21]
    .replace(/\s*\*[^*]+\*/g, '')                      // *F*  *FOIL*  (MTGO/Manabox foil marker)
    .replace(FINISH_PATTERN, '')                       // (Foil)  (Etched)  (Extended Art)  etc.
    // Strip any remaining trailing parenthetical (e.g., "(Retro Frame)",
    // "(Old Border)", "(Anime)" — treatment markers we haven't enumerated).
    // Real Magic card names don't end in " (something)".
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()
}

function parseSingleLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Skip pure section headers
  if (SECTION_HEADERS.has(trimmed.toLowerCase())) return null

  // Skip lines that are only digits (page numbers, totals, etc.)
  if (/^\d+$/.test(trimmed)) return null

  // Match "1 Sol Ring" / "1x Sol Ring" / "1X Sol Ring"
  const match = trimmed.match(/^(\d+)[xX]?\s+(.+)$/)
  if (match) {
    const qty = parseInt(match[1], 10)
    const name = stripSetInfo(match[2])
    if (!name) return null
    const warnings = []
    if (qty < 1) warnings.push('Quantity was invalid, defaulted to 1')
    return { name, quantity: qty >= 1 ? qty : 1, sourceLine: line, warnings }
  }

  // No quantity prefix — whole line is the card name
  const name = stripSetInfo(trimmed)
  if (!name) return null
  return { name, quantity: 1, sourceLine: line, warnings: [] }
}

// Merge cards with the same name (case-insensitive), summing quantities
function deduplicateCards(cards) {
  const map = new Map()
  for (const card of cards) {
    const key = card.name.toLowerCase()
    if (map.has(key)) {
      const existing = map.get(key)
      existing.quantity += card.quantity
      if (card.warnings.length) existing.warnings.push(...card.warnings)
    } else {
      map.set(key, { ...card })
    }
  }
  return Array.from(map.values())
}

// Parse plain-text / Manabox-style card lists
export function parseImportedText(inputText) {
  const lines = inputText.split(/\r?\n/)
  const parsed = []
  for (const line of lines) {
    const result = parseSingleLine(line)
    if (result) parsed.push(result)
  }
  return deduplicateCards(parsed)
}

// Split a CSV row, respecting double-quoted fields. Handles fields with
// embedded commas like `"Atraxa, Praetors' Voice"` which Moxfield/EDHREC
// exports produce. Also handles `""` as an escaped quote inside a field.
function splitCsvRow(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      // `""` inside a quoted field → literal `"`
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map(c => c.trim())
}

// Parse CSV text with flexible header detection
export function parseCsvText(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  const firstRow = splitCsvRow(lines[0]).map(c => c.toLowerCase().replace(/"/g, ''))
  const nameAliases = ['name', 'card name', 'card_name', 'cardname']
  const qtyAliases  = ['quantity', 'qty', 'count', 'amount', 'copies']

  const nameIdx = firstRow.findIndex(h => nameAliases.includes(h))
  const qtyIdx  = firstRow.findIndex(h => qtyAliases.includes(h))

  const hasHeaders = nameIdx !== -1
  const dataLines  = hasHeaders ? lines.slice(1) : lines

  const parsed = []
  for (const line of dataLines) {
    const row = splitCsvRow(line)
    if (row.every(c => !c)) continue

    let name = ''
    let qty  = 1

    if (hasHeaders) {
      name = row[nameIdx] ?? ''
      qty  = qtyIdx !== -1 ? parseInt(row[qtyIdx], 10) || 1 : 1
    } else {
      // Positional: "qty, name" or "name, qty" or "name only"
      if (row.length >= 2) {
        if (/^\d+$/.test(row[0])) {
          qty  = parseInt(row[0], 10) || 1
          name = row[1]
        } else if (/^\d+$/.test(row[row.length - 1])) {
          name = row[0]
          qty  = parseInt(row[row.length - 1], 10) || 1
        } else {
          name = row[0]
        }
      } else {
        name = row[0]
      }
    }

    name = stripSetInfo(name)
    if (!name) continue

    const warnings = []
    if (isNaN(qty) || qty < 1) {
      warnings.push('Invalid quantity, defaulted to 1')
      qty = 1
    }
    parsed.push({ name, quantity: qty, sourceLine: line, warnings })
  }

  return deduplicateCards(parsed)
}

// Auto-detect CSV vs plain-text by sniffing the first line
export function parseAuto(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) ?? ''
  const cols = firstLine.split(',').map(c => c.trim().toLowerCase())
  const csvKeywords = ['name', 'card', 'quantity', 'qty', 'count', 'amount']
  const looksLikeCsv =
    cols.length >= 2 && cols.some(c => csvKeywords.some(k => c.includes(k)))
  return looksLikeCsv ? parseCsvText(text) : parseImportedText(text)
}

// Final filter: remove anything with no name or qty < 1
export function normalizeImportedCards(cards) {
  return cards.filter(c => c.name && c.quantity >= 1)
}

// Exported so validation can re-clean names already stored with junk attached.
// Also strips bare trailing set codes with no separator (e.g. "VizzerdrixS5" → "Vizzerdrix"),
// which some export tools produce by concatenating name + edition code directly.
export function cleanCardName(name) {
  const base = stripSetInfo(name)
  // Strip a trailing uppercase-letter + digit(s) code with no preceding space,
  // only when the result would still be a plausible card name (>3 chars remaining).
  const deglued = base.replace(/([a-z])([A-Z][0-9]+)$/, '$1')
  return deglued.length > 3 ? deglued : base
}
