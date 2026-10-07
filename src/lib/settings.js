const KEY = 'mymaps-ai.settings'

export const emptySettings = { workerUrl: '', appToken: '' }

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...emptySettings, ...JSON.parse(raw) } : { ...emptySettings }
  } catch {
    return { ...emptySettings }
  }
}

export function saveSettings(settings) {
  const clean = {
    workerUrl: normalizeWorkerUrl(settings.workerUrl),
    appToken: settings.appToken.trim(),
  }
  localStorage.setItem(KEY, JSON.stringify(clean))
  return clean
}

export function normalizeWorkerUrl(url) {
  return url.trim().replace(/\/+$/, '')
}

export function isValidWorkerUrl(url) {
  try {
    const u = new URL(normalizeWorkerUrl(url))
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function isConfigured(settings) {
  return isValidWorkerUrl(settings.workerUrl) && settings.appToken.trim() !== ''
}
