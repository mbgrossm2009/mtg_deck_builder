// Live "deck cast" demo for the marketing hero.
//
// Pseudo-terminal that types out the actual steps the engine takes when
// generating a deck. Loops through real cEDH/casual commander examples so
// the user sees what the app does instead of just reading about it.
//
// Doubles as the AI-time disclosure: the [00:23.4] timestamps make the
// 15-30 second wait part of the storytelling rather than a surprise.
//
// Pure CSS animation. No images, no MTG IP — just the names of public
// commander cards and generic gameplay terminology.

import { useEffect, useState } from 'react'
import { useIsMobile } from '../lib/useMediaQuery'

// Each demo is a sequence of (timestamp, text, color) lines.
// Timestamps are realistic — Pass 1 and Pass 2 each take ~10s in production.
const DEMOS = [
  {
    command: 'deckify --commander "Atraxa, Praetors\' Voice" --bracket 4',
    lines: [
      { t: '00:00.2', text: '✓ Loaded collection (2,847 cards)',          tone: 'ok'   },
      { t: '00:00.4', text: '✓ Detected archetype: +1/+1 Counters · str 4', tone: 'ok'   },
      { t: '00:00.7', text: '✓ Filtered for bracket 4 → 723 candidates',  tone: 'ok'   },
      { t: '00:00.9', text: '→ Calling AI strategy pass...',              tone: 'wait' },
      { t: '00:14.1', text: '✓ Strategy: proliferate value engine',       tone: 'ok'   },
      { t: '00:14.3', text: '→ Calling AI build pass...',                 tone: 'wait' },
      { t: '00:23.4', text: '✓ 99 cards · avg CMC 2.8 · 7 tutors',         tone: 'ok'   },
      { t: '00:23.4', text: '✓ Done in 23.4 seconds',                     tone: 'good' },
    ],
  },
  {
    command: 'deckify --commander "Najeela, the Blade-Blossom" --bracket 5',
    lines: [
      { t: '00:00.3', text: '✓ Loaded collection (1,124 cards)',          tone: 'ok'   },
      { t: '00:00.5', text: '✓ Detected archetype: combo · str 5',         tone: 'ok'   },
      { t: '00:00.8', text: '✓ Filtered for bracket 5 → 412 candidates',  tone: 'ok'   },
      { t: '00:01.0', text: '→ Calling AI strategy pass...',              tone: 'wait' },
      { t: '00:11.7', text: '✓ Strategy: infinite combats · WUBRG 5c',    tone: 'ok'   },
      { t: '00:11.9', text: '→ Calling AI build pass...',                 tone: 'wait' },
      { t: '00:21.2', text: '✓ 99 cards · avg CMC 1.9 · 12 tutors · 28L', tone: 'ok'   },
      { t: '00:21.2', text: '✓ Done in 21.2 seconds',                     tone: 'good' },
    ],
  },
  {
    command: 'deckify --commander "Krenko, Mob Boss" --bracket 3',
    lines: [
      { t: '00:00.1', text: '✓ Loaded collection (843 cards)',            tone: 'ok'   },
      { t: '00:00.3', text: '✓ Detected archetype: tribal · goblins · str 3', tone: 'ok' },
      { t: '00:00.4', text: '✓ Filtered for bracket 3 → 287 candidates',  tone: 'ok'   },
      { t: '00:00.6', text: '→ Calling AI strategy pass...',              tone: 'wait' },
      { t: '00:13.8', text: '✓ Strategy: aggro tokens + sac payoff',      tone: 'ok'   },
      { t: '00:14.0', text: '→ Calling AI build pass...',                 tone: 'wait' },
      { t: '00:24.6', text: '✓ 99 cards · avg CMC 2.4 · synergy 28',      tone: 'ok'   },
      { t: '00:24.6', text: '✓ Done in 24.6 seconds',                     tone: 'good' },
    ],
  },
  {
    command: 'deckify --commander "Edgar Markov" --bracket 2',
    lines: [
      { t: '00:00.2', text: '✓ Loaded collection (1,602 cards)',          tone: 'ok'   },
      { t: '00:00.4', text: '✓ Detected archetype: tribal · vampires · str 4', tone: 'ok' },
      { t: '00:00.6', text: '✓ Filtered for bracket 2 → 318 candidates',  tone: 'ok'   },
      { t: '00:00.8', text: '→ Calling AI strategy pass...',              tone: 'wait' },
      { t: '00:12.5', text: '✓ Strategy: anthems + lifelink swarm',       tone: 'ok'   },
      { t: '00:12.7', text: '→ Calling AI build pass...',                 tone: 'wait' },
      { t: '00:22.1', text: '✓ 99 cards · avg CMC 3.6 · 38L · 0 tutors',  tone: 'ok'   },
      { t: '00:22.1', text: '✓ Done in 22.1 seconds',                     tone: 'good' },
    ],
  },
  {
    command: 'deckify --commander "Sliver Overlord" --bracket 4',
    lines: [
      { t: '00:00.3', text: '✓ Loaded collection (3,128 cards)',          tone: 'ok'   },
      { t: '00:00.5', text: '✓ Detected archetype: tribal · slivers · str 5', tone: 'ok' },
      { t: '00:00.6', text: '✓ Commander CMC 9 → ramp target +4',         tone: 'ok'   },
      { t: '00:00.9', text: '✓ Filtered for bracket 4 → 891 candidates',  tone: 'ok'   },
      { t: '00:01.1', text: '→ Calling AI strategy pass...',              tone: 'wait' },
      { t: '00:13.6', text: '✓ Strategy: cascade slivers + commander tutoring', tone: 'ok' },
      { t: '00:13.8', text: '→ Calling AI build pass...',                 tone: 'wait' },
      { t: '00:25.7', text: '✓ 99 cards · 5c · avg CMC 3.1 · synergy 28', tone: 'ok'   },
      { t: '00:25.7', text: '✓ Done in 25.7 seconds',                     tone: 'good' },
    ],
  },
]

const TYPING_DELAY_MS  = 1100  // pause between lines so each step has time to register
const HOLD_AT_END_MS   = 5500  // dwell on completed demo before cycling
const CHAR_SPEED_MS    = 22    // per-character typing delay — slow enough to watch the command get typed

export default function DeckCastDemo() {
  const [demoIdx, setDemoIdx]       = useState(0)
  const [visibleLines, setVisible]  = useState(0)
  const [typedCommand, setTyped]    = useState('')
  const isMobile = useIsMobile()

  const demo = DEMOS[demoIdx]

  // Type out the command line, then progressively reveal each output line,
  // then dwell, then advance to the next demo. All controlled by timeouts
  // chained inside one effect that re-runs whenever demoIdx changes.
  useEffect(() => {
    const timeouts = []
    setTyped('')
    setVisible(0)

    // Phase 1: type the command character by character
    const cmd = '$ ' + demo.command
    for (let i = 0; i <= cmd.length; i++) {
      timeouts.push(setTimeout(() => setTyped(cmd.slice(0, i)), i * CHAR_SPEED_MS))
    }
    const afterCmdMs = cmd.length * CHAR_SPEED_MS + 400

    // Phase 2: reveal output lines one at a time
    for (let i = 1; i <= demo.lines.length; i++) {
      timeouts.push(setTimeout(() => setVisible(i), afterCmdMs + i * TYPING_DELAY_MS))
    }
    const afterLinesMs = afterCmdMs + demo.lines.length * TYPING_DELAY_MS

    // Phase 3: dwell, then advance
    timeouts.push(setTimeout(() => {
      setDemoIdx(prev => (prev + 1) % DEMOS.length)
    }, afterLinesMs + HOLD_AT_END_MS))

    return () => timeouts.forEach(clearTimeout)
  }, [demoIdx, demo.command, demo.lines.length])

  return (
    <div style={styles.frame} aria-label="Live demo of Deckify generating a deck">
      <div style={{ ...styles.titleBar, ...(isMobile ? styles.titleBarMobile : {}) }}>
        <span style={{ ...styles.dot, background: '#ff5f57' }} aria-hidden />
        <span style={{ ...styles.dot, background: '#febc2e' }} aria-hidden />
        <span style={{ ...styles.dot, background: '#28c840' }} aria-hidden />
        <span style={styles.titleText}>deckify · live demo</span>
        <span style={styles.statusDot} aria-hidden>
          <span style={styles.statusPulse} />
          <span style={styles.statusCore} />
        </span>
      </div>

      <pre style={{ ...styles.terminal, ...(isMobile ? styles.terminalMobile : {}) }}>
        <code>
          <span style={styles.commandLine}>
            {typedCommand}
            <span style={styles.cursor} aria-hidden>▌</span>
          </span>
          {demo.lines.slice(0, visibleLines).map((line, i) => (
            <span
              key={`${demoIdx}-${i}`}
              style={{ ...styles.outputLine, ...toneStyles[line.tone] }}
            >
              <span style={styles.timestamp}>[{line.t}]</span>
              {' '}
              {line.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

const toneStyles = {
  ok:   { color: 'var(--text-muted)' },
  wait: { color: '#93c5fd' },           // blue — matches the LLM panel accent
  good: { color: 'var(--success)' },
}

const styles = {
  frame: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg), 0 0 0 1px rgba(139, 92, 246, 0.15)',
    overflow: 'hidden',
    width: '100%',
    maxWidth: '720px',
    margin: '0 auto',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-3)',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border)',
  },
  titleBarMobile: {
    padding: '6px var(--space-2)',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    flexShrink: 0,
  },
  titleText: {
    flex: 1,
    textAlign: 'center',
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    letterSpacing: '0.04em',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  statusDot: {
    width: 12,
    height: 12,
    position: 'relative',
    flexShrink: 0,
  },
  statusPulse: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: 'var(--success)',
    opacity: 0.3,
    animation: 'live-pulse 1.6s ease-out infinite',
  },
  statusCore: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--success)',
  },
  terminal: {
    margin: 0,
    padding: 'var(--space-5) var(--space-5) var(--space-6)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.7,
    background: 'transparent',
    color: 'var(--text)',
    minHeight: '320px',
    overflowX: 'auto',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',  // wrap long lines on narrow viewports instead of forcing horizontal scroll
    wordBreak: 'break-word',
  },
  terminalMobile: {
    padding: 'var(--space-3) var(--space-3) var(--space-4)',
    fontSize: '0.72rem',     // ~11.5px — fits the long timestamp+text lines on 375px
    lineHeight: 1.6,
    minHeight: '280px',
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
    marginRight: '4px',
  },
}
