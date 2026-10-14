/**
 * Google Identity Services (token model) + Google Picker, loaded on demand.
 * The access token is kept until it expires. Signing in to any app of the travel suite signs in here too (suite.ts).
 */
import { env, driveEnabled } from '../env'
import { DRIVE_SCOPE } from './drive'
import { dropFromSuite, readSuite, shareWithSuite, SUITE_SCOPE } from './suite'

/* Minimal typings for the bits of the Google globals we use. */
interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
}
interface TokenClient {
  callback: (r: TokenResponse) => void
  error_callback?: (e: { type: string }) => void
  requestAccessToken: (o?: { prompt?: string; hint?: string }) => void
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void }) => TokenClient
      revoke: (token: string, done: () => void) => void
    }
  }
  picker?: any // eslint-disable-line @typescript-eslint/no-explicit-any
}
declare global {
  interface Window {
    google?: GoogleGlobal
    gapi?: { load: (name: string, cb: () => void) => void }
  }
}

const scripts = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scripts.delete(src)
        reject(new Error('טעינת Google נכשלה. בדוק את החיבור לאינטרנט.'))
      }
      document.head.appendChild(s)
    })
    scripts.set(src, p)
  }
  return p
}

let client: TokenClient | null = null
const SIGNED_IN_HINT = 'mymaps-ai.google-signed-in'
/** Short-lived access token, kept so a reload doesn't force a new sign-in. */
const TOKEN_KEY = 'mymaps-ai.google-token'
const listeners = new Set<(signedIn: boolean) => void>()

type Token = { value: string; expires: number }
function restoreToken(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null
    if (t && typeof t.value === 'string' && t.expires > Date.now() + 60_000) return t
  } catch {
    /* below */
  }
  // Signed in to another app of the suite with Drive access: use that sign-in
  const s = readSuite()
  return s?.scopes?.includes(DRIVE_SCOPE) ? { value: s.token, expires: s.expires } : null
}
let token: Token | null = restoreToken()
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let renewTimer: ReturnType<typeof setTimeout> | undefined

function setToken(t: Token | null) {
  token = t
  clearTimeout(expiryTimer)
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  // Tell the UI when the session runs out
  if (t) expiryTimer = setTimeout(() => emit(), Math.max(0, t.expires - Date.now()) + 50)
  clearTimeout(renewTimer)
  if (t) renewTimer = setTimeout(() => void renewQuietly().catch(() => undefined), Math.max(0, t.expires - Date.now() - 120_000))
  emit()
}

export const isSignedIn = () => Boolean(token && token.expires > Date.now())
export const wasSignedIn = () => {
  try {
    return localStorage.getItem(SIGNED_IN_HINT) === '1'
  } catch {
    return false
  }
}
export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => listeners.forEach((fn) => fn(isSignedIn()))
if (token) expiryTimer = setTimeout(emit, Math.max(0, token.expires - Date.now()) + 50)
async function getClient(): Promise<TokenClient> {
  if (!driveEnabled()) throw new Error('Google Drive לא הוגדר באפליקציה (חסר VITE_GOOGLE_CLIENT_ID)')
  await loadScript('https://accounts.google.com/gsi/client')
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: env.VITE_GOOGLE_CLIENT_ID,
    scope: SUITE_SCOPE,
    callback: () => undefined,
  })
  return client
}

/** Asks Google for a token. `prompt: ''` is the quiet path: no popup (or one that closes itself) if already approved. */
async function requestToken(prompt: string, hint?: string): Promise<string> {
  const c = await getClient()
  return new Promise((resolve, reject) => {
    c.callback = (r) => {
      if (r.error || !r.access_token) {
        reject(new Error(r.error === 'access_denied' ? 'ההרשאה ל-Google נדחתה' : 'ההתחברות ל-Google נכשלה'))
        return
      }
      try {
        localStorage.setItem(SIGNED_IN_HINT, '1')
      } catch {
        /* ignore */
      }
      const expires = Date.now() + (r.expires_in ?? 3600) * 1000
      setToken({ value: r.access_token, expires })
      void shareWithSuite(r.access_token, expires, r.scope ?? SUITE_SCOPE).catch(() => undefined)
      resolve(r.access_token)
    }
    c.error_callback = (e) => reject(new Error(e.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : 'ההתחברות ל-Google נכשלה'))
    c.requestAccessToken({ prompt, ...(hint ? { hint } : {}) })
  })
}

let renewing: Promise<string> | null = null
/** A new token without asking, for someone who signed in before. Rejects when Google needs a real click. */
function renewQuietly(): Promise<string> {
  renewing ??= requestToken('', readSuite(0)?.email).finally(() => {
    renewing = null
  })
  return renewing
}

/**
 * Get a valid access token. `interactive` shows the Google consent popup when needed;
 * it must be called from a user gesture (click) or browsers block the popup.
 * Without a click, an expired token is renewed quietly if the person signed in before.
 */
export async function getToken(interactive = false): Promise<string> {
  if (token && token.expires - 60_000 > Date.now()) return token.value
  if (!interactive) {
    if (wasSignedIn()) {
      try {
        return await renewQuietly()
      } catch {
        /* needs a click: fall through */
      }
    }
    if (isSignedIn()) return token!.value
    throw new Error('נדרשת התחברות מחדש ל-Google')
  }
  return requestToken(wasSignedIn() ? '' : 'consent')
}

export async function signOut(): Promise<void> {
  const t = token?.value
  if (t) dropFromSuite(t)
  try {
    localStorage.removeItem(SIGNED_IN_HINT)
  } catch {
    /* ignore */
  }
  setToken(null)
  if (t && window.google) await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(t, r))
}

/**
 * Google Picker pre-selected to one file. Opening a file through the Picker grants this app
 * drive.file access to it — needed for maps other people shared with the user.
 */
export async function pickFile(fileId?: string): Promise<string | null> {
  const accessToken = await getToken(true)
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise<void>((r) => window.gapi!.load('picker', r))
  const gp = window.google!.picker
  return new Promise((resolve) => {
    const view = new gp.DocsView(gp.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(true)
    if (fileId) view.setFileIds(fileId)
    const picker = new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(env.VITE_GOOGLE_API_KEY)
      .setAppId(env.VITE_GOOGLE_CLIENT_ID.split('-')[0])
      .setLocale('iw')
      .setCallback((data: { action: string; docs?: { id: string }[] }) => {
        if (data.action === gp.Action.PICKED) resolve(data.docs?.[0]?.id ?? null)
        else if (data.action === gp.Action.CANCEL) resolve(null)
      })
      .build()
    picker.setVisible(true)
  })
}

// Opened with an expired token (or phones froze the timer): renew quietly instead of showing "sign in"
if (typeof document !== 'undefined') {
  const renewIfNeeded = () => {
    if (wasSignedIn() && (!token || token.expires - Date.now() < 120_000)) void renewQuietly().catch(() => undefined)
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && renewIfNeeded())
  if (!token) renewIfNeeded()
}
