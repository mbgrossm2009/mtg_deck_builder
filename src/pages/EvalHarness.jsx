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

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getCollection, getSelectedCommander, saveSelectedCommander } from '../utils/localStorage'
import { generateDeckWithLLMAssist } from '../services/llmDeckOrchestrator'
import { evaluateDeck } from '../services/llmDeckService'

const STORAGE_KEY = 'deckify-eval-harness-run'
const ALL_BRACKETS = [1, 2, 3, 4, 5]

export default function EvalHarness() {
  // ─── Configuration state ─────────────────────────────────────────────────
  const [commanderCount, setCommanderCount] = useState(5)
  const [brackets, setBrackets]             = useState([1, 2, 3, 4, 5])
  const [pickMode, setPickMode]             = useState('random')   // 'random' | 'manual'
  const [manualPicks, setManualPicks]       = useState([])         // Array<commander card>

  // ─── Run state ───────────────────────────────────────────────────────────
  const [status, setStatus] = useState('idle')   // 'idle' | 'running' | 'paused' | 'done' | 'error'
  const [results, setResults] = useState(loadRun())
  const [currentLabel, setCurrentLabel] = useState('')
  const pauseRef = useRef(false)

  // Persist results on every change
  useEffect(() => { saveRun(results) }, [results])

  // ─── Available commanders from the user's collection ─────────────────────
  const collection = getCollection()
  const allCommanders = collection.filter(c => isLegalCommander(c))

  const totalDecks = (results?.commanders?.flatMap(c => c.brackets ?? []).length ?? 0)
  const targetDecks = (results?.plannedCommanders?.length ?? commanderCount) * brackets.length

  // ─── Run loop ────────────────────────────────────────────────────────────
  const runLoop = useCallback(async (commandersToRun, bracketsToRun, existingResults) => {
    setStatus('running')
    pauseRef.current = false
    const originalCommander = getSelectedCommander()

    try {
      const updated = existingResults ?? newRunResults(commandersToRun, bracketsToRun)
      setResults(updated)

      for (const cmdr of commandersToRun) {
        if (pauseRef.current) break

        // Switch commander for this batch (orchestrator reads from localStorage)
        saveSelectedCommander(cmdr)
        const cmdrEntry = updated.commanders.find(c => c.name === cmdr.name)

        for (const bracket of bracketsToRun) {
          if (pauseRef.current) break

          // Skip brackets we've already done in a prior session
          if (cmdrEntry.brackets.find(b => b.bracket === bracket)) continue

          setCurrentLabel(`${cmdr.name} · Bracket ${bracket}`)

          let deckResult, evalResult
          try {
            deckResult = await generateDeckWithLLMAssist(bracket, null, { twoPass: true })
            if (deckResult?.error) throw new Error(deckResult.error)

            evalResult = await evaluateDeck({
              commander: cmdr,
              bracket,
              deck: deckResult.mainDeck,
            })
          } catch (err) {
            cmdrEntry.brackets.push({
              bracket,
              error: String(err?.message ?? err),
              completedAt: new Date().toISOString(),
            })
            setResults({ ...updated })
            continue
          }

          cmdrEntry.brackets.push({
            bracket,
            deckSize: deckResult.mainDeck.length,
            actualBracket: deckResult.bracketAnalysis?.actualBracket ?? null,
            warnings: (deckResult.warnings ?? []).filter(w => w.severity === 'warning' || w.severity === 'error').map(w => w.message),
            criticalCardCounts: countCriticalCards(deckResult.mainDeck),
            evaluation: evalResult ?? { score: null, summary: 'Eval call failed', strengths: [], weaknesses: [], bracketFitNotes: '' },
            completedAt: new Date().toISOString(),
          })
          setResults({ ...updated })
        }
      }

      updated.completedAt = new Date().toISOString()
      setResults({ ...updated })
      setStatus(pauseRef.current ? 'paused' : 'done')
    } catch (err) {
      console.error('[eval] run error', err)
      setStatus('error')
    } finally {
      // Restore the user's original commander
      if (originalCommander) saveSelectedCommander(originalCommander)
      setCurrentLabel('')
    }
  }, [])

  function handleStart() {
    const commanders = pickMode === 'manual' && manualPicks.length > 0
      ? manualPicks
      : pickRandomCommanders(allCommanders, commanderCount)

    if (commanders.length === 0) {
      alert('No legal commanders in your collection. Load a test collection first?')
      return
    }
    if (brackets.length === 0) {
      alert('Pick at least one bracket.')
      return
    }

    runLoop(commanders, brackets, null)
  }

  function handleResume() {
    if (!results || !results.commanders) return
    const remainingCommanders = results.plannedCommanders.map(name =>
      collection.find(c => c.name === name)
    ).filter(Boolean)
    runLoop(remainingCommanders, brackets, results)
  }

  function handlePause() {
    pauseRef.current = true
    setStatus('paused')
  }

  function handleReset() {
    if (!confirm('Discard the current run results?')) return
    setResults(null)
    setStatus('idle')
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
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
      </p>

      {/* Configuration panel — locked while running */}
      <div style={styles.panel}>
        <h2 style={styles.panelTitle}>Configuration</h2>

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
            ~{commanderCount * brackets.length} decks · ~{Math.round(commanderCount * brackets.length * 2)} min ·
            ~${(commanderCount * brackets.length * 0.05).toFixed(2)}
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

function newRunResults(commanders, brackets) {
  return {
    runId: crypto.randomUUID?.() ?? `run-${Date.now()}`,
    startedAt: new Date().toISOString(),
    completedAt: null,
    plannedCommanders: commanders.map(c => c.name),
    plannedBrackets: brackets,
    commanders: commanders.map(c => ({
      name: c.name,
      colorIdentity: c.color_identity,
      brackets: [],
    })),
  }
}

function loadRun() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveRun(run) {
  try {
    if (run) localStorage.setItem(STORAGE_KEY, JSON.stringify(run))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* quota — ignore */ }
}

// Count cards in deck by category for a quick health-check column.
function countCriticalCards(deck) {
  const tutors      = deck.filter(c => (c.tags ?? []).includes('tutor')).length
  const fastMana    = deck.filter(c => (c.tags ?? []).includes('fast_mana')).length
  const wincons     = deck.filter(c => (c.roles ?? []).includes('win_condition') || (c.tags ?? []).includes('explosive_finisher')).length
  const interaction = deck.filter(c => (c.roles ?? []).includes('removal') || (c.roles ?? []).includes('wipe')).length
  const ramp        = deck.filter(c => (c.roles ?? []).includes('ramp')).length
  return { tutors, fastMana, wincons, interaction, ramp }
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
