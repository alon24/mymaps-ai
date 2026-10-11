import * as ops from '../model/ops'
import type { MapDoc, MapFeature } from '../model/types'
import * as storage from './storage'

/**
 * A map handed over in a link: #/import/<base64url(MapDoc JSON)>. Travel Hub (alon24/travel-hub) uses it to open a
 * trip's map, with one dated layer per day. The data comes from a URL, so it is migrated and every feature is checked;
 * Drive and view-only fields are dropped (an imported map is a new local map). The same id again only opens the map.
 */
export function readImportHash(hash: string): string | null {
  return hash.match(/^#\/import\/([A-Za-z0-9_-]+)$/)?.[1] ?? null
}

export function decodePayload(text: string): unknown {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const lngLat = (c: unknown): boolean => Array.isArray(c) && c.length >= 2 && num(c[0]) && num(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')

function cleanFeature(f: unknown): MapFeature | null {
  const g = (f as MapFeature | null)?.geometry
  const p = ((f as MapFeature | null)?.properties ?? {}) as Partial<MapFeature['properties']>
  const ok =
    (g?.type === 'Point' && lngLat(g.coordinates)) ||
    (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(lngLat)) ||
    (g?.type === 'Polygon' && Array.isArray(g.coordinates) && g.coordinates.every((r) => Array.isArray(r) && r.length >= 4 && r.every(lngLat)))
  if (!ok) return null
  const feature = ops.createFeature(g as MapFeature['geometry'], {
    name: str(p.name, 200),
    description: str(p.description),
    ...(/^#[0-9a-f]{6}$/i.test(str(p.color)) ? { color: p.color } : {}),
    ...(str(p.icon, 8) ? { icon: str(p.icon, 8) } : {}),
  })
  return feature
}

export function docFromImport(raw: unknown): MapDoc {
  const doc = ops.migrate(raw)
  return {
    schema: doc.schema,
    id: /^[\w-]{1,80}$/.test(doc.id) ? doc.id : ops.newId(),
    title: doc.title.slice(0, 200),
    description: doc.description.slice(0, 2000),
    updatedAt: new Date().toISOString(),
    layers: doc.layers.map((l) => ({ ...l, features: l.features.map(cleanFeature).filter((f): f is MapFeature => f !== null) })),
  }
}

/** Saves the linked map (unless a map with its id is already here) and returns its id and whether it is new. */
export async function importFromLink(payload: string): Promise<{ id: string; added: boolean }> {
  const doc = docFromImport(decodePayload(payload))
  if (await storage.getMap(doc.id)) return { id: doc.id, added: false }
  await storage.saveMap(doc)
  return { id: doc.id, added: true }
}
