// Serverless proxy to the OpenAI Chat Completions API.
//
// Why this exists: the frontend must NEVER hold the API key. This function
// runs on Vercel's servers, reads OPENAI_API_KEY from a server-only env var,
// and forwards prompts on the user's behalf. The browser only ever talks to
// /api/llm — it never sees the key.
//
// Set the key once in the Vercel dashboard:
//   Project → Settings → Environment Variables → OPENAI_API_KEY
// Then redeploy. For local dev, `vercel dev` reads the same vars from
// `vercel env pull .env.local`.

export const config = {
  // Vercel Pro plan: maxDuration up to 300s (5 minutes). Pass 2 generation
  // typically takes 30-60s; iterative critique passes can push to 90s+.
  // Setting to 180s gives generous headroom while still failing fast on
  // genuinely stuck calls (don't burn 5 min waiting on a hung request).
  maxDuration: 180,
}

const DEFAULT_MODEL = 'gpt-4o-mini'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.',
    })
  }

  const { system, user, model } = req.body ?? {}
  if (!system || !user) {
    return res.status(400).json({ error: 'Request body must include both `system` and `user`.' })
  }

  // The prompt builder returns structured objects; OpenAI expects strings.
  const systemContent = typeof system === 'string' ? system : JSON.stringify(system)
  const userContent = typeof user === 'string' ? user : JSON.stringify(user)

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        // json_object guarantees the response is parseable JSON, which is what
        // the validator on the client side expects.
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      return res.status(upstream.status).json({
        error: `OpenAI returned ${upstream.status}: ${text.slice(0, 500)}`,
      })
    }

    const data = await upstream.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      return res.status(502).json({ error: 'OpenAI returned an empty response.' })
    }

    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (err) {
      return res.status(502).json({
        error: `OpenAI response was not valid JSON: ${err.message}`,
        raw: content.slice(0, 1000),
      })
    }

    return res.status(200).json({ content: parsed, usage: data.usage ?? null })
  } catch (err) {
    return res.status(500).json({ error: `Proxy error: ${err?.message ?? String(err)}` })
  }
}
