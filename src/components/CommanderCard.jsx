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
    <div style={styles.card}>
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
          <button style={styles.selectBtn} onClick={() => onSelect(card)}>
            Select Commander
          </button>
          <button
            style={alreadyIn ? styles.addedBtn : styles.addBtn}
            onClick={handleAdd}
            disabled={alreadyIn}
          >
            {alreadyIn ? 'In Collection' : '+ Collection'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  card: {
    background: '#16213e',
    border: '1px solid #4a2c6e',
    borderRadius: '10px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: '5 / 7',
    overflow: 'hidden',
    background: '#0f1526',
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
    color: '#555',
    fontSize: '0.8rem',
  },
  body: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
  },
  name: {
    fontWeight: '700',
    fontSize: '0.9rem',
    color: '#e0e0e0',
    lineHeight: '1.3',
  },
  manaCost: {
    fontSize: '0.78rem',
    color: '#c084fc',
  },
  typeLine: {
    fontSize: '0.75rem',
    color: '#a0a0c0',
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
    fontSize: '0.65rem',
    fontWeight: '700',
  },
  colorless: {
    fontSize: '0.75rem',
    color: '#777',
  },
  btnRow: {
    marginTop: 'auto',
    display: 'flex',
    gap: '6px',
  },
  selectBtn: {
    flex: 1,
    padding: '8px',
    background: '#4a2c6e',
    color: '#fff',
    border: '1px solid #c084fc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  addBtn: {
    flex: 1,
    padding: '8px',
    background: 'transparent',
    color: '#4ade80',
    border: '1px solid #4ade80',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  addedBtn: {
    flex: 1,
    padding: '8px',
    background: '#14532d',
    color: '#86efac',
    border: '1px solid #16a34a',
    borderRadius: '6px',
    cursor: 'default',
    fontSize: '0.82rem',
    fontWeight: '600',
    opacity: 0.8,
  },
}
