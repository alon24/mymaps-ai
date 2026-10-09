import { env, driveEnabled } from '../env'
import { isSignedIn } from '../google/auth'

// Same key as the previous version of the app, so saved settings carry over.
const KEY = 'mymaps-ai.settings'

export interface Settings {
  workerUrl: string
  appToken: string
}

export const emptySettings: Settings = { workerUrl: '', appToken: '' }

export const normalizeWorkerUrl = (url: string): string => url.trim().replace(/\/+$/, '')

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {}
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) saved = JSON.parse(raw) as Partial<Settings>
  } catch {
    /* storage unavailable */
  }
  return {
    workerUrl: saved.workerUrl || normalizeWorkerUrl(env.VITE_WORKER_URL),
    appToken: saved.appToken ?? '',
  }
}

export function saveSettings(settings: Settings): Settings {
  const clean = { workerUrl: normalizeWorkerUrl(settings.workerUrl), appToken: settings.appToken.trim() }
  try {
    localStorage.setItem(KEY, JSON.stringify(clean))
  } catch {
    /* storage unavailable */
  }
  return clean
}

export function isValidWorkerUrl(url: string): boolean {
  try {
    const u = new URL(normalizeWorkerUrl(url))
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * How the app can reach the Worker:
 * - 'ready': an APP_TOKEN is set (admin), or the user is signed in with Google (normal users)
 * - 'needs-signin': Google sign-in is available but the user isn't signed in
 * - 'needs-setup': no Worker URL, or no way to authenticate
 */
export type WorkerAccess = 'ready' | 'needs-signin' | 'needs-setup'

export function workerAccess(s: Settings, signedIn = isSignedIn(), google = driveEnabled()): WorkerAccess {
  if (!isValidWorkerUrl(s.workerUrl)) return 'needs-setup'
  if (s.appToken.trim()) return 'ready'
  if (google) return signedIn ? 'ready' : 'needs-signin'
  return 'needs-setup'
}

export const isConfigured = (s: Settings): boolean => workerAccess(s) === 'ready'
