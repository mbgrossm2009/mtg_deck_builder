import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { getCollection, removeFromCollection, addImportedCardsToCollection, saveCollection, trimScryfallCard, saveSelectedCommander, getSelectedCommander, clearCollection, removeFailedCards } from '../utils/localStorage'
import { getCardImageSmall, getCardsByNames } from '../utils/scryfallApi'
import { parseCsvText, parseAuto, normalizeImportedCards, cleanCardName } from '../utils/cardImportParser'

const PAGE_SIZE = 60

function emptyResultMessage({ search, legendaryOnly, raresOnly }) {
  const filters = []
  if (legendaryOnly) filters.push('legendary creatures')
  if (raresOnly)     filters.push('rares & mythics')
  const filterText = filters.length > 0 ? ` matching ${filters.join(' + ')}` : ''
  if (search) return `No cards match "${search}"${filterText}.`
  if (filters.length > 0) return `No cards in your collection are ${filters.join(' or ')}.`
  return 'No matching cards.'
}

function isCommanderEligible(card) {
  const type = (card.type_line ?? '').toLowerCase()
  if (type.includes('legendary') && type.includes('creature')) return true
  const oracle = (card.oracle_text ?? '').toLowerCase()
  return oracle.includes('can be your commander')
}

const COLOR_PIPS = {
  W: { bg: '#f5f0e8', color: '#4a3728' },
  U: { bg: '#1a6fb0', color: '#fff'    },
  B: { bg: '#2c2c2c', color: '#c0c0c0' },
  R: { bg: '#d43f1e', color: '#fff'    },
  G: { bg: '#1a7a3a', color: '#fff'    },
}

const CollectionCard = memo(function CollectionCard({ card, onRemove, onSetCommander, isCurrentCommander }) {
  const image = getCardImageSmall(card)
  const colorIdentity = card.color_identity ?? []
  const eligible = isCommanderEligible(card)
  return (
    <div style={styles.card}>
      <div style={styles.imageWrap}>
        {image
          ? <img src={image} alt={card.name} style={styles.image} loading="lazy" decoding="async" />
          : <div style={styles.noImage}>No image</div>
        }
      </div>
      <div style={styles.body}>
        <div style={styles.nameRow}>
          <div style={styles.name}>{card.name}</div>
          {(card.quantity ?? 1) > 1 && (
            <span style={styles.qtyBadge}>x{card.quantity}</span>
          )}
        </div>
        {card.mana_cost && <div style={styles.manaCost}>{card.mana_cost}</div>}
        {card.type_line && <div style={styles.typeLine}>{card.type_line}</div>}
        {card.needsValidation && (
          <div style={styles.validationBadge}>Fetching data…</div>
        )}
        {card.validationFailed && (
          <div style={styles.failedBadge}>Not found on Scryfall</div>
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
        <div style={styles.actions}>
          {eligible && (
            <button
              style={isCurrentCommander ? styles.commanderBtnActive : styles.commanderBtn}
              onClick={() => onSetCommander(card)}
              disabled={isCurrentCommander}
            >
              {isCurrentCommander ? '★ Current Commander' : 'Set as Commander'}
            </button>
          )}
          <button style={styles.removeBtn} onClick={() => onRemove(card.id)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
})

function ImportSection({ onImportComplete }) {
  const fileInputRef = useRef(null)
  const [importText, setImportText]           = useState('')
  const [selectedFileName, setFileName]       = useState(null)
  const [isCsvFile, setIsCsvFile]             = useState(false)
  const [parseError, setParseError]           = useState(null)
  const [parsedCards, setParsedCards]         = useState(null)
  const [importResult, setImportResult]       = useState(null)
  const [splitByCommas, setSplitByCommas]     = useState(false)

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return

    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'txt'].includes(ext)) {
      setParseError('Please upload a .csv or .txt file.')
      e.target.value = ''
      return
    }

    setIsCsvFile(ext === 'csv')
    setFileName(file.name)
    setParseError(null)
    setParsedCards(null)
    setImportResult(null)

    const reader = new FileReader()
    reader.onload = ev => setImportText(ev.target.result)
    reader.onerror = () => setParseError('Failed to read file.')
    reader.readAsText(file)
  }

  function handleClearFile() {
    setFileName(null)
    setIsCsvFile(false)
    setImportText('')
    setParsedCards(null)
    setParseError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleParse() {
    const text = importText.trim()
    if (!text) {
      setParseError('Please upload a file or paste a card list.')
      return
    }
    if (text.length > 400_000) {
      setParseError('Import text is very large (>400 KB). Try splitting into smaller batches.')
      return
    }

    // When pasting a single-line comma-separated list (e.g. "Sol Ring, Mox Diamond, Lightning Bolt"),
    // the toggle converts commas to newlines so the parser sees one card per line.
    // Disabled by default because real card names contain commas (Yawgmoth, Thran Physician).
    const prepared = !isCsvFile && splitByCommas
      ? text.replace(/,\s*/g, '\n')
      : text

    const raw = isCsvFile ? parseCsvText(prepared) : parseAuto(prepared)
    const cards = normalizeImportedCards(raw)

    if (cards.length === 0) {
      setParseError('No valid cards found. Try checking the format.')
      return
    }

    setParseError(null)
    setParsedCards(cards)
    setImportResult(null)
  }

  function handleConfirmImport() {
    let result
    try {
      result = addImportedCardsToCollection(parsedCards)
    } catch (err) {
      setParseError(err.userMessage ?? `Import failed: ${err.message ?? err}`)
      return
    }
    setImportResult(result)
    setParsedCards(null)
    setImportText('')
    setFileName(null)
    setIsCsvFile(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onImportComplete()
  }

  function handleCancelPreview() {
    setParsedCards(null)
  }

  function handleDismissResult() {
    setImportResult(null)
  }

  const totalQty      = parsedCards ? parsedCards.reduce((s, c) => s + c.quantity, 0) : 0
  const warningCount  = parsedCards ? parsedCards.filter(c => c.warnings.length > 0).length : 0

  return (
    <div style={importStyles.panel}>
      <div style={importStyles.panelHeader}>
        <span style={importStyles.panelTitle}>Import Cards</span>
        <span style={importStyles.panelHint}>
          Import from a CSV file, Manabox export, or pasted card list
        </span>
      </div>

      {/* Success banner */}
      {importResult && (
        <div style={importStyles.successBox}>
          <span>
            Imported <strong>{importResult.added}</strong> new card{importResult.added !== 1 ? 's' : ''}.
            {importResult.updated > 0 && (
              <> <strong>{importResult.updated}</strong> existing card{importResult.updated !== 1 ? 's' : ''} updated.</>
            )}
          </span>
          <button style={importStyles.dismissBtn} onClick={handleDismissResult}>Dismiss</button>
        </div>
      )}

      {/* Input area — hidden while preview is showing */}
      {!parsedCards && !importResult && (
        <>
          {/* File upload row */}
          <div style={importStyles.fileRow}>
            <label style={importStyles.fileLabel}>
              Choose file (.csv or .txt)
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>
            {selectedFileName && (
              <>
                <span style={importStyles.fileName}>{selectedFileName}</span>
                <button style={importStyles.clearFileBtn} onClick={handleClearFile}>✕</button>
              </>
            )}
          </div>

          <div style={importStyles.orDivider}>
            <span style={importStyles.orText}>or paste below</span>
          </div>

          <textarea
            style={{
              ...importStyles.textarea,
              ...(selectedFileName ? importStyles.textareaDisabled : {}),
            }}
            placeholder={'1 Sol Ring\n2x Island\n1 Arcane Signet (C21) 400\nCommand Tower'}
            value={importText}
            onChange={e => {
              if (selectedFileName) return
              setImportText(e.target.value)
              setParseError(null)
              setImportResult(null)
            }}
            readOnly={!!selectedFileName}
            rows={8}
          />

          <label style={{
            ...importStyles.commaToggleRow,
            ...(selectedFileName ? importStyles.commaToggleDisabled : {}),
          }}>
            <input
              type="checkbox"
              checked={splitByCommas}
              onChange={e => setSplitByCommas(e.target.checked)}
              disabled={!!selectedFileName}
              style={importStyles.commaToggleCheckbox}
            />
            <span>
              <strong>Split by commas</strong>
              <span style={importStyles.commaToggleHint}>
                Use only when pasting a one-line list. Will incorrectly split card names containing commas (e.g. "Yawgmoth, Thran Physician").
              </span>
            </span>
          </label>

          {parseError && (
            <div style={importStyles.errorBox}>{parseError}</div>
          )}

          <button style={importStyles.parseBtn} onClick={handleParse}>
            Parse Import
          </button>
        </>
      )}

      {/* Preview */}
      {parsedCards && (
        <div>
          <div style={importStyles.previewSummary}>
            <span style={importStyles.summaryChip}>{parsedCards.length} unique cards</span>
            <span style={importStyles.summaryChip}>{totalQty} total copies</span>
            {warningCount > 0 && (
              <span style={importStyles.warnChip}>{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
            )}
          </div>

          <div style={importStyles.previewTableWrap}>
            <table style={importStyles.table}>
              <thead>
                <tr>
                  <th style={importStyles.th}>Qty</th>
                  <th style={{ ...importStyles.th, textAlign: 'left' }}>Card Name</th>
                  <th style={{ ...importStyles.th, textAlign: 'left' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {parsedCards.map((card, i) => (
                  <tr key={i} style={i % 2 === 0 ? importStyles.rowEven : importStyles.rowOdd}>
                    <td style={importStyles.tdQty}>{card.quantity}</td>
                    <td style={importStyles.td}>{card.name}</td>
                    <td style={importStyles.tdWarn}>
                      {card.warnings.length > 0 && (
                        <span style={importStyles.warnText}>{card.warnings.join('; ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={importStyles.previewActions}>
            <button style={importStyles.confirmBtn} onClick={handleConfirmImport}>
              Add to Collection
            </button>
            <button style={importStyles.cancelBtn} onClick={handleCancelPreview}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Collection() {
  const [collection, setCollection]       = useState([])
  const [validatingCount, setValidating]  = useState(0)
  const [validationError, setValidationError] = useState(null)
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE)
  const [search, setSearch]               = useState('')
  const [legendaryOnly, setLegendaryOnly] = useState(false)
  const [raresOnly, setRaresOnly]         = useState(false)
  const [sortByUploaded, setSortByUploaded] = useState(false)
  const [commanderId, setCommanderId]     = useState(() => getSelectedCommander()?.id ?? null)
  const [commanderToast, setCommanderToast] = useState(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  // Generation counter: incrementing cancels any in-flight validation loop.
  // Prevents React Strict Mode's double-mount from running two concurrent loops
  // (which would double request rate and cause 429s from Scryfall).
  const validationGenRef = useRef(0)

  // Fetch Scryfall data for unvalidated or previously-failed cards.
  // Cleans the stored name before lookup (fixes cards imported with *F* or set codes attached).
  // Uses the /cards/collection batch endpoint to avoid rate-limiting (up to 75 cards per request).
  const runValidation = useCallback(async (cards) => {
    const myGen = ++validationGenRef.current
    // Re-fetch cards that are unvalidated, previously failed, OR missing fields
    // we now persist (rarity was added later — backfill on next load).
    const pending = cards.filter(c => {
      if (c.needsValidation || c.validationFailed) return true
      if (c.isBasicLand) return false
      return c.rarity == null
    })
    if (pending.length === 0) return

    setValidating(pending.length)

    const lookupNames = pending.map(c => cleanCardName(c.name))
    // Cards already validated successfully (we're just backfilling new fields).
    // If a backfill lookup fails, don't flip them to validationFailed — leave them be.
    const backfillIds = new Set(
      pending.filter(p => !p.needsValidation && !p.validationFailed).map(p => p.id)
    )

    // Save what the batch pass resolved before fuzzy starts — protects progress
    // if the user reloads while fuzzy is still running.
    const applyResults = (byLookupName, notFoundSet, partial = false) => {
      if (validationGenRef.current !== myGen) return
      const pendingIds = new Set(pending.map(p => p.id))
      setCollection(prev => {
        const next = prev.map(c => {
          if (!pendingIds.has(c.id)) return c
          const key = cleanCardName(c.name).toLowerCase()
          const data = byLookupName[key]
          if (data) {
            return {
              ...c,
              ...trimScryfallCard(data),
              needsValidation:  false,
              validationFailed: false,
            }
          }
          if (!partial && notFoundSet.has(key) && !backfillIds.has(c.id)) {
            return { ...c, needsValidation: false, validationFailed: true }
          }
          return c
        })
        saveCollection(next)
        return next
      })
    }

    try {
      setValidationError(null)
      const { byLookupName, notFound } = await getCardsByNames(lookupNames, {
        onBatchDone: (partialResults) => applyResults(partialResults, new Set(), true),
        onProgress: ({ processed, total, phase }) => {
          if (validationGenRef.current !== myGen) return
          // During batch phase: countdown remaining of pending.length.
          // During fuzzy phase: small constant remaining since fuzzy is per-card.
          const remaining = phase === 'batch' ? Math.max(0, pending.length - processed) : Math.max(0, total - processed)
          setValidating(remaining)
        },
      })
      if (validationGenRef.current !== myGen) return

      const notFoundSet = new Set(notFound.map(n => n.toLowerCase()))
      applyResults(byLookupName, notFoundSet, false)
    } catch (err) {
      if (validationGenRef.current !== myGen) return
      setValidationError(`Couldn't reach Scryfall. ${err?.message ?? err}. Card data won't be enriched until you retry.`)
    } finally {
      if (validationGenRef.current === myGen) setValidating(0)
    }
  }, [])

  useEffect(() => {
    const coll = getCollection()
    setCollection(coll)
    runValidation(coll)
    return () => { validationGenRef.current++ }
  }, [])

  function handleRemove(cardId) {
    removeFromCollection(cardId)
    setCollection(prev => prev.filter(c => c.id !== cardId))
  }

  const handleSetCommander = useCallback((card) => {
    saveSelectedCommander(card)
    setCommanderId(card.id)
    setCommanderToast(card.name)
    setTimeout(() => {
      setCommanderToast(curr => (curr === card.name ? null : curr))
    }, 2500)
  }, [])

  function handleImportComplete() {
    const updated = getCollection()
    setCollection(updated)
    runValidation(updated)
  }

  const handleRemoveFailed = useCallback(() => {
    removeFailedCards()
    setCollection(getCollection())
  }, [])

  // Cards whose Scryfall lookup confirmed they aren't real Magic cards.
  // Hidden while validation is mid-flight so the banner doesn't flash for cards
  // that just haven't been checked yet.
  const failedCards = useMemo(
    () => collection.filter(c => c.validationFailed),
    [collection]
  )

  const totalUnique = collection.length
  const totalCopies = collection.reduce((s, c) => s + (c.quantity ?? 1), 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = collection.filter(c => {
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (legendaryOnly) {
        const type = (c.type_line ?? '').toLowerCase()
        if (!type.includes('legendary') || !type.includes('creature')) return false
      }
      if (raresOnly) {
        const r = (c.rarity ?? '').toLowerCase()
        if (r !== 'rare' && r !== 'mythic') return false
      }
      return true
    })
    // Sort newest-uploaded first when toggled. Cards without a timestamp fall to the bottom.
    if (sortByUploaded) {
      out.sort((a, b) => {
        const ta = a.addedAt ?? ''
        const tb = b.addedAt ?? ''
        if (!ta && !tb) return 0
        if (!ta) return 1
        if (!tb) return -1
        return tb.localeCompare(ta)
      })
    }
    return out
  }, [collection, search, legendaryOnly, raresOnly, sortByUploaded])

  const handleSearchChange = useCallback((value) => {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
  }, [])

  const handleLegendaryToggle = useCallback(() => {
    setLegendaryOnly(v => !v)
    setVisibleCount(PAGE_SIZE)
  }, [])

  const handleRaresToggle = useCallback(() => {
    setRaresOnly(v => !v)
    setVisibleCount(PAGE_SIZE)
  }, [])

  const handleSortByUploadedToggle = useCallback(() => {
    setSortByUploaded(v => !v)
    setVisibleCount(PAGE_SIZE)
  }, [])

  const handleClearAll = useCallback(() => {
    clearCollection()
    setCollection([])
    setSearch('')
    setLegendaryOnly(false)
    setRaresOnly(false)
    setSortByUploaded(false)
    setConfirmingClear(false)
    setVisibleCount(PAGE_SIZE)
  }, [])

  return (
    <div>
      <header style={styles.header}>
        <h1 style={styles.heading}>My Collection</h1>
        <p style={styles.tagline}>The cards you own — Brewbench builds decks from this pool.</p>
      </header>
      <div style={styles.subRow}>
        <p style={styles.sub}>
          {totalUnique > 0
            ? `${totalUnique} unique card${totalUnique !== 1 ? 's' : ''} · ${totalCopies} total cop${totalCopies !== 1 ? 'ies' : 'y'}`
            : 'Your collection is empty — add cards from the Commander page or import below.'}
        </p>
        {totalUnique > 0 && (
          confirmingClear ? (
            <div style={styles.clearConfirmRow}>
              <span style={styles.clearConfirmText}>Delete all {totalUnique} cards? This cannot be undone.</span>
              <button style={styles.clearConfirmBtn} onClick={handleClearAll}>Delete All</button>
              <button style={styles.clearCancelBtn} onClick={() => setConfirmingClear(false)}>Cancel</button>
            </div>
          ) : (
            <button style={styles.clearAllBtn} onClick={() => setConfirmingClear(true)}>
              Delete All
            </button>
          )
        )}
      </div>
      {validatingCount > 0 && (
        <div style={styles.validatingBanner}>
          Fetching card data from Scryfall… {validatingCount} remaining
        </div>
      )}

      {validationError && (
        <div style={styles.failedBanner}>
          <div style={styles.failedBannerHeader}>
            <span style={styles.failedBannerTitle}>⚠ {validationError}</span>
            <button
              style={styles.failedBannerBtn}
              onClick={() => { setValidationError(null); runValidation(getCollection()) }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {validatingCount === 0 && failedCards.length > 0 && (
        <div style={styles.failedBanner}>
          <div style={styles.failedBannerHeader}>
            <span style={styles.failedBannerTitle}>
              ⚠ {failedCards.length} card{failedCards.length === 1 ? '' : 's'} not found on Scryfall
            </span>
            <button style={styles.failedBannerBtn} onClick={handleRemoveFailed}>
              Remove {failedCards.length === 1 ? 'it' : 'them'}
            </button>
          </div>
          <div style={styles.failedBannerBody}>
            These names didn{"'"}t match any real Magic card — likely typos or made-up names:
            <span style={styles.failedBannerNames}>
              {failedCards.slice(0, 12).map(c => c.name).join(', ')}
              {failedCards.length > 12 && `, and ${failedCards.length - 12} more`}
            </span>
          </div>
        </div>
      )}

      {commanderToast && (
        <div style={styles.commanderToast}>
          ★ {commanderToast} set as commander
        </div>
      )}

      <ImportSection onImportComplete={handleImportComplete} />

      {collection.length === 0 ? (
        <div style={styles.placeholder}>
          No cards yet. Search for commanders and click "+ Collection", or use the importer above.
        </div>
      ) : (
        <>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            collection={collection}
          />

          <div style={styles.filterRow}>
            <label style={styles.filterToggle}>
              <input
                type="checkbox"
                checked={legendaryOnly}
                onChange={handleLegendaryToggle}
                style={styles.filterCheckbox}
              />
              <span>Legendary creatures only</span>
            </label>
            <label style={styles.filterToggle}>
              <input
                type="checkbox"
                checked={raresOnly}
                onChange={handleRaresToggle}
                style={styles.filterCheckbox}
              />
              <span>Rares &amp; mythics only</span>
            </label>
            <label style={styles.filterToggle}>
              <input
                type="checkbox"
                checked={sortByUploaded}
                onChange={handleSortByUploadedToggle}
                style={styles.filterCheckbox}
              />
              <span>Sort by last uploaded</span>
            </label>
          </div>

          {filtered.length === 0 ? (
            <div style={styles.noResults}>
              {emptyResultMessage({ search, legendaryOnly, raresOnly })}
            </div>
          ) : (
            <>
              <div style={styles.grid}>
                {filtered.slice(0, visibleCount).map(card => (
                  <CollectionCard
                    key={card.id}
                    card={card}
                    onRemove={handleRemove}
                    onSetCommander={handleSetCommander}
                    isCurrentCommander={card.id === commanderId}
                  />
                ))}
              </div>
              {visibleCount < filtered.length && (
                <div style={styles.loadMoreWrap}>
                  <div style={styles.loadMoreInfo}>
                    Showing {visibleCount} of {filtered.length}
                    {search && ` (filtered from ${collection.length})`}
                  </div>
                  <button
                    style={styles.loadMoreBtn}
                    onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, filtered.length))}
                  >
                    Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                  </button>
                  <button
                    style={styles.loadAllBtn}
                    onClick={() => setVisibleCount(filtered.length)}
                  >
                    Show all
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

const MAX_SUGGESTIONS = 8

const SearchBar = memo(function SearchBar({ value, onChange, collection }) {
  const [focused, setFocused]         = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef = useRef(null)

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    const matches = []
    const seen = new Set()
    for (const card of collection) {
      const lower = card.name.toLowerCase()
      if (seen.has(lower)) continue
      if (lower.includes(q)) {
        seen.add(lower)
        matches.push(card.name)
        if (matches.length >= MAX_SUGGESTIONS) break
      }
    }
    return matches
  }, [value, collection])

  const showDropdown = focused && suggestions.length > 0

  // Close dropdown on outside click
  useEffect(() => {
    if (!focused) return
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setFocused(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [focused])

  const pick = (name) => {
    onChange(name)
    setFocused(false)
    setHighlighted(-1)
  }

  const handleKeyDown = (e) => {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, -1))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      pick(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setFocused(false)
    }
  }

  return (
    <div style={styles.searchWrap} ref={wrapRef}>
      <div style={styles.searchRow}>
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setHighlighted(-1) }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={`Search ${collection.length} cards…`}
          style={styles.searchInput}
        />
        {value && (
          <button style={styles.searchClear} onClick={() => onChange('')}>×</button>
        )}
      </div>
      {showDropdown && (
        <div style={styles.suggestions}>
          {suggestions.map((name, i) => (
            <div
              key={name}
              style={{ ...styles.suggestion, ...(i === highlighted ? styles.suggestionActive : {}) }}
              onMouseDown={() => pick(name)}
              onMouseEnter={() => setHighlighted(i)}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

const styles = {
  header:   { marginBottom: 'var(--space-6)' },
  heading:  { fontSize: 'var(--text-3xl)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 'var(--space-2)' },
  tagline:  { color: 'var(--text-muted)', fontSize: 'var(--text-base)', lineHeight: 1.6 },
  sub: { color: 'var(--text-muted)', marginBottom: '0', fontSize: 'var(--text-sm)' },
  subRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  clearAllBtn: {
    padding: '6px 14px',
    background: 'transparent',
    color: '#ef4444',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  clearConfirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  clearConfirmText: {
    color: '#f87171',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  clearConfirmBtn: {
    padding: '6px 14px',
    background: '#3b0000',
    color: '#fff',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '700',
  },
  clearCancelBtn: {
    padding: '6px 14px',
    background: 'transparent',
    color: '#a0a0c0',
    border: '1px solid #4a2c6e',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
  },
  validatingBanner: {
    color: '#c084fc',
    fontSize: '0.82rem',
    marginBottom: '20px',
    padding: '8px 14px',
    background: '#1a0e2e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '6px',
    display: 'inline-block',
  },
  failedBanner: {
    background: '#2d0f0f',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ef4444',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    color: '#fca5a5',
  },
  failedBannerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '6px',
  },
  failedBannerTitle: {
    color: '#fca5a5',
    fontSize: '0.95rem',
    fontWeight: '700',
  },
  failedBannerBtn: {
    padding: '6px 14px',
    background: '#3b0000',
    color: '#fca5a5',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  failedBannerBody: {
    color: '#e0a0a0',
    fontSize: '0.85rem',
    lineHeight: '1.5',
  },
  failedBannerNames: {
    display: 'block',
    color: '#fde0e0',
    fontFamily: 'monospace',
    fontSize: '0.82rem',
    marginTop: '4px',
    wordBreak: 'break-word',
  },
  placeholder: {
    padding: '40px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: '#4a2c6e',
    borderRadius: '8px',
    color: '#6060a0',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    gap: '16px',
  },
  card: {
    background: '#16213e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
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
  nameRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
  },
  name: {
    fontWeight: '700',
    fontSize: '0.9rem',
    color: '#e0e0e0',
    lineHeight: '1.3',
    flex: 1,
  },
  qtyBadge: {
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#c084fc',
    background: '#2a1a4e',
    borderRadius: '4px',
    padding: '1px 5px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  validationBadge: {
    fontSize: '0.68rem',
    color: '#a0a0c0',
    background: '#1a1a2e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '4px',
    padding: '1px 6px',
    alignSelf: 'flex-start',
  },
  failedBadge: {
    fontSize: '0.68rem',
    color: '#f59e0b',
    background: '#2d1f00',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#92400e',
    borderRadius: '4px',
    padding: '1px 6px',
    alignSelf: 'flex-start',
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
  removeBtn: {
    padding: '8px',
    background: 'transparent',
    color: '#ef4444',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ef4444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  actions: {
    marginTop: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  commanderBtn: {
    padding: '8px',
    background: '#2d1b4e',
    color: '#c084fc',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#c084fc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: '600',
  },
  commanderBtnActive: {
    padding: '8px',
    background: '#c084fc',
    color: '#1a0e2e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#c084fc',
    borderRadius: '6px',
    cursor: 'default',
    fontSize: '0.82rem',
    fontWeight: '700',
  },
  commanderToast: {
    position: 'fixed',
    top: '20px',
    right: '20px',
    background: '#2d1b4e',
    border: '1px solid #c084fc',
    color: '#fff',
    padding: '12px 18px',
    borderRadius: '8px',
    fontSize: '0.9rem',
    fontWeight: '600',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  loadMoreWrap: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '24px',
    flexWrap: 'wrap',
  },
  loadMoreInfo: {
    color: '#7070a0',
    fontSize: '0.85rem',
    marginRight: '8px',
  },
  loadMoreBtn: {
    padding: '10px 20px',
    background: '#7c3aed',
    border: 'none',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: '600',
  },
  loadAllBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid #4a2c6e',
    color: '#a0a0c0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.88rem',
  },
  searchWrap: {
    position: 'relative',
    marginBottom: '20px',
  },
  searchRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchInput: {
    width: '100%',
    padding: '12px 40px 12px 14px',
    background: '#1a1a2e',
    border: '1px solid #4a2c6e',
    borderRadius: '8px',
    color: '#e8e8ff',
    fontSize: '0.95rem',
    outline: 'none',
    boxSizing: 'border-box',
  },
  searchClear: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'transparent',
    border: 'none',
    color: '#a0a0c0',
    fontSize: '1.4rem',
    cursor: 'pointer',
    padding: '4px 10px',
    lineHeight: 1,
  },
  suggestions: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: '#16213e',
    border: '1px solid #4a2c6e',
    borderRadius: '8px',
    maxHeight: '320px',
    overflowY: 'auto',
    zIndex: 50,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  suggestion: {
    padding: '10px 14px',
    color: '#e8e8ff',
    fontSize: '0.9rem',
    cursor: 'pointer',
    borderBottom: '1px solid #2a1a4e',
  },
  suggestionActive: {
    background: '#2d1b4e',
    color: '#fff',
  },
  noResults: {
    padding: '32px',
    textAlign: 'center',
    color: '#7070a0',
    fontSize: '0.95rem',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '-8px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  filterToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: '#1a1a2e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '6px',
    color: '#c084fc',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    userSelect: 'none',
  },
  filterCheckbox: {
    accentColor: '#7c3aed',
    cursor: 'pointer',
  },
}

const importStyles = {
  panel: {
    background: '#16213e',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '32px',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  panelTitle: {
    color: '#c084fc',
    fontWeight: '700',
    fontSize: '1rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  panelHint: {
    color: '#6060a0',
    fontSize: '0.82rem',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  fileLabel: {
    padding: '8px 16px',
    background: '#0f1526',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '6px',
    color: '#a0a0c0',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  fileName: {
    color: '#c084fc',
    fontSize: '0.85rem',
    fontStyle: 'italic',
  },
  clearFileBtn: {
    background: 'transparent',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ef4444',
    color: '#ef4444',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    padding: '2px 7px',
  },
  orDivider: {
    textAlign: 'center',
    marginBottom: '10px',
    position: 'relative',
  },
  orText: {
    color: '#4a3a6e',
    fontSize: '0.78rem',
    background: '#16213e',
    padding: '0 8px',
    position: 'relative',
    zIndex: 1,
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#0f1526',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '0.88rem',
    fontFamily: 'monospace',
    padding: '10px 14px',
    resize: 'vertical',
    outline: 'none',
    marginBottom: '12px',
    lineHeight: '1.5',
  },
  textareaDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  errorBox: {
    background: '#2d0f0f',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ef4444',
    color: '#ef4444',
    padding: '10px 14px',
    borderRadius: '8px',
    marginBottom: '12px',
    fontSize: '0.88rem',
  },
  commaToggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 14px',
    background: '#1a1a2e',
    border: '1px solid #3a2a5e',
    borderRadius: '8px',
    marginBottom: '12px',
    cursor: 'pointer',
    color: '#c0c0e0',
    fontSize: '0.85rem',
    lineHeight: '1.45',
  },
  commaToggleDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  commaToggleCheckbox: {
    marginTop: '3px',
    flexShrink: 0,
    accentColor: '#c084fc',
    cursor: 'inherit',
  },
  commaToggleHint: {
    display: 'block',
    color: '#7a7a9a',
    fontSize: '0.78rem',
    marginTop: '2px',
  },
  parseBtn: {
    padding: '10px 24px',
    background: '#4a2c6e',
    color: '#fff',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#c084fc',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '600',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    background: '#0a2e1a',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#16a34a',
    color: '#4ade80',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '0.9rem',
    flexWrap: 'wrap',
  },
  dismissBtn: {
    background: 'transparent',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#16a34a',
    color: '#4ade80',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    padding: '4px 12px',
    whiteSpace: 'nowrap',
  },
  previewSummary: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  summaryChip: {
    background: '#2a1a4e',
    color: '#c084fc',
    fontSize: '0.78rem',
    fontWeight: '600',
    borderRadius: '12px',
    padding: '3px 10px',
  },
  warnChip: {
    background: '#2d1f00',
    color: '#f59e0b',
    fontSize: '0.78rem',
    fontWeight: '600',
    borderRadius: '12px',
    padding: '3px 10px',
  },
  previewTableWrap: {
    maxHeight: '320px',
    overflowY: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#2a1a4e',
    borderRadius: '8px',
    marginBottom: '14px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
  },
  th: {
    textAlign: 'center',
    padding: '8px 12px',
    color: '#a0a0c0',
    fontWeight: '600',
    background: '#0f1526',
    position: 'sticky',
    top: 0,
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  rowEven: {
    background: '#16213e',
  },
  rowOdd: {
    background: '#111a33',
  },
  tdQty: {
    padding: '7px 12px',
    color: '#c084fc',
    fontWeight: '700',
    textAlign: 'center',
    width: '48px',
  },
  td: {
    padding: '7px 12px',
    color: '#e0e0e0',
  },
  tdWarn: {
    padding: '7px 12px',
    width: '35%',
  },
  warnText: {
    color: '#f59e0b',
    fontSize: '0.78rem',
  },
  previewActions: {
    display: 'flex',
    gap: '10px',
  },
  confirmBtn: {
    padding: '10px 24px',
    background: '#14532d',
    color: '#4ade80',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#16a34a',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '600',
  },
  cancelBtn: {
    padding: '10px 20px',
    background: 'transparent',
    color: '#a0a0c0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.95rem',
  },
}
