import { describe, expect, it } from 'vitest'
import * as storage from './storage'
import * as ops from '../model/ops'

describe('IndexedDB storage', () => {
  it('saves, lists newest first, finds by Drive id, deletes', async () => {
    const a = { ...ops.createMap('a'), updatedAt: '2026-01-01T00:00:00Z' }
    const b = { ...ops.createMap('b'), updatedAt: '2026-02-01T00:00:00Z', driveFileId: 'D1' }
    b.layers[0].features.push(ops.createFeature({ type: 'Point', coordinates: [1, 2] }))
    await storage.saveMap(a)
    await storage.saveMap(b)
    const list = await storage.listMaps()
    expect(list.slice(0, 2).map((m) => [m.title, m.count])).toEqual([['b', 1], ['a', 0]])
    expect((await storage.findByDriveId('D1'))?.id).toBe(b.id)
    await storage.deleteMap(a.id)
    expect(await storage.getMap(a.id)).toBeUndefined()
  })
})
