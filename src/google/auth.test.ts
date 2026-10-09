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
