import { useState, useEffect } from 'react'
import { searchCommanders } from '../utils/scryfallApi'
import { getSelectedCommander, saveSelectedCommander, clearSelectedCommander, addToCollection, isInCollection } from '../utils/localStorage'
import CommanderCard from '../components/CommanderCard'
import SelectedCommander from '../components/SelectedCommander'

export default function Commander() {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [emptySearch, setEmpty]   = useState(false)
  const [searched, setSearched]   = useState(false)
  const [selected, setSelected]   = useState(null)

  useEffect(() => {
    setSelected(getSelectedCommander())
  }, [])

  async function handleSearch() {
    const trimmed = query.trim()
    if (!trimmed) {
      setEmpty(true)
      return
    }
    setEmpty(false)
    setError(null)
    setResults([])
    setSearched(false)
    setLoading(true)

    try {
      const cards = await searchCommanders(trimmed)
      setResults(cards)
      setSearched(true)
    } catch {
      setError('Failed to reach Scryfall. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSearch()
  }

  function handleSelect(card) {
    saveSelectedCommander(card)
    setSelected(card)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleClear() {
    clearSelectedCommander()
    setSelected(null)
  }

  function handleAddToCollection(card) {
    return addToCollection(card)
  }

  return (
    <div>
      <header style={styles.header}>
        <h1 style={styles.title}>Choose Your Commander</h1>
        <p style={styles.description}>
          Search for a legendary creature. Brewbench will build the deck around its color identity and abilities.
        </p>
      </header>

      {selected && (
        <SelectedCommander commander={selected} onClear={handleClear} />
      )}

      <div style={styles.searchRow}>
        <input
          style={styles.input}
          type="text"
          placeholder='Search by name, e.g. "Atraxa"'
          value={query}
          onChange={e => { setQuery(e.target.value); setEmpty(false) }}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary" style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {emptySearch && (
        <div style={styles.warning}>Please enter a commander name to search.</div>
      )}
      {error && (
        <div style={styles.errorBox}>{error}</div>
      )}

      {loading && (
        <div style={styles.status}>Searching Scryfall…</div>
      )}

      {!loading && searched && results.length === 0 && (
        <div style={styles.status}>No commanders found for "{query}". Try a different name.</div>
      )}

      {results.length > 0 && (
        <>
          <div style={styles.resultsCount}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
          <div style={styles.grid}>
            {results.map(card => (
              <CommanderCard
                key={card.id}
                card={card}
                onSelect={handleSelect}
                onAddToCollection={handleAddToCollection}
                inCollection={isInCollection(card.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  header: {
    marginBottom: 'var(--space-8)',
  },
  title: {
    fontSize: 'var(--text-3xl)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    marginBottom: 'var(--space-2)',
  },
  description: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-base)',
    lineHeight: 1.6,
    maxWidth: '560px',
  },
  searchRow: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
  },
  input: {
    flex: 1,
    padding: '11px 16px',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
  },
  searchBtn: {
    padding: '0 22px',
    fontSize: 'var(--text-sm)',
  },
  warning: {
    background: 'rgba(245, 158, 11, 0.10)',
    border: '1px solid rgba(245, 158, 11, 0.40)',
    color: 'var(--warning)',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-3)',
    fontSize: 'var(--text-sm)',
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.10)',
    border: '1px solid rgba(239, 68, 68, 0.40)',
    color: 'var(--danger)',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-3)',
    fontSize: 'var(--text-sm)',
  },
  status: {
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: 'var(--space-12) 0',
    fontSize: 'var(--text-sm)',
  },
  resultsCount: {
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    marginBottom: 'var(--space-4)',
    fontFeatureSettings: '"tnum"',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    gap: 'var(--space-4)',
  },
}
