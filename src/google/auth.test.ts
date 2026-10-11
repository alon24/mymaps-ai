import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({ env: { VITE_GOOGLE_CLIENT_ID: 'cid', VITE_GOOGLE_API_KEY: 'key' }, driveEnabled: () => true }))

afterEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('auth token', () => {
  it('never opens a popup without a click when there is no token', async () => {
    const { getToken, isSignedIn } = await import('./auth')
    expect(isSignedIn()).toBe(false)
    await expect(getToken()).rejects.toThrow()
  })

  it('restores a still-valid token after reload, ignores an expired one', async () => {
    localStorage.setItem('mymaps-ai.google-token', JSON.stringify({ value: 'ok', expires: Date.now() + 30 * 60_000 }))
    let auth = await import('./auth')
    expect(auth.isSignedIn()).toBe(true)
    expect(await auth.getToken()).toBe('ok')

    vi.resetModules()
    localStorage.setItem('mymaps-ai.google-token', JSON.stringify({ value: 'old', expires: Date.now() - 1000 }))
    auth = await import('./auth')
    expect(auth.isSignedIn()).toBe(false)
  })
})

describe('one sign-in for the travel suite', () => {
  const DRIVE = 'https://www.googleapis.com/auth/drive.file'
  const suite = (s: object) => localStorage.setItem('travel-hub.session', JSON.stringify(s))
  const hour = () => Date.now() + 60 * 60_000

  it('is signed in when another app of the suite signed in with Drive access', async () => {
    suite({ token: 'hub', expires: hour(), email: 'a@b.c', scopes: ['openid', 'email', 'profile', DRIVE] })
    const { getToken, isSignedIn } = await import('./auth')
    expect(isSignedIn()).toBe(true)
    expect(await getToken()).toBe('hub')
  })

  it('ignores a suite sign-in without Drive access, or with under a minute left', async () => {
    suite({ token: 'hub', expires: hour(), email: 'a@b.c', scopes: ['openid', 'email'] })
    expect((await import('./auth')).isSignedIn()).toBe(false)
    vi.resetModules()
    suite({ token: 'hub', expires: Date.now() + 30_000, email: 'a@b.c', scopes: [DRIVE] })
    expect((await import('./auth')).isSignedIn()).toBe(false)
  })

  it('signing out drops the suite copy of the same token, and leaves another account alone', async () => {
    suite({ token: 'hub', expires: hour(), email: 'a@b.c', scopes: [DRIVE] })
    let auth = await import('./auth')
    await auth.signOut()
    expect(localStorage.getItem('travel-hub.session')).toBeNull()
    expect(auth.isSignedIn()).toBe(false)

    vi.resetModules()
    localStorage.setItem('mymaps-ai.google-token', JSON.stringify({ value: 'mine', expires: hour() }))
    suite({ token: 'other', expires: hour(), email: 'x@y.z', scopes: [DRIVE] })
    auth = await import('./auth')
    await auth.signOut()
    expect(JSON.parse(localStorage.getItem('travel-hub.session')!).token).toBe('other')
  })
})
