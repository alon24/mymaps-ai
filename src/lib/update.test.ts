import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewer, latestVersion, verifyAfterUpdate } from './update'

afterEach(() => sessionStorage.clear())

describe('isNewer', () => {
  it('compares numerically and ignores -dev', () => {
    expect(isNewer('1.0.35', '1.0.33')).toBe(true)
    expect(isNewer('1.0.35', '1.0.9')).toBe(true)
    expect(isNewer('1.0.24', '1.0.33')).toBe(false) // never "update" to an older build
    expect(isNewer('1.0.33', '1.0.33')).toBe(false)
    expect(isNewer('1.1.0', '1.0.99')).toBe(true)
    expect(isNewer('1.0.1', '1.0.0-dev')).toBe(true)
  })
})

describe('latestVersion', () => {
  it('reads version.json without any cache', async () => {
    const f = vi.fn(async () => Response.json({ version: '1.0.40', commit: 'abc' }))
    expect(await latestVersion(f as unknown as typeof fetch)).toBe('1.0.40')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/version\.json\?t=\d+$/)
    expect(init.cache).toBe('no-store')
  })
  it('returns null when offline', async () => {
    expect(await latestVersion((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
})

describe('verifyAfterUpdate', () => {
  it('reports success when the expected version is running', async () => {
    sessionStorage.setItem('mymaps-ai.expect-version', JSON.stringify({ version: '1.0.0', tries: 1 }))
    expect(await verifyAfterUpdate()).toEqual({ status: 'ok', expected: '1.0.0' })
    expect(sessionStorage.getItem('mymaps-ai.expect-version')).toBeNull()
  })
  it('gives up after two tries instead of looping', async () => {
    sessionStorage.setItem('mymaps-ai.expect-version', JSON.stringify({ version: '9.9.9', tries: 2 }))
    expect(await verifyAfterUpdate()).toEqual({ status: 'failed', expected: '9.9.9' })
  })
  it('does nothing when no update was in progress', async () => {
    expect(await verifyAfterUpdate()).toBeNull()
  })
})
