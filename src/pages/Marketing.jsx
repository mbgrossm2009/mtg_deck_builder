// Marketing landing for logged-out visitors. Logged-in users see Home (the
// onboarding cards) instead — App.jsx routes / based on auth state.

import { Link } from 'react-router-dom'
import { useIsMobile } from '../lib/useMediaQuery'
import DeckCastDemo from '../components/DeckCastDemo'

export default function Marketing() {
  const isMobile = useIsMobile()
  return (
    <div>
      <section style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        {/* Glow behind the hero — subtle radial pulse adds depth without using
            an actual image (keeps bundle size tiny and avoids IP risk). */}
        <div style={styles.heroGlow} aria-hidden />

        <div style={styles.eyebrow}>
          <span style={styles.eyebrowOrnament} aria-hidden>◆</span>
          Commander Deck Builder
          <span style={styles.eyebrowOrnament} aria-hidden>◆</span>
        </div>
        <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
          Build optimized <span style={styles.titleAccent}>Commander</span> decks
          <br />from the cards you own.
        </h1>
        <p style={styles.subtitle}>
          Import your collection. Pick a commander. Deckify it — into a power-tuned
          99-card build with strategy detection, bracket-aware filtering, and AI-assisted
          card selection.
        </p>
        <div style={styles.ctaRow}>
          <Link to="/login" className="btn btn-primary" style={styles.primaryCta}>
            Get started — free →
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
            ~22-second total in the demo prepares users for the real wait. */}
        <div style={styles.demoWrap}>
          <div style={styles.demoLabel}>
            <span style={styles.demoLabelDot} aria-hidden />
            Watch a real generation run
          </div>
          <DeckCastDemo />
          <p style={styles.demoCaption}>
            AI deck generation runs two passes — strategy + build — and typically
            completes in <strong>15-30 seconds</strong> per deck.
          </p>
        </div>
      </section>

      <section id="how-it-works" style={styles.howSection}>
        <h2 style={styles.sectionTitle}>How it works</h2>
        <div style={styles.steps}>
          <FeatureCard
            number="1"
            title="Import your collection"
            description="Paste or upload a CSV/TXT export from any deck-tracking app. We validate every card against Scryfall."
          />
          <FeatureCard
            number="2"
            title="Pick a commander"
            description="Search any legendary creature. Deckify detects the strategy from your commander's text and your collection."
          />
          <FeatureCard
            number="3"
            title="Generate the deck"
            description="Pick a power bracket (1–5). Get a 99-card deck tuned to your commander, with role balance, combo detection, and bracket compliance."
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
            description="Flags 100+ known infinite combos — including ones you didn't know your collection could assemble."
          />
          <Capability
            title="Strategy-aware scoring"
            description="Tribal, +1/+1 counters, tokens, voltron, aristocrats, and 15+ more archetypes. Scoring adjusts to your build."
          />
        </div>
      </section>

      <section style={styles.cta}>
        <h2 style={styles.ctaTitle}>Ready to deckify?</h2>
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

function FeatureCard({ number, title, description }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardNumber}>{number}</div>
      <h3 style={styles.cardTitle}>{title}</h3>
      <p style={styles.cardDesc}>{description}</p>
    </div>
  )
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
    color: 'var(--accent-hover)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-4)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  eyebrowOrnament: {
    color: 'var(--accent-2)',
    fontSize: '0.6rem',
    opacity: 0.7,
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
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    margin: 'var(--space-8) 0 var(--space-4)',
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
