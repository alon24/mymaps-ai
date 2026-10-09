import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({
  env: { VITE_GOOGLE_CLIENT_ID: 'cid', VITE_GOOGLE_API_KEY: 'key' },
  driveEnabled: () => true,
}))
const auth = vi.hoisted(() => ({ signed: true }))
vi.mock('../google/auth', () => ({
  isSignedIn: () => auth.signed,
  wasSignedIn: () => auth.signed,
  getToken: async () => 'T',
  pickFile: async () => null,
}))
const uploads = vi.hoisted(() => [] as string[])
const trash = vi.hoisted(() => [] as [string, boolean][])
vi.mock('../google/drive', async (orig) => ({
  ...(await orig<typeof import('../google/drive')>()),
  setTrashed: async (_c: unknown, id: string, on: boolean) => void trash.push([id, on]),
  saveMap: async (_c: unknown, doc: { title: string }) => {
    uploads.push(doc.title)
    return { fileId: `F-${doc.title}`, version: 'r:1' }
  },
}))

import * as storage from './storage'
import * as ops from '../model/ops'
import { useMapStore } from '../store/mapStore'
import { deleteDriveMap, uploadLocalMaps } from './driveSync'
import { useUi } from '../store/uiStore'

const withPoint = (title: string) => {
  const d = ops.createMap(title)
  d.layers[0].features.push(ops.createFeature({ type: 'Point', coordinates: [35, 32] }))
  return d
}

describe('uploadLocalMaps', () => {
  beforeEach(async () => {
    uploads.length = 0
    for (const m of await storage.listMaps()) await storage.deleteMap(m.id)
  })

  it('uploads local-only maps with content, skips empty and already-synced ones', async () => {
    const open = ops.createMap('פתוחה')
    useMapStore.getState().load(open)
    await storage.saveMap(open)
    await storage.saveMap(withPoint('טיול'))
    await storage.saveMap(ops.createMap('ריקה'))
    await storage.saveMap({ ...withPoint('כבר שם'), driveFileId: 'X', driveVersion: 'r:1' })

    expect(await uploadLocalMaps()).toBe(1)
    expect(uploads).toEqual(['טיול'])
    const saved = (await storage.listMaps()).find((m) => m.title === 'טיול')
    expect(saved?.driveFileId).toBe('F-טיול')
  })

  it('does nothing when signed out', async () => {
    auth.signed = false
    await storage.saveMap(withPoint('טיול'))
    expect(await uploadLocalMaps()).toBe(0)
    expect(uploads).toEqual([])
    auth.signed = true
  })
})

describe('deleteDriveMap', () => {
  it('trashes the Drive file, removes the local copy, switches away if open, and undo restores both', async () => {
    trash.length = 0
    const d = { ...withPoint('למחיקה'), driveFileId: 'DEL', driveVersion: 'r:1' }
    await storage.saveMap(d)
    useMapStore.getState().load(d)

    expect(await deleteDriveMap('DEL', 'למחיקה')).toBe(true)
    expect(trash).toEqual([['DEL', true]])
    expect(await storage.findByDriveId('DEL')).toBeUndefined()
    expect(useMapStore.getState().doc.driveFileId).not.toBe('DEL')

    useUi.getState().toast!.action!.run()
    await vi.waitFor(() => expect(trash).toEqual([['DEL', true], ['DEL', false]]))
    await vi.waitFor(async () => expect((await storage.findByDriveId('DEL'))?.title).toBe('למחיקה'))
  })
})
