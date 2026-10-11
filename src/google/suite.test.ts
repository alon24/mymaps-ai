import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSuite, shareWithSuite } from './suite'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

const userinfo = (email?: string) => vi.fn(async () => new Response(JSON.stringify({ email }), { status: 200 }))

describe('sharing a MyMaps AI sign-in with the suite', () => {
  it('writes the token, its expiry, the lowercased email and the granted scopes', async () => {
    const fetch = userinfo('Ilan@Example.com')
    vi.stubGlobal('fetch', fetch)
    const expires = Date.now() + 3_600_000
    await shareWithSuite('tok', expires, 'openid email https://www.googleapis.com/auth/drive.file')
    expect(fetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer tok' } })
    expect(readSuite()).toEqual({ token: 'tok', expires, email: 'ilan@example.com', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'] })
  })

  it('never replaces a live suite sign-in, and writes nothing without an email', async () => {
    const fetch = userinfo('a@b.c')
    vi.stubGlobal('fetch', fetch)
    const other = { token: 'other', expires: Date.now() + 3_600_000, email: 'x@y.z' }
    localStorage.setItem('travel-hub.session', JSON.stringify(other))
    await shareWithSuite('tok', Date.now() + 3_600_000, 'openid email')
    expect(readSuite()).toEqual(other)
    expect(fetch).not.toHaveBeenCalled()

    localStorage.clear()
    vi.stubGlobal('fetch', userinfo(undefined))
    await shareWithSuite('tok', Date.now() + 3_600_000, 'openid email')
    expect(readSuite()).toBeNull()
  })
})
