import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../lib/useMediaQuery'

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
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Lock body scroll while the drawer is open so the page underneath doesn't
  // scroll when the user swipes inside the drawer.
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  async function handleSignOut() {
    setDrawerOpen(false)
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
          <span style={styles.brandMark} aria-hidden>D</span>
          <span style={styles.brandWord}>Deckify</span>
        </NavLink>

        {/* Desktop / tablet nav. Hidden on mobile via conditional render. */}
        {!isMobile && user && (
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

        {/* Right-side actions */}
        <div style={styles.right}>
          {!loading && (user ? (
            isMobile ? (
              <button
                type="button"
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                style={styles.hamburgerBtn}
              >
                <HamburgerIcon />
              </button>
            ) : (
              <div style={styles.userArea}>
                <span style={styles.userEmail} title={user.email}>
                  {user.email}
                </span>
                <button className="btn btn-ghost" style={styles.signOutBtn} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )
          ) : (
            <Link to="/login" className="btn btn-primary" style={styles.signInBtn}>
              Sign in
            </Link>
          ))}
        </div>
      </div>

      {/* Mobile drawer is portaled to <body> — the parent <header> has
          backdrop-filter, which creates a containing block for fixed-positioned
          descendants. Without portaling, the drawer would be clipped to the
          64px-tall header instead of filling the viewport. */}
      {isMobile && drawerOpen && user && createPortal(
        <>
          <div
            style={styles.drawerBackdrop}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside style={styles.drawer} role="dialog" aria-label="Navigation menu">
            <div style={styles.drawerHeader}>
              <span style={styles.drawerHeading}>Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                style={styles.drawerCloseBtn}
              >
                <CloseIcon />
              </button>
            </div>

            <nav style={styles.drawerNav}>
              {appLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  onClick={() => setDrawerOpen(false)}
                  style={({ isActive }) => ({
                    ...styles.drawerLink,
                    ...(isActive ? styles.drawerLinkActive : {}),
                  })}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>

            <div style={styles.drawerFooter}>
              <div style={styles.drawerEmail}>{user.email}</div>
              <button className="btn btn-secondary" style={styles.drawerSignOut} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </aside>
        </>,
        document.body
      )}
    </header>
  )
}

function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
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
    padding: '0 var(--space-4)',
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

  // Mobile-only — the hamburger that opens the drawer
  hamburgerBtn: {
    width: 40,
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease',
  },

  drawerBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    zIndex: 100,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 'min(86vw, 320px)',
    background: 'var(--surface-1)',
    borderLeft: '1px solid var(--border)',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 101,
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-4)',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-2) var(--space-2) var(--space-4)',
    borderBottom: '1px solid var(--border)',
    marginBottom: 'var(--space-3)',
  },
  drawerHeading: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.10em',
  },
  drawerCloseBtn: {
    width: 36,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-md)',
  },
  drawerNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },
  drawerLink: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-muted)',
    textDecoration: 'none',
    fontSize: 'var(--text-base)',
    fontWeight: 500,
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  drawerLinkActive: {
    background: 'var(--accent-soft)',
    color: 'var(--text)',
    fontWeight: 600,
  },
  drawerFooter: {
    borderTop: '1px solid var(--border)',
    paddingTop: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  drawerEmail: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0 var(--space-2)',
  },
  drawerSignOut: {
    padding: '10px 16px',
    fontSize: 'var(--text-sm)',
  },
}
