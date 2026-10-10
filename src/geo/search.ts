/**
 * Place search / geocoding. Nominatim (OpenStreetMap) — free, but the usage policy requires
 * max 1 request per second and attribution. All calls go through one queue here.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export interface Place {
  name: string
  label: string
  lat: number
  lng: number
}

export interface SearchOptions {
  /** Bias results to this box: [west, south, east, north] */
  viewbox?: [number, number, number, number]
  limit?: number
  signal?: AbortSignal
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1100
let last = 0
let chain: Promise<unknown> = Promise.resolve()

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  })
  chain = run.catch(() => undefined)
  return run
}

interface NominatimResult {
  lat: string
  lon: string
  name?: string
  display_name: string
}

export function buildSearchUrl(query: string, opts: SearchOptions = {}): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(opts.limit ?? 6),
    'accept-language': 'he,en',
  })
  if (opts.viewbox) params.set('viewbox', opts.viewbox.join(','))
  return `${ENDPOINT}?${params}`
}

export async function searchPlaces(query: string, opts: SearchOptions = {}): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const coord = parseCoordinates(q)
  if (coord) return [{ name: q, label: q, ...coord }]
  return throttle(async () => {
    const res = await fetch(buildSearchUrl(q, opts), { signal: opts.signal })
    if (!res.ok) throw new Error(`החיפוש נכשל (${res.status})`)
    const data = (await res.json()) as NominatimResult[]
    return data.map((r) => ({
      name: r.name || r.display_name.split(',')[0],
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }))
  })
}

/** Geocode one query → best match or null. */
export async function geocode(query: string, viewbox?: SearchOptions['viewbox']): Promise<Place | null> {
  const [first] = await searchPlaces(query, { viewbox, limit: 1 })
  return first ?? null
}

const STREET_PREFIX = /^(רחוב|רח'|רח׳|שדרות|שד'|שד׳)\s+/

/**
 * Looser forms of "<name>, <street> <no>, <city>": as written, then the address without the
 * name (models often attach a name OSM doesn't know to a real address), then "<name>, <city>".
 */
export function queryVariants(query: string): string[] {
  const parts = query.split(',').map((p) => p.trim()).filter(Boolean)
  const out = [query.trim()]
  if (parts.length >= 3) {
    out.push(parts.slice(1).map((p) => p.replace(STREET_PREFIX, '')).join(', '))
    out.push(`${parts[0]}, ${parts[parts.length - 1]}`)
  }
  return [...new Set(out)]
}

/**
 * Geocode a model-written query, loosening it step by step: within the map view, then anywhere,
 * then just "<first part>, <last part>" (drops street details models often get slightly wrong).
 */
export async function geocodeWithFallback(
  query: string,
  viewbox?: SearchOptions['viewbox'],
  find: (q: string, vb?: SearchOptions['viewbox']) => Promise<Place | null> = geocode,
): Promise<Place | null> {
  const tries: [string, SearchOptions['viewbox'] | undefined][] = []
  for (const q of queryVariants(query)) {
    if (viewbox) tries.push([q, viewbox])
    tries.push([q, undefined])
  }
  for (const [q, vb] of tries) {
    const hit = await find(q, vb).catch(() => null)
    if (hit) return hit
  }
  return null
}

/** "31.77, 35.23" or "31.77 35.23" → coordinates (lat, lng order, as people paste them). */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
