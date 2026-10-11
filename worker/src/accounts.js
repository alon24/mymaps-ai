/*
 * One user list for all the travel apps (Travel Hub, MyMaps AI, Skyhop), kept in the shared D1 database
 * "travel-hub-users" (binding DB). Skyhop's Worker binds the same database and uses the same tables.
 *
 * - users: who may use the apps; role 'admin' can manage users and read the audit log.
 * - audit: one row per action worth knowing about (AI calls with their token usage, user changes).
 *
 * ADMIN_EMAILS (var, same format as ALLOWED_EMAILS: address or sha256:<hex>) are always admins, so the owner can
 * never lock themselves out. ALLOWED_EMAILS stays as a fallback list of users until everyone is in the database.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    added_by TEXT,
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    email TEXT NOT NULL,
    app TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    tokens INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS audit_ts ON audit (ts)',
  'CREATE INDEX IF NOT EXISTS audit_email_ts ON audit (email, ts)',
]

const ready = new WeakMap()
/** Creates the tables on first use (once per isolate), so a new database needs no migration step. */
export function ensureSchema(db) {
  let p = ready.get(db)
  if (!p) {
    p = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      ready.delete(db)
      throw e
    })
    ready.set(db, p)
  }
  return p
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase()
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/

async function inList(list, email) {
  const entries = String(list || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean)
  if (!entries.length) return false
  return entries.includes(email) || entries.includes(`sha256:${await sha256Hex(email)}`)
}

/**
 * The role of a signed-in Google account: 'admin', 'user', or null (not allowed).
 * With no database and no lists configured, any account of our OAuth client is a user (the old behaviour).
 */
export async function roleFor(email, env) {
  email = normalizeEmail(email)
  if (!email) return null
  if (await inList(env.ADMIN_EMAILS, email)) return 'admin'
  if (env.DB) {
    await ensureSchema(env.DB)
    const row = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first()
    if (row) return row.role
  }
  if (await inList(env.ALLOWED_EMAILS, email)) return 'user'
  if (!env.DB && !env.ALLOWED_EMAILS && !env.ADMIN_EMAILS) return 'user'
  return null
}

/** Records an action; never fails the request (logging is best effort). */
export async function audit(env, { email, app, action, detail = null, tokens = null }) {
  if (!env.DB) return
  try {
    await ensureSchema(env.DB)
    await env.DB.prepare('INSERT INTO audit (ts, email, app, action, detail, tokens) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), normalizeEmail(email) || 'unknown', String(app), String(action), detail == null ? null : String(detail).slice(0, 500), tokens)
      .run()
  } catch {
    /* ignore */
  }
}

// ---------- daily AI cap

/** AI calls a person may make per UTC day (DAILY_AI_LIMIT, default 100). */
export const dailyLimit = (env) => {
  const n = Number(env.DAILY_AI_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100
}

/**
 * True when this person still has AI calls left today, counted from the audit log (every AI call is logged
 * there already). Admins are never capped; without the database the cap is skipped.
 */
export async function withinDailyCap(env, who) {
  if (who.role === 'admin' || !env.DB) return true
  await ensureSchema(env.DB)
  const dayStart = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE email = ? AND action = 'ai' AND ts >= ?")
    .bind(normalizeEmail(who.email), dayStart)
    .first()
  return (row?.n ?? 0) < dailyLimit(env)
}

// ---------- admin API (callers must already be admins)

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

export async function listUsers(env) {
  await ensureSchema(env.DB)
  const { results } = await env.DB.prepare(
    `SELECT u.email, u.role, u.added_by, u.added_at,
       (SELECT MAX(ts) FROM audit a WHERE a.email = u.email) AS last_seen
     FROM users u ORDER BY u.added_at`,
  ).all()
  return results
}

export async function addUser(env, admin, body) {
  const email = normalizeEmail(body?.email)
  const role = body?.role === 'admin' ? 'admin' : 'user'
  if (!EMAIL_RE.test(email)) return { error: 'invalid email', status: 400 }
  await ensureSchema(env.DB)
  await env.DB.prepare(
    `INSERT INTO users (email, role, added_by, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = excluded.role`,
  )
    .bind(email, role, admin, Date.now())
    .run()
  await audit(env, { email: admin, app: 'admin', action: 'add_user', detail: `${email} (${role})` })
  return { user: { email, role } }
}

export async function removeUser(env, admin, rawEmail) {
  const email = normalizeEmail(rawEmail)
  if (!email) return { error: 'email is required', status: 400 }
  if (email === normalizeEmail(admin)) return { error: "you can't remove yourself", status: 400 }
  await ensureSchema(env.DB)
  const { meta } = await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run()
  if (!meta?.changes) return { error: 'no such user', status: 404 }
  await audit(env, { email: admin, app: 'admin', action: 'remove_user', detail: email })
  return { removed: email }
}

export async function readAudit(env, params) {
  await ensureSchema(env.DB)
  const where = []
  const args = []
  for (const key of ['email', 'app', 'action']) {
    const v = params.get(key)
    if (v) {
      where.push(`${key} = ?`)
      args.push(key === 'email' ? normalizeEmail(v) : v)
    }
  }
  const before = clampInt(params.get('before'), 0, 0, Number.MAX_SAFE_INTEGER)
  if (before) {
    where.push('id < ?')
    args.push(before)
  }
  const limit = clampInt(params.get('limit'), 100, 1, 500)
  const { results } = await env.DB.prepare(
    `SELECT id, ts, email, app, action, detail, tokens FROM audit
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
  )
    .bind(...args, limit)
    .all()
  return results
}

export async function usage(env, params) {
  await ensureSchema(env.DB)
  const days = clampInt(params.get('days'), 30, 1, 365)
  const since = Date.now() - days * 86_400_000
  const { results } = await env.DB.prepare(
    `SELECT email, app, COUNT(*) AS calls, COALESCE(SUM(tokens), 0) AS tokens, MAX(ts) AS last
     FROM audit WHERE ts >= ? AND app != 'admin' GROUP BY email, app ORDER BY tokens DESC, calls DESC`,
  )
    .bind(since)
    .all()
  return { days, rows: results }
}
