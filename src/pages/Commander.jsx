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
      <h1 style={styles.title}>Choose Your Commander</h1>
      <p style={styles.description}>
        Search for a legendary creature or legal commander and save it as your selected commander.
      </p>

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
        <button style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
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
  title: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '8px',
  },
  description: {
    color: '#a0a0c0',
    fontSize: '0.95rem',
    marginBottom: '28px',
  },
  searchRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '14px',
  },
  input: {
    flex: 1,
    padding: '10px 16px',
    background: '#16213e',
    border: '1px solid #4a2c6e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '1rem',
    outline: 'none',
  },
  searchBtn: {
    padding: '10px 24px',
    background: '#4a2c6e',
    color: '#fff',
    border: '1px solid #c084fc',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
  },
  warning: {
    background: '#2d1f00',
    border: '1px solid #f59e0b',
    color: '#f59e0b',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '12px',
    fontSize: '0.9rem',
  },
  errorBox: {
    background: '#2d0f0f',
    border: '1px solid #ef4444',
    color: '#ef4444',
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '12px',
    fontSize: '0.9rem',
  },
  status: {
    color: '#a0a0c0',
    textAlign: 'center',
    padding: '40px 0',
    fontSize: '0.95rem',
  },
  resultsCount: {
    color: '#a0a0c0',
    fontSize: '0.82rem',
    marginBottom: '14px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    gap: '16px',
  },
}
