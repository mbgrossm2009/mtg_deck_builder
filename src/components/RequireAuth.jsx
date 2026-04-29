// Route guard. Wrap any protected route element in <RequireAuth> so it
// redirects unauthenticated users to /login. Shows a soft loading state
// while we're still checking the session — without this, a logged-in user
// reloading /collection sees /login flash before the redirect back.

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner} />
      </div>
    )
  }

  if (!user) {
    // Preserve the attempted path so we can send the user back after login.
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
