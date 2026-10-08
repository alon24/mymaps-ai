import type { MapGeometry } from '../model/types'

const R = 6371008.8 // mean Earth radius, meters
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance between two [lng, lat] positions, meters. */
export function haversine(a: number[], b: number[]): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLength(coords: number[][]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i])
  return total
}

/** Spherical polygon ring area, m² (same method as Leaflet.draw / turf). */
export function ringArea(ring: number[][]): number {
  if (ring.length < 3) return 0
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [p1, p2, p3] = [ring[i], ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]]
    area += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]))
  }
  return Math.abs((area * R * R) / 2)
}

export function polygonArea(rings: number[][][]): number {
  const [outer, ...holes] = rings
  return Math.max(0, ringArea(outer ?? []) - holes.reduce((s, h) => s + ringArea(h), 0))
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} מ'` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} ק"מ`
}

export function formatArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2)} מ"ר`
  if (m2 < 1e6) return `${(m2 / 1000).toFixed(1)} דונם`
  return `${(m2 / 1e6).toFixed(2)} קמ"ר`
}

export function describeGeometry(g: MapGeometry): string {
  if (g.type === 'Point') return `${g.coordinates[1].toFixed(5)}, ${g.coordinates[0].toFixed(5)}`
  if (g.type === 'LineString') return formatDistance(pathLength(g.coordinates))
  return `${formatArea(polygonArea(g.coordinates))} · היקף ${formatDistance(pathLength(g.coordinates[0]))}`
}

/** Representative point: the point itself, the middle vertex of a line, the vertex average of a polygon. */
export function anchor(g: MapGeometry): [number, number] {
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]]
  if (g.type === 'LineString') {
    const c = g.coordinates[Math.floor(g.coordinates.length / 2)]
    return [c[0], c[1]]
  }
  const ring = g.coordinates[0].slice(0, -1)
  const n = ring.length || 1
  return [ring.reduce((s, c) => s + c[0], 0) / n, ring.reduce((s, c) => s + c[1], 0) / n]
}

/** [[south, west], [north, east]] bounds of a geometry. */
export function bounds(g: MapGeometry): [[number, number], [number, number]] {
  const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates.flat()
  const lats = pts.map((p) => p[1])
  const lngs = pts.map((p) => p[0])
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ]
}
