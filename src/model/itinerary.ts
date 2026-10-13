import type { Layer, MapDoc, MapFeature, TravelMode } from './types'
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

// ---------- Day times ----------

export interface TimedStop {
  /** minutes since midnight of the day */
  arrive: number
  leave: number
}

export interface DaySchedule {
  stops: TimedStop[]
  /** when the last stop's visit ends (minutes since midnight) */
  end: number
  travelSeconds: number
}

export const DEFAULT_STAY_MIN = 60

const parseClock = (s?: string): number | null => {
  const m = s?.match(/^(\d{2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** "09:05"; past midnight → "00:20 (+1)" */
export function formatClock(minutes: number): string {
  const m = Math.round(minutes)
  const day = Math.floor(m / 1440)
  const t = ((m % 1440) + 1440) % 1440
  const hhmm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  return day > 0 ? `${hhmm} (+${day})` : hhmm
}

/**
 * Arrival and leave times for a day: departure (day.start) at the first stop, then travel time from
 * the road route between stops and `stay` minutes at each. Null without a start time or road legs.
 */
export function daySchedule(day: Day, road?: { legs: { seconds: number }[] }): DaySchedule | null {
  const start = parseClock(day.layer.day?.start)
  if (start === null || !day.stops.length) return null
  if (day.stops.length > 1 && (!road || road.legs.length < day.stops.length - 1)) return null
  const stay = day.layer.day?.stay ?? DEFAULT_STAY_MIN
  const stops: TimedStop[] = []
  let t = start
  let travelSeconds = 0
  day.stops.forEach((_, i) => {
    if (i > 0) {
      const s = road!.legs[i - 1].seconds
      travelSeconds += s
      t += s / 60
    }
    stops.push({ arrive: Math.round(t), leave: Math.round(t + stay) })
    t += stay
  })
  return { stops, end: stops.at(-1)!.leave, travelSeconds }
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

const GOOGLE_MODE: Record<TravelMode, string> = { car: 'driving', foot: 'walking', bike: 'bicycling' }

export function dayRouteUrls(stops: Pick<Stop, 'lat' | 'lng'>[], travel?: TravelMode): string[] {
  if (stops.length < 2) return stops.length ? [navigateUrl(stops[0])] : []
  const urls: string[] = []
  const chunk = MAX_WAYPOINTS + 2 // origin + waypoints + destination
  for (let start = 0; start < stops.length - 1; start += chunk - 1) {
    const part = stops.slice(start, start + chunk)
    const [origin, ...rest] = part
    const destination = rest.pop()!
    const params = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(destination) })
    if (rest.length) params.set('waypoints', rest.map(ll).join('|'))
    if (travel) params.set('travelmode', GOOGLE_MODE[travel])
    urls.push(`https://www.google.com/maps/dir/?${params}`)
  }
  return urls
}

/** Link back into the app for a map stored in Drive (focuses a feature when given). */
export function appFeatureUrl(appBase: string, driveFileId: string | undefined, featureId?: string): string | undefined {
  if (!driveFileId) return undefined
  return `${appBase}#/m/${encodeURIComponent(driveFileId)}${featureId ? `?f=${encodeURIComponent(featureId)}` : ''}`
}
