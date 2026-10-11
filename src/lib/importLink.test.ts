import { describe, expect, it } from 'vitest'
import { decodePayload, docFromImport, importFromLink, readImportHash } from './importLink'
import * as storage from './storage'

const encode = (v: unknown) => {
  let bin = ''
  for (const b of new TextEncoder().encode(JSON.stringify(v))) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// What Travel Hub sends (travel-hub/src/model/mymaps.ts): flights & stays, then an empty dated layer per day
const tripMap = {
  schema: 1,
  id: 'trip-trip_abc123',
  title: 'Lisbon & Porto',
  description: 'From Travel Hub',
  updatedAt: '2026-10-10T12:00:00Z',
  driveFileId: 'should-be-dropped',
  layers: [
    { id: 'l1', name: '✈ Flights & stays', visible: true, color: '#5c5c5c', style: 'individual', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-9.13, 38.71] }, properties: { id: 'x', name: 'Alfama flat', description: 'Stay', color: '#7b2d8e', icon: '🏨' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [500, 38] }, properties: { id: 'y', name: 'Off the planet', description: '', color: '#000000' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: 'z', name: '<img src=x onerror=alert(1)>', description: '', color: 'red;}' } },
    ] },
    { id: 'l2', name: 'Day 1 · Mon 16 Nov · Fly to Lisbon', visible: true, color: '#1f6f5c', style: 'numbered', day: { date: '2026-11-16', route: true }, features: [] },
  ],
}

describe('map links (#/import/…)', () => {
  it('reads only import hashes', () => {
    expect(readImportHash('#/import/abc_-1')).toBe('abc_-1')
    expect(readImportHash('#/m/abc')).toBeNull()
    expect(readImportHash('')).toBeNull()
  })

  it('decodes Unicode base64url', () => {
    expect(decodePayload(encode({ t: 'מפה ✈' }))).toEqual({ t: 'מפה ✈' })
  })

  it('keeps day layers and valid features, drops bad coordinates, Drive fields and bad colors', () => {
    const doc = docFromImport(tripMap)
    expect(doc.driveFileId).toBeUndefined()
    expect(doc.layers[1]).toMatchObject({ style: 'numbered', day: { date: '2026-11-16', route: true } })
    const names = doc.layers[0].features.map((f) => f.properties.name)
    expect(names).toEqual(['Alfama flat', '<img src=x onerror=alert(1)>'])   // text only; React renders it as text
    expect(doc.layers[0].features[0].properties).toMatchObject({ color: '#7b2d8e', icon: '🏨' })
    expect(doc.layers[0].features[1].properties.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('rejects something that is not a map', () => {
    expect(() => docFromImport({ nope: true })).toThrow()
  })

  it('saves a new map once; the same link later just opens it', async () => {
    const first = await importFromLink(encode(tripMap))
    expect(first).toEqual({ id: 'trip-trip_abc123', added: true })
    expect((await storage.getMap(first.id))?.layers).toHaveLength(2)
    expect(await importFromLink(encode({ ...tripMap, title: 'Changed' }))).toEqual({ id: 'trip-trip_abc123', added: false })
    expect((await storage.getMap(first.id))?.title).toBe('Lisbon & Porto')
  })
})
