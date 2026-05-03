import { getCardImage } from '../utils/scryfallApi'

const COLOR_GLOW = {
  W: 'var(--mana-w-glow)',
  U: 'var(--mana-u-glow)',
  B: 'var(--mana-b-glow)',
  R: 'var(--mana-r-glow)',
  G: 'var(--mana-g-glow)',
}
const COLOR_TO_PIP_CLASS = {
  W: 'mana-pip-w', U: 'mana-pip-u', B: 'mana-pip-b', R: 'mana-pip-r', G: 'mana-pip-g',
}

export default function SelectedCommander({ commander, onClear }) {
  const image = getCardImage(commander)
  const colorIdentity = commander.color_identity ?? []
  const wrapStyle = identityGlow(colorIdentity)

  return (
    <div style={{ ...styles.wrap, ...wrapStyle }}>
      <div style={styles.header}>
        <span style={styles.label}>◆ Selected Commander</span>
        <button className="btn btn-danger" style={styles.clearBtn} onClick={onClear}>Clear</button>
      </div>
      <div style={styles.body}>
        {image && (
          <div style={styles.imageWrap}>
            <img src={image} alt={commander.name} style={styles.image} />
          </div>
        )}
        <div style={styles.details}>
          <div style={styles.name}>{commander.name}</div>
          <div style={styles.typeLine}>{commander.type_line}</div>
          {commander.mana_cost && (
            <div style={styles.manaCost}>{commander.mana_cost}</div>
          )}
          <div className="mana-pip-row">
            {colorIdentity.length > 0
              ? colorIdentity.map(c => (
                  <span key={c} className={`mana-pip ${COLOR_TO_PIP_CLASS[c]}`}>{c}</span>
                ))
              : <span className="mana-pip mana-pip-c">C</span>
            }
          </div>
          {commander.oracle_text && (
            <p style={styles.oracleText}>{commander.oracle_text}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// Color-identity outer glow — single color = strong ring; multi = blended ring.
// Same shape as the MyDecks card glow so the language is consistent.
function identityGlow(colorIdentity) {
  if (!colorIdentity || colorIdentity.length === 0) return {}
  if (colorIdentity.length === 1) {
    const g = COLOR_GLOW[colorIdentity[0]]
    return g ? { borderColor: g, boxShadow: `0 0 0 1px ${g}, 0 12px 32px ${g}` } : {}
  }
  if (colorIdentity.length === 2) {
    const [a, b] = colorIdentity
    return {
      borderColor: COLOR_GLOW[a],
      boxShadow: `0 0 0 1px ${COLOR_GLOW[a]}, 0 8px 24px ${COLOR_GLOW[a]}, 0 12px 32px ${COLOR_GLOW[b]}`,
    }
  }
  const tones = colorIdentity.slice(0, 3).map(c => COLOR_GLOW[c]).filter(Boolean)
  return {
    borderColor: 'var(--border-strong)',
    boxShadow: tones.map((t, i) => `0 0 ${12 + i * 6}px ${t}`).join(', '),
  }
}

const styles = {
  wrap: {
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%), var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-6)',
    marginBottom: 'var(--space-8)',
    boxShadow: 'var(--shadow-md), inset 0 1px 0 rgba(255,255,255,0.04)',
    transition: 'border-color 240ms ease, box-shadow 240ms ease',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-4)',
  },
  label: {
    color: 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 'var(--text-xs)',
    textTransform: 'uppercase',
    letterSpacing: '0.10em',
  },
  clearBtn: {
    padding: '6px 14px',
    fontSize: 'var(--text-xs)',
  },
  body: {
    display: 'flex',
    gap: 'var(--space-5)',
    alignItems: 'flex-start',
  },
  imageWrap: {
    position: 'relative',
    flexShrink: 0,
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.40)',
  },
  image: {
    width: '140px',
    display: 'block',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '-0.01em',
    lineHeight: 1.15,
  },
  typeLine: {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    fontSize: 'var(--text-sm)',
  },
  manaCost: {
    color: 'var(--accent-hover)',
    fontSize: 'var(--text-sm)',
    fontFeatureSettings: '"tnum"',
  },
  oracleText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    margin: 0,
    whiteSpace: 'pre-wrap',
    maxHeight: '160px',
    overflowY: 'auto',
    padding: 'var(--space-3)',
    background: 'var(--bg-app)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    marginTop: 'var(--space-2)',
  },
}
