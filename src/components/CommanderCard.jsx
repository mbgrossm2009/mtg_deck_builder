import { useState } from 'react'
import { getCardImage } from '../utils/scryfallApi'

const COLOR_PIPS = {
  W: { bg: '#f5f0e8', color: '#4a3728' },
  U: { bg: '#1a6fb0', color: '#fff'    },
  B: { bg: '#2c2c2c', color: '#c0c0c0' },
  R: { bg: '#d43f1e', color: '#fff'    },
  G: { bg: '#1a7a3a', color: '#fff'    },
}

export default function CommanderCard({ card, onSelect, onAddToCollection, inCollection }) {
  const image = getCardImage(card)
  const [added, setAdded] = useState(false)
  const alreadyIn = inCollection || added

  function handleAdd() {
    const wasAdded = onAddToCollection(card)
    if (wasAdded) setAdded(true)
  }

  return (
    <div className="card-hover" style={styles.card}>
      <div style={styles.imageWrap}>
        {image
          ? <img src={image} alt={card.name} style={styles.image} />
          : <div style={styles.noImage}>No image available</div>
        }
      </div>
      <div style={styles.body}>
        <div style={styles.name}>{card.name}</div>
        {card.mana_cost && <div style={styles.manaCost}>{card.mana_cost}</div>}
        <div style={styles.typeLine}>{card.type_line}</div>
        <div style={styles.pips}>
          {card.color_identity.length > 0
            ? card.color_identity.map(c => (
                <span key={c} style={{ ...styles.pip, background: COLOR_PIPS[c]?.bg, color: COLOR_PIPS[c]?.color }}>
                  {c}
                </span>
              ))
            : <span style={styles.colorless}>Colorless</span>
          }
        </div>
        <div style={styles.btnRow}>
          <button className="btn btn-primary" style={styles.actionBtn} onClick={() => onSelect(card)}>
            Select
          </button>
          <button
            className={alreadyIn ? 'btn btn-secondary' : 'btn btn-secondary'}
            style={{ ...styles.actionBtn, ...(alreadyIn ? styles.addedBtn : {}) }}
            onClick={handleAdd}
            disabled={alreadyIn}
          >
            {alreadyIn ? '✓ Owned' : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  card: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: '5 / 7',
    overflow: 'hidden',
    background: 'var(--bg-app)',
    flexShrink: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  noImage: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
  },
  body: {
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
  },
  name: {
    fontWeight: 700,
    fontSize: 'var(--text-sm)',
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  manaCost: {
    fontSize: 'var(--text-xs)',
    color: 'var(--accent-hover)',
    fontFeatureSettings: '"tnum"',
  },
  typeLine: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  pips: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    marginTop: '2px',
  },
  pip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
  },
  colorless: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-subtle)',
  },
  btnRow: {
    marginTop: 'auto',
    display: 'flex',
    gap: 'var(--space-2)',
    paddingTop: 'var(--space-2)',
  },
  actionBtn: {
    flex: 1,
    padding: '8px 10px',
    fontSize: 'var(--text-xs)',
  },
  addedBtn: {
    color: 'var(--success)',
    borderColor: 'rgba(16, 185, 129, 0.40)',
    background: 'rgba(16, 185, 129, 0.10)',
  },
}
