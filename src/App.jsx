import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import RequireAuth from './components/RequireAuth'
import Toaster from './components/Toaster'
import { useAuth } from './contexts/AuthContext'
import Home from './pages/Home'
import Marketing from './pages/Marketing'
import Login from './pages/Login'
import Collection from './pages/Collection'
import Commander from './pages/Commander'
import DeckBuilder from './pages/DeckBuilder'
import MyDecks from './pages/MyDecks'

function App() {
  return (
    <div style={styles.app}>
      <NavBar />
      <main className="responsive-main" style={styles.main}>
        <Routes>
          {/* Conditional landing: Marketing for visitors, Home (onboarding) for users. */}
          <Route path="/" element={<RootRoute />} />

          <Route path="/login" element={<Login />} />

          {/* Gated routes — RequireAuth bounces visitors to /login. */}
          <Route path="/collection"   element={<RequireAuth><Collection /></RequireAuth>} />
          <Route path="/commander"    element={<RequireAuth><Commander /></RequireAuth>} />
          <Route path="/deck-builder" element={<RequireAuth><DeckBuilder /></RequireAuth>} />
          <Route path="/my-decks"     element={<RequireAuth><MyDecks /></RequireAuth>} />
        </Routes>
      </main>
      <Toaster />
    </div>
  )
}

function RootRoute() {
  const { user, loading } = useAuth()
  // Avoid flashing Marketing for the split second between mount and session
  // resolution when the user is actually logged in.
  if (loading) return null
  return user ? <Home /> : <Marketing />
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
