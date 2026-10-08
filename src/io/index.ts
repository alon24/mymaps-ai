import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { createLayer } from '../model/ops'
import type { MapDoc } from '../model/types'
import { importCsv, exportCsv, type CsvImportResult } from './csv'
import { importKml, importKmz, importGpx, exportKml, exportKmz, dominantColor } from './kml'
import { PALETTE } from '../model/types'
import { toMapFeatures } from './normalize'

export type { ImportResult } from './kml'
export type { PendingAddress } from './csv'

export function importGeoJson(text: string): CsvImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('קובץ ה-JSON אינו תקין')
  }
  const d = data as Partial<FeatureCollection> & Partial<Feature>
  const features: Feature<Geometry | null>[] =
    d.type === 'FeatureCollection' ? (d.features ?? []) : d.type === 'Feature' ? [d as Feature] : []
  if (!features.length && d.type !== 'FeatureCollection') throw new Error('זה לא נראה כמו GeoJSON')
  const byLayer = new Map<string, ReturnType<typeof toMapFeatures>>()
  for (const f of features) {
    const name = typeof f.properties?.layer === 'string' && f.properties.layer ? f.properties.layer : 'GeoJSON'
    byLayer.set(name, [...(byLayer.get(name) ?? []), ...toMapFeatures(f)])
  }
  const layers = [...byLayer].map(([n, fs], i) => createLayer(n, fs, { color: dominantColor(fs, PALETTE[i % PALETTE.length]) }))
  return { layers: layers.length ? layers : [createLayer('GeoJSON')], pending: [], skipped: 0 }
}

export function exportGeoJson(doc: MapDoc): string {
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: doc.layers.flatMap((l) =>
      l.features.map((f) => ({
        type: 'Feature' as const,
        geometry: f.geometry,
        properties: {
          ...f.properties,
          layer: l.name,
          // simplestyle-spec so other tools (geojson.io, GitHub) show colors
          ...(f.geometry.type === 'Point' ? { 'marker-color': f.properties.color } : { stroke: f.properties.color }),
          ...(f.geometry.type === 'Polygon' ? { fill: f.properties.color, 'fill-opacity': 0.3 } : {}),
        },
      })),
    ),
  }
  return JSON.stringify(fc, null, 2)
}

export const SUPPORTED_EXTENSIONS = ['.kml', '.kmz', '.geojson', '.json', '.csv', '.gpx'] as const

/** Import any supported file. */
export async function importFile(file: File): Promise<CsvImportResult> {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  const base = file.name.replace(/\.[^.]+$/, '')
  switch (ext) {
    case '.kml':
      return { ...importKml(await file.text()), pending: [], skipped: 0 }
    case '.kmz':
      return { ...(await importKmz(await file.arrayBuffer())), pending: [], skipped: 0 }
    case '.gpx':
      return { ...importGpx(await file.text()), pending: [], skipped: 0 }
    case '.geojson':
    case '.json':
      return importGeoJson(await file.text())
    case '.csv':
    case '.tsv':
    case '.txt':
      return importCsv(await file.text(), base)
    default:
      throw new Error(`סוג קובץ לא נתמך: ${ext || file.name}. נתמכים: ${SUPPORTED_EXTENSIONS.join(', ')}`)
  }
}

export type ExportFormat = 'kml' | 'kmz' | 'geojson' | 'csv'

export async function exportDoc(doc: MapDoc, format: ExportFormat): Promise<{ blob: Blob; filename: string }> {
  const safe = (doc.title || 'map').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'map'
  switch (format) {
    case 'kml':
      return { blob: new Blob([exportKml(doc)], { type: 'application/vnd.google-earth.kml+xml' }), filename: `${safe}.kml` }
    case 'kmz':
      return { blob: await exportKmz(doc), filename: `${safe}.kmz` }
    case 'geojson':
      return { blob: new Blob([exportGeoJson(doc)], { type: 'application/geo+json' }), filename: `${safe}.geojson` }
    case 'csv':
      return { blob: new Blob([exportCsv(doc)], { type: 'text/csv;charset=utf-8' }), filename: `${safe}.csv` }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
