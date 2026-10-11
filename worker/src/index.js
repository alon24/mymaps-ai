import { addUser, audit, dailyLimit, listUsers, readAudit, removeUser, roleFor, usage, withinDailyCap } from './accounts.js'

export const DEFAULT_MODEL = 'qwen/qwen3.5-plus-20260420'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MID_RE = /^[A-Za-z0-9_-]{10,100}$/
const MAX_BODY = 600_000
const MAX_OUTPUT_TOKENS = 4096
const MAX_MESSAGES = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Token, Authorization, X-App',
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
 * client (GOOGLE_CLIENT_ID). Who may then use the apps, and as what role, is decided by roleFor()
 * (src/accounts.js): ADMIN_EMAILS, the shared users database, then ALLOWED_EMAILS.
 * The token -> email lookup is cached for a few minutes to avoid a Google round trip per request;
 * the role is read fresh each time, so removing a user takes effect at once.
 */
const authCache = new Map()
const AUTH_TTL = 5 * 60_000

async function googleEmail(token, env) {
  if (!token || !env.GOOGLE_CLIENT_ID) return null
  const hit = authCache.get(token)
  if (hit && hit.until > Date.now()) return hit.email
  let email = null
  let ttl = 60_000
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
  if (info.ok) {
    const t = await info.json()
    if (t.aud === env.GOOGLE_CLIENT_ID || t.azp === env.GOOGLE_CLIENT_ID) {
      ttl = Math.min(Math.max(Number(t.expires_in) || 0, 0) * 1000, AUTH_TTL)
      // Tokens with the email scope (Travel Hub) name a verified address; drive.file tokens (MyMaps AI)
      // carry no email claim, so Drive's "about" returns the account's address instead
      email = t.email && String(t.email_verified) === 'true' ? String(t.email).trim().toLowerCase() : ''
      if (!email) {
        const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
          headers: { Authorization: `Bearer ${token}` },
        })
        email = about.ok ? String((await about.json())?.user?.emailAddress || '').trim().toLowerCase() : ''
      }
      email ||= null
    }
  }
  if (authCache.size > 1000) authCache.clear()
  authCache.set(token, { email, until: Date.now() + ttl })
  return email
}

function bearer(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '')
  return m ? m[1].trim() : ''
}

/** Who is calling: { email, role } or null. The APP_TOKEN admin key acts as an admin. */
async function identify(request, env) {
  if (await tokenMatches(request.headers.get('X-App-Token'), env.APP_TOKEN)) return { email: 'app-token', role: 'admin' }
  const email = await googleEmail(bearer(request), env)
  if (!email) return null
  const role = await roleFor(email, env)
  return role ? { email, role } : null
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

/** Rough token estimate (≈3 characters per token; Hebrew runs denser than English, so this errs high). */
export const estimateTokens = (text) => Math.ceil(String(text).length / 3)

/** MAX_CONTEXT_TOKENS per request (default 100,000, output included). */
export const contextLimit = (env) => {
  const n = Number(env.MAX_CONTEXT_TOKENS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100_000
}

/**
 * Keep the newest messages that fit next to the system prompt (the map) under the limit; the conversation
 * sent upstream always starts with a user message. Returns null when even the newest message doesn't fit.
 */
export function fitContext(system, messages, limit) {
  let budget = limit - MAX_OUTPUT_TOKENS - estimateTokens(system)
  const kept = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(JSON.stringify(messages[i])) + 4
    if (cost > budget) break
    budget -= cost
    kept.unshift(messages[i])
  }
  while (kept.length && kept[0].role !== 'user') kept.shift()
  return kept.length ? kept : null
}

const MAX_TOOLS = 8

/** One chat message: user/assistant text, an assistant tool call, or a tool result. */
function validMessage(m) {
  if (!m || typeof m !== 'object') return false
  if (m.role === 'user') return typeof m.content === 'string'
  if (m.role === 'assistant') {
    if (typeof m.content === 'string' && !m.tool_calls) return true
    return (m.content == null || typeof m.content === 'string') && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 &&
      m.tool_calls.every((c) => c && typeof c.id === 'string' && typeof c.function?.name === 'string')
  }
  if (m.role === 'tool') return typeof m.tool_call_id === 'string' && typeof m.content === 'string'
  return false
}

function validateAiBody(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object'
  if (typeof body.system !== 'string') return 'system must be a string'
  const { messages, tools } = body
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array'
  if (messages.length > MAX_MESSAGES) return 'too many messages'
  if (!messages.every(validMessage)) return 'each message needs role user|assistant|tool with valid content'
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > MAX_TOOLS) return `tools must be an array of at most ${MAX_TOOLS}`
    if (!tools.every((t) => t?.type === 'function' && typeof t.function?.name === 'string')) return 'each tool must be a function'
  }
  return null
}

/** Only the fields OpenRouter needs, per message kind. */
const cleanMessage = (m) =>
  m.role === 'tool'
    ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
    : m.role === 'assistant' && m.tool_calls
      ? { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls }
      : { role: m.role, content: m.content }

async function handleAi(request, env, who) {
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
  const fitted = fitContext(body.system, body.messages.map(cleanMessage), contextLimit(env))
  if (!fitted) return error('the map is too large for the AI context limit', 413)
  // So nobody burns the owner's OpenRouter credit by accident (DAILY_AI_LIMIT per person per day)
  if (!(await withinDailyCap(env, who))) return json({ error: 'daily limit reached', limit: dailyLimit(env) }, 429)

  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'MyMaps AI',
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      // The final answer is one JSON object; while tools are offered the model may call them first instead
      ...(body.tools?.length ? { tools: body.tools, tool_choice: 'auto' } : { response_format: { type: 'json_object' } }),
      temperature: 0.4,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'system', content: body.system }, ...fitted],
    }),
  })
  if (!upstream.ok) return error(`openrouter returned ${upstream.status}`, 502)

  const data = await upstream.json()
  const message = data?.choices?.[0]?.message
  if (typeof message?.content !== 'string' && !(Array.isArray(message?.tool_calls) && message.tool_calls.length)) {
    return error('unexpected response from openrouter', 502)
  }
  const app = request.headers.get('X-App') === 'hub' ? 'hub' : 'mymaps'
  const tokens = Number.isFinite(data?.usage?.total_tokens) ? data.usage.total_tokens : null
  await audit(env, { email: who.email, app, action: 'ai', detail: env.MODEL || DEFAULT_MODEL, tokens })
  return json(data)
}

async function handleAdmin(request, env, who, url) {
  if (who.role !== 'admin') return error('admins only', 403)
  if (!env.DB) return error('the users database is not configured', 503)
  const path = url.pathname
  if (path === '/admin/users' && request.method === 'GET') return json({ users: await listUsers(env) })
  if (path === '/admin/users' && request.method === 'POST') {
    let body
    try {
      body = await request.json()
    } catch {
      return error('invalid JSON', 400)
    }
    const r = await addUser(env, who.email, body)
    return r.error ? error(r.error, r.status) : json(r)
  }
  if (path === '/admin/users' && request.method === 'DELETE') {
    const r = await removeUser(env, who.email, url.searchParams.get('email'))
    return r.error ? error(r.error, r.status) : json(r)
  }
  if (path === '/admin/audit' && request.method === 'GET') return json({ entries: await readAudit(env, url.searchParams) })
  if (path === '/admin/usage' && request.method === 'GET') return json(await usage(env, url.searchParams))
  return error('not found', 404)
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    try {
      const who = await identify(request, env)
      if (!who) return error('unauthorized', 401)
      if (url.pathname === '/me' && request.method === 'GET') return json(who)
      if (url.pathname.startsWith('/admin/')) return await handleAdmin(request, env, who, url)
      if (url.pathname === '/kml' && request.method === 'GET') return await handleKml(url)
      if (url.pathname === '/ai' && request.method === 'POST') return await handleAi(request, env, who)
    } catch {
      return error('upstream request failed', 502)
    }
    return error('not found', 404)
  },
}
