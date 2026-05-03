import { Link } from 'react-router-dom'
import { useDataStore } from '../lib/dataStore'
import { useIsMobile } from '../lib/useMediaQuery'

export default function Home() {
  const isMobile = useIsMobile()
  // Live read from dataStore so onboarding cards stay current when the user
  // adds cards / picks a commander / saves decks on other pages.
  const data = useDataStore()
  const progress = {
    collection: data.collection.length,
    commander:  data.commander,
    decks:      data.decks.length,
  }

  const hasCards     = progress.collection > 0
  const hasCommander = !!progress.commander
  const hasDecks     = progress.decks > 0

  // Determine which step is "next" — the first incomplete step gets the
  // primary visual treatment, and earlier completed steps get a checkmark.
  const nextStep =
    !hasCards     ? 1
    : !hasCommander ? 2
    : !hasDecks   ? 3
    : 3

  return (
    <div>
      <section style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        <div style={styles.heroGlow} aria-hidden />
        <div style={styles.eyebrow}>
          <span className="mana-pip-row" aria-hidden>
            <span className="mana-pip mana-pip-w">W</span>
            <span className="mana-pip mana-pip-u">U</span>
            <span className="mana-pip mana-pip-b">B</span>
            <span className="mana-pip mana-pip-r">R</span>
            <span className="mana-pip mana-pip-g">G</span>
          </span>
          <span style={styles.eyebrowText}>BuiltFromBulk · Commander Deck Builder</span>
        </div>
        <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
          Turn your collection into{' '}
          <span style={styles.titleAccent}>real Commander decks</span>.
        </h1>
        <p style={styles.subtitle}>
          Import your collection, pick a commander, and BuiltFromBulk assembles
          a power-tuned 99-card deck — strategy-aware, bracket-aware, built only
          from cards you already own.
        </p>
      </section>

      <section style={styles.steps}>
        <StepCard
          number={1}
          mana="w"
          title="Add your cards"
          description="Paste or upload a CSV/TXT export of your collection. Card data is fetched from Scryfall."
          status={hasCards ? 'done' : nextStep === 1 ? 'next' : 'todo'}
          progressLabel={hasCards ? `${progress.collection} cards in collection` : null}
          ctaLabel={hasCards ? 'Manage collection' : 'Add cards'}
          to="/collection"
        />
        <StepCard
          number={2}
          mana="u"
          title="Choose your commander"
          description="Search Scryfall for any legendary creature or designated commander."
          status={hasCommander ? 'done' : nextStep === 2 ? 'next' : 'todo'}
          progressLabel={progress.commander ? progress.commander.name : null}
          ctaLabel={hasCommander ? 'Change commander' : 'Pick commander'}
          to="/commander"
          locked={!hasCards}
        />
        <StepCard
          number={3}
          mana="r"
          title="Generate your deck"
          description="Pick a power bracket. BuiltFromBulk analyzes your collection and assembles 99 cards tuned to your commander."
          status={hasDecks ? 'done' : nextStep === 3 ? 'next' : 'todo'}
          progressLabel={hasDecks ? `${progress.decks} saved deck${progress.decks !== 1 ? 's' : ''}` : null}
          ctaLabel={hasDecks ? 'Open builder' : 'Generate deck'}
          to="/deck-builder"
          locked={!hasCards || !hasCommander}
        />
      </section>

      {hasDecks && (
        <section style={styles.shortcut}>
          <div style={styles.shortcutText}>
            <div style={styles.shortcutTitle}>Pick up where you left off</div>
            <div style={styles.shortcutSub}>
              You have {progress.decks} saved deck{progress.decks !== 1 ? 's' : ''}.
            </div>
          </div>
          <Link to="/my-decks" className="btn btn-secondary" style={styles.shortcutBtn}>
            View My Decks
          </Link>
        </section>
      )}
    </div>
  )
}

function StepCard({ number, mana, title, description, status, progressLabel, ctaLabel, to, locked = false }) {
  const isDone = status === 'done'
  const isNext = status === 'next' && !locked
  const tint = manaTint(mana)

  // The "next up" step uses the assigned mana color for its glow + badge,
  // cycling W → U → R across the three onboarding steps so the page reads
  // as MTG-coded without any one step dominating the palette.
  const nextStyle = isNext && tint ? {
    borderColor: tint.glow,
    boxShadow: `0 0 0 1px ${tint.glow}, 0 12px 32px ${tint.glow}`,
  } : (isNext ? styles.cardNext : {})

  const badgeNextStyle = isNext && tint ? {
    background: tint.fg,
    borderColor: tint.fg,
    color: '#0a0d18',
    boxShadow: `0 0 12px ${tint.glow}`,
  } : (isNext ? styles.stepBadgeNext : {})

  return (
    <div
      style={{
        ...styles.card,
        ...nextStyle,
        ...(locked ? styles.cardLocked : {}),
      }}
    >
      <div style={styles.cardHeader}>
        <div
          style={{
            ...styles.stepBadge,
            ...(isDone ? styles.stepBadgeDone : {}),
            ...badgeNextStyle,
          }}
        >
          {isDone ? '✓' : number}
        </div>
        {isNext && <span style={{ ...styles.nextPill, ...(tint ? { color: tint.fg, background: tint.soft } : {}) }}>Up next</span>}
        {isDone && <span style={styles.donePill}>Complete</span>}
      </div>

      <h3 style={styles.cardTitle}>{title}</h3>
      <p style={styles.cardDesc}>{description}</p>

      {progressLabel && (
        <div style={styles.progressLabel}>{progressLabel}</div>
      )}

      {locked ? (
        <button className="btn btn-ghost" style={styles.cardCta} disabled>
          Complete previous step first
        </button>
      ) : (
        <Link
          to={to}
          className={`btn ${isNext ? 'btn-primary' : 'btn-secondary'}`}
          style={styles.cardCta}
        >
          {ctaLabel} →
        </Link>
      )}
    </div>
  )
}

function manaTint(mana) {
  switch (mana) {
    case 'w': return { soft: 'var(--mana-w-soft)', glow: 'var(--mana-w-glow)', fg: 'var(--mana-w)' }
    case 'u': return { soft: 'var(--mana-u-soft)', glow: 'var(--mana-u-glow)', fg: 'var(--mana-u)' }
    case 'b': return { soft: 'var(--mana-b-soft)', glow: 'var(--mana-b-glow)', fg: 'var(--mana-b)' }
    case 'r': return { soft: 'var(--mana-r-soft)', glow: 'var(--mana-r-glow)', fg: 'var(--mana-r)' }
    case 'g': return { soft: 'var(--mana-g-soft)', glow: 'var(--mana-g-glow)', fg: 'var(--mana-g)' }
    default:  return null
  }
}

const styles = {
  hero: {
    padding: 'var(--space-8) 0 var(--space-12)',
    borderBottom: '1px solid var(--border)',
    marginBottom: 'var(--space-12)',
    position: 'relative',
    overflow: 'hidden',
  },
  heroMobile: {
    padding: 'var(--space-6) 0 var(--space-8)',
    marginBottom: 'var(--space-8)',
  },
  // Same purple aura as the marketing hero — keeps the brand voice consistent.
  heroGlow: {
    position: 'absolute',
    top: '-20%',
    left: '-10%',
    width: '70%',
    height: '280px',
    background:
      'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.14) 0%, rgba(139, 92, 246, 0.04) 35%, transparent 70%)',
    filter: 'blur(20px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  eyebrow: {
    position: 'relative',
    zIndex: 1,
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-5)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: '6px 14px',
    borderRadius: '999px',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
  },
  eyebrowText: {
    color: 'var(--text-muted)',
  },
  title: {
    position: 'relative',
    zIndex: 1,
    fontSize: 'var(--text-4xl)',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    marginBottom: 'var(--space-5)',
    maxWidth: '780px',
  },
  titleMobile: {
    fontSize: 'var(--text-3xl)',
  },
  titleAccent: {
    background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 50%, #f59e0b 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-lg)',
    lineHeight: 1.6,
    maxWidth: '640px',
  },

  steps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-12)',
  },

  card: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
  },
  cardNext: {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 1px var(--accent), 0 12px 32px rgba(139,92,246,0.18)',
  },
  cardLocked: {
    opacity: 0.55,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  stepBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)',
    fontWeight: 700,
    fontSize: 'var(--text-sm)',
  },
  stepBadgeNext: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
  stepBadgeDone: {
    background: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'var(--success)',
    color: 'var(--success)',
  },
  nextPill: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--accent-hover)',
    background: 'var(--accent-soft)',
    padding: '4px 10px',
    borderRadius: '999px',
  },
  donePill: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--success)',
    background: 'rgba(16, 185, 129, 0.10)',
    padding: '4px 10px',
    borderRadius: '999px',
  },
  cardTitle: {
    fontSize: 'var(--text-xl)',
    fontWeight: 700,
    marginBottom: 'var(--space-2)',
  },
  cardDesc: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    marginBottom: 'var(--space-4)',
    flex: 1,
  },
  progressLabel: {
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    marginBottom: 'var(--space-4)',
    fontFeatureSettings: '"tnum"',
  },
  cardCta: {
    padding: '10px 16px',
    textDecoration: 'none',
    width: '100%',
  },

  shortcut: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5) var(--space-6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
  },
  shortcutText: {
    flex: 1,
    minWidth: 0,
  },
  shortcutTitle: {
    fontSize: 'var(--text-base)',
    fontWeight: 600,
    marginBottom: 'var(--space-1)',
  },
  shortcutSub: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  shortcutBtn: {
    padding: '10px 16px',
    textDecoration: 'none',
  },
}
