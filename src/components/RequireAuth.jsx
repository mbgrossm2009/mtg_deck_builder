// Route guard. Wrap any protected route element in <RequireAuth> so it
// redirects unauthenticated users to /login. Shows a soft loading state
// while we're still checking the session — without this, a logged-in user
// reloading /collection sees /login flash before the redirect back.

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDataStore } from '../lib/dataStore'

export default function RequireAuth({ children }) {
  const { user, loading: authLoading } = useAuth()
  const data = useDataStore()
  const location = useLocation()

  // Two layers to wait for: auth (do we know if user is logged in?) and data
  // (have we hydrated their collection/decks from Supabase yet?). Without the
  // second wait, pages render with empty state for a frame and then snap to
  // their real content — looks like a glitch.
  if (authLoading || (user && !data.ready)) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner} />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

const styles = {
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50vh',
  },
  spinner: {
    width: 24,
    height: 24,
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
}
