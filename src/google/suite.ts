/**
 * One Google sign-in for the travel suite on alon24.github.io (Travel Hub AI, Skyhop, MyMaps AI). All three use the
 * same OAuth client and share one origin, so a token from any of them works in all; the shared copy is Travel Hub's
 * `travel-hub.session`. Signing in to any app asks for SUITE_SCOPE, so the token also opens MyMaps AI's Drive files.
 */
import { DRIVE_SCOPE } from './drive'

export const SUITE_KEY = 'travel-hub.session'
export const SUITE_SCOPE = `openid email profile ${DRIVE_SCOPE}`
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo'

export interface SuiteSession {
  token: string
  expires: number
  email: string
  /** Granted scopes; missing on sessions from before the suite asked for Drive */
  scopes?: string[]
}

/** The suite's sign-in while it has more than a minute left (Travel Hub's own rule). */
export function readSuite(now = Date.now()): SuiteSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SUITE_KEY) ?? 'null') as SuiteSession | null
    return s && typeof s.token === 'string' && typeof s.email === 'string' && s.expires > now + 60_000 ? s : null
  } catch {
    return null
  }
}

/** Hand a MyMaps AI sign-in to the suite, unless it is signed in already (possibly as someone else). */
export async function shareWithSuite(token: string, expires: number, scope: string): Promise<void> {
  if (readSuite()) return
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } })
  const email = res.ok ? ((await res.json()) as { email?: string }).email : undefined
  if (!email || readSuite()) return
  try {
    localStorage.setItem(SUITE_KEY, JSON.stringify({ token, expires, email: email.toLowerCase(), scopes: scope.split(/\s+/) }))
  } catch {
    /* private mode */
  }
}

/** A signed-out (revoked) token is dead in every app of the suite: drop the suite's copy of it too. */
export function dropFromSuite(token: string) {
  try {
    if (readSuite(0)?.token === token) localStorage.removeItem(SUITE_KEY)
  } catch {
    /* private mode */
  }
}
