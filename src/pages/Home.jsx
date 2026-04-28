import React from 'react'

function Home() {
  return (
    <div>
      <h2 style={styles.heading}>Welcome</h2>
      <p style={styles.sub}>Build, manage, and explore your MTG Commander decks.</p>
      <ul style={styles.list}>
        <li>📦 <strong>Collection</strong> — Track the cards you own</li>
        <li>👑 <strong>Commander</strong> — Search and pick your legendary leader</li>
        <li>🃏 <strong>Deck Builder</strong> — Assemble your 100-card deck</li>
      </ul>
    </div>
  )
}

const styles = {
  heading: { color: '#c084fc', marginBottom: '12px' },
  sub:     { color: '#a0a0c0', marginBottom: '24px' },
  list:    { lineHeight: '2.2', paddingLeft: '20px', color: '#d0d0d0' },
}

export default Home