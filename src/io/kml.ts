import { kmlWithFolders, gpx, type Folder, type F } from '@tmcw/togeojson'
import JSZip from 'jszip'
import { createLayer } from '../model/ops'
import type { Layer, LayerStyle, MapDoc, MapFeature, TripDay } from '../model/types'
import { PALETTE } from '../model/types'
import { normalizeColor, toMapFeatures } from './normalize'

/** Most common feature color, used as the layer color for imported layers. */
export function dominantColor(features: MapFeature[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const f of features) counts.set(f.properties.color, (counts.get(f.properties.color) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
}

interface FolderExtras {
  style?: LayerStyle
  color?: string
  day?: TripDay
  route?: boolean
  visible?: boolean
}

/** Our own layer settings, written to Folder ExtendedData on export (Google tools ignore them). */
function folderExtras(folder: Element): FolderExtras {
  const out: FolderExtras = {}
  for (const child of Array.from(folder.children)) {
    if (child.tagName === 'visibility' && child.textContent?.trim() === '0') out.visible = false
    if (child.tagName !== 'ExtendedData') continue
    for (const data of Array.from(child.getElementsByTagName('Data'))) {
      const value = data.getElementsByTagName('value')[0]?.textContent?.trim() ?? ''
      switch (data.getAttribute('name')) {
        case 'mymaps:style':
          if (value === 'individual' || value === 'uniform' || value === 'numbered') out.style = value
          break
        case 'mymaps:color':
          out.color = normalizeColor(value)
          break
        case 'mymaps:route':
          out.route = value === '1'
          break
        case 'mymaps:day': {
          const [date, route] = value.split('|')
          out.day = { route: route !== 'noroute', ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}) }
          break
        }
      }
    }
  }
  return out
}

function topLevelFolders(doc: Document): Element[] {
  const container = doc.getElementsByTagName('Document')[0] ?? doc.documentElement
  return Array.from(container.children).filter((c) => c.tagName === 'Folder')
}

export interface ImportResult {
  title?: string
  layers: Layer[]
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('קובץ ה-XML אינו תקין')
  return doc
}

function documentName(doc: Document): string | undefined {
  const d = doc.getElementsByTagName('Document')[0]
  for (const child of Array.from(d?.children ?? [])) {
    if (child.tagName === 'name') return child.textContent?.trim() || undefined
  }
  return undefined
}

/** KML → layers. Each top-level Folder becomes a layer (nested folders are merged into it). */
export function importKml(text: string): ImportResult {
  const xml = parseXml(text)
  if (!xml.getElementsByTagName('kml').length && !xml.getElementsByTagName('Placemark').length) {
    throw new Error('זה לא נראה כמו קובץ KML')
  }
  const root = kmlWithFolders(xml)
  const title = documentName(xml)
  const extras = topLevelFolders(xml).map(folderExtras)
  const layers: Layer[] = []
  const loose: MapFeature[] = []

  const collect = (node: Folder | F): MapFeature[] =>
    node.type === 'folder' ? node.children.flatMap(collect) : toMapFeatures(node)

  let folderIndex = 0
  for (const child of root.children) {
    if (child.type === 'folder') {
      const i = folderIndex++
      const name = typeof child.meta.name === 'string' && child.meta.name.trim() ? child.meta.name.trim() : `שכבה ${i + 1}`
      const features = collect(child)
      const x = extras[i] ?? {}
      layers.push(
        createLayer(name, features, {
          color: x.color ?? dominantColor(features, PALETTE[i % PALETTE.length]),
          style: x.style,
          day: x.day,
          route: x.route,
          visible: x.visible,
        }),
      )
    } else {
      loose.push(...toMapFeatures(child))
    }
  }
  if (loose.length || layers.length === 0)
    layers.unshift(createLayer(title ?? 'שכבה מיובאת', loose, { color: dominantColor(loose, PALETTE[0]) }))
  return { title, layers }
}

export async function importKmz(data: ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(data)
  const kmlFile = zip.file('doc.kml') ?? zip.file(/\.kml$/i)[0]
  if (!kmlFile) throw new Error('לא נמצא קובץ KML בתוך ה-KMZ')
  return importKml(await kmlFile.async('string'))
}

export function importGpx(text: string): ImportResult {
  const fc = gpx(parseXml(text))
  return { layers: [createLayer('GPX', fc.features.flatMap(toMapFeatures))] }
}

// ---------- export ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** #rrggbb → KML aabbggrr */
export function kmlColor(hex: string, alpha = 'ff'): string {
  const h = hex.replace('#', '')
  return `${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase()
}

const coord = (p: number[]) => `${p[0]},${p[1]},0`

function geometryKml(f: MapFeature): string {
  const g = f.geometry
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${coord(g.coordinates)}</coordinates></Point>`
    case 'LineString':
      return `<LineString><tessellate>1</tessellate><coordinates>${g.coordinates.map(coord).join(' ')}</coordinates></LineString>`
    case 'Polygon': {
      const [outer, ...holes] = g.coordinates
      const ring = (r: number[][]) => `<LinearRing><coordinates>${r.map(coord).join(' ')}</coordinates></LinearRing>`
      return `<Polygon><outerBoundaryIs>${ring(outer)}</outerBoundaryIs>${holes
        .map((h) => `<innerBoundaryIs>${ring(h)}</innerBoundaryIs>`)
        .join('')}</Polygon>`
    }
  }
}

const styleId = (f: MapFeature) => `${f.geometry.type === 'Point' ? 'icon' : f.geometry.type === 'LineString' ? 'line' : 'poly'}-${f.properties.color.replace('#', '').toUpperCase()}`

function styleKml(id: string): string {
  const [kind, hex] = id.split('-')
  const c = `#${hex}`
  if (kind === 'icon')
    return `<Style id="${id}"><IconStyle><color>${kmlColor(c)}</color><scale>1</scale><Icon><href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href></Icon></IconStyle></Style>`
  if (kind === 'line') return `<Style id="${id}"><LineStyle><color>${kmlColor(c)}</color><width>4</width></LineStyle></Style>`
  return `<Style id="${id}"><LineStyle><color>${kmlColor(c)}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(c, '4d')}</color><fill>1</fill><outline>1</outline></PolyStyle></Style>`
}

function placemark(f: MapFeature): string {
  const { name, description, icon } = f.properties
  const ext = icon ? `<ExtendedData><Data name="emoji"><value>${esc(icon)}</value></Data></ExtendedData>` : ''
  return `<Placemark><name>${esc(name)}</name>${description ? `<description>${esc(description)}</description>` : ''}<styleUrl>#${styleId(f)}</styleUrl>${ext}${geometryKml(f)}</Placemark>`
}

export function exportKml(doc: MapDoc): string {
  const all = doc.layers.flatMap((l) => l.features)
  const styles = [...new Set(all.map(styleId))].map(styleKml).join('\n')
  const folders = doc.layers
    .map((l) => {
      const data = [
        ['mymaps:style', l.style],
        ['mymaps:color', l.color],
        ...(l.day ? [['mymaps:day', `${l.day.date ?? ''}|${l.day.route ? 'route' : 'noroute'}`]] : []),
        ...(l.route ? [['mymaps:route', '1']] : []),
      ]
        .map(([k, v]) => `<Data name="${k}"><value>${esc(v)}</value></Data>`)
        .join('')
      return `<Folder><name>${esc(l.name)}</name>${l.visible ? '' : '<visibility>0</visibility>'}<ExtendedData>${data}</ExtendedData>\n${l.features.map(placemark).join('\n')}\n</Folder>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${esc(doc.title)}</name>${doc.description ? `\n<description>${esc(doc.description)}</description>` : ''}
${styles}
${folders}
</Document>
</kml>
`
}

export async function exportKmz(doc: MapDoc): Promise<Blob> {
  const zip = new JSZip()
  zip.file('doc.kml', exportKml(doc))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' })
}
