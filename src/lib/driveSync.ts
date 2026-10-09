/** Glue between the stores, IndexedDB and Google Drive. */
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as storage from './storage'
import * as drive from '../google/drive'
import { getToken, isSignedIn, pickFile, wasSignedIn } from '../google/auth'
import { env, driveEnabled } from '../env'
import { duplicateMap, migrate, createMap } from '../model/ops'
import type { MapDoc } from '../model/types'

const LAST_KEY = 'mymaps-ai.last-map'

export function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* ignore */
  }
}

export function lastMapId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

const ctx = async (interactive = false): Promise<drive.DriveCtx> => ({
  token: isSignedIn() || interactive ? await getToken(interactive) : undefined,
  apiKey: env.VITE_GOOGLE_API_KEY,
})

/** Open a local map, or a new one. */
export async function openLocal(id?: string | null): Promise<void> {
  const doc = id ? await storage.getMap(id) : undefined
  const d = doc ? migrate(doc) : createMap()
  useMapStore.getState().load(d, { readOnly: Boolean(d.viewOnly) })
  rememberLast(d.id)
  if (!doc) await storage.saveMap(d)
  setHash(d.driveFileId)
  useUi.getState().setSync(d.viewOnly ? 'view-only' : d.driveFileId ? 'saved' : 'local')
  useUi.getState().setHighlights([])
  useUi.getState().focusOn({ all: true })
}

export function setHash(driveFileId?: string) {
  const next = driveFileId ? `#/m/${encodeURIComponent(driveFileId)}` : ''
  if (window.location.hash !== next) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
}

async function adopt(loaded: drive.LoadedMap, featureId?: string) {
  const existing = await storage.findByDriveId(loaded.meta.id)
  let doc: MapDoc = { ...loaded.doc, viewOnly: loaded.canEdit ? undefined : true }
  // Keep a local copy that has unsynced edits on top of the same remote version
  if (existing && existing.driveVersion === loaded.meta.version && loaded.canEdit) doc = migrate(existing)
  else if (existing) doc = { ...doc, id: existing.id }
  await storage.saveMap(doc)
  useMapStore.getState().load(doc, { readOnly: !loaded.canEdit })
  rememberLast(doc.id)
  setHash(loaded.meta.id)
  useUi.getState().setSync(loaded.canEdit ? 'saved' : 'view-only')
  if (featureId) {
    useMapStore.getState().select(featureId)
    useUi.getState().focusOn({ featureId })
  } else useUi.getState().focusOn({ all: true })
}

export type OpenOutcome = 'ok' | 'needs-signin' | 'needs-picker' | 'failed'

/**
 * Open a map from a Drive link. Tries anonymous (public link) or signed-in access;
 * reports what the user must do next when access is missing.
 */
export async function openDriveMap(fileId: string, featureId?: string, opts: { interactive?: boolean; picker?: boolean } = {}): Promise<OpenOutcome> {
  if (!driveEnabled()) {
    useUi.getState().showToast('פתיחת מפות מ-Google Drive לא הוגדרה באפליקציה הזו', { tone: 'error' })
    return 'failed'
  }
  try {
    if (opts.picker) {
      const picked = await pickFile(fileId)
      if (!picked) return 'needs-picker'
      fileId = picked
    }
    const c = await ctx(opts.interactive)
    await adopt(await drive.loadMap(c, fileId), featureId)
    return 'ok'
  } catch (e) {
    const status = e instanceof drive.DriveError ? e.status : -1
    if ((status === 403 || status === 404 || status === 401) && !isSignedIn()) return 'needs-signin'
    if (status === 403 || status === 404) return 'needs-picker'
    // Offline: fall back to a cached copy
    const cached = await storage.findByDriveId(fileId)
    if (cached) {
      useMapStore.getState().load(migrate(cached), { readOnly: Boolean(cached.viewOnly) })
      useUi.getState().setSync('offline')
      useUi.getState().showToast('אין חיבור. מוצג העותק השמור במכשיר.')
      return 'ok'
    }
    useUi.getState().showToast(e instanceof Error ? e.message : 'פתיחת המפה נכשלה', { tone: 'error' })
    return 'failed'
  }
}

let saving: Promise<void> | null = null

/** Save the current map to Drive. `interactive` may open the Google sign-in popup (call from a click). */
export async function saveToDrive(opts: { interactive?: boolean; force?: boolean } = {}): Promise<boolean> {
  const st = useMapStore.getState()
  const ui = useUi.getState()
  if (st.readOnly || !driveEnabled()) return false
  if (!navigator.onLine) {
    ui.setSync('offline')
    return false
  }
  if (!isSignedIn() && !opts.interactive) {
    ui.setSync('needs-auth')
    return false
  }
  // One save at a time, strictly in order (a drag & drop fires several edits in a row)
  const previous = saving
  let ok = false
  const run = (async () => {
    if (previous) await previous.catch(() => undefined)
    ui.setSync('saving')
    try {
      const doc = useMapStore.getState().doc
      const res = await drive.saveMap(await ctx(opts.interactive), doc, { force: opts.force })
      // Only patch if the user is still on the same map
      if (useMapStore.getState().doc.id === doc.id) {
        useMapStore.getState().patchMeta({ driveFileId: res.fileId, driveVersion: res.version })
        await storage.saveMap(useMapStore.getState().doc)
        setHash(res.fileId)
      }
      ui.setSync('saved')
      ok = true
    } catch (e) {
      if (e instanceof drive.ConflictError) {
        ui.setSync('error', e.message)
        ui.openDialog('conflict')
      } else {
        ui.setSync('error', e instanceof Error ? e.message : 'השמירה נכשלה')
      }
    }
  })()
  saving = run
  await run
  if (saving === run) saving = null
  return ok
}

export async function resolveConflict(choice: 'mine' | 'theirs' | 'copy'): Promise<void> {
  const st = useMapStore.getState()
  const ui = useUi.getState()
  ui.openDialog(null)
  if (choice === 'mine') {
    await saveToDrive({ force: true })
  } else if (choice === 'theirs' && st.doc.driveFileId) {
    const loaded = await drive.loadMap(await ctx(), st.doc.driveFileId)
    const doc = { ...loaded.doc, id: st.doc.id }
    await storage.saveMap(doc)
    st.load(doc)
    ui.setSync('saved')
    ui.showToast('נטענה הגרסה מ-Drive')
  } else if (choice === 'copy') {
    const copy = duplicateMap(st.doc)
    st.load(copy)
    await storage.saveMap(copy)
    rememberLast(copy.id)
    await saveToDrive()
    ui.showToast('נשמר כמפה חדשה ב-Drive')
  }
}

/** Debounced autosave: IndexedDB always, Drive when the map lives there. */
export function startAutosave(): () => void {
  let localTimer = 0
  let driveTimer = 0
  const unsub = useMapStore.subscribe((s, prev) => {
    if (s.doc === prev.doc) return
    const docId = s.doc.id
    // New map loaded: nothing to save
    if (prev.doc.id !== docId) return
    window.clearTimeout(localTimer)
    localTimer = window.setTimeout(() => {
      const d = useMapStore.getState().doc
      if (d.id === docId) void storage.saveMap(d)
    }, 300)
    if (s.readOnly || !s.doc.driveFileId || !driveEnabled()) return
    // Only metadata changed (after our own save)
    if (s.doc.updatedAt === prev.doc.updatedAt) return
    window.clearTimeout(driveTimer)
    useUi.getState().setSync(isSignedIn() ? 'saving' : 'needs-auth')
    driveTimer = window.setTimeout(() => void saveToDrive(), 2500)
  })
  const onOnline = () => {
    const s = useMapStore.getState()
    if (s.doc.driveFileId && !s.readOnly && useUi.getState().sync !== 'saved') void saveToDrive()
  }
  window.addEventListener('online', onOnline)
  const onOffline = () => useMapStore.getState().doc.driveFileId && useUi.getState().setSync('offline')
  window.addEventListener('offline', onOffline)
  return () => {
    unsub()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

export { wasSignedIn }
