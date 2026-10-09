export const DEFAULT_MODEL = 'qwen/qwen3.5-plus-20260420'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MID_RE = /^[A-Za-z0-9_-]{10,100}$/
const MAX_BODY = 200_000
const MAX_MESSAGES = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token, Authorization',
  'Access-Control-Max-Age': '86400',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const error = (message, status) => json({ error: message }, status)

// Constant-time comparison of SHA-256 digests (equal length regardless of input).
async function tokenMatches(given, expected) {
  if (!given || !expected) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(a, b)
}

/*
 * Google sign-in as an alternative to APP_TOKEN: the app sends the user's Google access token
 * (Authorization: Bearer ...). It is accepted only if Google says it was issued to our OAuth
 * client (GOOGLE_CLIENT_ID). While the OAuth app is in "Testing", Google only issues tokens to
 * the listed test users. ALLOWED_EMAILS (comma separated) optionally narrows it further.
 * Results are cached per token for a few minutes to avoid a Google round trip per request.
 */
const authCache = new Map()
const AUTH_TTL = 5 * 60_000

async function googleUserAllowed(token, env) {
  if (!token || !env.GOOGLE_CLIENT_ID) return false
  const hit = authCache.get(token)
  if (hit && hit.until > Date.now()) return hit.ok
  let ok = false
  let ttl = 60_000
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
  if (info.ok) {
    const t = await info.json()
    ok = t.aud === env.GOOGLE_CLIENT_ID || t.azp === env.GOOGLE_CLIENT_ID
    ttl = Math.min(Math.max(Number(t.expires_in) || 0, 0) * 1000, AUTH_TTL)
    const allowed = (env.ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    if (ok && allowed.length) {
      // drive.file tokens carry no email claim; Drive's "about" returns the account's address
      const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const email = about.ok ? String((await about.json())?.user?.emailAddress || '').toLowerCase() : ''
      ok = allowed.includes(email)
    }
  }
  if (authCache.size > 1000) authCache.clear()
  authCache.set(token, { ok, until: Date.now() + ttl })
  return ok
}

function bearer(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '')
  return m ? m[1].trim() : ''
}

async function authorized(request, env) {
  if (await tokenMatches(request.headers.get('X-App-Token'), env.APP_TOKEN)) return true
  return googleUserAllowed(bearer(request), env)
}

async function handleKml(url) {
  const mid = url.searchParams.get('mid')
  if (!mid || !MID_RE.test(mid)) return error('invalid mid', 400)

  const upstream = await fetch(
    `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`,
    { redirect: 'follow' },
  )
  if (upstream.status === 404) return error('map not found', 404)
  if (!upstream.ok) return error(`google returned ${upstream.status}`, 502)

  const text = await upstream.text()
  // Private maps redirect to a sign-in HTML page instead of returning KML
  if (!/<kml[\s>]/.test(text.slice(0, 2000))) {
    return error('map is not public: share it as "anyone with the link"', 403)
  }
  return new Response(text, {
    headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8', ...CORS },
  })
}

function validateAiBody(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object'
  if (typeof body.system !== 'string') return 'system must be a string'
  const { messages } = body
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array'
  if (messages.length > MAX_MESSAGES) return 'too many messages'
  const ok = messages.every(
    (m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string',
  )
  return ok ? null : 'each message needs role user|assistant and string content'
}

async function handleAi(request, env) {
  const raw = await request.text()
  if (raw.length > MAX_BODY) return error('body too large', 413)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return error('invalid JSON', 400)
  }
  const invalid = validateAiBody(body)
  if (invalid) return error(invalid, 400)
  if (!env.OPENROUTER_API_KEY) return error('OPENROUTER_API_KEY is not configured', 500)

  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'MyMaps AI',
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: body.system },
        ...body.messages.map(({ role, content }) => ({ role, content })),
      ],
    }),
  })
  if (!upstream.ok) return error(`openrouter returned ${upstream.status}`, 502)

  const data = await upstream.json()
  if (typeof data?.choices?.[0]?.message?.content !== 'string') {
    return error('unexpected response from openrouter', 502)
  }
  return json(data)
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    try {
      if (!(await authorized(request, env))) return error('unauthorized', 401)
      if (url.pathname === '/kml' && request.method === 'GET') return await handleKml(url)
      if (url.pathname === '/ai' && request.method === 'POST') return await handleAi(request, env)
    } catch {
      return error('upstream request failed', 502)
    }
    return error('not found', 404)
  },
}
