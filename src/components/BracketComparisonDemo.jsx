// Side-by-side bracket comparison demo for the marketing page.
//
// Shows the SAME commander (Atraxa, Grand Unifier) being generated at
// bracket 1 (Exhibition — no fast mana, no tutors, no game changers) and
// bracket 5 (cEDH — everything allowed). Both terminals advance in lock-
// step so the divergence is obvious: the same input produces radically
// different decks at different power levels.
//
// This is the engine's most distinctive feature, and no other deck builder
// can demonstrate it. Single screenshot communicates more than a paragraph
// of marketing copy.

import { useEffect, useState } from 'react'
import { useIsMobile } from '../lib/useMediaQuery'

const COMMANDER = '"Atraxa, Praetors\' Voice"'

// Each row of these arrays represents the SAME step of the generation
// pipeline. Tones map to colors in the terminal:
//   ok    — neutral text-muted
//   good  — green (allowed/eligible)
//   block — red (eligibility-filtered out)
//   wait  — blue (LLM call in progress)
//   done  — green (finished step)
const B1_LINES = [
  { t: '00:00.4', text: '✓ Filtered for B1 → 287 candidates',     tone: 'ok'    },
  { t: '00:00.5', text: '✗ Blocked Sol Ring (fast mana)',         tone: 'block' },
  { t: '00:00.5', text: '✗ Blocked Demonic Tutor (tutor)',        tone: 'block' },
  { t: '00:00.6', text: '✗ Blocked Mana Crypt (fast mana)',       tone: 'block' },
  { t: '00:00.6', text: '✗ Blocked Cyclonic Rift (game changer)', tone: 'block' },
  { t: '00:00.8', text: '→ Calling AI strategy pass...',          tone: 'wait'  },
  { t: '00:32.2', text: '✓ Strategy: counters value, no combos',  tone: 'ok'    },
  { t: '00:32.4', text: '→ Calling AI build pass...',             tone: 'wait'  },
  { t: '01:09.1', text: '✓ 99 cards · avg CMC 4.0 · 38L · 0 tutors', tone: 'ok' },
  { t: '01:09.1', text: '✓ Done in 69.1s',                        tone: 'done'  },
]
const B5_LINES = [
  { t: '00:00.4', text: '✓ Filtered for B5 → 891 candidates',     tone: 'ok'    },
  { t: '00:00.5', text: '✓ Sol Ring eligible',                    tone: 'good'  },
  { t: '00:00.5', text: '✓ Demonic Tutor eligible',               tone: 'good'  },
  { t: '00:00.6', text: '✓ Mana Crypt eligible',                  tone: 'good'  },
  { t: '00:00.6', text: '✓ Cyclonic Rift eligible',               tone: 'good'  },
  { t: '00:00.8', text: '→ Calling AI strategy pass...',          tone: 'wait'  },
  { t: '00:33.6', text: '✓ Strategy: proliferate combo lines',    tone: 'ok'    },
  { t: '00:33.8', text: '→ Calling AI build pass...',             tone: 'wait'  },
  { t: '01:11.4', text: '✓ 99 cards · avg CMC 2.0 · 28L · 12 tutors', tone: 'ok' },
  { t: '01:11.4', text: '✓ Done in 71.4s',                        tone: 'done'  },
]

const TYPING_DELAY_MS = 1100   // pause between lines (a bit faster than the cycling demo since there are two terminals)
const HOLD_AT_END_MS  = 7000   // dwell on completed comparison so users can absorb the diff
const CHAR_SPEED_MS   = 30     // command-line typing speed

export default function BracketComparisonDemo() {
  const [visibleLines, setVisible] = useState(0)
  const [typedCommand, setTyped]   = useState('')
  const [cycleKey, setCycleKey]    = useState(0)   // bumps to restart the loop
  const isMobile = useIsMobile()

  useEffect(() => {
    const timeouts = []
    setTyped('')
    setVisible(0)

    // Phase 1: type the command (same on both terminals)
    const cmd = '$ deckify ' + COMMANDER
    for (let i = 0; i <= cmd.length; i++) {
      timeouts.push(setTimeout(() => setTyped(cmd.slice(0, i)), i * CHAR_SPEED_MS))
    }
    const afterCmdMs = cmd.length * CHAR_SPEED_MS + 400

    // Phase 2: reveal output lines in lockstep (drives both terminals from
    // a single counter so they stay in sync visually)
    const lineCount = Math.max(B1_LINES.length, B5_LINES.length)
    for (let i = 1; i <= lineCount; i++) {
      timeouts.push(setTimeout(() => setVisible(i), afterCmdMs + i * TYPING_DELAY_MS))
    }
    const afterLinesMs = afterCmdMs + lineCount * TYPING_DELAY_MS

    // Phase 3: dwell, then loop
    timeouts.push(setTimeout(() => setCycleKey(k => k + 1), afterLinesMs + HOLD_AT_END_MS))

    return () => timeouts.forEach(clearTimeout)
  }, [cycleKey])

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <span style={styles.headerEyebrow}>Same commander, different brackets</span>
        <h3 style={styles.headerTitle}>
          One collection. <span style={styles.headerAccent}>Five distinct deck shapes.</span>
        </h3>
        <p style={styles.headerCaption}>
          Watch Deckify generate the same commander at both extremes of the
          bracket spectrum. Live, lockstep, no editing.
        </p>
      </div>

      <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
        <Terminal
          label="Bracket 1 · Exhibition"
          tag="No fast mana · No tutors · No game changers"
          tagTone="warn"
          command={typedCommand}
          lines={B1_LINES.slice(0, visibleLines)}
          isMobile={isMobile}
          key={`b1-${cycleKey}`}
        />
        <Terminal
          label="Bracket 5 · Competitive"
          tag="Everything allowed · cEDH"
          tagTone="ok"
          command={typedCommand}
          lines={B5_LINES.slice(0, visibleLines)}
          isMobile={isMobile}
          key={`b5-${cycleKey}`}
        />
      </div>
    </div>
  )
}

function Terminal({ label, tag, tagTone, command, lines, isMobile }) {
  return (
    <div style={styles.terminal}>
      <div style={styles.titleBar}>
        <span style={styles.labelText}>{label}</span>
        <span style={{ ...styles.tagPill, ...tagToneStyles[tagTone] }}>{tag}</span>
      </div>
      <pre style={{ ...styles.terminalBody, ...(isMobile ? styles.terminalBodyMobile : {}) }}>
        <code>
          <span style={styles.commandLine}>
            {command}
            <span style={styles.cursor} aria-hidden>▌</span>
          </span>
          {lines.map((line, i) => (
            <span
              key={i}
              style={{ ...styles.outputLine, ...lineToneStyles[line.tone] }}
            >
              <span style={styles.timestamp}>[{line.t}]</span>{' '}
              {line.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

const lineToneStyles = {
  ok:    { color: 'var(--text-muted)' },
  good:  { color: 'var(--success)' },
  block: { color: 'var(--danger)' },
  wait:  { color: '#93c5fd' },          // matches the LLM panel accent
  done:  { color: 'var(--success)', fontWeight: 600 },
}

const tagToneStyles = {
  ok:   {
    background: 'rgba(16, 185, 129, 0.10)',
    color:      'var(--success)',
    border:     '1px solid rgba(16, 185, 129, 0.30)',
  },
  warn: {
    background: 'rgba(245, 158, 11, 0.10)',
    color:      'var(--warning)',
    border:     '1px solid rgba(245, 158, 11, 0.30)',
  },
}

const styles = {
  container: {
    width: '100%',
    margin: '0 auto',
  },
  headerRow: {
    textAlign: 'center',
    marginBottom: 'var(--space-6)',
    maxWidth: '600px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  headerEyebrow: {
    color: 'var(--accent-2)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-3)',
    display: 'block',
  },
  headerTitle: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    marginBottom: 'var(--space-3)',
    color: 'var(--text)',
  },
  headerAccent: {
    background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  headerCaption: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-4)',
  },
  gridMobile: {
    gridTemplateColumns: '1fr',
  },
  terminal: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-md)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  titleBar: {
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border)',
    padding: 'var(--space-2) var(--space-3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-2)',
    minHeight: '36px',
  },
  labelText: {
    color: 'var(--text)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  tagPill: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '999px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '60%',
  },
  terminalBody: {
    margin: 0,
    padding: 'var(--space-4)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.78rem',
    lineHeight: 1.7,
    color: 'var(--text)',
    minHeight: '300px',
    background: 'transparent',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textAlign: 'left',
    flex: 1,
  },
  terminalBodyMobile: {
    fontSize: '0.7rem',
    padding: 'var(--space-3)',
    minHeight: '260px',
  },
  commandLine: {
    display: 'block',
    color: 'var(--accent-hover)',
    marginBottom: 'var(--space-3)',
    fontWeight: 500,
  },
  cursor: {
    display: 'inline-block',
    color: 'var(--accent)',
    animation: 'cursor-blink 1.1s steps(1) infinite',
    marginLeft: '2px',
  },
  outputLine: {
    display: 'block',
    animation: 'line-in 220ms ease both',
  },
  timestamp: {
    color: 'var(--text-subtle)',
  },
}
