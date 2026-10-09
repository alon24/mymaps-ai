/**
 * Google Identity Services (token model) + Google Picker, loaded on demand.
 * The access token lives in memory only; a silent re-request happens when it expires.
 */
import { env, driveEnabled } from '../env'
import { DRIVE_SCOPE } from './drive'

/* Minimal typings for the bits of the Google globals we use. */
interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}
interface TokenClient {
  callback: (r: TokenResponse) => void
  error_callback?: (e: { type: string }) => void
  requestAccessToken: (o?: { prompt?: string }) => void
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
/** Short-lived access token (drive.file only), kept so a reload doesn't force a new sign-in. */
const TOKEN_KEY = 'mymaps-ai.google-token'
const listeners = new Set<(signedIn: boolean) => void>()

type Token = { value: string; expires: number }
function restoreToken(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null
    return t && typeof t.value === 'string' && t.expires > Date.now() + 60_000 ? t : null
  } catch {
    return null
  }
}
let token: Token | null = restoreToken()
let expiryTimer: ReturnType<typeof setTimeout> | undefined

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
    scope: DRIVE_SCOPE,
    callback: () => undefined,
  })
  return client
}

/**
 * Get a valid access token. `interactive` shows the Google consent popup when needed;
 * it must be called from a user gesture (click) or browsers block the popup.
 */
export async function getToken(interactive = false): Promise<string> {
  if (token && token.expires - 60_000 > Date.now()) return token.value
  // Never open a popup outside a click: browsers block it and the promise would never settle
  if (!interactive) {
    if (isSignedIn()) return token!.value
    throw new Error('נדרשת התחברות מחדש ל-Google')
  }
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
      setToken({ value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 })
      resolve(r.access_token)
    }
    c.error_callback = (e) => reject(new Error(e.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : 'ההתחברות ל-Google נכשלה'))
    c.requestAccessToken({ prompt: wasSignedIn() ? '' : 'consent' })
  })
}

export async function signOut(): Promise<void> {
  const t = token?.value
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
