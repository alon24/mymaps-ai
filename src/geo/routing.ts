/**
 * Road routes between stops (car / foot / bike) from the public OSRM servers that power
 * openstreetmap.org's directions (routing.openstreetmap.de, FOSSGIS). Free, no key; light use only,
 * so requests go one at a time and results are cached by stops + mode. Kept behind this one module
 * so the provider can be swapped.
 */
import type { TravelMode } from '../model/types'

export interface Leg {
  meters: number
  seconds: number
}

export interface RouteResult {
  /** one leg per pair of consecutive stops */
  legs: Leg[]
  /** the route along the roads, [lng, lat] */
  line: [number, number][]
}

const BASE = 'https://routing.openstreetmap.de'
const PROFILE: Record<TravelMode, string> = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' }
/** OSRM's public servers limit waypoints per request; longer days go in overlapping chunks */
export const MAX_POINTS = 25

export const routeUrl = (mode: TravelMode, pts: [number, number][]): string =>
  `${BASE}/${PROFILE[mode]}/route/v1/driving/${pts.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')}?overview=full&geometries=geojson&steps=false`

interface OsrmResponse {
  code?: string
  routes?: { legs: { distance: number; duration: number }[]; geometry: { coordinates: [number, number][] } }[]
}

let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, RouteResult>()

export const cacheKey = (mode: TravelMode, pts: [number, number][]) => `${mode}:${pts.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(';')}`

async function oneRequest(mode: TravelMode, pts: [number, number][], fetchFn: typeof fetch): Promise<RouteResult> {
  const run = queue.then(async () => {
    const res = await fetchFn(routeUrl(mode, pts))
    if (!res.ok) throw new Error(`חישוב המסלול נכשל (${res.status})`)
    const data = (await res.json()) as OsrmResponse
    const r = data.routes?.[0]
    if (data.code !== 'Ok' || !r) throw new Error('לא נמצא מסלול בין הנקודות')
    return { legs: r.legs.map((l) => ({ meters: l.distance, seconds: l.duration })), line: r.geometry.coordinates }
  })
  queue = run.catch(() => undefined)
  return run
}

/** Route through `pts` ([lng, lat], in order). Cached; long lists are split into chunks. */
export async function fetchRoute(mode: TravelMode, pts: [number, number][], fetchFn: typeof fetch = fetch): Promise<RouteResult> {
  if (pts.length < 2) return { legs: [], line: [] }
  const key = cacheKey(mode, pts)
  const hit = cache.get(key)
  if (hit) return hit
  const out: RouteResult = { legs: [], line: [] }
  for (let start = 0; start < pts.length - 1; start += MAX_POINTS - 1) {
    const part = await oneRequest(mode, pts.slice(start, start + MAX_POINTS), fetchFn)
    out.legs.push(...part.legs)
    out.line.push(...(out.line.length ? part.line.slice(1) : part.line))
  }
  if (cache.size > 100) cache.clear()
  cache.set(key, out)
  return out
}

/** "1 ש' 20 ד'" / "12 ד'" */
export function formatDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  if (m < 60) return `${m} ד'`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} ש' ${rest} ד'` : `${h} ש'`
}

export const TRAVEL_LABEL: Record<TravelMode, string> = { car: 'ברכב', foot: 'בהליכה', bike: 'באופניים' }
export const TRAVEL_ICON: Record<TravelMode, string> = { car: '🚗', foot: '🚶', bike: '🚲' }
