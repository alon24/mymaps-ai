import type { Layer, MapDoc, MapFeature } from './types'
import { haversine } from '../geo/measure'

export interface Stop {
  feature: MapFeature
  /** 1-based sequence number (points only) */
  number: number
  lat: number
  lng: number
  /** Straight-line distance from the previous stop, meters (0 for the first) */
  legMeters: number
}

export interface Day {
  layer: Layer
  stops: Stop[]
  /** Lines/areas in the day layer: listed, not part of the route */
  others: MapFeature[]
  totalMeters: number
}

const isPoint = (f: MapFeature): f is MapFeature & { geometry: { type: 'Point'; coordinates: number[] } } =>
  f.geometry.type === 'Point'

/** Numbered stops of a layer: its points in list order. */
export function stopsOf(layer: Layer): Stop[] {
  const stops: Stop[] = []
  for (const f of layer.features) {
    if (!isPoint(f)) continue
    const [lng, lat] = f.geometry.coordinates
    const prev = stops.at(-1)
    stops.push({ feature: f, number: stops.length + 1, lat, lng, legMeters: prev ? haversine([prev.lng, prev.lat], [lng, lat]) : 0 })
  }
  return stops
}

/** Sequence number of each point feature in numbered layers (feature id → number). */
export function sequenceNumbers(doc: MapDoc): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of doc.layers) if (l.style === 'numbered') for (const s of stopsOf(l)) out.set(s.feature.properties.id, s.number)
  return out
}

/** Trip days: dated days first (by date), then undated days in layer order. */
export function tripDays(doc: MapDoc): Day[] {
  const days = doc.layers
    .map((layer, order) => ({ layer, order }))
    .filter(({ layer }) => layer.day)
    .sort((a, b) => {
      const da = a.layer.day?.date
      const db = b.layer.day?.date
      if (da && db) return da.localeCompare(db) || a.order - b.order
      if (da) return -1
      if (db) return 1
      return a.order - b.order
    })
  return days.map(({ layer }) => {
    const stops = stopsOf(layer)
    return {
      layer,
      stops,
      others: layer.features.filter((f) => !isPoint(f)),
      totalMeters: stops.reduce((s, x) => s + x.legMeters, 0),
    }
  })
}

// ---------- Google Maps links (official Maps URLs, no API key) ----------

const ll = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`

export const navigateUrl = (s: { lat: number; lng: number }): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${ll(s)}`

export const placeUrl = (s: { lat: number; lng: number }): string =>
  `https://www.google.com/maps/search/?api=1&query=${ll(s)}`

/**
 * Search a place by name around its position in Google Maps (business page, reviews, hours).
 * Unnamed points fall back to the coordinates.
 */
export function googleSearchUrl(name: string, s: { lat: number; lng: number }): string {
  const q = name.trim()
  if (!q) return placeUrl(s)
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${s.lat},${s.lng},17z`
}

/** Google Maps URLs allow up to 9 waypoints; longer days are split into consecutive legs. */
export const MAX_WAYPOINTS = 9

export function dayRouteUrls(stops: Pick<Stop, 'lat' | 'lng'>[]): string[] {
  if (stops.length < 2) return stops.length ? [navigateUrl(stops[0])] : []
  const urls: string[] = []
  const chunk = MAX_WAYPOINTS + 2 // origin + waypoints + destination
  for (let start = 0; start < stops.length - 1; start += chunk - 1) {
    const part = stops.slice(start, start + chunk)
    const [origin, ...rest] = part
    const destination = rest.pop()!
    const params = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(destination) })
    if (rest.length) params.set('waypoints', rest.map(ll).join('|'))
    urls.push(`https://www.google.com/maps/dir/?${params}`)
  }
  return urls
}

/** Link back into the app for a map stored in Drive (focuses a feature when given). */
export function appFeatureUrl(appBase: string, driveFileId: string | undefined, featureId?: string): string | undefined {
  if (!driveFileId) return undefined
  return `${appBase}#/m/${encodeURIComponent(driveFileId)}${featureId ? `?f=${encodeURIComponent(featureId)}` : ''}`
}
