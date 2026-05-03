// Deck Doctor — paste any decklist + commander, get a structured per-lens
// diagnosis. No deck-build pipeline involved; pure consumption of the
// knowledge layer.
//
// This page exists to demonstrate the value of the architecture from
// Phase 1-5: the same lenses that grade builder output also grade
// arbitrary user-pasted decklists. New use cases come almost free.

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getCollection } from '../utils/localStorage'
import { parseAuto } from '../utils/cardImportParser'
import { evaluateDecklist } from '../services/deckDoctor'

export default function DeckDoctor() {
  const collection = useMemo(() => getCollection(), [])
  const allCommanders = useMemo(
    () => collection.filter(c => isLegalCommander(c)),
    [collection]
  )
  const cardLookup = useMemo(() => {
    const m = new Map()
    for (const c of collection) m.set(c.name.toLowerCase(), c)
    return m
  }, [collection])

  // ─── Form state ─────────────────────────────────────────────────────────
  const [commanderName, setCommanderName] = useState('')
  const [bracket, setBracket]             = useState(3)
  const [decklistText, setDecklistText]   = useState('')

  // ─── Results state ──────────────────────────────────────────────────────
  const [result, setResult]    = useState(null)
  const [error, setError]      = useState('')
  const [unmatched, setUnmatched] = useState([])

  function runDoctor() {
    setError('')
    setUnmatched([])
    setResult(null)

    const cmdr = allCommanders.find(c => c.name === commanderName)
    if (!cmdr) {
      setError('Pick a commander from your collection.')
      return
    }

    const parsed = parseAuto(decklistText.trim())
    if (!parsed || parsed.length === 0) {
      setError('Decklist is empty or could not be parsed. One card per line, optional "Nx" prefix.')
      return
    }

    // Look up each parsed name in the collection. Expand by quantity.
    const cards = []
    const missing = []
    for (const entry of parsed) {
      const found = cardLookup.get(entry.name.toLowerCase())
      if (!found) {
        missing.push(entry.name)
        continue
      }
      for (let i = 0; i < (entry.quantity ?? 1); i++) {
        cards.push(found)
      }
    }

    if (missing.length > 0) setUnmatched(missing)
    if (cards.length === 0) {
      setError('None of the listed cards were found in your collection.')
      return
    }

    try {
      const out = evaluateDecklist({ commander: cmdr, cards, bracket })
      setResult(out)
    } catch (err) {
      setError(`Evaluation failed: ${err?.message ?? String(err)}`)
    }
  }

  return (
    <div style={styles.page}>
      <h1>Deck Doctor</h1>
      <p style={styles.intro}>
        Paste a decklist and pick its commander. Deck Doctor runs your deck
        through the same analysis lenses as the deck builder — without
        rebuilding it. You'll see per-dimension verdicts (commander
        execution, win plan, bracket fit, mana base) plus per-card evidence
        and actionable suggestions.
      </p>
      <p style={styles.intro}>
        Want to build a deck instead? <Link to="/deck-builder">Deck Builder →</Link>
      </p>

      <div style={styles.form}>
        <label style={styles.label}>
          Commander
          <select
            value={commanderName}
            onChange={e => setCommanderName(e.target.value)}
            style={styles.select}
          >
            <option value="">— select —</option>
            {allCommanders.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Target bracket
          <select
            value={bracket}
            onChange={e => setBracket(Number(e.target.value))}
            style={styles.select}
          >
            {[1, 2, 3, 4, 5].map(b => (
              <option key={b} value={b}>Bracket {b}</option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Decklist (one card per line, optional Nx prefix)
          <textarea
            value={decklistText}
            onChange={e => setDecklistText(e.target.value)}
            placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Demonic Tutor\n...'}
            rows={14}
            style={styles.textarea}
          />
        </label>

        <button onClick={runDoctor} style={styles.button}>
          Run Doctor
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {unmatched.length > 0 && (
        <div style={styles.warning}>
          <strong>{unmatched.length} card{unmatched.length === 1 ? '' : 's'} not in collection — skipped:</strong>{' '}
          {unmatched.slice(0, 8).join(', ')}{unmatched.length > 8 ? `, …+${unmatched.length - 8} more` : ''}
        </div>
      )}

      {result && <DiagnosisReport result={result} />}
    </div>
  )
}

function DiagnosisReport({ result }) {
  const { lensResults, overall, commanderProfile } = result

  return (
    <section style={styles.report}>
      <header style={styles.reportHeader}>
        <VerdictPill verdict={overall.verdict} />
        <div>
          <div style={styles.overallSummary}>{overall.summary}</div>
          <div style={styles.subdued}>
            {overall.passCount} pass · {overall.warnCount} warn · {overall.failCount} fail
          </div>
        </div>
      </header>

      <div style={styles.profileBlock}>
        <strong>{commanderProfile.name}</strong>
        {commanderProfile.tribal.tribe && (
          <span style={styles.tag}>tribe: {commanderProfile.tribal.tribe}</span>
        )}
        {commanderProfile.mechanicTags.slice(0, 4).map(t => (
          <span key={t} style={styles.tag}>{t.replace(/^cares_about_/, '')}</span>
        ))}
        {commanderProfile.bracket.winPlanShapes.map(s => (
          <span key={s} style={styles.tagAccent}>plan: {s.replace(/_/g, ' ')}</span>
        ))}
      </div>

      {lensResults.map(r => <LensCard key={r.name} lens={r} />)}
    </section>
  )
}

function LensCard({ lens }) {
  return (
    <div style={styles.lensCard}>
      <div style={styles.lensHeader}>
        <VerdictPill verdict={lens.verdict} />
        <div style={styles.lensName}>{lens.name.replace(/_/g, ' ')}</div>
        {typeof lens.score === 'number' && (
          <div style={styles.lensScore}>{(lens.score * 100).toFixed(0)}%</div>
        )}
      </div>
      <div style={styles.lensSummary}>{lens.summary}</div>

      {lens.evidence.length > 0 && (
        <details style={styles.details}>
          <summary>Evidence ({lens.evidence.length})</summary>
          <ul style={styles.evidenceList}>
            {lens.evidence.map((e, i) => (
              <li key={i}>
                {e.card && <strong>{e.card}</strong>}{e.card && ' — '}{e.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      {lens.suggestions.length > 0 && (
        <div style={styles.suggestions}>
          <strong>Suggestions:</strong>
          <ul style={styles.suggestionList}>
            {lens.suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function VerdictPill({ verdict }) {
  const color = verdict === 'pass' ? '#1a8a4a'
              : verdict === 'warn' ? '#c47a1a'
              : verdict === 'fail' ? '#b22222'
              :                       '#666'
  return <span style={{ ...styles.pill, backgroundColor: color }}>{verdict}</span>
}

function isLegalCommander(card) {
  const type = (card.type_line ?? '').toLowerCase()
  if (type.includes('legendary creature')) return true
  if (type.includes('planeswalker') && /can be your commander/i.test(card.oracle_text ?? '')) return true
  return false
}

const styles = {
  page: { maxWidth: 900, margin: '0 auto' },
  intro: { color: '#555', maxWidth: 700 },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginTop: 24,
    padding: 20,
    border: '1px solid #ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 500 },
  select: { padding: 8, fontSize: 14, borderRadius: 4, border: '1px solid #ccc' },
  textarea: { padding: 8, fontFamily: 'monospace', fontSize: 13, borderRadius: 4, border: '1px solid #ccc' },
  button: {
    padding: '10px 20px',
    fontSize: 15,
    backgroundColor: '#3a3a8a',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  error: { marginTop: 16, padding: 12, backgroundColor: '#fdd', color: '#900', borderRadius: 4 },
  warning: { marginTop: 16, padding: 12, backgroundColor: '#ffe', color: '#860', borderRadius: 4 },
  report: { marginTop: 32 },
  reportHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 16,
  },
  overallSummary: { fontSize: 16, fontWeight: 500 },
  subdued: { color: '#666', fontSize: 13, marginTop: 4 },
  profileBlock: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f5f5fa',
    borderRadius: 6,
    marginBottom: 24,
  },
  tag: {
    padding: '4px 10px',
    backgroundColor: '#ddd',
    borderRadius: 12,
    fontSize: 12,
    color: '#444',
  },
  tagAccent: {
    padding: '4px 10px',
    backgroundColor: '#cde0ff',
    borderRadius: 12,
    fontSize: 12,
    color: '#0a3a90',
  },
  lensCard: {
    padding: 16,
    border: '1px solid #ddd',
    borderRadius: 8,
    marginBottom: 12,
  },
  lensHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  lensName: { fontSize: 16, fontWeight: 500, textTransform: 'capitalize', flex: 1 },
  lensScore: { fontFamily: 'monospace', color: '#666' },
  lensSummary: { color: '#444', marginBottom: 8 },
  details: { marginTop: 8 },
  evidenceList: { fontSize: 13, color: '#555', marginTop: 6 },
  suggestions: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#fffbe8',
    borderLeft: '3px solid #ddb000',
    borderRadius: 4,
  },
  suggestionList: { margin: '6px 0 0', paddingLeft: 20, color: '#555' },
  pill: {
    padding: '3px 10px',
    color: 'white',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
}
