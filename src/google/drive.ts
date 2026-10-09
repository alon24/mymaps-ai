/**
 * Google Drive storage & sharing, called from the browser.
 * Scope is drive.file only: the app can see files it created, or that the user opened with it (Picker).
 * All network calls go through `driveFetch` so tests can inject a fake fetch.
 */
import type { MapDoc } from '../model/types'
import { migrate } from '../model/ops'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_NAME = 'MyMaps AI'
const APP_TAG = { key: 'app', value: 'mymaps-ai' }
export const MAP_MIME = 'application/json'

export interface DriveCtx {
  /** OAuth access token (absent for anonymous public reads) */
  token?: string
  /** API key, used for anonymous reads of "anyone with the link" files */
  apiKey?: string
  fetch?: typeof fetch
}

export class DriveError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface DriveFileMeta {
  id: string
  name: string
  version: string
  /** Changes only when the file content changes (unlike `version`, which also bumps on metadata/indexing) */
  headRevisionId?: string
  modifiedTime: string
  ownedByMe?: boolean
  shared?: boolean
  capabilities?: { canEdit?: boolean; canShare?: boolean }
}

const META_FIELDS = 'id,name,version,headRevisionId,modifiedTime,ownedByMe,shared,capabilities(canEdit,canShare)'

async function driveFetch(ctx: DriveCtx, url: string, init: RequestInit = {}): Promise<Response> {
  const f = ctx.fetch ?? fetch
  const u = new URL(url)
  if (!ctx.token && ctx.apiKey) u.searchParams.set('key', ctx.apiKey)
  const headers = new Headers(init.headers)
  if (ctx.token) headers.set('Authorization', `Bearer ${ctx.token}`)
  let res: Response
  try {
    res = await f(u.toString(), { ...init, headers })
  } catch {
    throw new DriveError('אין חיבור ל-Google Drive', 0)
  }
  if (!res.ok) {
    let msg = `Google Drive: שגיאה ${res.status}`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) msg += ` (${body.error.message})`
    } catch {
      /* not JSON */
    }
    throw new DriveError(msg, res.status)
  }
  return res
}

function multipartBody(metadata: object, content: string): { body: string; contentType: string } {
  const boundary = `mymaps${Math.random().toString(36).slice(2)}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${MAP_MIME}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

export const fileName = (doc: MapDoc) => `${(doc.title || 'מפה').replace(/[\\/]/g, '_')}.mymap.json`

/** What we store: the doc without local-only sync fields. */
export function serialize(doc: MapDoc): string {
  const { driveFileId: _a, driveVersion: _b, viewOnly: _c, ...rest } = doc
  void _a
  void _b
  void _c
  return JSON.stringify(rest)
}

async function findOrCreateFolder(ctx: DriveCtx): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false and appProperties has { key='${APP_TAG.key}' and value='${APP_TAG.value}' }`
  const res = await driveFetch(ctx, `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)
  const { files } = (await res.json()) as { files: { id: string }[] }
  if (files[0]) return files[0].id
  const created = await driveFetch(ctx, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_TAG.key]: APP_TAG.value },
    }),
  })
  return ((await created.json()) as { id: string }).id
}

/** Identity of the file content we synced with. Falls back to `version` when Drive gives no revision id. */
export const revisionOf = (m: { version: string; headRevisionId?: string }): string =>
  m.headRevisionId ? `r:${m.headRevisionId}` : m.version

export async function getMeta(ctx: DriveCtx, fileId: string): Promise<DriveFileMeta> {
  const res = await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}?fields=${META_FIELDS}&supportsAllDrives=true`)
  return (await res.json()) as DriveFileMeta
}

export interface LoadedMap {
  doc: MapDoc
  meta: DriveFileMeta
  /** False for anonymous/public reads or viewer permission */
  canEdit: boolean
}

export async function loadMap(ctx: DriveCtx, fileId: string): Promise<LoadedMap> {
  const meta = await getMeta(ctx, fileId)
  const res = await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new DriveError('הקובץ ב-Drive אינו מפה של MyMaps AI', 422)
  }
  const doc = { ...migrate(raw), driveFileId: meta.id, driveVersion: revisionOf(meta) }
  return { doc, meta, canEdit: Boolean(ctx.token) && meta.capabilities?.canEdit !== false }
}

export type SyncDecision = 'create' | 'update' | 'conflict'

/**
 * Decide how to write: new file, safe update, or conflict (someone else saved since our last sync).
 * `r:`-prefixed values are content revision ids (equal = safe). Plain numbers are Drive `version`s
 * (either the no-revision fallback, or legacy values saved before revision ids were used).
 */
export function decideSync(local: Pick<MapDoc, 'driveFileId' | 'driveVersion'>, remoteVersion: string | null): SyncDecision {
  if (!local.driveFileId || remoteVersion === null) return 'create'
  if (!local.driveVersion) return 'conflict'
  const localIsRev = local.driveVersion.startsWith('r:')
  const remoteIsRev = remoteVersion.startsWith('r:')
  if (remoteIsRev) return !localIsRev || local.driveVersion === remoteVersion ? 'update' : 'conflict' // legacy value: accept once
  if (localIsRev) return 'update'
  return BigInt(remoteVersion) > BigInt(local.driveVersion) ? 'conflict' : 'update'
}

export interface SaveResult {
  fileId: string
  version: string
}

export class ConflictError extends DriveError {
  remoteVersion: string
  constructor(remoteVersion: string) {
    super('המפה שונתה במקום אחר מאז השמירה האחרונה', 409)
    this.remoteVersion = remoteVersion
  }
}

/**
 * Save to Drive. Creates the file on first save. Throws ConflictError if the remote changed,
 * unless `force` is set (user chose "keep mine").
 */
export async function saveMap(ctx: DriveCtx, doc: MapDoc, opts: { force?: boolean } = {}): Promise<SaveResult> {
  let remoteVersion: string | null = null
  if (doc.driveFileId) {
    try {
      const meta = await getMeta(ctx, doc.driveFileId)
      remoteVersion = revisionOf(meta)
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
  }
  const decision = decideSync(doc, remoteVersion)
  if (decision === 'conflict' && !opts.force) throw new ConflictError(remoteVersion!)

  const content = serialize(doc)
  if (decision === 'create') {
    const folder = await findOrCreateFolder(ctx)
    const { body, contentType } = multipartBody(
      { name: fileName(doc), mimeType: MAP_MIME, parents: [folder], appProperties: { [APP_TAG.key]: APP_TAG.value } },
      content,
    )
    const res = await driveFetch(ctx, `${UPLOAD}/files?uploadType=multipart&fields=id,version,headRevisionId`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const out = (await res.json()) as { id: string; version: string; headRevisionId?: string }
    return { fileId: out.id, version: revisionOf(out) }
  }
  const { body, contentType } = multipartBody({ name: fileName(doc) }, content)
  const res = await driveFetch(
    ctx,
    `${UPLOAD}/files/${encodeURIComponent(doc.driveFileId!)}?uploadType=multipart&fields=id,version,headRevisionId&supportsAllDrives=true`,
    { method: 'PATCH', headers: { 'Content-Type': contentType }, body },
  )
  const out = (await res.json()) as { id: string; version: string; headRevisionId?: string }
  return { fileId: out.id, version: revisionOf(out) }
}

export interface DriveUser {
  displayName?: string
  emailAddress?: string
}

/** The signed-in Google account (works with the drive.file scope). */
export async function getUser(ctx: DriveCtx): Promise<DriveUser> {
  const res = await driveFetch(ctx, `${API}/about?fields=user(displayName,emailAddress)`)
  return ((await res.json()) as { user?: DriveUser }).user ?? {}
}

/** Maps the app can see in the user's Drive (created by the app, or opened with it). */
export async function listMaps(ctx: DriveCtx): Promise<DriveFileMeta[]> {
  const q = `trashed=false and mimeType='${MAP_MIME}' and appProperties has { key='${APP_TAG.key}' and value='${APP_TAG.value}' }`
  const params = new URLSearchParams({
    q,
    fields: `files(${META_FIELDS})`,
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  })
  const res = await driveFetch(ctx, `${API}/files?${params}`)
  return ((await res.json()) as { files: DriveFileMeta[] }).files
}

export async function trashMap(ctx: DriveCtx, fileId: string): Promise<void> {
  await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

export interface Permission {
  id: string
  type: 'user' | 'anyone' | 'group' | 'domain'
  role: 'owner' | 'writer' | 'commenter' | 'reader' | 'organizer' | 'fileOrganizer'
  emailAddress?: string
  displayName?: string
}

export async function listPermissions(ctx: DriveCtx, fileId: string): Promise<Permission[]> {
  const res = await driveFetch(
    ctx,
    `${API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,emailAddress,displayName)&supportsAllDrives=true`,
  )
  return ((await res.json()) as { permissions: Permission[] }).permissions
}

/** Move a file to the Drive trash (recoverable for 30 days), or restore it. Owner only. */
export async function setTrashed(ctx: DriveCtx, fileId: string, trashed: boolean): Promise<void> {
  await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed }),
  })
}

/** Anyone with the link can view (needed for sign-in-free view links). */
export async function setLinkSharing(ctx: DriveCtx, fileId: string, on: boolean): Promise<void> {
  if (on) {
    await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
    })
    return
  }
  const anyone = (await listPermissions(ctx, fileId)).filter((p) => p.type === 'anyone')
  for (const p of anyone) {
    await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}/permissions/${p.id}?supportsAllDrives=true`, { method: 'DELETE' })
  }
}

/** Invite a person by email. Drive sends the notification email with our message. */
export async function shareWith(
  ctx: DriveCtx,
  fileId: string,
  email: string,
  role: 'writer' | 'reader',
  message: string,
): Promise<void> {
  const params = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: message, supportsAllDrives: 'true' })
  await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}/permissions?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email.trim() }),
  })
}

export async function removePermission(ctx: DriveCtx, fileId: string, permissionId: string): Promise<void> {
  await driveFetch(ctx, `${API}/files/${encodeURIComponent(fileId)}/permissions/${permissionId}?supportsAllDrives=true`, {
    method: 'DELETE',
  })
}

/** App link that opens a Drive map, e.g. https://alon24.github.io/mymaps-ai/#/m/<id> */
export const shareUrl = (appBase: string, fileId: string) => `${appBase}#/m/${encodeURIComponent(fileId)}`
