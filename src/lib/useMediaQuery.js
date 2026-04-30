// Tiny matchMedia wrapper for responsive logic in inline-style components.
// CSS media queries handle the things they can; this hook handles the things
// they can't (conditionally rendering different markup, e.g. hamburger vs
// horizontal nav).

import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 640px)'

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    // Re-check in case the query already changed between SSR and effect.
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY)
}
