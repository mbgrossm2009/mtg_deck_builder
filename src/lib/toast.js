// Tiny toast dispatcher.
//
// Why a CustomEvent instead of a Context: the storage layer (utils/localStorage.js)
// runs in a non-React module. It can't useToast() from a hook. CustomEvent on
// document is a simple decoupled bus — storage fires the event, the <Toaster />
// component listens and renders. No prop drilling, no provider needed.
//
// Usage:
//   import { notify } from '../lib/toast'
//   notify('Couldn\'t save card to server', 'error')
//   notify('Saved!', 'success')

const EVENT = 'deckify:toast'

export function notify(message, type = 'info') {
  if (typeof document === 'undefined') return  // SSR safety
  document.dispatchEvent(new CustomEvent(EVENT, {
    detail: { message, type, id: Date.now() + Math.random() },
  }))
}

export function subscribe(handler) {
  if (typeof document === 'undefined') return () => {}
  const wrapped = (e) => handler(e.detail)
  document.addEventListener(EVENT, wrapped)
  return () => document.removeEventListener(EVENT, wrapped)
}
