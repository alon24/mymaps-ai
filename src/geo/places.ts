/**
 * Real places around a point, for the AI's search tool. OpenStreetMap only (no paid APIs):
 * - by category (restaurants, museums, beaches…) → Overpass API, which also returns opening hours,
 *   cuisine and website when mappers added them;
 * - by name → Nominatim (src/geo/search.ts), biased to the area.
 * Results carry stable ids ("osm:node/123") so the AI can pick them without ever giving coordinates.
 */
import { haversine } from './measure'
import { searchPlaces } from './search'

export interface PlaceResult {
  id: string
  name: string
  lat: number
  lng: number
  category?: string
  cuisine?: string
  opening_hours?: string
  website?: string
  address?: string
  /** has a Wikipedia/Wikidata entry: usually a notable place */
  notable?: boolean
  distance_km: number
}

/** Categories the AI may ask for: OSM tag filters (Overpass QL) + an emoji for the map. */
export const CATEGORIES = {
  restaurant: { filters: ['["amenity"="restaurant"]'], icon: '🍽️' },
  cafe: { filters: ['["amenity"="cafe"]'], icon: '☕' },
  bar: { filters: ['["amenity"~"^(bar|pub)$"]'], icon: '🍽️' },
  fast_food: { filters: ['["amenity"="fast_food"]'], icon: '🍽️' },
  bakery: { filters: ['["shop"="bakery"]'], icon: '☕' },
  ice_cream: { filters: ['["amenity"="ice_cream"]'], icon: '❤️' },
  museum: { filters: ['["tourism"="museum"]'], icon: '🏛️' },
  attraction: { filters: ['["tourism"="attraction"]'], icon: '⭐' },
  viewpoint: { filters: ['["tourism"="viewpoint"]'], icon: '⛰️' },
  historic: { filters: ['["historic"~"^(castle|monument|ruins|archaeological_site|memorial)$"]'], icon: '🏛️' },
  park: { filters: ['["leisure"="park"]'], icon: '🌳' },
  nature: { filters: ['["leisure"="nature_reserve"]', '["boundary"="national_park"]'], icon: '🌳' },
  beach: { filters: ['["natural"="beach"]'], icon: '🏖️' },
  playground: { filters: ['["leisure"="playground"]'], icon: '❤️' },
  hotel: { filters: ['["tourism"~"^(hotel|guest_house|hostel|apartment)$"]'], icon: '🏨' },
  supermarket: { filters: ['["shop"~"^(supermarket|convenience)$"]'], icon: '🛒' },
  parking: { filters: ['["amenity"="parking"]'], icon: '🅿️' },
  fuel: { filters: ['["amenity"="fuel"]'], icon: '⛽' },
  station: { filters: ['["railway"="station"]', '["public_transport"="station"]'], icon: '🚉' },
} as const

export type Category = keyof typeof CATEGORIES
export const isCategory = (c: unknown): c is Category => typeof c === 'string' && c in CATEGORIES

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const MAX_RESULTS = 30

/** Overpass QL for named places of a category within `radiusM` of a point. */
export function overpassQuery(category: Category, lat: number, lng: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lng.toFixed(6)})`
  const parts = CATEGORIES[category].filters.map((f) => `nwr${f}["name"]${around};`).join('')
  return `[out:json][timeout:20];(${parts});out center tags 120;`
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** Overpass JSON → results sorted notable first, then by distance. */
export function parseOverpass(data: { elements?: OsmElement[] }, center: [number, number], category?: Category): PlaceResult[] {
  const out: PlaceResult[] = []
  for (const el of data.elements ?? []) {
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    const t = el.tags ?? {}
    const name = t['name:he'] || t.name
    if (lat == null || lng == null || !name) continue
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ')
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name,
      lat,
      lng,
      ...(category ? { category } : {}),
      ...(t.cuisine ? { cuisine: t.cuisine.replace(/;/g, ', ') } : {}),
      ...(t.opening_hours ? { opening_hours: t.opening_hours } : {}),
      ...(t.website || t['contact:website'] ? { website: t.website || t['contact:website'] } : {}),
      ...(street || t['addr:city'] ? { address: [street, t['addr:city']].filter(Boolean).join(', ') } : {}),
      ...(t.wikipedia || t.wikidata ? { notable: true } : {}),
      distance_km: Math.round(haversine([center[1], center[0]], [lng, lat]) / 100) / 10,
    })
  }
  return out.sort((a, b) => Number(Boolean(b.notable)) - Number(Boolean(a.notable)) || a.distance_km - b.distance_km)
}

let queue: Promise<unknown> = Promise.resolve()
const CACHE_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; data: { elements?: OsmElement[] } }>()

/** One Overpass request at a time (fair use of the public server); identical queries are cached for 10 minutes. */
async function overpass(query: string, fetchFn: typeof fetch): Promise<{ elements?: OsmElement[] }> {
  const hit = cache.get(query)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const run = queue.then(async () => {
    const again = cache.get(query)
    if (again && Date.now() - again.at < CACHE_MS) return again.data
    const res = await fetchFn(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) })
    if (!res.ok) throw new Error(`חיפוש המקומות נכשל (${res.status})`)
    const data = (await res.json()) as { elements?: OsmElement[] }
    cache.set(query, { at: Date.now(), data })
    return data
  })
  queue = run.catch(() => undefined)
  return run
}

export interface NearbySearch {
  center: [number, number]
  category?: Category
  /** a name or a word to match (e.g. "sushi", "Louvre") */
  query?: string
  radiusKm?: number
  limit?: number
}

/** Places around `center`: by category (optionally filtered by `query`), or by name. */
export async function searchNearby(s: NearbySearch, fetchFn: typeof fetch = fetch): Promise<PlaceResult[]> {
  const radiusKm = Math.min(Math.max(s.radiusKm ?? 3, 0.2), 25)
  const limit = Math.min(Math.max(s.limit ?? 12, 1), MAX_RESULTS)
  const [lat, lng] = s.center
  if (s.category) {
    let results = parseOverpass(await overpass(overpassQuery(s.category, lat, lng, radiusKm * 1000), fetchFn), s.center, s.category)
    const q = s.query?.trim().toLowerCase()
    if (q) {
      const hits = results.filter((r) => `${r.name} ${r.cuisine ?? ''}`.toLowerCase().includes(q))
      if (hits.length) results = hits
    }
    return results.slice(0, limit)
  }
  if (!s.query?.trim()) return []
  const d = radiusKm / 111
  const found = await searchPlaces(s.query, { viewbox: [lng - d, lat - d, lng + d, lat + d], limit })
  return found.map((p) => ({
    id: `nominatim:${p.lat.toFixed(6)},${p.lng.toFixed(6)}`,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.label,
    distance_km: Math.round(haversine([lng, lat], [p.lng, p.lat]) / 100) / 10,
  }))
}
