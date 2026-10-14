import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ signed: false }))
vi.mock('../google/auth', () => ({ isSignedIn: () => auth.signed, getToken: async () => 'google-token' }))

import { askAi } from './api'
import { workerAccess } from './settings'

const W = 'https://w.example.workers.dev'
const ok = () => Response.json({ choices: [{ message: { content: '{"reply":"ok"}' } }] })

afterEach(() => {
  vi.restoreAllMocks()
  auth.signed = false
})

describe('workerAccess', () => {
  it('admin token, Google sign-in, or setup needed', () => {
    expect(workerAccess({ workerUrl: W, appToken: 'x' }, false, true)).toBe('ready')
    expect(workerAccess({ workerUrl: W, appToken: '' }, true, true)).toBe('ready')
    expect(workerAccess({ workerUrl: W, appToken: '' }, false, true)).toBe('needs-signin')
    expect(workerAccess({ workerUrl: W, appToken: '' }, false, false)).toBe('needs-setup')
    expect(workerAccess({ workerUrl: '', appToken: 'x' }, true, true)).toBe('needs-setup')
  })
})

describe('Worker auth headers', () => {
  it.each([
    ['sends the Google token when signed in without an app token', '', 'Authorization', 'Bearer google-token', 'X-App-Token'],
    ['prefers the admin app token', 'admin', 'X-App-Token', 'admin', 'Authorization'],
  ])('%s', async (_n, appToken, present, value, absent) => {
    auth.signed = true
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    await askAi({ workerUrl: W, appToken }, 'sys', [{ role: 'user', content: 'hi' }])
    const headers = f.mock.calls[0][1]!.headers as Record<string, string>
    expect(headers[present]).toBe(value)
    expect(headers[absent]).toBeUndefined()
  })

  it('explains a 401 for Google users', async () => {
    auth.signed = true
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'unauthorized' }, { status: 401 }))
    await expect(askAi({ workerUrl: W, appToken: '' }, 's', [{ role: 'user', content: 'x' }])).rejects.toThrow(/התחבר שוב עם Google/)
  })

  it('explains the daily cap', async () => {
    auth.signed = true
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'daily limit reached', limit: 100 }, { status: 429 }))
    await expect(askAi({ workerUrl: W, appToken: '' }, 's', [{ role: 'user', content: 'x' }])).rejects.toThrow(/מכסה היומית.*100 שאלות/)
  })
})
