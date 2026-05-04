// Server-side proxy to EDHREC's public JSON endpoint.
//
// Purpose: pull commander-specific top-cards data (the "% of decks that run
// this card" inclusion stats) so the orchestrator can build a skeleton
// from real EDHREC meta picks. Without this data, generation falls back
// to bracket staples + LLM picks alone, losing commander-specific flavor.
//
// Why a serverless function and not a direct browser call: EDHREC's JSON
// endpoint returns 403 for browser-origin requests (anti-scraping policy).
// Server-side fetches with a stable User-Agent are honored. Same pattern
// as the Moxfield proxy.
//
// Endpoint shape (as of 2024-2025):
//   GET https://json.edhrec.com/pages/commanders/<slug>.json
// Response is large and nested; this module just passes it through to the
// client, which has its own defensive parser (utils/edhrecApi.js).

export const config = {
  // EDHREC responds in <1s normally; 10s is a generous timeout.
  maxDuration: 10,
}

const EDHREC_BASE = 'https://json.edhrec.com/pages/commanders'

const HEADERS = {
  Accept:        'application/json',
  // EDHREC is a community resource — identify the proxy clearly so they can
  // reach out about issues. Same convention as the Moxfield proxy.
  'User-Agent':  'BuiltFromBulk/1.0 (https://mtg-deck-builder-gamma.vercel.app, contact via GitHub)',
}

// Module-level memoization. Survives across calls on a warm Vercel
// instance, gets wiped on cold start. TTL: 24h.
const CACHE = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export default async function handler(req, res) {
  // Allow GET (with ?slug=...) so the existing client fetch URL pattern
  // can be lifted easily, AND POST (with body { slug }) for parity with
  // the other proxies.
  let slug
  if (req.method === 'GET') {
    slug = req.query?.slug
  } else if (req.method === 'POST') {
    slug = req.body?.slug
  } else {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'Request must include a commander slug.' })
  }

  // Defensive: slugs come from commanderSlug() in utils/edhrecApi.js which
  // already lowercases and strips. Reject anything weird here as belt-and-
  // suspenders against URL injection.
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug format.' })
  }

  const cached = CACHE.get(slug)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, _cached: true })
  }

  try {
    const upstreamUrl = `${EDHREC_BASE}/${slug}.json`
    const upstream = await fetch(upstreamUrl, { headers: HEADERS })
    if (!upstream.ok) {
      // Common case: 404 for misspelled commander or new commander not on
      // EDHREC yet. Return structured empty rather than 4xx so the client
      // degrades gracefully (already its behavior on the original 403).
      return res.status(200).json({
        topCards: [],
        themes: [],
        _error: `EDHREC ${upstream.status}`,
      })
    }
    const data = await upstream.json()
    CACHE.set(slug, { fetchedAt: Date.now(), data })
    return res.status(200).json({ ...data, _cached: false })
  } catch (err) {
    return res.status(200).json({
      topCards: [],
      themes: [],
      _error: `EDHREC fetch failed: ${err?.message ?? String(err)}`,
    })
  }
}
