import React from 'react'
import { NavLink } from 'react-router-dom'

const links = [
  { label: 'Home',         to: '/' },
  { label: 'Collection',   to: '/collection' },
  { label: 'Commander',    to: '/commander' },
  { label: 'Deck Builder', to: '/deck-builder' },
  { label: 'My Decks',     to: '/my-decks' },
]

function NavBar() {
  return (
    <header style={styles.header}>
      <span style={styles.logo}>⚔️ MTG Commander</span>
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
    </header>
  )
}

const styles = {
  header: {
    backgroundColor: '#16213e',
    borderBottom: '2px solid #4a2c6e',
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
    rowGap: '10px',
  },
  logo: {
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: '#c084fc',
    whiteSpace: 'nowrap',
  },
  nav: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  link: {
    padding: '7px 14px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#4a2c6e',
    color: '#a0a0c0',
    textDecoration: 'none',
    fontSize: '0.9rem',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  linkActive: {
    backgroundColor: '#4a2c6e',
    color: '#fff',
    borderColor: '#c084fc',
  },
}

export default NavBar