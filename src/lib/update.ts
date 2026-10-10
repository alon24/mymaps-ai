/**
 * Updates that really bring the latest version.
 * The service worker and the browser's HTTP cache can both hold an older build, so instead of
 * trusting them we read /version.json from the server (no cache), and when it is newer we drop
 * the service worker + its caches and reload a cache-busting URL. After the reload we verify the
 * running version and retry once if an old copy still came back.
 */
import { APP_VERSION } from '../version'
import { appBase } from './appBase'

const EXPECT_KEY = 'mymaps-ai.expect-version'
const KEEP_CACHES = ['tiles', 'fonts'] // offline map tiles survive an update

/** Compare dotted versions numerically ("1.0.35" > "1.0.9"); a "-dev" suffix is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/-.*$/, '').split('.').map((n) => Number(n) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export const isDevBuild = () => APP_VERSION.endsWith('-dev') || APP_VERSION === 'dev'

/** The version currently deployed on the server, or null when offline. */
export async function latestVersion(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${appBase()}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const v = ((await res.json()) as { version?: unknown }).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Drop the service worker and its caches, then load the newest build. */
export async function installLatest(version: string): Promise<void> {
  try {
    sessionStorage.setItem(EXPECT_KEY, JSON.stringify({ version, tries: Number(JSON.parse(sessionStorage.getItem(EXPECT_KEY) ?? '{}').tries ?? 0) + 1 }))
  } catch {
    /* ignore */
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    const names = (await globalThis.caches?.keys?.()) ?? []
    await Promise.all(names.filter((n) => !KEEP_CACHES.includes(n)).map((n) => caches.delete(n)))
  } catch {
    /* best effort */
  }
  // A new URL skips the HTTP cache for index.html; hashed assets follow from it
  location.replace(`${location.pathname}?v=${encodeURIComponent(version)}${location.hash}`)
}

export type UpdateCheck = { status: 'latest' | 'updating' | 'offline'; latest?: string }

/** "Check for updates": compare with the server and update if needed. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const latest = await latestVersion()
  if (!latest) return { status: 'offline' }
  if (!isNewer(latest, APP_VERSION)) return { status: 'latest', latest }
  await installLatest(latest)
  return { status: 'updating', latest }
}

/**
 * On startup: finish an update that was in progress (retry once if the old build came back),
 * and clean the ?v= marker from the address bar. Returns the version we were expecting, if any.
 */
export async function verifyAfterUpdate(): Promise<{ status: 'ok' | 'retrying' | 'failed'; expected: string } | null> {
  let pending: { version?: string; tries?: number } = {}
  try {
    pending = JSON.parse(sessionStorage.getItem(EXPECT_KEY) ?? '{}')
  } catch {
    /* ignore */
  }
  const url = new URL(location.href)
  if (url.searchParams.has('v')) {
    url.searchParams.delete('v')
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  if (!pending.version) return null
  if (!isNewer(pending.version, APP_VERSION)) {
    sessionStorage.removeItem(EXPECT_KEY)
    return { status: 'ok', expected: pending.version }
  }
  if ((pending.tries ?? 0) < 2) {
    await installLatest(pending.version)
    return { status: 'retrying', expected: pending.version }
  }
  sessionStorage.removeItem(EXPECT_KEY)
  return { status: 'failed', expected: pending.version }
}
