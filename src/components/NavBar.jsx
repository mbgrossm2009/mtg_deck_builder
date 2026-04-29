import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const appLinks = [
  { label: 'Home',         to: '/' },
  { label: 'Collection',   to: '/collection' },
  { label: 'Commander',    to: '/commander' },
  { label: 'Deck Builder', to: '/deck-builder' },
  { label: 'My Decks',     to: '/my-decks' },
]

export default function NavBar() {
  const { user, signOut, loading } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/', { replace: true })
    } catch (err) {
      console.error('Sign out failed:', err)
    }
  }

  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        <NavLink to="/" style={styles.brand} end>
          <span style={styles.brandMark} aria-hidden>B</span>
          <span style={styles.brandWord}>Brewbench</span>
        </NavLink>

        {/* Show full app nav only when signed in. Visitors see a clean nav. */}
        {user && (
          <nav style={styles.nav}>
            {appLinks.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                style={({ isActive }) => ({
                  ...styles.link,
                  ...(isActive ? styles.linkActive : {}),
                })}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div style={styles.right}>
          {!loading && (user ? (
            <div style={styles.userArea}>
              <span style={styles.userEmail} title={user.email}>
                {user.email}
              </span>
              <button className="btn btn-ghost" style={styles.signOutBtn} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn btn-primary" style={styles.signInBtn}>
              Sign in
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}

const styles = {
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'rgba(10, 13, 24, 0.85)',
    backdropFilter: 'saturate(180%) blur(12px)',
    WebkitBackdropFilter: 'saturate(180%) blur(12px)',
    borderBottom: '1px solid var(--border)',
  },
  inner: {
    maxWidth: 'var(--content-max-width)',
    margin: '0 auto',
    height: 'var(--nav-height)',
    padding: '0 var(--space-6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
  },
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    textDecoration: 'none',
    color: 'var(--text)',
  },
  brandMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 'var(--radius-md)',
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 'var(--text-base)',
    letterSpacing: '-0.02em',
    boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 12px rgba(139,92,246,0.35)',
  },
  brandWord: {
    fontSize: 'var(--text-lg)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  nav: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-1)',
    flex: 1,
    justifyContent: 'center',
  },
  link: {
    padding: '8px 14px',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-muted)',
    textDecoration: 'none',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    transition: 'background-color 120ms ease, color 120ms ease',
    whiteSpace: 'nowrap',
  },
  linkActive: {
    background: 'var(--accent-soft)',
    color: 'var(--text)',
    fontWeight: 600,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
  },
  userEmail: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  signOutBtn: {
    padding: '6px 10px',
    fontSize: 'var(--text-xs)',
  },
  signInBtn: {
    padding: '8px 16px',
    fontSize: 'var(--text-sm)',
    textDecoration: 'none',
  },
}
