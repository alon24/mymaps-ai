import { describe, expect, it } from 'vitest'
import * as storage from './storage'
import * as ops from '../model/ops'

describe('backup & restore', () => {
  it('exports all maps and restores them, keeping newer local copies', async () => {
    const a = { ...ops.createMap('גיבוי א'), updatedAt: '2026-01-01T00:00:00Z' }
    const b = { ...ops.createMap('גיבוי ב'), updatedAt: '2026-01-01T00:00:00Z' }
    await storage.saveMap(a)
    await storage.saveMap(b)
    const backup = JSON.parse(JSON.stringify(await storage.exportAll()))
    expect(backup.app).toBe('mymaps-ai')
    expect(backup.maps.map((m: { title: string }) => m.title)).toEqual(expect.arrayContaining(['גיבוי א', 'גיבוי ב']))

    await storage.deleteMap(a.id) // lost
    await storage.saveMap({ ...b, title: 'ב חדש', updatedAt: '2026-05-01T00:00:00Z' }) // edited after backup
    const r = await storage.importAll(backup, ops.migrate)
    expect(r.added).toBeGreaterThanOrEqual(1)
    expect((await storage.getMap(a.id))?.title).toBe('גיבוי א')
    expect((await storage.getMap(b.id))?.title).toBe('ב חדש')
  })

  it('rejects files that are not backups', async () => {
    await expect(storage.importAll({ foo: 1 }, ops.migrate)).rejects.toThrow(/גיבוי/)
  })
})
