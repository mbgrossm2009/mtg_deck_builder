import React from 'react'
import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import Home from './pages/Home'
import Collection from './pages/Collection'
import Commander from './pages/Commander'
import DeckBuilder from './pages/DeckBuilder'
import MyDecks from './pages/MyDecks'

function App() {
  return (
    <div style={styles.app}>
      <NavBar />
      <main style={styles.main}>
        <Routes>
          <Route path="/"             element={<Home />} />
          <Route path="/collection"   element={<Collection />} />
          <Route path="/commander"    element={<Commander />} />
          <Route path="/deck-builder" element={<DeckBuilder />} />
          <Route path="/my-decks"     element={<MyDecks />} />
        </Routes>
      </main>
    </div>
  )
}

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  main: {
    flex: 1,
    padding: 'var(--space-12) var(--space-6) var(--space-16)',
    maxWidth: 'var(--content-max-width)',
    width: '100%',
    margin: '0 auto',
  },
}

export default App