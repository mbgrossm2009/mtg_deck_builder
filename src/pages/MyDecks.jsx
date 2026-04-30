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
      <header style={styles.header}>
        <h1 style={styles.heading}>My Decks</h1>
        <p style={styles.sub}>
          {decks.length > 0
            ? `${decks.length} saved deck${decks.length !== 1 ? 's' : ''}`
            : 'No decks saved yet — generate one in the Deck Builder and save it.'}
        </p>
      </header>

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
    <div className="card-hover" style={styles.card}>
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
          <button className="btn btn-primary" style={styles.actionBtn} onClick={onLoad}>Load</button>
          {!isConfirmingDelete ? (
            <button className="btn btn-danger" style={styles.actionBtn} onClick={onAskDelete}>Delete</button>
          ) : (
            <div style={styles.confirmRow}>
              <button className="btn btn-danger" style={{ ...styles.actionBtn, ...styles.deleteConfirm }} onClick={onConfirmDelete}>Confirm</button>
              <button className="btn btn-secondary" style={styles.actionBtn} onClick={onCancelDelete}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  header:  { marginBottom: 'var(--space-8)' },
  heading: { fontSize: 'var(--text-3xl)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 'var(--space-2)' },
  sub:     { color: 'var(--text-muted)', fontSize: 'var(--text-base)', lineHeight: 1.6 },
  placeholder: {
    padding: 'var(--space-12)',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text-muted)',
    textAlign: 'center',
    fontSize: 'var(--text-sm)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 'var(--space-4)',
  },
  card: {
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: '5 / 7',
    overflow: 'hidden',
    background: 'var(--bg-app)',
    flexShrink: 0,
  },
  image: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  noImage: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-subtle)', fontSize: 'var(--text-xs)',
  },
  body: { padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  deckName:      { fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)', lineHeight: 1.3 },
  commanderName: { color: 'var(--accent-hover)', fontSize: 'var(--text-xs)' },
  pips: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  pip: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '20px', borderRadius: '50%',
    fontSize: 'var(--text-xs)', fontWeight: 700,
  },
  colorless: { fontSize: 'var(--text-xs)', color: 'var(--text-subtle)' },
  meta: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '4px' },
  metaDate: { color: 'var(--text-subtle)', fontSize: 'var(--text-xs)' },
  actions: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-2)' },
  actionBtn: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 'var(--text-xs)',
  },
  confirmRow: { display: 'flex', gap: 'var(--space-2)' },
  deleteConfirm: {
    flex: 1,
    fontWeight: 700,
  },
}
