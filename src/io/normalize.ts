import type { Feature, Geometry, Position } from 'geojson'
import { createFeature } from '../model/ops'
import type { MapFeature, MapGeometry } from '../model/types'
import { PALETTE } from '../model/types'

const HEX6 = /^#?([0-9a-f]{6})$/i

export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = value.trim().match(HEX6)
  return m ? `#${m[1].toLowerCase()}` : undefined
}

/** Google My Maps style ids embed the color: #icon-1899-0288D1-nodesc, #line-000000-1200, #poly-FF5252-1200-77 */
export function colorFromStyleUrl(styleUrl: unknown): string | undefined {
  if (typeof styleUrl !== 'string') return undefined
  const m = styleUrl.match(/(?:icon-\d+|line|poly)-([0-9A-Fa-f]{6})(?:-|$)/)
  return m ? `#${m[1].toLowerCase()}` : undefined
}

const pos2 = (p: Position): Position => [round(p[0]), round(p[1])]
const round = (n: number) => Math.round(n * 1e7) / 1e7

/** Split any GeoJSON geometry into the simple geometries we edit. */
export function splitGeometry(g: Geometry | null | undefined): MapGeometry[] {
  if (!g) return []
  switch (g.type) {
    case 'Point':
      return [{ type: 'Point', coordinates: pos2(g.coordinates) }]
    case 'LineString':
      return g.coordinates.length >= 2 ? [{ type: 'LineString', coordinates: g.coordinates.map(pos2) }] : []
    case 'Polygon':
      return g.coordinates.length && g.coordinates[0].length >= 4
        ? [{ type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(pos2)) }]
        : []
    case 'MultiPoint':
      return g.coordinates.flatMap((c) => splitGeometry({ type: 'Point', coordinates: c }))
    case 'MultiLineString':
      return g.coordinates.flatMap((c) => splitGeometry({ type: 'LineString', coordinates: c }))
    case 'MultiPolygon':
      return g.coordinates.flatMap((c) => splitGeometry({ type: 'Polygon', coordinates: c }))
    case 'GeometryCollection':
      return g.geometries.flatMap(splitGeometry)
  }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) return String((value as { value: unknown }).value)
  return ''
}

/** Turn an arbitrary GeoJSON feature (from KML, GPX, GeoJSON files) into editable features. */
export function toMapFeatures(f: Feature<Geometry | null>): MapFeature[] {
  const p = (f.properties ?? {}) as Record<string, unknown>
  const geoms = splitGeometry(f.geometry)
  return geoms.map((geometry) => {
    const color =
      normalizeColor(p.color) ??
      normalizeColor(geometry.type === 'Point' ? (p['icon-color'] ?? p['marker-color']) : undefined) ??
      normalizeColor(geometry.type === 'Polygon' ? (p.fill ?? p.stroke) : undefined) ??
      normalizeColor(p.stroke) ??
      colorFromStyleUrl(p.styleUrl) ??
      PALETTE[0]
    const rawIcon = p.emoji ?? p.icon
    const icon = typeof rawIcon === 'string' && !rawIcon.includes('/') && rawIcon.length <= 8 ? rawIcon : undefined
    return createFeature(geometry, {
      name: text(p.name ?? p.title).trim(),
      description: text(p.description).trim(),
      color,
      icon,
    })
  })
}
