// Server-side proxy to api.scryfall.com.
//
// Why this isn't `api/scryfall/[...path].js` anymore: Vercel's auto-detected
// dynamic-route catch-alls (`[...slug].js`) inside subdirectories were not
// being routed in production — `/api/scryfall/cards/named` 404'd even though
// the file was committed. A single top-level function + a vercel.json rewrite
// is more reliable and avoids the bracket-syntax detection entirely.
//
// vercel.json rewrites `/api/scryfall/<anything>` → `/api/scryfall?path=<anything>`
// so this handler reads the upstream Scryfall path from req.query.path and
// forwards method, body, and remaining query params.

export const config = { maxDuration: 30 }

const UPSTREAM = 'https://api.scryfall.com'

export default async function handler(req, res) {
  const rawPath = req.query.path
  if (!rawPath) {
    return res.status(400).json({ error: 'Missing scryfall path' })
  }

  // The rewrite passes :path* as a slash-joined string. Strip any leading
  // slash defensively so the upstream URL is well-formed.
  const path = String(Array.isArray(rawPath) ? rawPath.join('/') : rawPath).replace(/^\/+/, '')

  // Forward every query param except `path` (that one is internal). Scryfall
  // endpoints like /cards/search rely on `q`, /cards/named on `exact` or `fuzzy`.
  const forward = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue
    if (Array.isArray(v)) {
      for (const item of v) forward.append(k, String(item))
    } else if (v != null) {
      forward.append(k, String(v))
    }
  }
  const qs = forward.toString()
  const upstreamUrl = `${UPSTREAM}/${path}${qs ? `?${qs}` : ''}`

  const init = {
    method: req.method,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MTGDeckBuilder/1.0 (vercel-proxy)',
    },
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json'
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }

  try {
    const upstream = await fetch(upstreamUrl, init)
    const body = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    return res.send(body)
  } catch (err) {
    return res.status(502).json({ error: `Scryfall proxy error: ${err?.message ?? String(err)}` })
  }
}
