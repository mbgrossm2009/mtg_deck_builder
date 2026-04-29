// Auth state for the whole app.
//
// Wrap <App /> in <AuthProvider>. Components that need the current user call
// `useAuth()` to get { user, session, loading, signInWith, signOut }.
//
// Loading state matters: on first mount, the provider has to call
// supabase.auth.getSession() before it knows whether the user is logged in.
// Until that resolves, `loading` is true and the RequireAuth wrapper holds
// off on redirecting to /login. Without this we'd flash the login page for
// a frame and then redirect to /collection.

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Initial session fetch — covers reloads and OAuth redirect returns.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    // Subscribe to subsequent changes (login, logout, token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  // OAuth sign-in. Supabase opens a popup-or-redirect flow that ends back at
  // our origin with the session in the URL fragment; detectSessionInUrl: true
  // (in lib/supabase.js) picks it up automatically.
  async function signInWith(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider, // 'google' | 'facebook' | 'apple' | ...
      options: {
        // After auth, Supabase redirects back to this URL. Use window.location.origin
        // so it works on localhost AND the deployed Vercel URL with no config.
        redirectTo: `${window.location.origin}/`,
      },
    })
    if (error) throw error
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signInWith,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
