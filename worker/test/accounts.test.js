import { env as cf } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'
import { audit, ensureSchema, roleFor, sha256Hex } from '../src/accounts.js'

const CLIENT = 'client-123.apps.googleusercontent.com'
const ADMIN = 'owner@example.com'
const base = () => ({ GOOGLE_CLIENT_ID: CLIENT, OPENROUTER_API_KEY: 'sk-test', DB: cf.DB })

// Each token is "tok:<email>"; Google's tokeninfo says which address it belongs to
function google() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      const email = decodeURIComponent(url.split('access_token=')[1]).replace(/^tok:/, '')
      return Response.json({ aud: CLIENT, expires_in: '3500', email, email_verified: 'true' })
    }
    if (url.startsWith('https://openrouter.ai')) {
      return Response.json({ choices: [{ message: { content: '{"reply":"ok"}' } }], usage: { total_tokens: 321 } })
    }
    return new Response('unexpected', { status: 500 })
  })
}

function call(path, email, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer tok:${email}`)   // roles are read fresh, so the token cache never hides a change
  return new Request(`https://worker.test${path}`, { ...init, headers })
}
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let env
beforeEach(async () => {
  await ensureSchema(cf.DB)
  await cf.DB.batch([cf.DB.prepare('DELETE FROM users'), cf.DB.prepare('DELETE FROM audit')])
  env = { ...base(), ADMIN_EMAILS: `sha256:${await sha256Hex(ADMIN)}` }
  google()
})
afterEach(() => vi.restoreAllMocks())

describe('roles', () => {
  it('ADMIN_EMAILS are admins, database rows decide the rest, ALLOWED_EMAILS is a fallback', async () => {
    await cf.DB.prepare("INSERT INTO users (email, role, added_at) VALUES ('friend@example.com', 'user', 1)").run()
    const e = { ...env, ALLOWED_EMAILS: 'legacy@example.com' }
    expect(await roleFor('Owner@Example.com', e)).toBe('admin')
    expect(await roleFor('friend@example.com', e)).toBe('user')
    expect(await roleFor('legacy@example.com', e)).toBe('user')
    expect(await roleFor('stranger@example.com', e)).toBeNull()
  })

  it('with nothing configured, any account of our client is a user (old behaviour)', async () => {
    expect(await roleFor('anyone@example.com', { GOOGLE_CLIENT_ID: CLIENT })).toBe('user')
  })
})

describe('/me', () => {
  it('tells the hub who is signed in and as what', async () => {
    const res = await worker.fetch(call('/me', ADMIN), env)
    expect(await res.json()).toEqual({ email: ADMIN, role: 'admin' })
    expect((await worker.fetch(call('/me', 'stranger@example.com'), env)).status).toBe(401)
  })
})

describe('admin', () => {
  it('adds a user, who can then use the AI, and removes them again', async () => {
    const friend = 'friend@example.com'
    expect((await worker.fetch(call('/me', friend), env)).status).toBe(401)

    const add = await worker.fetch(call('/admin/users', ADMIN, json({ email: ' Friend@Example.com ' })), env)
    expect(add.status).toBe(200)
    expect(await add.json()).toEqual({ user: { email: friend, role: 'user' } })
    expect(await (await worker.fetch(call('/me', friend), env)).json()).toEqual({ email: friend, role: 'user' })

    const list = await (await worker.fetch(call('/admin/users', ADMIN), env)).json()
    expect(list.users).toMatchObject([{ email: friend, role: 'user', added_by: ADMIN }])

    const del = await worker.fetch(call(`/admin/users?email=${encodeURIComponent(friend)}`, ADMIN, { method: 'DELETE' }), env)
    expect(del.status).toBe(200)
    expect((await worker.fetch(call('/me', friend), env)).status).toBe(401)
  })

  it('rejects bad input', async () => {
    expect((await worker.fetch(call('/admin/users', ADMIN, json({ email: 'not-an-email' })), env)).status).toBe(400)
    expect((await worker.fetch(call(`/admin/users?email=${ADMIN}`, ADMIN, { method: 'DELETE' }), env)).status).toBe(400)
    expect((await worker.fetch(call('/admin/users?email=nobody@example.com', ADMIN, { method: 'DELETE' }), env)).status).toBe(404)
  })

  it('is for admins only', async () => {
    await cf.DB.prepare("INSERT INTO users (email, role, added_at) VALUES ('friend@example.com', 'user', 1)").run()
    for (const path of ['/admin/users', '/admin/audit', '/admin/usage']) {
      expect((await worker.fetch(call(path, 'friend@example.com'), env)).status).toBe(403)
    }
    const promote = await worker.fetch(call('/admin/users', 'friend@example.com', json({ email: 'friend@example.com', role: 'admin' })), env)
    expect(promote.status).toBe(403)
  })

  it('says so when the database is missing', async () => {
    const res = await worker.fetch(call('/admin/users', ADMIN), { ...env, DB: undefined })
    expect(res.status).toBe(503)
  })
})

describe('audit and usage', () => {
  const ai = (email, app) =>
    call('/ai', email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(app ? { 'X-App': app } : {}) },
      body: JSON.stringify({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
    })

  it('logs every AI call with its tokens and app, and every user change', async () => {
    await worker.fetch(call('/admin/users', ADMIN, json({ email: 'friend@example.com' })), env)
    expect((await worker.fetch(ai('friend@example.com', 'hub'), env)).status).toBe(200)
    expect((await worker.fetch(ai(ADMIN), env)).status).toBe(200)

    const { entries } = await (await worker.fetch(call('/admin/audit', ADMIN), env)).json()
    expect(entries.map((e) => [e.email, e.app, e.action, e.tokens])).toEqual([
      [ADMIN, 'mymaps', 'ai', 321],
      ['friend@example.com', 'hub', 'ai', 321],
      [ADMIN, 'admin', 'add_user', null],
    ])

    const filtered = await (await worker.fetch(call('/admin/audit?email=friend@example.com', ADMIN), env)).json()
    expect(filtered.entries).toHaveLength(1)

    const { rows } = await (await worker.fetch(call('/admin/usage?days=7', ADMIN), env)).json()
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'friend@example.com', app: 'hub', calls: 1, tokens: 321 }),
        expect.objectContaining({ email: ADMIN, app: 'mymaps', calls: 1, tokens: 321 }),
      ]),
    )
    expect(rows.some((r) => r.app === 'admin')).toBe(false)
  })

  it('never fails a request because logging failed', async () => {
    const broken = { prepare: () => { throw new Error('db down') }, batch: async () => { throw new Error('db down') } }
    await expect(audit({ DB: broken }, { email: 'a@b.c', app: 'x', action: 'y' })).resolves.toBeUndefined()
  })
})

describe('daily AI cap', () => {
  const ai = (email) => call('/ai', email, json({ system: 's', messages: [{ role: 'user', content: 'hi' }] }))
  it('stops a user after DAILY_AI_LIMIT AI calls today (per person); admins are exempt', async () => {
    const e = { ...env, ALLOWED_EMAILS: 'a@example.com,b@example.com', DAILY_AI_LIMIT: '2' }
    expect((await worker.fetch(ai('a@example.com'), e)).status).toBe(200)
    expect((await worker.fetch(ai('a@example.com'), e)).status).toBe(200)
    const over = await worker.fetch(ai('a@example.com'), e)
    expect(over.status).toBe(429)
    expect(await over.json()).toMatchObject({ error: 'daily limit reached', limit: 2 })
    expect((await worker.fetch(ai('b@example.com'), e)).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await worker.fetch(ai(ADMIN), e)).status).toBe(200)
  })
  it("yesterday's calls don't count", async () => {
    const e = { ...env, ALLOWED_EMAILS: 'a@example.com', DAILY_AI_LIMIT: '1' }
    await cf.DB.prepare("INSERT INTO audit (ts, email, app, action) VALUES (?, 'a@example.com', 'mymaps', 'ai')").bind(Date.now() - 2 * 86_400_000).run()
    expect((await worker.fetch(ai('a@example.com'), e)).status).toBe(200)
  })
  it('defaults to 100 a day', async () => {
    const { dailyLimit } = await import('../src/accounts.js')
    expect(dailyLimit({})).toBe(100)
    expect(dailyLimit({ DAILY_AI_LIMIT: 'x' })).toBe(100)
    expect(dailyLimit({ DAILY_AI_LIMIT: '30' })).toBe(30)
  })
})
