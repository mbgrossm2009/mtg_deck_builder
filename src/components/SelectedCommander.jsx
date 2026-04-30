import { getCardImage } from '../utils/scryfallApi'

const COLOR_PIPS = {
  W: { bg: '#f5f0e8', color: '#4a3728' },
  U: { bg: '#1a6fb0', color: '#fff'    },
  B: { bg: '#2c2c2c', color: '#c0c0c0' },
  R: { bg: '#d43f1e', color: '#fff'    },
  G: { bg: '#1a7a3a', color: '#fff'    },
}

export default function SelectedCommander({ commander, onClear }) {
  const image = getCardImage(commander)

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.label}>Selected Commander</span>
        <button className="btn btn-danger" style={styles.clearBtn} onClick={onClear}>Clear</button>
      </div>
      <div style={styles.body}>
        {image && (
          <img src={image} alt={commander.name} style={styles.image} />
        )}
        <div style={styles.details}>
          <div style={styles.name}>{commander.name}</div>
          <div style={styles.typeLine}>{commander.type_line}</div>
          {commander.mana_cost && (
            <div style={styles.manaCost}>{commander.mana_cost}</div>
          )}
          <div style={styles.pips}>
            {commander.color_identity.length > 0
              ? commander.color_identity.map(c => (
                  <span key={c} style={{ ...styles.pip, background: COLOR_PIPS[c]?.bg, color: COLOR_PIPS[c]?.color }}>
                    {c}
                  </span>
                ))
              : <span style={styles.colorless}>Colorless</span>
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

const styles = {
  wrap: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-6)',
    marginBottom: 'var(--space-8)',
    boxShadow: 'var(--shadow-md)',
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
  image: {
    width: '140px',
    borderRadius: 'var(--radius-md)',
    flexShrink: 0,
    boxShadow: 'var(--shadow-sm)',
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
  pips: {
    display: 'flex',
    gap: '5px',
    flexWrap: 'wrap',
  },
  pip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
  },
  colorless: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-subtle)',
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
