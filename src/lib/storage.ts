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
