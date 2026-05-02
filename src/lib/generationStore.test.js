import { describe, it, expect, beforeEach, vi } from 'vitest'

// Vitest runs without a DOM by default. Stub localStorage in-memory so the
// store's persistence layer has something to read/write against.
const memStore = new Map()
globalThis.localStorage = {
  getItem:    (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem:    (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear:      () => memStore.clear(),
  key:        (i) => Array.from(memStore.keys())[i] ?? null,
  get length() { return memStore.size },
}

// Re-import the module fresh for each test so the module-level state and
// localStorage hydration don't bleed across tests.
async function loadStore() {
  vi.resetModules()
  return await import('./generationStore')
}

describe('generationStore — initial state', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts in idle state with no result when localStorage is empty', async () => {
    const { getState } = await loadStore()
    const s = getState()
    expect(s.status).toBe('idle')
    expect(s.result).toBeNull()
    expect(s.stage).toBeNull()
  })

  it('hydrates from localStorage when a recent result is persisted', async () => {
    localStorage.setItem('deckify-last-generation', JSON.stringify({
      result: { mainDeck: [], commander: { name: 'Test' } },
      bracket: 3,
      primaryArchetype: null,
      savedAt: Date.now(),
    }))
    const { getState } = await loadStore()
    expect(getState().status).toBe('done')
    expect(getState().result?.commander?.name).toBe('Test')
  })

  it('discards persisted results older than the TTL', async () => {
    localStorage.setItem('deckify-last-generation', JSON.stringify({
      result: { mainDeck: [], commander: { name: 'Stale' } },
      savedAt: Date.now() - 25 * 60 * 60 * 1000,   // 25 hours ago
    }))
    const { getState } = await loadStore()
    expect(getState().status).toBe('idle')
    expect(getState().result).toBeNull()
  })
})

describe('generationStore — startGeneration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sets status to generating immediately', async () => {
    const { startGeneration, getState } = await loadStore()
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: () => new Promise(() => {}),    // never resolves
    })
    expect(getState().status).toBe('generating')
    expect(getState().stage).toBe('pass1')
  })

  it('updates stage when the generator calls onProgress', async () => {
    const { startGeneration, getState } = await loadStore()
    let externalOnProgress
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: ({ onProgress }) => new Promise(() => {
        externalOnProgress = onProgress
      }),
    })
    // Wait a tick for the generator to capture onProgress
    await new Promise(r => setTimeout(r, 0))
    externalOnProgress({ stage: 'pass2' })
    expect(getState().stage).toBe('pass2')
    externalOnProgress({ stage: 'critique' })
    expect(getState().stage).toBe('critique')
  })

  it('transitions to done with the result when the generator resolves', async () => {
    const { startGeneration, getState } = await loadStore()
    const fakeDeck = { mainDeck: [{ name: 'A' }], commander: { name: 'C' } }
    startGeneration({
      bracket: 4,
      primaryArchetype: null,
      generator: async () => fakeDeck,
    })
    // Let the microtasks run
    await new Promise(r => setTimeout(r, 10))
    const s = getState()
    expect(s.status).toBe('done')
    expect(s.result).toEqual(fakeDeck)
    expect(s.bracket).toBe(4)
    expect(s.stage).toBeNull()
  })

  it('transitions to error when the generator rejects', async () => {
    const { startGeneration, getState } = await loadStore()
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: async () => { throw new Error('boom') },
    })
    await new Promise(r => setTimeout(r, 10))
    expect(getState().status).toBe('error')
    expect(getState().error).toBe('boom')
  })

  it('treats a generator-returned { error } as an error result, not done', async () => {
    const { startGeneration, getState } = await loadStore()
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: async () => ({ error: 'No commander selected' }),
    })
    await new Promise(r => setTimeout(r, 10))
    expect(getState().status).toBe('error')
    expect(getState().error).toBe('No commander selected')
    expect(getState().result).toBeNull()
  })

  it('persists completed result to localStorage', async () => {
    const { startGeneration } = await loadStore()
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: async () => ({ mainDeck: [], commander: { name: 'Persisted' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    const raw = localStorage.getItem('deckify-last-generation')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.result.commander.name).toBe('Persisted')
  })

  it('invalidates an in-flight generation when a new one starts', async () => {
    const { startGeneration, getState } = await loadStore()
    let resolveOld
    startGeneration({
      bracket: 3,
      primaryArchetype: null,
      generator: () => new Promise(r => { resolveOld = r }),
    })
    // Now start a second generation that resolves immediately
    startGeneration({
      bracket: 5,
      primaryArchetype: null,
      generator: async () => ({ mainDeck: [], commander: { name: 'New' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    expect(getState().result?.commander?.name).toBe('New')
    expect(getState().bracket).toBe(5)
    // Now resolve the OLD generation — should be a no-op
    resolveOld({ mainDeck: [], commander: { name: 'Old' } })
    await new Promise(r => setTimeout(r, 10))
    expect(getState().result?.commander?.name).toBe('New')   // not overwritten
  })
})

describe('generationStore — clearGeneration', () => {
  beforeEach(() => { localStorage.clear() })

  it('resets to idle state', async () => {
    const { startGeneration, clearGeneration, getState } = await loadStore()
    startGeneration({
      bracket: 3, primaryArchetype: null,
      generator: async () => ({ mainDeck: [], commander: { name: 'X' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    clearGeneration()
    expect(getState().status).toBe('idle')
    expect(getState().result).toBeNull()
    expect(localStorage.getItem('deckify-last-generation')).toBeNull()
  })
})

describe('generationStore — subscribe', () => {
  beforeEach(() => { localStorage.clear() })

  it('notifies subscribers on state changes', async () => {
    const { subscribe, startGeneration } = await loadStore()
    const fn = vi.fn()
    const unsubscribe = subscribe(fn)
    startGeneration({
      bracket: 3, primaryArchetype: null,
      generator: async () => ({ mainDeck: [], commander: { name: 'X' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    expect(fn).toHaveBeenCalled()
    unsubscribe()
  })

  it('stops notifying after unsubscribe', async () => {
    const { subscribe, startGeneration } = await loadStore()
    const fn = vi.fn()
    const unsubscribe = subscribe(fn)
    unsubscribe()
    startGeneration({
      bracket: 3, primaryArchetype: null,
      generator: async () => ({ mainDeck: [], commander: { name: 'X' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    expect(fn).not.toHaveBeenCalled()
  })
})
