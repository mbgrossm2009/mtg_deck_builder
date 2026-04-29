// Single Supabase client instance for the whole app.
//
// The URL and anon key are public values — Vite exposes any env var prefixed
// with VITE_ to the browser bundle. The anon key is RLS-gated, so it only
// authorizes whatever Row Level Security policies allow. The OAuth secrets,
// service-role key, and database password live ONLY in Supabase's dashboard
// and never reach the client or this file.

import { createClient } from '@supabase/supabase-js'

const url     = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surface the misconfiguration loudly during development. In production
  // a redeploy is needed after env vars are set in Vercel — they're injected
  // at build time, not at runtime.
  console.error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
    'in .env.local (dev) and in Vercel → Settings → Environment Variables (prod).'
  )
}

export const supabase = createClient(url ?? 'http://missing-url', anonKey ?? 'missing-key', {
  auth: {
    persistSession: true,       // keep the user logged in across reloads
    autoRefreshToken: true,     // silently refresh JWTs before they expire
    detectSessionInUrl: true,   // pick up the session after an OAuth redirect
  },
})
