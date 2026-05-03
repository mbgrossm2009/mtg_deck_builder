import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDecks, deleteDeck } from '../utils/localStorage'
import { getCardImageSmall } from '../utils/scryfallApi'

// Per-color glow tints lifted from the design tokens, used to surround
// the deck card with the commander's color identity. Multi-color decks
// blend their two strongest colors into the box-shadow so the card
// reads as "this is a Boros deck" / "this is a Golgari deck" at a glance.
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
            ? `${decks.length} saved deck${decks.length !== 1 ? 's' : ''} — every one built from your collection.`
            : 'No decks saved yet. Generate one in the Deck Builder and save it.'}
        </p>
      </header>

      {decks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-ornament" aria-hidden>◆</div>
          <div className="empty-state-title">No decks yet</div>
          <div className="empty-state-body">
            Head to the Deck Builder, generate a deck, and click <strong>Save Deck</strong> to
            keep it here. Every saved deck shows its commander, color identity, and a quick
            shortcut back into the builder.
          </div>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/deck-builder')}
            style={{ padding: '10px 20px', fontSize: 'var(--text-sm)' }}
          >
            Open Deck Builder →
          </button>
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

  // Color-identity glow ring — picks up the first 1-2 mana colors so the
  // deck tile visually telegraphs its WUBRG identity.
  const cardStyle = identityGlowStyle(colorIdentity)

  return (
    <div className="card-hover" style={{ ...styles.card, ...cardStyle }}>
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
                <span key={c} className={`mana-pip ${COLOR_TO_PIP_CLASS[c]}`}>
                  {c}
                </span>
              ))
            : <span className="mana-pip mana-pip-c">C</span>
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

// Build a subtle outer glow whose tone reflects the commander's color
// identity. Mono = single color. Two colors = blended ring. 3+ = soft
// rainbow. Falls back to neutral border when colorless.
function identityGlowStyle(colorIdentity) {
  if (!colorIdentity || colorIdentity.length === 0) return {}
  if (colorIdentity.length === 1) {
    const g = COLOR_GLOW[colorIdentity[0]]
    return g ? { borderColor: g, boxShadow: `0 8px 24px ${g}` } : {}
  }
  if (colorIdentity.length === 2) {
    const [a, b] = colorIdentity
    return {
      borderColor: COLOR_GLOW[a],
      boxShadow: `0 4px 16px ${COLOR_GLOW[a]}, 0 8px 24px ${COLOR_GLOW[b]}`,
    }
  }
  // 3+: light rainbow blend (pull the first three present in WUBRG order).
  const tones = colorIdentity.slice(0, 3).map(c => COLOR_GLOW[c]).filter(Boolean)
  if (tones.length === 0) return {}
  return {
    borderColor: 'var(--border-strong)',
    boxShadow: tones.map((t, i) => `0 ${4 + i * 2}px ${12 + i * 4}px ${t}`).join(', '),
  }
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
