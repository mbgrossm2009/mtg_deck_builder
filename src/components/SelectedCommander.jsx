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
        <button style={styles.clearBtn} onClick={onClear}>Clear Commander</button>
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
    background: '#16213e',
    border: '2px solid #c084fc',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '32px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  label: {
    color: '#c084fc',
    fontWeight: '700',
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  clearBtn: {
    padding: '6px 14px',
    background: 'transparent',
    border: '1px solid #ef4444',
    color: '#ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
  },
  body: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
  },
  image: {
    width: '140px',
    borderRadius: '8px',
    flexShrink: 0,
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  name: {
    fontSize: '1.4rem',
    fontWeight: '700',
    color: '#fff',
  },
  typeLine: {
    color: '#a0a0c0',
    fontStyle: 'italic',
    fontSize: '0.88rem',
  },
  manaCost: {
    color: '#c084fc',
    fontSize: '0.88rem',
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
    fontSize: '0.72rem',
    fontWeight: '700',
  },
  colorless: {
    fontSize: '0.85rem',
    color: '#777',
  },
  oracleText: {
    fontSize: '0.85rem',
    color: '#b0b0c8',
    lineHeight: '1.55',
    margin: 0,
    whiteSpace: 'pre-wrap',
    maxHeight: '110px',
    overflowY: 'auto',
  },
}
