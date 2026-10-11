/**
 * Leaflet-Geoman (line/area drawing and vertex editing) is the heaviest library in the app (~290 KB)
 * and points don't need it, so it loads right after the map appears instead of with the first paint.
 */
import L from 'leaflet'
import type {} from '@geoman-io/leaflet-geoman-free' // types only (adds map.pm / layer.pm)

let loading: Promise<void> | null = null

export const loadGeoman = (): Promise<void> => (loading ??= import('@geoman-io/leaflet-geoman-free').then(() => undefined))

/** Give a map created before Geoman loaded its `pm` controller, with our options. */
export function attachGeoman(map: L.Map): void {
  const m = map as L.Map & { pm?: L.PM.PMMap }
  if (!m.pm) m.pm = new (L as unknown as { PM: { Map: new (map: L.Map) => L.PM.PMMap } }).PM.Map(map)
  m.pm.setLang('he' as never)
  m.pm.setGlobalOptions({ snappable: false, continueDrawing: false } as never)
}

/** False until Geoman is attached (before that, drawing tools wait). */
export const hasGeoman = (map: L.Map | null): map is L.Map => Boolean((map as (L.Map & { pm?: unknown }) | null)?.pm)
