import { NavLink } from 'react-router-dom'

const links = [
  { label: 'Home',         to: '/' },
  { label: 'Collection',   to: '/collection' },
  { label: 'Commander',    to: '/commander' },
  { label: 'Deck Builder', to: '/deck-builder' },
  { label: 'My Decks',     to: '/my-decks' },
]

export default function NavBar() {
  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        <NavLink to="/" style={styles.brand} end>
          <span style={styles.brandMark} aria-hidden>B</span>
          <span style={styles.brandWord}>Brewbench</span>
        </NavLink>

        <nav style={styles.nav}>
          {links.map(link => (
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
    gap: 'var(--space-6)',
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
}
