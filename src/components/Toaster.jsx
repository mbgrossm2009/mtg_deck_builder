// Renders a stack of toast messages dispatched via lib/toast.js.
// Mounted once at the app root. Self-removes toasts after 4 seconds.

import { useEffect, useState } from 'react'
import { subscribe } from '../lib/toast'

const TYPE_STYLES = {
  info:    { bg: 'rgba(59, 130, 246, 0.10)', border: 'rgba(59, 130, 246, 0.40)', accent: 'var(--info)',    icon: 'ℹ' },
  success: { bg: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.40)', accent: 'var(--success)', icon: '✓' },
  warning: { bg: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.40)', accent: 'var(--warning)', icon: '⚠' },
  error:   { bg: 'rgba(239, 68, 68, 0.10)',  border: 'rgba(239, 68, 68, 0.40)',  accent: 'var(--danger)',  icon: '✕' },
}

export default function Toaster() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    return subscribe(({ id, message, type }) => {
      setToasts(prev => [...prev, { id, message, type }])
      // Auto-dismiss after 4 seconds. Long enough to read, short enough
      // to not pile up if the storage layer is failing repeatedly.
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 4000)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={styles.stack} role="status" aria-live="polite">
      {toasts.map(toast => {
        const ts = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
        return (
          <div
            key={toast.id}
            style={{
              ...styles.toast,
              background: ts.bg,
              borderColor: ts.border,
            }}
          >
            <span style={{ ...styles.icon, color: ts.accent }} aria-hidden>{ts.icon}</span>
            <span style={styles.message}>{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}

const styles = {
  stack: {
    position: 'fixed',
    bottom: 'var(--space-5)',
    right: 'var(--space-5)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    maxWidth: 'min(92vw, 380px)',
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--surface-1)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-lg)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text)',
    pointerEvents: 'auto',
    animation: 'toast-in 180ms ease',
  },
  icon: {
    fontWeight: 700,
    fontSize: 'var(--text-base)',
    flexShrink: 0,
    lineHeight: 1.4,
  },
  message: {
    lineHeight: 1.4,
    minWidth: 0,
    wordBreak: 'break-word',
  },
}
