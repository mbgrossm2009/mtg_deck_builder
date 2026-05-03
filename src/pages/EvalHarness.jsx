// Evaluation harness — run automated multi-commander × multi-bracket
// generations + LLM evaluations to grade the deck-builder algorithm at scale.
//
// Flow:
//   1. User picks N commanders (random from collection, or hand-picked) and
//      a bracket range
//   2. Click "Start run". For each (commander × bracket) pair:
//        - generateDeckWithLLMAssist (full pipeline: Pass 1, 2, 3)
//        - evaluateDeck (separate LLM call that scores 1-10 + strengths/
//          weaknesses)
//        - Stream the result to the table
//        - Auto-save partial results to localStorage
//   3. When the run finishes (or the user pauses), download as JSON
//
// Cost: ~$0.04-0.08 per deck × ~25 decks = ~$1-2 per full run.
// Wall time: ~2 min per deck × 25 = ~50 minutes. Browser tab must stay open.
//
// Resilience: pause/resume controls so long runs don't have to be one shot;
// auto-save after every deck so a crash loses at most one deck of progress.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getCollection } from '../utils/localStorage'
import {
  useEvalRunStore,
  startEvalRun,
  resumeEvalRun,
  pauseEvalRun,
  resetEvalRun,
} from '../lib/evalRunStore'

const ALL_BRACKETS = [1, 2, 3, 4, 5]

export default function EvalHarness() {
  // ─── Configuration state ─────────────────────────────────────────────────
  const [commanderCount, setCommanderCount] = useState(5)
  const [brackets, setBrackets]             = useState([1, 2, 3, 4, 5])
  const [pickMode, setPickMode]             = useState('random')   // 'random' | 'manual'
  const [manualPicks, setManualPicks]       = useState([])         // Array<commander card>
  const [search, setSearch]                 = useState('')

  // ─── Run state — lives in a module-level store so navigating away
  // doesn't kill the loop. The store survives unmount/remount and persists
  // results to localStorage on every change.
  const run = useEvalRunStore()
  const { status, results, currentLabel, errorMsg } = run

  // ─── Available commanders from the user's collection ─────────────────────
  const collection = getCollection()
  const allCommanders = collection.filter(c => isLegalCommander(c))

  // Effective commander list driving the run
  const effectiveCount = pickMode === 'manual' ? manualPicks.length : commanderCount

  const totalDecks = (results?.commanders?.flatMap(c => c.brackets ?? []).length ?? 0)
  const targetDecks = (results?.plannedCommanders?.length ?? effectiveCount) * brackets.length

  // Search-filtered candidate list for the manual picker. Cap at 50 results
  // so the dropdown stays responsive even with a 7500-card collection.
  const manualPickedNames = new Set(manualPicks.map(c => c.name.toLowerCase()))
  const searchResults = pickMode === 'manual' && search.trim().length > 0
    ? allCommanders
        .filter(c =>
          c.name.toLowerCase().includes(search.toLowerCase()) &&
          !manualPickedNames.has(c.name.toLowerCase())
        )
        .slice(0, 50)
    : []

  function addManualPick(card) {
    if (manualPicks.length >= 20) {
      alert('Maximum 20 commanders per run. Remove one to add more.')
      return
    }
    if (manualPickedNames.has(card.name.toLowerCase())) return
    setManualPicks([...manualPicks, card])
    setSearch('')
  }

  function removeManualPick(name) {
    setManualPicks(manualPicks.filter(c => c.name !== name))
  }

  function handleStart() {
    const commanders = pickMode === 'manual'
      ? manualPicks
      : pickRandomCommanders(allCommanders, commanderCount)
    if (commanders.length === 0) {
      alert(pickMode === 'manual'
        ? 'Pick at least one commander manually.'
        : 'No legal commanders in your collection. Load a test collection first?')
      return
    }
    if (brackets.length === 0) {
      alert('Pick at least one bracket.')
      return
    }
    startEvalRun({ commanders, brackets })
  }

  function handleResume() {
    if (!results || !results.commanders) return
    const remainingCommanders = results.plannedCommanders.map(name =>
      collection.find(c => c.name === name)
    ).filter(Boolean)
    resumeEvalRun({ commanders: remainingCommanders, brackets })
  }

  function handlePause() {
    pauseEvalRun()
  }

  function handleReset() {
    if (!confirm('Discard the current run results?')) return
    resetEvalRun()
  }

  function handleDownload() {
    if (!results) return
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eval-run-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const flatRows = (results?.commanders ?? []).flatMap(c =>
    (c.brackets ?? []).map(b => ({ commander: c.name, ...b }))
  )

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Eval Harness</h1>
        <Link to="/deck-builder" style={styles.backLink}>← Back to Deck Builder</Link>
      </div>

      <p style={styles.intro}>
        Auto-generate decks across many commanders + brackets and have ChatGPT
        score each one. Each deck takes ~2 minutes and ~$0.05 in tokens.
        25-deck runs are roughly 50 minutes and $1-2.
        <br />
        <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--text-xs)' }}>
          The loop runs in the background — you can navigate away and come back.
          It survives tab switches, page navigations, and (via auto-save) tab crashes.
          Closing the tab entirely will pause it; resume by returning here.
        </span>
      </p>

      {errorMsg && (
        <div style={styles.errorBanner}>
          <strong>Run error:</strong> {errorMsg}
        </div>
      )}

      {/* Configuration panel — locked while running */}
      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>Configuration</h2>

        <div style={styles.formRow}>
          <label style={styles.label}>Pick mode:</label>
          <div style={styles.bracketRow}>
            <label style={styles.bracketChip}>
              <input
                type="radio"
                name="pickMode"
                checked={pickMode === 'random'}
                disabled={status === 'running'}
                onChange={() => setPickMode('random')}
              />
              Random
            </label>
            <label style={styles.bracketChip}>
              <input
                type="radio"
                name="pickMode"
                checked={pickMode === 'manual'}
                disabled={status === 'running'}
                onChange={() => setPickMode('manual')}
              />
              Manual (pick specific commanders)
            </label>
          </div>
        </div>

        {pickMode === 'random' && (
          <div style={styles.formRow}>
            <label style={styles.label}>Commanders to test:</label>
            <input
              type="number"
              min="1"
              max="20"
              value={commanderCount}
              disabled={status === 'running'}
              onChange={e => setCommanderCount(parseInt(e.target.value) || 1)}
              style={styles.input}
            />
            <span style={styles.hint}>You have {allCommanders.length} legal commanders in your collection</span>
          </div>
        )}

        {pickMode === 'manual' && (
          <div style={styles.formRow}>
            <label style={styles.label}>Pick commanders:</label>
            <div style={styles.manualPicker}>
              <input
                type="text"
                placeholder="Search by name…"
                value={search}
                disabled={status === 'running'}
                onChange={e => setSearch(e.target.value)}
                style={styles.searchInput}
              />
              {searchResults.length > 0 && (
                <div style={styles.searchResults}>
                  {searchResults.map(c => (
                    <button
                      key={c.id ?? c.name}
                      type="button"
                      style={styles.searchResultItem}
                      onClick={() => addManualPick(c)}
                    >
                      <span style={styles.searchResultName}>{c.name}</span>
                      <span style={styles.searchResultMeta}>
                        {(c.color_identity ?? []).join('') || 'C'} · {c.type_line?.split('—')[1]?.trim() ?? ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {search.trim().length > 0 && searchResults.length === 0 && (
                <div style={styles.searchEmpty}>
                  No matching legal commanders in your collection.
                </div>
              )}

              {manualPicks.length > 0 && (
                <div style={styles.pickedList}>
                  <div style={styles.pickedHeader}>
                    Selected ({manualPicks.length}/20):
                  </div>
                  <div style={styles.chipRow}>
                    {manualPicks.map(c => (
                      <button
                        key={c.id ?? c.name}
                        type="button"
                        style={styles.pickedChip}
                        disabled={status === 'running'}
                        onClick={() => removeManualPick(c.name)}
                        title="Click to remove"
                      >
                        ✕ {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {manualPicks.length === 0 && (
                <div style={styles.hint}>
                  Search and click commanders to add them. Up to 20 per run.
                </div>
              )}
            </div>
          </div>
        )}

        <div style={styles.formRow}>
          <label style={styles.label}>Brackets to test:</label>
          <div style={styles.bracketRow}>
            {ALL_BRACKETS.map(b => (
              <label key={b} style={styles.bracketChip}>
                <input
                  type="checkbox"
                  checked={brackets.includes(b)}
                  disabled={status === 'running'}
                  onChange={e => {
                    if (e.target.checked) setBrackets([...brackets, b].sort())
                    else setBrackets(brackets.filter(x => x !== b))
                  }}
                />
                B{b}
              </label>
            ))}
          </div>
        </div>

        <div style={styles.formRow}>
          <label style={styles.label}>Estimate:</label>
          <span style={styles.hint}>
            ~{effectiveCount * brackets.length} decks · ~{Math.round(effectiveCount * brackets.length * 2)} min ·
            ~${(effectiveCount * brackets.length * 0.05).toFixed(2)}
          </span>
        </div>

        <div style={styles.actions}>
          {status === 'idle' && (
            <button className="btn btn-primary" onClick={handleStart}>Start run</button>
          )}
          {status === 'running' && (
            <button className="btn btn-warning" onClick={handlePause}>Pause</button>
          )}
          {status === 'paused' && (
            <>
              <button className="btn btn-primary" onClick={handleResume}>Resume</button>
              <button className="btn btn-ghost" onClick={handleReset}>Discard & reset</button>
            </>
          )}
          {(status === 'done' || status === 'error') && (
            <>
              <button className="btn btn-primary" onClick={handleDownload}>Download JSON</button>
              <button className="btn btn-ghost" onClick={handleReset}>New run</button>
            </>
          )}
        </div>
      </div>

      {/* Live progress */}
      {(status === 'running' || status === 'paused') && (
        <div style={styles.progressPanel}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>
              {totalDecks} / {targetDecks} decks complete
            </span>
            {status === 'running' && currentLabel && (
              <span style={styles.currentLabel}>Now: {currentLabel}</span>
            )}
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(totalDecks / Math.max(targetDecks, 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Results table */}
      {flatRows.length > 0 && (
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>Results ({flatRows.length})</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Commander</th>
                <th style={styles.th}>Bracket</th>
                <th style={styles.th}>Score</th>
                <th style={styles.th}>Critical cards</th>
                <th style={styles.th}>Top strength</th>
                <th style={styles.th}>Top weakness</th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map((row, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>{row.commander}</td>
                  <td style={styles.td}>B{row.bracket}{row.actualBracket && row.actualBracket !== row.bracket ? ` (actual B${row.actualBracket})` : ''}</td>
                  <td style={{ ...styles.td, ...scoreCellStyle(row.evaluation?.score) }}>
                    {row.error ? '⚠' : row.evaluation?.score ?? '?'}
                  </td>
                  <td style={styles.td}>{row.criticalCardCounts ? formatCriticalCards(row.criticalCardCounts) : '-'}</td>
                  <td style={styles.tdSmall}>
                    {row.error ? '' : (row.evaluation?.topStrength ?? row.evaluation?.strengths?.[0] ?? '')}
                  </td>
                  <td style={styles.tdSmall}>
                    {row.error ? row.error : (row.evaluation?.weaknesses?.[0] ?? row.evaluation?.summary ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────────

function isLegalCommander(card) {
  const tl = (card?.type_line ?? '').toLowerCase()
  // Standard commanders: legendary creatures. Also allow planeswalkers that
  // explicitly say they can be your commander (rare; oracle text check).
  if (tl.includes('legendary') && tl.includes('creature')) return true
  if (tl.includes('planeswalker') && /can be your commander/i.test(card.oracle_text ?? '')) return true
  return false
}

function pickRandomCommanders(pool, count) {
  if (count >= pool.length) return pool.slice()
  const shuffled = pool.slice()
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, count)
}

function formatCriticalCards(c) {
  return `R${c.ramp}/T${c.tutors}/F${c.fastMana}/W${c.wincons}/I${c.interaction}`
}

function scoreCellStyle(score) {
  if (score == null) return { color: 'var(--text-subtle)' }
  if (score >= 8) return { color: 'var(--success)', fontWeight: 700 }
  if (score >= 6) return { color: 'var(--text)', fontWeight: 600 }
  if (score >= 4) return { color: 'var(--warning)', fontWeight: 600 }
  return { color: 'var(--danger)', fontWeight: 700 }
}

const styles = {
  page: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: 'var(--space-6)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-3)',
  },
  title: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
  },
  backLink: {
    color: 'var(--accent)',
    textDecoration: 'none',
    fontSize: 'var(--text-sm)',
  },
  intro: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    marginBottom: 'var(--space-5)',
  },
  errorBanner: {
    background: 'rgba(244, 63, 94, 0.10)',
    border: '1px solid rgba(244, 63, 94, 0.30)',
    color: 'var(--danger)',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
    fontSize: 'var(--text-sm)',
  },
  panel: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    marginBottom: 'var(--space-4)',
  },
  panelTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 700,
    marginBottom: 'var(--space-4)',
  },
  formRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
    flexWrap: 'wrap',
  },
  label: {
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    minWidth: 180,
    color: 'var(--text)',
  },
  input: {
    width: 80,
    padding: '6px 10px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    fontSize: 'var(--text-sm)',
  },
  hint: {
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
  },
  bracketRow: {
    display: 'flex',
    gap: 'var(--space-2)',
  },
  bracketChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-2)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
  },
  manualPicker: {
    flex: 1,
    minWidth: 300,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    fontSize: 'var(--text-sm)',
  },
  searchResults: {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    maxHeight: 240,
    overflowY: 'auto',
  },
  searchResultItem: {
    display: 'flex',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  searchResultName: {
    fontWeight: 600,
    fontSize: 'var(--text-sm)',
  },
  searchResultMeta: {
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'ui-monospace, monospace',
  },
  searchEmpty: {
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-sm)',
    fontStyle: 'italic',
    padding: 'var(--space-2)',
  },
  pickedList: {
    marginTop: 'var(--space-2)',
  },
  pickedHeader: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--text-subtle)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 'var(--space-2)',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
  },
  pickedChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    background: 'var(--accent-soft, rgba(124, 58, 237, 0.15))',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--accent-hover, var(--accent))',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-3)',
  },
  progressPanel: {
    background: 'var(--surface-1)',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 'var(--space-2)',
  },
  progressLabel: {
    fontSize: 'var(--text-base)',
    fontWeight: 700,
    color: 'var(--text)',
  },
  currentLabel: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    fontFamily: 'ui-monospace, monospace',
  },
  progressBar: {
    height: 8,
    background: 'var(--surface-2)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    transition: 'width 200ms ease',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'var(--text-sm)',
  },
  th: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '2px solid var(--border-strong)',
    color: 'var(--text-subtle)',
    fontWeight: 600,
    fontSize: 'var(--text-xs)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tr: {
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--text)',
    verticalAlign: 'top',
  },
  tdSmall: {
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.5,
    maxWidth: 400,
  },
}
