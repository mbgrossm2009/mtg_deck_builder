import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDecks, deleteDeck } from '../utils/localStorage'
import { getCardImageSmall } from '../utils/scryfallApi'

const COLOR_PIPS = {
  W: { bg: '#f5f0e8', color: '#4a3728' },
  U: { bg: '#1a6fb0', color: '#fff'    },
  B: { bg: '#2c2c2c', color: '#c0c0c0' },
  R: { bg: '#d43f1e', color: '#fff'    },
  G: { bg: '#1a7a3a', color: '#fff'    },
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function MyDecks() {
  const navigate = useNavigate()
  const [decks, setDecks] = useState(() => getDecks())
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const handleLoad = useCallback((deckId) => {
    navigate('/deck-builder', { state: { loadDeckId: deckId } })
  }, [navigate])

  const handleConfirmDelete = useCallback((deckId) => {
    deleteDeck(deckId)
    setDecks(getDecks())
    setConfirmDeleteId(null)
  }, [])

  const sorted = [...decks].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

  return (
    <div>
      <h2 style={styles.heading}>My Decks</h2>
      <p style={styles.sub}>
        {decks.length > 0
          ? `${decks.length} saved deck${decks.length !== 1 ? 's' : ''}`
          : 'No decks saved yet — generate one in the Deck Builder and save it.'}
      </p>

      {decks.length === 0 ? (
        <div style={styles.placeholder}>
          Head to the Deck Builder, generate a deck, and click "Save Deck" to keep it here.
        </div>
      ) : (
        <div style={styles.grid}>
          {sorted.map(deck => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onLoad={() => handleLoad(deck.id)}
              onAskDelete={() => setConfirmDeleteId(deck.id)}
              isConfirmingDelete={confirmDeleteId === deck.id}
              onConfirmDelete={() => handleConfirmDelete(deck.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DeckCard({ deck, onLoad, onAskDelete, isConfirmingDelete, onConfirmDelete, onCancelDelete }) {
  const image = deck.commander ? getCardImageSmall(deck.commander) : null
  const totalCards = (deck.mainDeck ?? []).reduce((s, c) => s + (c.quantity ?? 1), 0)
  const colorIdentity = deck.commander?.color_identity ?? []

  return (
    <div style={styles.card}>
      <div style={styles.imageWrap}>
        {image
          ? <img src={image} alt={deck.commander?.name ?? ''} style={styles.image} loading="lazy" />
          : <div style={styles.noImage}>No image</div>
        }
      </div>
      <div style={styles.body}>
        <div style={styles.deckName}>{deck.name}</div>
        {deck.commander && (
          <div style={styles.commanderName}>{deck.commander.name}</div>
        )}
        <div style={styles.pips}>
          {colorIdentity.length > 0
            ? colorIdentity.map(c => (
                <span key={c} style={{ ...styles.pip, background: COLOR_PIPS[c]?.bg, color: COLOR_PIPS[c]?.color }}>
                  {c}
                </span>
              ))
            : <span style={styles.colorless}>Colorless</span>
          }
        </div>
        <div style={styles.meta}>
          <div>{totalCards} cards{deck.commander ? ' + commander' : ''}</div>
          <div style={styles.metaDate}>Created {formatDate(deck.createdAt)}</div>
          <div style={styles.metaDate}>Updated {formatDate(deck.updatedAt)}</div>
        </div>

        <div style={styles.actions}>
          <button style={styles.loadBtn} onClick={onLoad}>Load</button>
          {!isConfirmingDelete ? (
            <button style={styles.deleteBtn} onClick={onAskDelete}>Delete</button>
          ) : (
            <div style={styles.confirmRow}>
              <button style={styles.deleteConfirm} onClick={onConfirmDelete}>Confirm</button>
              <button style={styles.deleteCancel} onClick={onCancelDelete}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  heading: { color: '#c084fc', marginBottom: '8px' },
  sub:     { color: '#a0a0c0', marginBottom: '20px', fontSize: '0.95rem' },
  placeholder: {
    padding: '40px',
    border: '1px dashed #4a2c6e',
    borderRadius: '8px',
    color: '#6060a0',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
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
  image: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  noImage: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#555', fontSize: '0.8rem',
  },
  body: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  deckName:      { fontWeight: '700', fontSize: '0.95rem', color: '#e0e0e0', lineHeight: '1.3' },
  commanderName: { color: '#c084fc', fontSize: '0.82rem' },
  pips: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  pip: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '20px', borderRadius: '50%',
    fontSize: '0.65rem', fontWeight: '700',
  },
  colorless: { fontSize: '0.75rem', color: '#777' },
  meta: { fontSize: '0.78rem', color: '#a0a0c0', marginTop: '4px' },
  metaDate: { color: '#6070a0', fontSize: '0.72rem' },
  actions: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' },
  loadBtn: {
    padding: '8px',
    background: '#2d1b4e',
    color: '#c084fc',
    border: '1px solid #c084fc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  deleteBtn: {
    padding: '8px',
    background: 'transparent',
    color: '#ef4444',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  confirmRow: { display: 'flex', gap: '6px' },
  deleteConfirm: {
    flex: 1,
    padding: '8px',
    background: '#3b0000',
    color: '#fff',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: '700',
  },
  deleteCancel: {
    flex: 1,
    padding: '8px',
    background: 'transparent',
    color: '#a0a0c0',
    border: '1px solid #4a2c6e',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.78rem',
  },
}
