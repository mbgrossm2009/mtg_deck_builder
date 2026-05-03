// Marketing landing for logged-out visitors. Logged-in users see Home (the
// onboarding cards) instead — App.jsx routes / based on auth state.

import { Link } from 'react-router-dom'
import { useIsMobile } from '../lib/useMediaQuery'
import DeckCastDemo from '../components/DeckCastDemo'
import BracketComparisonDemo from '../components/BracketComparisonDemo'

export default function Marketing() {
  const isMobile = useIsMobile()
  return (
    <div>
      <section style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        {/* Glow behind the hero — subtle radial pulse adds depth without using
            an actual image (keeps bundle size tiny and avoids IP risk). */}
        <div style={styles.heroGlow} aria-hidden />

        {/* Mana-pip eyebrow — five tiny WUBRG dots flank the format label,
            instantly placing the product in the MTG world without art assets. */}
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
          Even your bulk has potential. BuiltFromBulk imports your collection,
          detects your commander's strategy, and assembles a power-tuned 99-card
          deck — using only the cards you already own.
        </p>
        <div style={styles.ctaRow}>
          <Link to="/login" className="btn btn-primary" style={styles.primaryCta}>
            Get started for free →
          </Link>
          <a
            href="#how-it-works"
            className="btn btn-ghost"
            style={styles.secondaryCta}
          >
            How it works
          </a>
        </div>

        {/* Live demo terminal — shows the deck-gen pipeline running in real time
            with realistic timestamps. Doubles as the AI-time disclosure: the
            ~60-75 second total in the demo prepares users for the real wait. */}
        <div style={styles.demoWrap}>
          <div style={styles.demoLabel}>
            <span style={styles.demoLabelDot} aria-hidden />
            Watch a real generation run
          </div>
          <DeckCastDemo />
          <p style={styles.demoCaption}>
            AI deck generation runs three passes (strategy, build, then a final
            critique that swaps in better cards if needed) and typically completes
            in <strong>90 to 120 seconds</strong> per deck. Bottlenecked by OpenAI's
            output speed on JSON responses.
          </p>
        </div>
      </section>

      {/* Side-by-side bracket comparison — same commander, two brackets,
          shown in lockstep so the divergence is unmissable. The most
          differentiated thing the engine does. */}
      <section style={styles.comparisonSection}>
        <BracketComparisonDemo />
      </section>

      <section id="how-it-works" style={styles.howSection}>
        <h2 style={styles.sectionTitle}>How it works</h2>
        <div style={styles.steps}>
          <FeatureCard
            number="1"
            mana="w"
            title="Import your collection"
            description="Paste or upload a CSV/TXT export from any deck-tracking app. Every card is validated against Scryfall."
          />
          <FeatureCard
            number="2"
            mana="u"
            title="Pick your commander"
            description="Search any legendary creature. We detect the strategy from your commander's text and the cards in your collection."
          />
          <FeatureCard
            number="3"
            mana="r"
            title="Build the deck"
            description="Pick a power bracket (1–5). Get a 99-card deck tuned to your commander — role balance, combo detection, bracket compliance, all from cards you already own."
          />
        </div>
      </section>

      <section style={styles.featureSection}>
        <div style={styles.featureGrid}>
          <Capability
            title="AI-assisted strategy"
            description="Two-pass generation: the LLM picks your strategy and core engine first, then fills the rest of the deck around it."
          />
          <Capability
            title="Bracket-aware"
            description="Automatically excludes fast mana, tutors, and game-changers when you target casual brackets. No accidental cEDH."
          />
          <Capability
            title="Combo detection"
            description="Flags 100+ known infinite combos, including ones you didn't know your collection could assemble."
          />
          <Capability
            title="Strategy-aware scoring"
            description="Tribal, +1/+1 counters, tokens, voltron, aristocrats, and 15+ more archetypes. Scoring adjusts to your build."
          />
        </div>
      </section>

      <section style={styles.cta}>
        <div style={styles.ctaGlow} aria-hidden />
        <h2 style={styles.ctaTitle}>Discover the decks hiding in your collection</h2>
        <p style={styles.ctaSub}>
          Free to use. Sign in with Google or Facebook.
        </p>
        <Link to="/login" className="btn btn-primary" style={styles.primaryCta}>
          Get started →
        </Link>
      </section>
    </div>
  )
}

// Mana-color tinted feature card. The number badge picks up the assigned
// mana color so the three steps cycle visually through the MTG palette
// (W → U → R) instead of all being purple. Subtle but unmistakably MTG.
function FeatureCard({ number, mana, title, description }) {
  const tint = manaTint(mana)
  return (
    <div style={{ ...styles.card, ...(tint ? { borderColor: tint.border } : {}) }} className="card-hover">
      <div style={{
        ...styles.cardNumber,
        ...(tint ? { background: tint.soft, color: tint.fg, boxShadow: `0 0 12px ${tint.glow}` } : {}),
      }}>
        {number}
      </div>
      <h3 style={styles.cardTitle}>{title}</h3>
      <p style={styles.cardDesc}>{description}</p>
    </div>
  )
}

function manaTint(mana) {
  switch (mana) {
    case 'w': return { border: 'var(--mana-w-glow)', soft: 'var(--mana-w-soft)', glow: 'var(--mana-w-glow)', fg: 'var(--mana-w)' }
    case 'u': return { border: 'var(--mana-u-glow)', soft: 'var(--mana-u-soft)', glow: 'var(--mana-u-glow)', fg: 'var(--mana-u)' }
    case 'b': return { border: 'var(--mana-b-glow)', soft: 'var(--mana-b-soft)', glow: 'var(--mana-b-glow)', fg: 'var(--mana-b)' }
    case 'r': return { border: 'var(--mana-r-glow)', soft: 'var(--mana-r-soft)', glow: 'var(--mana-r-glow)', fg: 'var(--mana-r)' }
    case 'g': return { border: 'var(--mana-g-glow)', soft: 'var(--mana-g-soft)', glow: 'var(--mana-g-glow)', fg: 'var(--mana-g)' }
    default:  return null
  }
}

function Capability({ title, description }) {
  return (
    <div style={styles.capability}>
      <h3 style={styles.capabilityTitle}>{title}</h3>
      <p style={styles.capabilityDesc}>{description}</p>
    </div>
  )
}

const styles = {
  hero: {
    padding: 'var(--space-16) 0 var(--space-12)',
    textAlign: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  heroMobile: {
    padding: 'var(--space-10) 0 var(--space-8)',
  },
  // Soft purple aura behind the hero — sits behind the title and fades out.
  // Pure CSS, no image, no IP risk.
  heroGlow: {
    position: 'absolute',
    top: '20%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '120%',
    height: '320px',
    background:
      'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.18) 0%, rgba(139, 92, 246, 0.06) 35%, transparent 70%)',
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
    maxWidth: '620px',
    margin: '0 auto var(--space-8)',
  },
  ctaRow: {
    display: 'flex',
    gap: 'var(--space-3)',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  primaryCta: {
    padding: '14px 24px',
    fontSize: 'var(--text-base)',
    fontWeight: 700,
    textDecoration: 'none',
  },
  demoWrap: {
    marginTop: 'var(--space-12)',
    position: 'relative',
    zIndex: 1,
  },
  demoLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-3)',
  },
  demoLabelDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--success)',
    boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.20)',
  },
  demoCaption: {
    marginTop: 'var(--space-4)',
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    maxWidth: '520px',
    margin: 'var(--space-4) auto 0',
  },
  secondaryCta: {
    padding: '14px 16px',
    fontSize: 'var(--text-base)',
    textDecoration: 'none',
  },

  comparisonSection: {
    padding: 'var(--space-12) 0',
    borderTop: '1px solid var(--border)',
  },
  howSection: {
    padding: 'var(--space-12) 0',
    borderTop: '1px solid var(--border)',
  },
  sectionTitle: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    marginBottom: 'var(--space-8)',
    textAlign: 'center',
  },
  steps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 'var(--space-5)',
  },

  card: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
  },
  cardNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--accent-soft)',
    color: 'var(--accent-hover)',
    fontWeight: 700,
    fontSize: 'var(--text-base)',
    marginBottom: 'var(--space-4)',
  },
  cardTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 700,
    marginBottom: 'var(--space-2)',
  },
  cardDesc: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
  },

  featureSection: {
    padding: 'var(--space-12) 0',
    borderTop: '1px solid var(--border)',
  },
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 'var(--space-6)',
  },
  capability: {
    padding: 'var(--space-2) 0',
  },
  capabilityTitle: {
    fontSize: 'var(--text-base)',
    fontWeight: 700,
    marginBottom: 'var(--space-2)',
    color: 'var(--text)',
  },
  capabilityDesc: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
  },

  cta: {
    padding: 'var(--space-16) var(--space-6)',
    textAlign: 'center',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%), var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    margin: 'var(--space-8) 0 var(--space-4)',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  ctaGlow: {
    position: 'absolute',
    top: '-40%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '70%',
    height: '320px',
    background:
      'radial-gradient(ellipse at center, rgba(245,158,11,0.10) 0%, rgba(139,92,246,0.06) 35%, transparent 70%)',
    filter: 'blur(20px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  ctaTitle: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    marginBottom: 'var(--space-3)',
  },
  ctaSub: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-base)',
    marginBottom: 'var(--space-6)',
  },
}
