import { kml } from '@tmcw/togeojson'

export class KmlError extends Error {}

export function parseKmlDocument(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new KmlError('KML is not valid XML')
  }
  if (doc.documentElement.localName !== 'kml') {
    throw new KmlError('Document is not KML')
  }
  return doc
}

// Parse KML text into { name, geojson }. Features without geometry are dropped.
export function parseKml(text) {
  const doc = parseKmlDocument(text)
  const geojson = kml(doc)
  geojson.features = geojson.features.filter((f) => f.geometry)
  const docName = doc.getElementsByTagName('Document')[0]
  const nameEl = docName && [...docName.children].find((c) => c.localName === 'name')
  return { name: nameEl?.textContent.trim() || '', geojson }
}

// Compact text description of the map for the AI prompt.
export function summarizeFeatures(geojson, limit = 200) {
  const lines = geojson.features.slice(0, limit).map((f) => {
    const name = f.properties?.name || '(ללא שם)'
    const g = f.geometry
    if (g.type === 'Point') {
      const [lng, lat] = g.coordinates
      return `- ${name} [Point ${lat.toFixed(5)},${lng.toFixed(5)}]`
    }
    return `- ${name} [${g.type}]`
  })
  const more = geojson.features.length - limit
  if (more > 0) lines.push(`... and ${more} more`)
  return lines.join('\n')
}
