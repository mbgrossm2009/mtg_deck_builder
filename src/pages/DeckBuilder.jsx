import { useState, useCallback, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { getSelectedCommander, saveDeck, getDeck } from '../utils/localStorage'
import { getCardImage } from '../utils/scryfallApi'
import { generateDeck } from '../rules/deckGenerator'
import { generateDeckWithLLMAssist } from '../services/llmDeckOrchestrator'
import { BRACKET_LABELS } from '../rules/bracketRules'
import { useGenerationStore, startGeneration, clearGeneration } from '../lib/generationStore'

const COLOR_PIPS = {
  W: { bg: '#f5f0e8', color: '#4a3728' },
  U: { bg: '#1a6fb0', color: '#fff'    },
  B: { bg: '#2c2c2c', color: '#c0c0c0' },
  R: { bg: '#d43f1e', color: '#fff'    },
  G: { bg: '#1a7a3a', color: '#fff'    },
}

const ROLE_LABELS = {
  land:          'Lands',
  ramp:          'Ramp',
  draw:          'Card Draw',
  removal:       'Removal',
  wipe:          'Board Wipes',
  protection:    'Protection',
  win_condition: 'Win Conditions',
  tutor:         'Tutors',
  synergy:       'Synergy',
  filler:        'Other',
}

const ROLE_ORDER = ['land', 'ramp', 'draw', 'removal', 'wipe', 'protection', 'win_condition', 'tutor', 'synergy', 'filler']

const SEVERITY_COLORS = { error: 'var(--danger)', warning: 'var(--warning)', info: '#60a5fa' }

// Bracket tint mapping — each bracket gets an MTG color personality.
// B1 Exhibition / B2 Core feel casual = white (life-gain, tokens, low-power).
// B3 Upgraded sits in the middle = blue (analysis, optimization).
// B4 Optimized leans aggressive = red (fast mana, fast wins).
// B5 Competitive is the apex = black (tutors, combos, no mercy).
// G is reserved for the "Generate with AI" sparkle treatment.
const BRACKET_TINT = {
  1: { glow: 'var(--mana-w-glow)', soft: 'var(--mana-w-soft)', fg: 'var(--mana-w)' },
  2: { glow: 'var(--mana-w-glow)', soft: 'var(--mana-w-soft)', fg: 'var(--mana-w)' },
  3: { glow: 'var(--mana-u-glow)', soft: 'var(--mana-u-soft)', fg: 'var(--mana-u)' },
  4: { glow: 'var(--mana-r-glow)', soft: 'var(--mana-r-soft)', fg: 'var(--mana-r)' },
  5: { glow: 'var(--mana-b-glow)', soft: 'var(--mana-b-soft)', fg: 'var(--mana-b)' },
}

export default function DeckBuilder() {
  const location = useLocation()
  const navigate = useNavigate()
  const loadDeckId = location.state?.loadDeckId ?? null

  // Hydrate state lazily from the deck-to-load (if any) so we don't bounce through useEffect+setState.
  const initialDeck = loadDeckId ? getDeck(loadDeckId) : null

  const [bracket, setBracket]         = useState(3)
  const [showExcluded, setShowExcluded] = useState(false)
  const [showExplanation, setShowExplanation] = useState(false)
  const [hoveredCard, setHoveredCard] = useState(null)
  const [loadedDeck, setLoadedDeck]   = useState(initialDeck)
  const [saveName, setSaveName]       = useState(initialDeck?.name ?? '')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveToast, setSaveToast]     = useState(null)
  const [primaryArchetype, setPrimaryArchetype] = useState(null)

  // Generation state lives in a module-level store (src/lib/generationStore.js)
  // so it survives page navigation. The Promise runs in the store; the
  // component just subscribes. Persisted to localStorage so a completed deck
  // also survives reloads (24h TTL).
  const gen = useGenerationStore()
  const generating = gen.status === 'generating'
  const aiStage    = gen.stage
  // A loaded saved deck takes precedence (Supabase-backed, persistent on its
  // own). Otherwise show the latest generation result. Errors are also
  // displayed via the same channel.
  const result = loadedDeck
    ? deckToResult(loadedDeck, bracket)
    : (gen.status === 'error' ? { error: gen.error } : gen.result)

  const commander = loadedDeck?.commander ?? getSelectedCommander()

  // Clear the location state so a refresh doesn't re-load the same deck.
  useEffect(() => {
    if (loadDeckId) navigate(location.pathname, { replace: true, state: null })
  }, [loadDeckId, navigate, location.pathname])

  const handleGenerate = useCallback(() => {
    setLoadedDeck(null)
    setSaveName('')
    startGeneration({
      bracket,
      primaryArchetype,
      generator: () => generateDeck(bracket, primaryArchetype),
    })
  }, [bracket, primaryArchetype])

  // Automated three-pass AI generation. Pass 1 picks the strategy + core engine,
  // Pass 2 fills the remaining slots around it, Pass 3 critiques the finished
  // deck and applies up to 5 targeted swaps. All calls go through the /api/llm
  // Vercel function so the OpenAI key never leaves the server. If /api/llm
  // fails the orchestrator falls back to the heuristic generator and surfaces
  // a warning.
  const handleGenerateAI = useCallback(() => {
    setLoadedDeck(null)
    setSaveName('')
    startGeneration({
      bracket,
      primaryArchetype,
      generator: ({ onProgress }) => generateDeckWithLLMAssist(bracket, primaryArchetype, {
        twoPass: true,
        onProgress,
      }),
    })
  }, [bracket, primaryArchetype])

  const handleOpenSave = useCallback(() => {
    if (!saveName) setSaveName(commander ? `${commander.name} deck` : 'Untitled deck')
    setShowSaveDialog(true)
  }, [saveName, commander])

  const handleConfirmSave = useCallback(() => {
    const name = saveName.trim()
    if (!name || !result || !commander) return
    let saved
    try {
      saved = saveDeck({
        id:        loadedDeck?.id,
        name,
        commander,
        mainDeck:  result.mainDeck,
      })
    } catch (err) {
      const msg = err?.userMessage ?? `Save failed: ${err?.message ?? err}`
      setSaveToast(msg)
      setTimeout(() => setSaveToast(curr => (curr === msg ? null : curr)), 5000)
      return
    }
    setLoadedDeck(saved)
    setShowSaveDialog(false)
    setSaveToast(`Saved "${saved.name}"`)
    setTimeout(() => setSaveToast(curr => (curr === `Saved "${saved.name}"` ? null : curr)), 2500)
  }, [saveName, result, commander, loadedDeck])

  const handleCopyDeck = useCallback(async () => {
    if (!result || !commander) return
    const text = formatDeckForClipboard(commander, result.mainDeck)
    try {
      await navigator.clipboard.writeText(text)
      setSaveToast('Deck copied to clipboard')
    } catch {
      // Fallback: surface the text in a prompt so the user can copy manually
      window.prompt('Copy deck (Cmd/Ctrl+C):', text)
      setSaveToast('Use the dialog to copy manually')
    }
    setTimeout(() => setSaveToast(curr => (curr?.startsWith('Deck copied') || curr?.startsWith('Use the dialog') ? null : curr)), 2500)
  }, [result, commander])

  const handleDownloadDeck = useCallback(() => {
    if (!result || !commander) return
    const text = formatDeckForClipboard(commander, result.mainDeck)
    const safeName = (loadedDeck?.name ?? `${commander.name} deck`).replace(/[^a-z0-9-_ ]/gi, '_').trim() || 'deck'
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSaveToast(`Downloaded ${safeName}.txt`)
    setTimeout(() => setSaveToast(curr => (curr?.startsWith('Downloaded') ? null : curr)), 2500)
  }, [result, commander, loadedDeck])

  if (!commander) {
    return (
      <div style={styles.page}>
        <header style={styles.pageHeader}>
          <h1 style={styles.heading}>Deck Builder</h1>
          <p style={styles.subhead}>Generate a 99-card deck tuned to your commander.</p>
        </header>
        <div style={styles.emptyState}>
          <div className="empty-state-ornament" aria-hidden>◆</div>
          <div style={styles.emptyTitle}>Pick a commander to start building</div>
          <div style={styles.emptyDesc}>
            Every deck is built around your commander's color identity, abilities,
            and strategy — and the cards you actually own. Choose one and come back here.
          </div>
          <Link to="/commander" className="btn btn-primary" style={styles.emptyBtn}>
            Choose Commander →
          </Link>
        </div>
      </div>
    )
  }

  const groupedDeck = result && !result.error ? groupByPrimaryRole(result.mainDeck) : null

  return (
    <div style={styles.page}>
      <header style={styles.pageHeader}>
        <div style={styles.pageEyebrow}>
          <span aria-hidden style={styles.pageEyebrowOrnament}>◆</span>
          Deck Builder
        </div>
        <h1 style={styles.heading}>Build your 99</h1>
        <p style={styles.subhead}>Tune the bracket and let BuiltFromBulk assemble a deck around your commander — using only the cards you already own.</p>
      </header>

      {/* Commander strip */}
      <CommanderStrip commander={commander} />

      {/* Bracket selector */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Target Bracket</div>
        <div style={styles.bracketRow}>
          {[1, 2, 3, 4, 5].map(b => {
            const tint = BRACKET_TINT[b]
            const isActive = bracket === b
            const activeStyle = isActive && tint ? {
              borderColor: tint.glow,
              background: tint.soft,
              color: 'var(--text)',
              boxShadow: `0 0 0 1px ${tint.glow}, 0 4px 16px ${tint.glow}`,
            } : (isActive ? styles.bracketBtnActive : {})
            const numStyle = isActive && tint ? { color: tint.fg } :
                             (isActive ? styles.bracketNumActive : {})
            return (
              <button
                key={b}
                onClick={() => setBracket(b)}
                style={{ ...styles.bracketBtn, ...activeStyle }}
              >
                <span style={{ ...styles.bracketNum, ...numStyle }}>{b}</span>
                <span style={styles.bracketLabel}>{BRACKET_LABELS[b]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Primary action: AI two-pass generation. The marquee feature — gradient
          treatment puts it visually above the heuristic option. Falls back to the
          heuristic silently if /api/llm is unreachable. */}
      <button
        className="btn"
        style={{ ...styles.aiGenerateBtn, ...(generating ? styles.generateBtnDisabled : {}) }}
        onClick={handleGenerateAI}
        disabled={generating}
      >
        {aiStage === 'pass1'
          ? 'Pass 1: choosing strategy (~30s)…'
          : aiStage === 'pass2'
          ? 'Pass 2: building deck (~40s)…'
          : aiStage === 'critique'
          ? 'Pass 3: reviewing deck (iterative, ~30s/iter)…'
          : <><span style={styles.sparkle} aria-hidden>✦</span>Generate with AI</>}
      </button>
      {!generating && (
        <div style={styles.aiHint}>
          <span style={styles.aiHintIcon} aria-hidden>⏱</span>
          Takes about <strong>90 seconds to 3 minutes</strong>. Strategy + build + iterative critique (the deck only ships when the AI approves it, or after 4 review cycles).
        </div>
      )}

      {/* Secondary action: heuristic generator. Instant, no API cost. */}
      <button
        className="btn btn-secondary"
        style={{ ...styles.heuristicBtn, ...(generating ? styles.generateBtnDisabled : {}) }}
        onClick={handleGenerate}
        disabled={generating}
      >
        {generating && !aiStage ? 'Generating…' : result ? 'Quick Regenerate (no AI)' : 'Quick Generate (no AI)'}
      </button>

      {result?.error && (
        <div style={styles.errorBanner}>{result.error}</div>
      )}

      {result && !result.error && (
        <>
          {/* Save / copy row */}
          <div style={styles.saveRow}>
            <button style={styles.saveBtn} onClick={handleOpenSave}>
              {loadedDeck ? `Update "${loadedDeck.name}"` : 'Save Deck'}
            </button>
            <button style={styles.copyBtn} onClick={handleCopyDeck}>
              Copy Deck
            </button>
            <button style={styles.copyBtn} onClick={handleDownloadDeck}>
              Download .txt
            </button>
            {loadedDeck && (
              <span style={styles.savedHint}>
                Last saved {formatDate(loadedDeck.updatedAt)}
              </span>
            )}
          </div>

          {/* Detected archetypes — click one to lock it as the primary strategy
              (others get reduced weight). Click the active chip again to clear. */}
          {result.archetypes?.length > 0 && (
            <div style={styles.archetypeRow}>
              <span style={styles.archetypeLabel}>Strategy:</span>
              <button
                style={primaryArchetype === null ? styles.archetypeChipActive : styles.archetypeChipBtn}
                onClick={() => setPrimaryArchetype(null)}
                title="Use all detected archetypes equally"
              >
                Balanced
              </button>
              {result.archetypes.map(a => (
                <button
                  key={a.id}
                  style={primaryArchetype === a.id ? styles.archetypeChipActive : styles.archetypeChipBtn}
                  onClick={() =>
                    setPrimaryArchetype(curr => (curr === a.id ? null : a.id))
                  }
                  title={`Lock ${a.label} as the primary strategy`}
                >
                  {a.label}
                </button>
              ))}
              <span style={styles.archetypeHint}>
                {primaryArchetype
                  ? 'Click Regenerate to apply the new focus.'
                  : 'Pick one to focus the deck on a single strategy.'}
              </span>
            </div>
          )}

          {/* LLM strategy panel — only shown when AI Assisted mode produced a result */}
          {result.llmStrategy && (
            <div style={styles.llmPanel}>
              <div style={styles.panelTitle}>
                AI Strategy
                <span style={styles.llmModePill}>mode: {result.llmStrategy.mode ?? 'unknown'}</span>
              </div>

              {result.llmStrategy.chosenStrategy && (
                <div style={styles.llmChosenStrategy}>{result.llmStrategy.chosenStrategy}</div>
              )}
              {result.llmStrategy.primaryStrategy && (
                <div style={styles.llmStrategyRow}>
                  <span style={styles.llmStrategyLabel}>Primary:</span>
                  <span style={styles.llmStrategyValue}>{result.llmStrategy.primaryStrategy}</span>
                </div>
              )}
              {result.llmStrategy.secondaryStrategy && (
                <div style={styles.llmStrategyRow}>
                  <span style={styles.llmStrategyLabel}>Secondary:</span>
                  <span style={styles.llmStrategyValue}>{result.llmStrategy.secondaryStrategy}</span>
                </div>
              )}
              {result.llmStrategy.winPlan && (
                <div style={styles.llmStrategyRow}>
                  <span style={styles.llmStrategyLabel}>Win plan:</span>
                  <span style={styles.llmStrategyValue}>{result.llmStrategy.winPlan}</span>
                </div>
              )}

              {result.llmValidation && result.llmValidation.invalidCount > 0 && (
                <div style={styles.llmRejected}>
                  Rejected {result.llmValidation.invalidCount} card{result.llmValidation.invalidCount === 1 ? '' : 's'}
                  {' '}suggested by the LLM (see Excluded Cards below).
                  {result.llmValidation.missingCount > 0 &&
                    ` ${result.llmValidation.missingCount} slot${result.llmValidation.missingCount === 1 ? '' : 's'} filled by the heuristic fallback.`}
                </div>
              )}

              {result.llmStrategy.deckStats && (
                <div style={styles.llmStatsBlock}>
                  <div style={styles.llmSubLabel}>Deck stats (LLM self-reported):</div>
                  <div style={styles.llmStatsRow}>
                    {Object.entries(result.llmStrategy.deckStats).map(([k, v]) => (
                      <span key={k} style={styles.llmStatPill}>
                        <span style={styles.llmStatKey}>{formatStatKey(k)}</span>
                        <span style={styles.llmStatVal}>{k === 'strategyDensityEstimate' ? `${v}%` : v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.llmStrategy.coreEngine?.length > 0 && (
                <div style={styles.llmCoreEngine}>
                  <div style={styles.llmSubLabel}>Core engine ({result.llmStrategy.coreEngine.length}):</div>
                  {result.llmStrategy.coreEngine.slice(0, 25).map((c, i) => (
                    <div key={i} style={styles.llmUpgradeRow}>
                      <span style={styles.llmUpgradeName}>{c.name}</span>
                      <span style={styles.llmUpgradeReason}>{c.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.llmStrategy.winConditionDetails?.length > 0 && (
                <div style={styles.llmWinConditions}>
                  <div style={styles.llmSubLabel}>Win conditions (proof):</div>
                  {result.llmStrategy.winConditionDetails.map((w, i) => (
                    <div key={i} style={styles.llmWinConditionBlock}>
                      <div style={styles.llmWinConditionName}>
                        {w.name}
                        {typeof w.estimatedTurnsToWin === 'number' && w.estimatedTurnsToWin > 0 && (
                          <span style={styles.llmWinConditionTurns}> · ~{w.estimatedTurnsToWin} turns</span>
                        )}
                      </div>
                      {w.howItWins && (
                        <div style={styles.llmWinConditionRow}><strong>How: </strong>{w.howItWins}</div>
                      )}
                      {w.requiredBoardState && (
                        <div style={styles.llmWinConditionRow}><strong>Board state: </strong>{w.requiredBoardState}</div>
                      )}
                      {w.keySupportingCards?.length > 0 && (
                        <div style={styles.llmWinConditionRow}><strong>Key cards: </strong>{w.keySupportingCards.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result.llmStrategy.weakIncludes?.length > 0 && (
                <div style={styles.llmWeakIncludes}>
                  <div style={styles.llmSubLabel}>Weak includes (LLM forced these in):</div>
                  {result.llmStrategy.weakIncludes.slice(0, 10).map((c, i) => (
                    <div key={i} style={styles.llmUpgradeRow}>
                      <span style={styles.llmUpgradeName}>{c.name}</span>
                      <span style={styles.llmUpgradeReason}>{c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deck summary — strategy + how it wins */}
          <DeckSummary
            mainDeck={result.mainDeck}
            combos={result.combos ?? []}
            archetypes={result.archetypes ?? []}
            primaryArchetypeId={primaryArchetype}
          />

          {/* Stats bar — "Interaction" is a derived stat (removal + protection)
              that mirrors how cEDH players talk about their decks: "how many
              cards stop the win?" The buckets stay separate inside the
              generator, but the user-facing summary aggregates them.
              On mobile the .stats-bar-responsive class flips to a 2-col grid. */}
          <div className="stats-bar-responsive" style={styles.statsBar}>
            <StatPill label="Total Cards" value={result.stats.totalCards} />
            <StatPill label="Lands" value={result.stats.landCount} />
            <StatPill label="Avg CMC" value={result.stats.avgCmc} />
            <StatPill
              label="Interaction"
              value={(result.stats.roleCounts?.removal ?? 0) + (result.stats.roleCounts?.protection ?? 0)}
            />
            <StatPill
              label="Actual Bracket"
              value={`${result.bracketAnalysis.actualBracket}: ${BRACKET_LABELS[result.bracketAnalysis.actualBracket]}`}
              highlight={result.bracketAnalysis.actualBracket > result.bracketAnalysis.targetBracket}
            />
          </div>

          {/* Mana curve histogram — surfaces the CMC distribution so users can
              spot top-heavy decks at a glance. Pairs with the per-bracket CMC
              target enforced by the scorer. */}
          <ManaCurveHistogram mainDeck={result.mainDeck} />

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div style={styles.warningsPanel}>
              <div style={styles.panelTitle}>Warnings & Notes</div>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ ...styles.warningRow, color: SEVERITY_COLORS[w.severity] ?? '#fff' }}>
                  <span style={styles.warningIcon}>
                    {w.severity === 'error' ? '✕' : w.severity === 'warning' ? '⚠' : 'ℹ'}
                  </span>
                  {w.message}
                </div>
              ))}
            </div>
          )}

          {/* Combos */}
          {result.combos.length > 0 && (
            <div style={styles.combosPanel}>
              <div style={styles.panelTitle}>Combos Detected ({result.combos.length})</div>
              {result.combos.map((combo, i) => (
                <div key={i} style={styles.comboRow}>
                  <div style={styles.comboCards}>{combo.cards.join(' + ')}</div>
                  <div style={styles.comboDesc}>{combo.description}</div>
                </div>
              ))}
            </div>
          )}

          {/* Deck list grouped by role */}
          <div style={styles.deckSection}>
            <div style={styles.panelTitle}>
              Deck: {result.mainDeck.length} cards + commander
            </div>
            {ROLE_ORDER.map(role => {
              const cards = groupedDeck[role]
              if (!cards || cards.length === 0) return null
              return (
                <div key={role} style={styles.roleGroup}>
                  <div style={styles.roleHeader}>
                    {ROLE_LABELS[role]} ({cards.length})
                  </div>
                  <div style={styles.cardList}>
                    {cards.map(card => (
                      <CardRow
                        key={card.id ?? card.name}
                        card={card}
                        hovered={hoveredCard?.name === card.name}
                        onHover={setHoveredCard}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Explanation */}
          <div style={styles.collapsible}>
            <button style={styles.collapsibleBtn} onClick={() => setShowExplanation(p => !p)}>
              {showExplanation ? '▾' : '▸'} Generation Log ({result.explanation.length} notes)
            </button>
            {showExplanation && (
              <ul style={styles.explanationList}>
                {result.explanation.map((line, i) => <li key={i} style={styles.explanationItem}>{line}</li>)}
              </ul>
            )}
          </div>

          {/* Excluded cards */}
          <div style={styles.collapsible}>
            <button style={styles.collapsibleBtn} onClick={() => setShowExcluded(p => !p)}>
              {showExcluded ? '▾' : '▸'} Excluded Cards ({result.excludedCards.length})
            </button>
            {showExcluded && (
              <div style={styles.excludedList}>
                {result.excludedCards.map((card, i) => (
                  <div key={i} style={styles.excludedRow}>
                    <span style={styles.excludedName}>{card.name}</span>
                    <span style={styles.excludedReason}>{card.excludeReason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diagnostics */}
          {result.diagnostics && (
            <DiagnosticsPanel diagnostics={result.diagnostics} />
          )}
        </>
      )}

      {/* Card image tooltip — hidden on touch devices via CSS (.hover-only) */}
      {hoveredCard && getCardImage(hoveredCard) && (
        <div className="hover-only" style={styles.tooltip}>
          <img src={getCardImage(hoveredCard)} alt={hoveredCard.name} style={styles.tooltipImg} />
        </div>
      )}

      {/* Save dialog */}
      {showSaveDialog && (
        <div style={styles.modalBackdrop} onClick={() => setShowSaveDialog(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalTitle}>{loadedDeck ? 'Update Deck' : 'Save Deck'}</div>
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="Deck name"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmSave() }}
              style={styles.modalInput}
            />
            <div style={styles.modalActions}>
              <button style={styles.modalCancel} onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button style={styles.modalConfirm} onClick={handleConfirmSave} disabled={!saveName.trim()}>
                {loadedDeck ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {saveToast && (
        <div style={styles.saveToast}>★ {saveToast}</div>
      )}
    </div>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────────

function CommanderStrip({ commander }) {
  const image = getCardImage(commander)
  const colorIdentity = commander.color_identity ?? []
  const stripStyle = { ...styles.commanderStrip, ...identityGlow(colorIdentity) }
  return (
    <div style={stripStyle}>
      {image && (
        <div style={styles.commanderImgWrap}>
          <img src={image} alt={commander.name} style={styles.commanderImg} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.commanderEyebrow}>◆ Building for</div>
        <div style={styles.commanderName}>{commander.name}</div>
        <div style={styles.commanderType}>{commander.type_line}</div>
        <div className="mana-pip-row" style={{ marginTop: 'var(--space-2)' }}>
          {colorIdentity.length > 0
            ? colorIdentity.map(c => (
                <span key={c} className={`mana-pip ${MANA_PIP_CLASS[c]}`}>{c}</span>
              ))
            : <span className="mana-pip mana-pip-c">C</span>
          }
        </div>
      </div>
    </div>
  )
}

const MANA_PIP_CLASS = {
  W: 'mana-pip-w', U: 'mana-pip-u', B: 'mana-pip-b', R: 'mana-pip-r', G: 'mana-pip-g',
}

const COLOR_GLOW = {
  W: 'var(--mana-w-glow)',
  U: 'var(--mana-u-glow)',
  B: 'var(--mana-b-glow)',
  R: 'var(--mana-r-glow)',
  G: 'var(--mana-g-glow)',
}

function identityGlow(colorIdentity) {
  if (!colorIdentity || colorIdentity.length === 0) return {}
  if (colorIdentity.length === 1) {
    const g = COLOR_GLOW[colorIdentity[0]]
    return g ? { borderColor: g, boxShadow: `0 0 0 1px ${g}, 0 8px 24px ${g}` } : {}
  }
  if (colorIdentity.length === 2) {
    const [a, b] = colorIdentity
    return {
      borderColor: COLOR_GLOW[a],
      boxShadow: `0 0 0 1px ${COLOR_GLOW[a]}, 0 6px 18px ${COLOR_GLOW[a]}, 0 12px 28px ${COLOR_GLOW[b]}`,
    }
  }
  const tones = colorIdentity.slice(0, 3).map(c => COLOR_GLOW[c]).filter(Boolean)
  return {
    borderColor: 'var(--border-strong)',
    boxShadow: tones.map((t, i) => `0 0 ${10 + i * 6}px ${t}`).join(', '),
  }
}

function StatPill({ label, value, highlight }) {
  return (
    <div style={{ ...styles.statPill, ...(highlight ? styles.statPillHighlight : {}) }}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  )
}

// CSS-based bar histogram showing CMC distribution of non-land cards.
// Buckets: 0, 1, 2, 3, 4, 5, 6+. Bar heights normalized to the tallest
// bucket so even small decks render with visible bars. Surfacing this
// helps users spot top-heavy decks at a glance — pairs with the bracket
// CMC target (cEDH wants ~2.0, casual wants ~4.0).
function ManaCurveHistogram({ mainDeck }) {
  const buckets = [0, 0, 0, 0, 0, 0, 0]   // indexes 0..6, where 6 means "6+"
  for (const card of mainDeck) {
    const types = (card.type_line ?? '').toLowerCase()
    if (types.includes('land')) continue
    const cmc = Math.min(6, Math.max(0, Math.round(card.cmc ?? 0)))
    buckets[cmc]++
  }
  const maxCount = Math.max(1, ...buckets)
  const labels = ['0', '1', '2', '3', '4', '5', '6+']

  return (
    <div style={styles.curvePanel}>
      <div style={styles.curveTitle}>Mana Curve <span style={styles.curveSubtitle}>(non-land)</span></div>
      <div className="curve-bars-responsive" style={styles.curveBars}>
        {buckets.map((count, i) => {
          const heightPct = (count / maxCount) * 100
          return (
            <div key={i} style={styles.curveCol}>
              <div style={styles.curveCount}>{count}</div>
              <div className="curve-bar-track-responsive" style={styles.curveBarTrack}>
                <div
                  style={{
                    ...styles.curveBarFill,
                    height: `${heightPct}%`,
                    opacity: count === 0 ? 0.15 : 1,
                  }}
                />
              </div>
              <div style={styles.curveLabel}>{labels[i]}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DeckSummary({ mainDeck, combos, archetypes, primaryArchetypeId }) {
  // Win conditions are ONLY cards that close out a game by themselves —
  // i.e. cards explicitly tagged with the win_condition role (which covers the
  // hardcoded WIN_CONDITIONS list + the "you win the game" / "opponents lose
  // the game" regex). Combo enablers like Doubling Season belong in COMBO LINES,
  // not here, because they need a partner to do anything.
  const winCons = mainDeck.filter(c => (c.roles ?? []).includes('win_condition'))

  const primary = archetypes.find(a => a.id === primaryArchetypeId)
  const strategyText = primary
    ? primary.label
    : archetypes.length > 0
      ? archetypes.map(a => a.label).join(' + ')
      : 'No clear strategy detected'

  // The deck has *some* path to victory if either standalone win cons OR combos exist.
  const hasWinPath = winCons.length > 0 || combos.length > 0

  return (
    <div style={summaryStyles.panel}>
      <div style={summaryStyles.row}>
        <span style={summaryStyles.label}>STRATEGY</span>
        <span style={summaryStyles.value}>{strategyText}</span>
      </div>

      <div style={summaryStyles.row}>
        <span style={summaryStyles.label}>WIN CONDITIONS</span>
        {winCons.length === 0 ? (
          <span style={combos.length > 0 ? summaryStyles.muted : summaryStyles.warning}>
            {combos.length > 0
              ? 'No standalone finisher. Wins through the combo lines below.'
              : '⚠ No win conditions or combo lines detected. Deck has no clear path to victory.'}
          </span>
        ) : (
          <div style={summaryStyles.winConList}>
            {winCons.map(c => (
              <span key={c.name} style={summaryStyles.winConChip}>{c.name}</span>
            ))}
          </div>
        )}
      </div>

      {combos.length > 0 && (
        <div style={summaryStyles.row}>
          <span style={summaryStyles.label}>COMBO LINES</span>
          <div style={summaryStyles.comboList}>
            {combos.map((combo, i) => (
              <div key={i} style={summaryStyles.comboLine}>
                <span style={summaryStyles.comboCards}>{combo.cards.join(' + ')}</span>
                <span style={summaryStyles.comboDesc}>: {combo.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasWinPath && (
        <div style={summaryStyles.bottomWarning}>
          ⚠ This deck has no detected win path. Add cards like Craterhoof Behemoth, Aetherflux Reservoir, or a known combo to give it a way to close.
        </div>
      )}
    </div>
  )
}

function DiagnosticsPanel({ diagnostics }) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery]       = useState('')

  const allCards = diagnostics.cardDiagnostics ?? []
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allCards
      .filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }, [allCards, query])

  const selected = matches.length > 0 && query.trim() && allCards.find(
    c => c.name.toLowerCase() === query.trim().toLowerCase()
  )

  const ds = diagnostics.dataSources ?? {}
  const targets = diagnostics.bracketTargets ?? {}

  return (
    <div style={diagStyles.collapsible}>
      <button style={diagStyles.collapsibleBtn} onClick={() => setExpanded(p => !p)}>
        {expanded ? '▾' : '▸'} Diagnostics: see why each card was picked or skipped
      </button>
      {expanded && (
        <div style={diagStyles.body}>
          {/* Data sources */}
          <div style={diagStyles.section}>
            <div style={diagStyles.sectionTitle}>Data Sources</div>
            <div style={diagStyles.row}>
              <span style={ds.edhrec?.loaded ? diagStyles.statusOk : diagStyles.statusFail}>
                {ds.edhrec?.loaded ? '✓' : '✕'} EDHREC
              </span>
              <span style={diagStyles.statusDetail}>
                {ds.edhrec?.loaded
                  ? `${ds.edhrec.topCardCount} top cards · ${ds.edhrec.themeCount} themes`
                  : 'No data loaded. Likely CORS or fetch failure (check browser console).'}
              </span>
            </div>
            {ds.edhrec?.loaded && (
              <>
                <div style={diagStyles.row}>
                  <span style={
                    ds.edhrec.matchedInCollection > 30 ? diagStyles.statusOk
                    : ds.edhrec.matchedInCollection > 5 ? diagStyles.statusWarn
                    : diagStyles.statusFail
                  }>
                    {ds.edhrec.matchedInCollection > 30 ? '✓'
                     : ds.edhrec.matchedInCollection > 5 ? '!' : '✕'} EDHREC ↔ Collection
                  </span>
                  <span style={diagStyles.statusDetail}>
                    {ds.edhrec.matchedInCollection} of {ds.edhrec.topCardCount} EDHREC top cards are in your collection.
                    {ds.edhrec.matchedInCollection <= 5 && ' If your collection has these cards, name matching is failing (likely DFC names or special characters).'}
                  </span>
                </div>
                <div style={diagStyles.row}>
                  <span style={diagStyles.statusOk}>→ Picked from top</span>
                  <span style={diagStyles.statusDetail}>
                    {ds.edhrec.pickedFromTop} of {ds.edhrec.matchedInCollection} matched cards landed in the deck.
                  </span>
                </div>
                {ds.edhrec.sampleMatches?.length > 0 && (
                  <div style={diagStyles.statusDetail}>
                    Sample matches: {ds.edhrec.sampleMatches.join(', ')}
                  </div>
                )}
                {ds.edhrec.misses?.length > 0 && (
                  <div style={diagStyles.missList}>
                    <div style={diagStyles.subTitle}>EDHREC top cards in your collection that did NOT land in the deck</div>
                    <table style={diagStyles.breakdownTable}>
                      <tbody>
                        {ds.edhrec.misses.map(m => (
                          <tr key={m.name}>
                            <td style={diagStyles.missName}>{m.name}</td>
                            <td style={diagStyles.missRank}>#{m.rank}</td>
                            <td style={diagStyles.missRole}>{m.role}</td>
                            <td style={diagStyles.missReason}>{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div style={diagStyles.row}>
              <span style={diagStyles.statusOk}>✓ Combo DB</span>
              <span style={diagStyles.statusDetail}>
                {ds.spellbook?.combosRegistered ?? 0} combos relevant to this collection
              </span>
            </div>
          </div>

          {/* Archetypes */}
          <div style={diagStyles.section}>
            <div style={diagStyles.sectionTitle}>Detected Archetypes</div>
            {(diagnostics.archetypes ?? []).length === 0 ? (
              <div style={diagStyles.empty}>No archetypes detected.</div>
            ) : (
              <div style={diagStyles.archChips}>
                {diagnostics.archetypes.map(a => (
                  <span key={a.id} style={diagStyles.archChip}>
                    {a.label} <span style={diagStyles.archStrength}>str {a.strength}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bracket targets */}
          <div style={diagStyles.section}>
            <div style={diagStyles.sectionTitle}>Bracket Targets</div>
            <div style={diagStyles.targets}>
              {Object.entries(targets).map(([role, count]) => (
                <span key={role} style={diagStyles.targetChip}>
                  {role}: <strong>{count}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Card inspector */}
          <div style={diagStyles.section}>
            <div style={diagStyles.sectionTitle}>Why this card?</div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type a card name from your collection…"
              style={diagStyles.input}
              list="diag-card-names"
            />
            <datalist id="diag-card-names">
              {allCards.map(c => <option key={c.name} value={c.name} />)}
            </datalist>

            {!selected && matches.length > 0 && (
              <div style={diagStyles.suggestions}>
                {matches.map(m => (
                  <div
                    key={m.name}
                    style={diagStyles.suggestion}
                    onClick={() => setQuery(m.name)}
                  >
                    <span>{m.name}</span>
                    <span style={diagStyles.smallScore}>score {m.score} · {m.role}</span>
                  </div>
                ))}
              </div>
            )}

            {selected && <CardDetail card={selected} />}
          </div>
        </div>
      )}
    </div>
  )
}

function CardDetail({ card }) {
  return (
    <div style={diagStyles.detail}>
      <div style={diagStyles.detailHeader}>
        <span style={diagStyles.detailName}>{card.name}</span>
        <span style={card.picked ? diagStyles.pickedBadge : diagStyles.unpickedBadge}>
          {card.picked ? '✓ Picked' : '✕ Not Picked'}
        </span>
      </div>
      <div style={diagStyles.detailMeta}>
        Role: <strong>{card.role}</strong>
        {' · '}
        Score: <strong>{card.score}</strong>
        {card.edhrecRank != null && <> {' · '} EDHREC rank: <strong>#{card.edhrecRank}</strong></>}
      </div>

      {card.breakdown.length > 0 && (
        <>
          <div style={diagStyles.subTitle}>Score breakdown</div>
          <table style={diagStyles.breakdownTable}>
            <tbody>
              {card.breakdown.map(([reason, delta], i) => (
                <tr key={i}>
                  <td style={diagStyles.breakdownReason}>{reason}</td>
                  <td style={delta >= 0 ? diagStyles.deltaPos : diagStyles.deltaNeg}>
                    {delta >= 0 ? '+' : ''}{delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!card.picked && card.beatBy.length > 0 && (
        <>
          <div style={diagStyles.subTitle}>Beaten by (in {card.role} bucket)</div>
          <div style={diagStyles.beatList}>
            {card.beatBy.map(b => (
              <div key={b.name} style={diagStyles.beatRow}>
                <span>{b.name}</span>
                <span style={diagStyles.smallScore}>{b.score}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!card.picked && card.beatBy.length === 0 && (
        <div style={diagStyles.empty}>
          Not picked despite no higher-scoring competition in this role. Likely the bucket's target was already filled by then, or the card was an overflow case. Try regenerating; ordering between role passes can shift this.
        </div>
      )}
    </div>
  )
}

function CardRow({ card, hovered, onHover }) {
  return (
    <div
      style={{ ...styles.cardRow, ...(hovered ? styles.cardRowHovered : {}) }}
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
    >
      <span style={styles.cardName}>{card.name}</span>
      {card.mana_cost && <span style={styles.cardMana}>{card.mana_cost}</span>}
      {card.type_line && <span style={styles.cardType}>{card.type_line}</span>}
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatStatKey(key) {
  if (key === 'strategyDensityEstimate') return 'Synergy %'
  if (key === 'boardWipes') return 'Wipes'
  if (key === 'winConditions') return 'Wincons'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function formatDeckForClipboard(commander, mainDeck) {
  const counts = new Map()
  for (const card of mainDeck) {
    const key = card.name
    const isBasic = (card.type_line ?? '').toLowerCase().includes('basic') &&
                    (card.type_line ?? '').toLowerCase().includes('land')
    const qty = isBasic ? (card.quantity ?? 1) : 1
    counts.set(key, (counts.get(key) ?? 0) + qty)
  }
  const mainLines = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, qty]) => `${qty} ${name}`)
  return [
    'Commander',
    `1 ${commander.name}`,
    '',
    'Deck',
    ...mainLines,
  ].join('\n')
}

function deckToResult(deck, bracket) {
  return {
    mainDeck:        deck.mainDeck,
    excludedCards:   [],
    warnings:        [],
    combos:          [],
    explanation:     [`Loaded saved deck "${deck.name}".`],
    stats:           computeStats(deck.mainDeck),
    bracketAnalysis: { targetBracket: bracket, actualBracket: bracket, flaggedCards: [] },
  }
}

function computeStats(cards) {
  const totalCards = cards.reduce((s, c) => s + (c.quantity ?? 1), 0)
  const landCount  = cards
    .filter(c => (c.type_line ?? '').toLowerCase().includes('land'))
    .reduce((s, c) => s + (c.quantity ?? 1), 0)
  const nonland    = cards.filter(c => !(c.type_line ?? '').toLowerCase().includes('land'))
  const cmcSum     = nonland.reduce((s, c) => s + ((c.cmc ?? 0) * (c.quantity ?? 1)), 0)
  const nonlandQty = nonland.reduce((s, c) => s + (c.quantity ?? 1), 0)
  const avgCmc     = nonlandQty > 0 ? (cmcSum / nonlandQty).toFixed(2) : '0'
  return { totalCards, landCount, avgCmc }
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

function groupByPrimaryRole(cards) {
  const groups = {}
  for (const card of cards) {
    const role = (card.roles ?? ['filler'])[0]
    if (!groups[role]) groups[role] = []
    groups[role].push(card)
  }
  return groups
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = {
  page:            { position: 'relative' },
  pageHeader:      { marginBottom: 'var(--space-8)' },
  pageEyebrow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    color: 'var(--accent-hover)',
    marginBottom: 'var(--space-3)',
    padding: '4px 12px',
    background: 'var(--accent-soft)',
    border: '1px solid var(--accent-ring)',
    borderRadius: '999px',
  },
  pageEyebrowOrnament: {
    color: 'var(--accent-2)',
    fontSize: '0.7rem',
  },
  heading:         { fontSize: 'var(--text-3xl)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 'var(--space-2)', color: 'var(--text)' },
  subhead:         { fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: '640px' },
  emptyState:      {
                     padding: 'var(--space-12) var(--space-6)',
                     background: 'var(--surface-1)',
                     border: '1px solid var(--border)',
                     borderRadius: 'var(--radius-lg)',
                     textAlign: 'center',
                     display: 'flex',
                     flexDirection: 'column',
                     alignItems: 'center',
                     gap: 'var(--space-3)',
                   },
  emptyIcon:       { fontSize: '2.5rem', marginBottom: 'var(--space-2)' },
  emptyTitle:      { fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text)' },
  emptyDesc:       { color: 'var(--text-muted)', maxWidth: '440px', lineHeight: 1.6 },
  emptyBtn:        { padding: '10px 20px', textDecoration: 'none', marginTop: 'var(--space-3)' },
  section:         { marginBottom: 'var(--space-6)' },
  sectionLabel:    { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, marginBottom: 'var(--space-3)' },

  commanderStrip:  {
    display: 'flex',
    gap: 'var(--space-4)',
    alignItems: 'center',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%), var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-6)',
    boxShadow: 'var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.04)',
    transition: 'border-color 240ms ease, box-shadow 240ms ease',
  },
  commanderImgWrap: {
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    boxShadow: '0 4px 16px rgba(0,0,0,0.40)',
  },
  commanderImg:    { width: '70px', display: 'block' },
  commanderEyebrow: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--text-subtle)',
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-1)',
  },
  commanderName:   { fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text)', marginBottom: '4px' },
  commanderType:   { color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontStyle: 'italic', marginBottom: 'var(--space-2)' },

  modeRow:         { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  modeBtn:         { flex: '1', minWidth: '180px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', padding: '12px 14px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--text-muted)', textAlign: 'left' },
  modeBtnActive:   { background: 'var(--accent-soft)', border: '2px solid var(--accent-hover)', color: '#fff' },
  modeName:        { fontSize: '0.95rem', fontWeight: '700', color: 'var(--accent-hover)', display: 'inline-flex', alignItems: 'center', gap: '8px' },
  modeDesc:        { fontSize: '0.75rem', color: 'var(--text-subtle)' },
  betaPill:        { background: 'var(--accent)', color: '#fff', fontSize: '0.6rem', fontWeight: '700', padding: '2px 6px', borderRadius: '8px', letterSpacing: '0.05em' },

  // Bracket selector — 5 buttons must fit on a 375px viewport. With 4px gaps
  // between them and 24px container padding, each button gets ~64px max.
  bracketRow:      { display: 'flex', gap: 'var(--space-2)', flexWrap: 'nowrap' },
  bracketBtn:      { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 4px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-muted)', transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease', overflow: 'hidden' },
  bracketBtnActive:{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' },
  bracketNum:      { fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-muted)', fontFeatureSettings: '"tnum"', lineHeight: 1 },
  bracketNumActive:{ color: 'var(--accent-hover)' },
  bracketLabel:    { fontSize: 'var(--text-xs)', textAlign: 'center', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' },

  aiGenerateBtn:   {
                     display: 'flex',
                     width: '100%',
                     padding: '16px',
                     // Multi-stop WUBRG-inspired gradient. Reads as "all five
                     // colors at work" without naming any of them — the AI
                     // pass is the marquee feature; the gradient sells it.
                     background:
                       'linear-gradient(135deg, #8b5cf6 0%, #6366f1 30%, #3b82f6 55%, #f59e0b 100%)',
                     backgroundSize: '200% 200%',
                     color: '#fff',
                     border: '1px solid rgba(255,255,255,0.10)',
                     borderRadius: 'var(--radius-md)',
                     fontSize: 'var(--text-base)',
                     fontWeight: 700,
                     letterSpacing: '0.01em',
                     marginBottom: 'var(--space-3)',
                     boxShadow:
                       '0 6px 20px rgba(99, 102, 241, 0.35), 0 1px 0 rgba(255,255,255,0.08) inset',
                     transition: 'transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background-position 600ms ease',
                   },
  heuristicBtn:    {
                     display: 'flex',
                     width: '100%',
                     padding: '12px',
                     fontSize: 'var(--text-sm)',
                     fontWeight: 600,
                     marginBottom: 'var(--space-3)',
                   },
  generateBtnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  sparkle:         { fontSize: 'var(--text-base)', color: '#fde68a' },
  aiHint:          {
                     display: 'flex',
                     alignItems: 'center',
                     gap: '6px',
                     justifyContent: 'center',
                     marginTop: 'calc(var(--space-3) * -1 + 2px)',
                     marginBottom: 'var(--space-3)',
                     color: 'var(--text-subtle)',
                     fontSize: 'var(--text-xs)',
                     fontWeight: 500,
                   },
  aiHintIcon:      { color: 'var(--accent-hover)', fontSize: 'var(--text-sm)' },
  errorBanner:     { background: 'rgba(239, 68, 68, 0.10)', border: '1px solid rgba(239, 68, 68, 0.40)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', padding: 'var(--space-4)', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)' },

  statsBar:        { display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' },
  statPill:        { flex: '1', minWidth: '100px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)' },
  statPillHighlight: { borderColor: 'var(--warning)' },
  statLabel:       { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '4px' },
  statValue:       { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-base)', fontFeatureSettings: '"tnum"' },

  // Mana curve histogram
  curvePanel:      { background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)' },
  curveTitle:      { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 'var(--space-3)' },
  curveSubtitle:   { color: 'var(--text-subtle)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, marginLeft: 'var(--space-2)' },
  curveBars:       { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)', alignItems: 'end' },
  curveCol:        { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
  curveCount:      { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 600, fontFeatureSettings: '"tnum"', minHeight: '14px' },
  curveBarTrack:   { width: '100%', height: '80px', background: 'var(--bg-app)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' },
  curveBarFill:    { width: '100%', background: 'linear-gradient(180deg, var(--accent-hover) 0%, var(--accent) 100%)', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', transition: 'height var(--transition-base)', minHeight: '2px' },
  curveLabel:      { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', fontWeight: 500, fontFeatureSettings: '"tnum"' },

  // The LLM panel intentionally uses a blue accent to differentiate from the
  // commander/deck purple, but built on top of standard surface tokens so it
  // still reads as part of the same design system.
  llmPanel:        { background: 'var(--surface-1)', border: '1px solid rgba(59, 130, 246, 0.30)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', marginBottom: 'var(--space-5)', boxShadow: 'var(--shadow-sm)' },
  llmModePill:     { marginLeft: 'var(--space-3)', background: 'rgba(59, 130, 246, 0.18)', color: '#93c5fd', fontSize: 'var(--text-xs)', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', textTransform: 'lowercase', letterSpacing: '0.05em' },
  llmChosenStrategy:{ background: 'rgba(59, 130, 246, 0.10)', border: '1px solid rgba(59, 130, 246, 0.30)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontWeight: 500, lineHeight: 1.5, marginBottom: 'var(--space-4)' },
  llmStrategyRow:  { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', lineHeight: 1.5 },
  llmStrategyLabel:{ color: '#93c5fd', fontWeight: 600, minWidth: '80px', flexShrink: 0 },
  llmStrategyValue:{ color: 'var(--text-muted)' },
  llmRejected:     { color: 'var(--warning)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)', marginBottom: 'var(--space-2)', fontStyle: 'italic' },
  llmStatsBlock:   { marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' },
  llmStatsRow:     { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' },
  llmStatPill:     { display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'baseline', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--text-xs)' },
  llmStatKey:      { color: 'var(--text-subtle)' },
  llmStatVal:      { color: 'var(--text)', fontWeight: 700, fontFeatureSettings: '"tnum"' },
  llmCoreEngine:   { marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' },
  llmWinConditions:{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' },
  llmWinConditionBlock: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-2)' },
  llmWinConditionName: { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '4px' },
  llmWinConditionTurns: { color: 'var(--text-subtle)', fontWeight: 500, fontSize: 'var(--text-xs)' },
  llmWinConditionRow: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5, marginTop: '2px' },
  llmWeakIncludes: { marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' },
  llmSubLabel:     { color: '#93c5fd', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 'var(--space-2)' },
  llmUpgradeRow:   { display: 'flex', gap: 'var(--space-3)', marginBottom: '4px', fontSize: 'var(--text-xs)' },
  llmUpgradeName:  { color: 'var(--text)', fontWeight: 600, minWidth: '180px' },
  llmUpgradeReason:{ color: 'var(--text-muted)' },

  warningsPanel:   { background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.30)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', marginBottom: 'var(--space-5)' },
  combosPanel:     { background: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.30)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', marginBottom: 'var(--space-5)' },
  panelTitle:      { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 'var(--space-3)' },
  warningRow:      { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--text-muted)' },
  warningIcon:     { flexShrink: 0, fontWeight: 700, width: '16px' },
  comboRow:        { marginBottom: 'var(--space-3)' },
  comboCards:      { color: '#93c5fd', fontWeight: 600, fontSize: 'var(--text-sm)' },
  comboDesc:       { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: '2px' },

  deckSection:     { marginBottom: 'var(--space-4)' },
  roleGroup:       { marginBottom: 'var(--space-6)' },
  roleHeader:      {
                     display: 'flex',
                     alignItems: 'baseline',
                     gap: 'var(--space-2)',
                     color: 'var(--text-muted)',
                     fontWeight: 600,
                     fontSize: 'var(--text-xs)',
                     textTransform: 'uppercase',
                     letterSpacing: '0.10em',
                     marginBottom: 'var(--space-2)',
                     paddingBottom: 'var(--space-2)',
                     borderBottom: '1px solid var(--border)',
                   },
  cardList:        { display: 'flex', flexDirection: 'column', gap: '1px' },
  cardRow:         { display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default', transition: 'background-color var(--transition-fast)' },
  cardRowHovered:  { background: 'var(--surface-2)' },
  cardName:        { color: 'var(--text)', fontSize: 'var(--text-sm)', flex: '1' },
  cardMana:        { color: 'var(--accent-hover)', fontSize: 'var(--text-xs)', flexShrink: 0, fontFeatureSettings: '"tnum"' },
  cardType:        { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', flexShrink: 0, minWidth: '120px', textAlign: 'right' },

  collapsible:     { marginBottom: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-1)' },
  collapsibleBtn:  { width: '100%', background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 'var(--space-3) var(--space-4)', textAlign: 'left', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'background-color var(--transition-fast)' },
  explanationList: { margin: 0, padding: 'var(--space-3) var(--space-4) var(--space-3) var(--space-8)', background: 'var(--bg-app)' },
  explanationItem: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '6px', lineHeight: 1.5 },
  excludedList:    { padding: 'var(--space-2) 0', background: 'var(--bg-app)' },
  excludedRow:     { display: 'flex', gap: 'var(--space-4)', padding: '6px var(--space-4)', alignItems: 'flex-start' },
  excludedName:    { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', flex: '1' },
  excludedReason:  { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', textAlign: 'right', maxWidth: '260px' },

  tooltip:         {
                     position: 'fixed',
                     bottom: 'var(--space-6)',
                     right: 'var(--space-6)',
                     zIndex: 1000,
                     pointerEvents: 'none',
                     padding: 'var(--space-2)',
                     background: 'var(--surface-1)',
                     border: '1px solid var(--border-strong)',
                     borderRadius: 'var(--radius-lg)',
                     boxShadow: 'var(--shadow-lg)',
                   },
  tooltipImg:      { width: '220px', display: 'block', borderRadius: 'var(--radius-md)' },

  archetypeRow:    { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' },
  archetypeLabel:  { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600 },
  archetypeChip:   { background: 'var(--accent-soft)', color: 'var(--accent-hover)', fontSize: 'var(--text-xs)', fontWeight: 600, borderRadius: '999px', padding: '4px 12px', border: '1px solid var(--accent)' },
  archetypeChipBtn:    { background: 'var(--surface-1)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 600, borderRadius: '999px', padding: '5px 14px', border: '1px solid var(--border)', cursor: 'pointer', transition: 'background-color var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)' },
  archetypeChipActive: { background: 'var(--accent)', color: '#fff',    fontSize: 'var(--text-xs)', fontWeight: 700, borderRadius: '999px', padding: '5px 14px', border: '1px solid var(--accent-hover)', cursor: 'pointer' },
  archetypeHint:       { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', fontStyle: 'italic', marginLeft: 'var(--space-2)' },

  saveRow:         { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' },
  saveBtn:         { padding: '10px 18px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent-hover)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'background-color 120ms ease, color 120ms ease' },
  copyBtn:         { padding: '10px 18px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'background-color 120ms ease, color 120ms ease' },
  savedHint:       { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', fontStyle: 'italic' },

  modalBackdrop:   { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:           { background: 'var(--surface-1)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', minWidth: '320px', maxWidth: '90vw', boxShadow: 'var(--shadow-lg)' },
  modalTitle:      { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-lg)', letterSpacing: '-0.01em', marginBottom: 'var(--space-4)' },
  modalInput:      { width: '100%', boxSizing: 'border-box', padding: '11px 14px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: 'var(--text-sm)', outline: 'none', marginBottom: 'var(--space-4)', transition: 'border-color var(--transition-fast)' },
  modalActions:    { display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' },
  modalCancel:     { padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 },
  modalConfirm:    { padding: '8px 18px', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 },

  saveToast:       { position: 'fixed', top: 'var(--space-5)', right: 'var(--space-5)', background: 'var(--surface-2)', border: '1px solid var(--accent)', color: 'var(--text)', padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, boxShadow: 'var(--shadow-lg)', zIndex: 100 },
}

const summaryStyles = {
  panel: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-strong)',
    borderRadius: '10px',
    padding: '14px 16px',
    marginBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  },
  label: {
    color: 'var(--text-subtle)',
    fontSize: '0.7rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    minWidth: '120px',
    flexShrink: 0,
  },
  value: {
    color: 'var(--text)',
    fontSize: '0.92rem',
    fontWeight: '600',
  },
  warning: {
    color: 'var(--warning)',
    fontSize: '0.85rem',
    background: 'rgba(245, 158, 11, 0.10)',
    border: '1px solid rgba(245, 158, 11, 0.30)',
    borderRadius: '6px',
    padding: '6px 10px',
  },
  muted: {
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    fontStyle: 'italic',
  },
  bottomWarning: {
    color: 'var(--warning)',
    fontSize: '0.85rem',
    background: 'rgba(245, 158, 11, 0.10)',
    border: '1px solid rgba(245, 158, 11, 0.30)',
    borderRadius: '6px',
    padding: '8px 12px',
    marginTop: '4px',
  },
  winConList: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  winConChip: {
    background: 'rgba(16, 185, 129, 0.12)',
    color: 'var(--success)',
    border: '1px solid rgba(16, 185, 129, 0.40)',
    borderRadius: '999px',
    padding: '3px 10px',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
  },
  comboList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
    minWidth: '60%',
  },
  comboLine: {
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    lineHeight: '1.4',
  },
  comboCards: {
    color: '#93c5fd',
    fontWeight: '600',
  },
  comboDesc: {
    color: '#7090b0',
  },
}

const diagStyles = {
  collapsible:    { marginBottom: '12px', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' },
  collapsibleBtn: { width: '100%', background: 'var(--surface-1)', border: 'none', color: 'var(--text-muted)', padding: '12px 16px', textAlign: 'left', cursor: 'pointer', fontSize: '0.88rem', fontWeight: '600' },
  body:           { padding: '14px 16px', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '18px' },
  section:        { display: 'flex', flexDirection: 'column', gap: '6px' },
  sectionTitle:   { color: 'var(--accent-hover)', fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em' },
  row:            { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  statusOk:       { color: 'var(--success)', fontWeight: '700', fontSize: '0.85rem' },
  statusWarn:     { color: 'var(--warning)', fontWeight: '700', fontSize: '0.85rem' },
  statusFail:     { color: 'var(--danger)', fontWeight: '700', fontSize: '0.85rem' },
  statusDetail:   { color: 'var(--text-muted)', fontSize: '0.82rem' },
  empty:          { color: 'var(--text-subtle)', fontSize: '0.82rem', fontStyle: 'italic' },
  archChips:      { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  archChip:       { background: 'var(--border)', border: '1px solid var(--border-strong)', color: 'var(--accent-hover)', borderRadius: '12px', padding: '3px 10px', fontSize: '0.78rem', fontWeight: '600' },
  archStrength:   { color: 'var(--text-subtle)', marginLeft: '6px', fontWeight: '500' },
  targets:        { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  targetChip:     { background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '3px 8px', fontSize: '0.78rem' },
  input:          { width: '100%', boxSizing: 'border-box', padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--border-strong)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' },
  suggestions:    { display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px', maxHeight: '240px', overflowY: 'auto' },
  suggestion:     { display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-1)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text)' },
  smallScore:     { color: 'var(--text-subtle)', fontSize: '0.78rem' },
  detail:         { background: 'var(--surface-1)', border: '1px solid var(--border-strong)', borderRadius: '8px', padding: '12px', marginTop: '8px' },
  detailHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  detailName:     { color: 'var(--text)', fontWeight: 700, fontSize: 'var(--text-base)' },
  pickedBadge:    { background: 'rgba(16, 185, 129, 0.12)', color: 'var(--success)', border: '1px solid rgba(16, 185, 129, 0.40)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 700 },
  unpickedBadge:  { background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.40)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 700 },
  detailMeta:     { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' },
  subTitle:       { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.10em', marginTop: 'var(--space-2)', marginBottom: '4px' },
  breakdownTable: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' },
  breakdownReason:{ color: 'var(--text-muted)', padding: '3px 0' },
  deltaPos:       { color: 'var(--success)', fontWeight: 700, textAlign: 'right', padding: '3px 0', width: '60px', fontFeatureSettings: '"tnum"' },
  deltaNeg:       { color: 'var(--danger)', fontWeight: 700, textAlign: 'right', padding: '3px 0', width: '60px', fontFeatureSettings: '"tnum"' },
  beatList:       { display: 'flex', flexDirection: 'column', gap: '2px' },
  beatRow:        { display: 'flex', justifyContent: 'space-between', padding: '3px 8px', background: 'var(--bg-app)', borderRadius: '4px', fontSize: '0.82rem', color: 'var(--text)' },
  missList:       { marginTop: '8px', maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' },
  missName:       { color: 'var(--text)', padding: '3px 8px', fontSize: '0.82rem' },
  missRank:       { color: 'var(--text-subtle)', padding: '3px 8px', fontSize: '0.78rem', whiteSpace: 'nowrap' },
  missRole:       { color: 'var(--accent-hover)', padding: '3px 8px', fontSize: '0.78rem', whiteSpace: 'nowrap' },
  missReason:     { color: 'var(--text-muted)', padding: '3px 8px', fontSize: '0.78rem' },
}
