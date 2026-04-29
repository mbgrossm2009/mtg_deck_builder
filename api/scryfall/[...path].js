// Server-side proxy to api.scryfall.com.
//
// Routes /api/scryfall/* to the corresponding Scryfall path, forwarding method,
// query string, and JSON body. This avoids CORS and lets us set a proper
// User-Agent (Scryfall asks API consumers to identify themselves).

export const config = {
  maxDuration: 30,
}

const UPSTREAM = 'https://api.scryfall.com'

export default async function handler(req, res) {
  const tail = req.url.replace(/^\/api\/scryfall/, '')
  if (!tail || tail === '/') {
    return res.status(400).json({ error: 'Missing Scryfall path' })
  }

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
    const upstream = await fetch(`${UPSTREAM}${tail}`, init)
    const body = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    return res.send(body)
  } catch (err) {
    return res.status(502).json({ error: `Scryfall proxy error: ${err?.message ?? String(err)}` })
  }
}
