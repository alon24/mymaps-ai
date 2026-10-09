import { openDB, type IDBPDatabase } from 'idb'
import type { MapDoc } from '../model/types'

const DB_NAME = 'mymaps-ai'
const STORE = 'maps'

let dbPromise: Promise<IDBPDatabase> | null = null
const db = () =>
  (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' })
    },
  }))

export interface MapSummary {
  id: string
  title: string
  updatedAt: string
  driveFileId?: string
  count: number
}

export async function saveMap(doc: MapDoc): Promise<void> {
  await (await db()).put(STORE, doc)
}

export async function getMap(id: string): Promise<MapDoc | undefined> {
  return (await db()).get(STORE, id) as Promise<MapDoc | undefined>
}

export async function findByDriveId(driveFileId: string): Promise<MapDoc | undefined> {
  const all = (await (await db()).getAll(STORE)) as MapDoc[]
  return all.find((m) => m.driveFileId === driveFileId)
}

export async function deleteMap(id: string): Promise<void> {
  await (await db()).delete(STORE, id)
}

export async function listMaps(): Promise<MapSummary[]> {
  const all = (await (await db()).getAll(STORE)) as MapDoc[]
  return all
    .map((m) => ({
      id: m.id,
      title: m.title,
      updatedAt: m.updatedAt,
      driveFileId: m.driveFileId,
      count: m.layers.reduce((n, l) => n + l.features.length, 0),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

// ---------- durability & backup ----------

/**
 * Ask the browser not to evict our data under storage pressure.
 * Chrome/Edge grant it to installed or frequently used sites; Firefox may ask the user.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export interface Backup {
  app: 'mymaps-ai'
  version: 1
  createdAt: string
  maps: MapDoc[]
}

export async function exportAll(): Promise<Backup> {
  const maps = (await (await db()).getAll(STORE)) as MapDoc[]
  return { app: 'mymaps-ai', version: 1, createdAt: new Date().toISOString(), maps }
}

/**
 * Restore a backup. A map that already exists is replaced only if the backup copy is newer.
 * Returns how many maps were added or updated.
 */
export async function importAll(raw: unknown, migrate: (d: unknown) => MapDoc): Promise<{ added: number; updated: number; skipped: number }> {
  const b = raw as Partial<Backup>
  if (!b || b.app !== 'mymaps-ai' || !Array.isArray(b.maps)) throw new Error('זה לא קובץ גיבוי של MyMaps AI')
  let added = 0
  let updated = 0
  let skipped = 0
  for (const m of b.maps) {
    let doc: MapDoc
    try {
      doc = migrate(m)
    } catch {
      skipped++
      continue
    }
    const existing = await getMap(doc.id)
    if (!existing) {
      await saveMap(doc)
      added++
    } else if (doc.updatedAt > existing.updatedAt) {
      await saveMap(doc)
      updated++
    } else skipped++
  }
  return { added, updated, skipped }
}
