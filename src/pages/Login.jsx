// Sign-in page. Two OAuth buttons (Google + Facebook) — Apple deferred until
// the user signs up for the Apple Developer Program ($99/year). Adding more
// providers later is one button + one entry in Supabase's Auth → Providers.

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { user, loading, signInWith } = useAuth()
  const location = useLocation()
  const [signingIn, setSigningIn] = useState(null)
  const [error, setError] = useState(null)

  // If they're already logged in, bounce them out. This also handles the
  // post-OAuth redirect: provider sends them back to /, the AuthProvider
  // picks up the session, then this page (if briefly mounted) bounces.
  useEffect(() => {
    if (!loading && user) setSigningIn(null)
  }, [loading, user])

  if (!loading && user) {
    const dest = location.state?.from?.pathname ?? '/'
    return <Navigate to={dest} replace />
  }

  async function handleSignIn(provider) {
    setError(null)
    setSigningIn(provider)
    try {
      await signInWith(provider)
      // signInWith triggers a redirect, so this line typically doesn't run.
      // If the popup-style flow is used, AuthProvider's onAuthStateChange
      // will pick up the session and the effect above bounces us off.
    } catch (err) {
      setError(err?.message ?? 'Sign-in failed. Try again.')
      setSigningIn(null)
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brandMark} aria-hidden>D</div>
        <h1 style={styles.title}>Welcome to Deckify</h1>
        <p style={styles.subtitle}>
          Sign in to import your collection and build optimized Commander decks.
        </p>

        <div style={styles.buttons}>
          <button
            type="button"
            className="btn"
            style={{ ...styles.providerBtn, ...styles.googleBtn }}
            onClick={() => handleSignIn('google')}
            disabled={signingIn !== null}
          >
            <GoogleIcon />
            {signingIn === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <button
            type="button"
            className="btn"
            style={{ ...styles.providerBtn, ...styles.facebookBtn }}
            onClick={() => handleSignIn('facebook')}
            disabled={signingIn !== null}
          >
            <FacebookIcon />
            {signingIn === 'facebook' ? 'Redirecting…' : 'Continue with Facebook'}
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.fineprint}>
          By signing in, you agree to be a chill person about playgroup power levels.
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  )
}

const styles = {
  wrap: {
    minHeight: 'calc(100vh - var(--nav-height))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-8) var(--space-4)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-10) var(--space-8)',
    textAlign: 'center',
    boxShadow: 'var(--shadow-lg)',
  },
  brandMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: 'var(--radius-lg)',
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 'var(--text-2xl)',
    letterSpacing: '-0.02em',
    marginBottom: 'var(--space-5)',
    boxShadow: '0 8px 24px rgba(139,92,246,0.35)',
  },
  title: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    marginBottom: 'var(--space-2)',
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    marginBottom: 'var(--space-8)',
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  providerBtn: {
    width: '100%',
    padding: '12px 16px',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    gap: 'var(--space-3)',
  },
  googleBtn: {
    background: '#fff',
    color: '#1f1f1f',
    borderColor: 'rgba(0,0,0,0.1)',
  },
  facebookBtn: {
    background: '#1877F2',
    color: '#fff',
    borderColor: '#1877F2',
  },
  error: {
    marginTop: 'var(--space-4)',
    padding: '10px 14px',
    background: 'rgba(239, 68, 68, 0.10)',
    border: '1px solid rgba(239, 68, 68, 0.40)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--danger)',
    fontSize: 'var(--text-sm)',
  },
  fineprint: {
    marginTop: 'var(--space-8)',
    color: 'var(--text-subtle)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.5,
  },
}
