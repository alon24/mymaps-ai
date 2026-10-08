import { env } from '../env'

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

export const isConfigured = (s: Settings): boolean => isValidWorkerUrl(s.workerUrl) && s.appToken.trim() !== ''
