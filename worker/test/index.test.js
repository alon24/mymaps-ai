import { describe, it, expect, vi, afterEach } from 'vitest'
import worker, { DEFAULT_MODEL } from '../src/index.js'

const TOKEN = 'test-token'
const env = { APP_TOKEN: TOKEN, OPENROUTER_API_KEY: 'sk-test' }
const MID = '1AbC_def-GhIjKlMnOp'
const KML = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>מפה</name></Document></kml>'

function req(path, { token = TOKEN, ...init } = {}) {
  const headers = new Headers(init.headers)
  if (token) headers.set('X-App-Token', token)
  return new Request(`https://worker.test${path}`, { ...init, headers })
}

function aiReq(body, opts = {}) {
  return req('/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...opts,
  })
}

const goodAiBody = { system: 'sys', messages: [{ role: 'user', content: 'שלום' }] }
const completion = (content) =>
  Response.json({ choices: [{ message: { role: 'assistant', content } }] })

function mockFetch(impl) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl)
}

afterEach(() => vi.restoreAllMocks())

describe('auth', () => {
  it.each([
    ['missing', null],
    ['wrong', 'nope'],
  ])('returns 401 with %s token', async (_label, token) => {
    const fetch = mockFetch(async () => new Response(KML))
    const res = await worker.fetch(req(`/kml?mid=${MID}`, { token }), env)
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 401 when APP_TOKEN is not configured', async () => {
    const res = await worker.fetch(req(`/kml?mid=${MID}`), { ...env, APP_TOKEN: undefined })
    expect(res.status).toBe(401)
  })

  it('answers CORS preflight without a token', async () => {
    const res = await worker.fetch(req('/ai', { method: 'OPTIONS', token: null }), env)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-App-Token')
  })

  it('returns 404 for unknown routes', async () => {
    const res = await worker.fetch(req('/nope'), env)
    expect(res.status).toBe(404)
  })
})

describe('GET /kml', () => {
  it('proxies KML from Google with forcekml=1', async () => {
    const fetch = mockFetch(async () => new Response(KML))
    const res = await worker.fetch(req(`/kml?mid=${MID}`), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(KML)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(String(fetch.mock.calls[0][0])).toBe(
      `https://www.google.com/maps/d/kml?mid=${MID}&forcekml=1`,
    )
  })

  it.each(['', 'short', 'bad!chars-1234567', `${MID}&x=1`])('rejects invalid mid %j', async (mid) => {
    const fetch = mockFetch(async () => new Response(KML))
    const res = await worker.fetch(req(`/kml?mid=${encodeURIComponent(mid)}`), env)
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 403 when Google serves a sign-in page (private map)', async () => {
    mockFetch(async () => new Response('<!DOCTYPE html><html>Sign in</html>'))
    const res = await worker.fetch(req(`/kml?mid=${MID}`), env)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('anyone with the link')
  })

  it('maps upstream 404 to 404 and other errors to 502', async () => {
    mockFetch(async () => new Response('', { status: 404 }))
    expect((await worker.fetch(req(`/kml?mid=${MID}`), env)).status).toBe(404)
    vi.restoreAllMocks()
    mockFetch(async () => new Response('', { status: 500 }))
    expect((await worker.fetch(req(`/kml?mid=${MID}`), env)).status).toBe(502)
  })

  it('returns 502 when the upstream request throws', async () => {
    mockFetch(async () => {
      throw new Error('network down')
    })
    expect((await worker.fetch(req(`/kml?mid=${MID}`), env)).status).toBe(502)
  })
})

describe('POST /ai', () => {
  it('forwards to OpenRouter with the default model and returns the completion', async () => {
    const fetch = mockFetch(async () => completion('תשובה'))
    const res = await worker.fetch(aiReq(goodAiBody), env)
    expect(res.status).toBe(200)
    expect((await res.json()).choices[0].message.content).toBe('תשובה')

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe(DEFAULT_MODEL)
    expect(sent.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'שלום' },
    ])
  })

  it('uses the MODEL variable when set', async () => {
    const fetch = mockFetch(async () => completion('x'))
    await worker.fetch(aiReq(goodAiBody), { ...env, MODEL: 'anthropic/claude-sonnet-5.5' })
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('anthropic/claude-sonnet-5.5')
  })

  it.each([
    ['invalid JSON', '{nope'],
    ['missing system', { messages: goodAiBody.messages }],
    ['empty messages', { system: 's', messages: [] }],
    ['system role injected in messages', { system: 's', messages: [{ role: 'system', content: 'x' }] }],
    ['non-string content', { system: 's', messages: [{ role: 'user', content: 5 }] }],
  ])('rejects %s with 400', async (_label, body) => {
    const fetch = mockFetch(async () => completion('x'))
    const res = await worker.fetch(aiReq(body), env)
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies with 413', async () => {
    const big = { system: 'x'.repeat(200_001), messages: goodAiBody.messages }
    expect((await worker.fetch(aiReq(big), env)).status).toBe(413)
  })

  it('returns 502 on OpenRouter errors without leaking the upstream body', async () => {
    mockFetch(async () => new Response('{"error":"key sk-test invalid"}', { status: 401 }))
    const res = await worker.fetch(aiReq(goodAiBody), env)
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('sk-test')
  })

  it('returns 502 on an unexpected OpenRouter response shape', async () => {
    mockFetch(async () => Response.json({ choices: [] }))
    expect((await worker.fetch(aiReq(goodAiBody), env)).status).toBe(502)
  })

  it('returns 500 when the API key is missing', async () => {
    const res = await worker.fetch(aiReq(goodAiBody), { APP_TOKEN: TOKEN })
    expect(res.status).toBe(500)
  })
})

describe('Google sign-in auth', () => {
  const genv = { OPENROUTER_API_KEY: 'sk-test', GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com' }
  let n = 0
  // A fresh token per test so the per-token cache never leaks between tests
  const gReq = (path, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer g-${++n}`)
    return new Request(`https://worker.test${path}`, { ...init, headers })
  }
  const aiCall = () =>
    gReq('/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goodAiBody) })

  function google({ aud = genv.GOOGLE_CLIENT_ID, valid = true, email = 'ilan@example.com' } = {}) {
    return mockFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
        return valid ? Response.json({ aud, azp: aud, expires_in: '3500', scope: 'https://www.googleapis.com/auth/drive.file' }) : Response.json({ error: 'invalid_token' }, { status: 400 })
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return Response.json({ user: { emailAddress: email } })
      return completion('{"reply":"ok"}')
    })
  }

  it('accepts a Google token issued to our client, without an app token', async () => {
    google()
    const res = await worker.fetch(aiCall(), genv)
    expect(res.status).toBe(200)
  })

  it('rejects tokens issued to another app, invalid tokens, and when GOOGLE_CLIENT_ID is unset', async () => {
    google({ aud: 'someone-else' })
    expect((await worker.fetch(aiCall(), genv)).status).toBe(401)
    vi.restoreAllMocks()
    google({ valid: false })
    expect((await worker.fetch(aiCall(), genv)).status).toBe(401)
    vi.restoreAllMocks()
    const f = google()
    expect((await worker.fetch(aiCall(), { ...genv, GOOGLE_CLIENT_ID: undefined })).status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('applies ALLOWED_EMAILS when set', async () => {
    google({ email: 'Ilan@Example.com' })
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: 'ilan@example.com, friend@example.com' })).status).toBe(200)
    vi.restoreAllMocks()
    google({ email: 'stranger@example.com' })
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: 'ilan@example.com' })).status).toBe(401)
  })

  it('uses the verified email from tokeninfo when the token has the email scope (Travel Hub)', async () => {
    const f = mockFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
        return Response.json({ aud: genv.GOOGLE_CLIENT_ID, expires_in: '3500', scope: 'openid email profile', email: 'Friend@Example.com', email_verified: 'true' })
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return new Response('no drive scope', { status: 403 })
      return completion('{"reply":"ok"}')
    })
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: 'friend@example.com' })).status).toBe(200)
    expect(f.mock.calls.some(([u]) => String(u).includes('drive/v3/about'))).toBe(false)
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: 'ilan@example.com' })).status).toBe(401)
  })

  it('matches hashed entries (sha256 of the lowercased address)', async () => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ilan@example.com')))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    google({ email: 'ILAN@example.com' })
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: `sha256:${hash}` })).status).toBe(200)
    vi.restoreAllMocks()
    google({ email: 'other@example.com' })
    expect((await worker.fetch(aiCall(), { ...genv, ALLOWED_EMAILS: `sha256:${hash}` })).status).toBe(401)
  })

  it('checks a token with Google once, then uses the cache', async () => {
    const f = google()
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer cached-token' }
    const call = () => new Request('https://worker.test/ai', { method: 'POST', headers, body: JSON.stringify(goodAiBody) })
    await worker.fetch(call(), genv)
    await worker.fetch(call(), genv)
    const checks = f.mock.calls.filter(([u]) => String(u).includes('tokeninfo'))
    expect(checks).toHaveLength(1)
  })

  it('allows the Authorization header in CORS preflight', async () => {
    const res = await worker.fetch(new Request('https://worker.test/ai', { method: 'OPTIONS' }), genv)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })
})
