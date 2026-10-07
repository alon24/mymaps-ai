import { parseKml, parseKmlDocument, KmlError } from './kml.js'

const MAX_KML_LENGTH = 500_000

// Fences are matched in order (any language tag) so open/close pairs stay aligned.
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

function isKmlFence(tag, body) {
  return ['', 'kml', 'xml'].includes(tag.trim().toLowerCase()) && /<kml[\s>]/i.test(body)
}

// Pull the first ```kml (or ```xml with <kml) block out of an AI reply.
export function extractKmlBlock(content) {
  for (const [, tag, body] of content.matchAll(FENCE_RE)) {
    if (isKmlFence(tag, body)) return body.trim()
  }
  return null
}

function validCoord([lng, lat]) {
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
}

function allCoords(geometry) {
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(allCoords)
  const flat = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(flat))
  return flat(geometry.coordinates)
}

// AI output is untrusted. Returns { kml, name, geojson } or throws KmlError.
export function validateAiKml(text) {
  if (text.length > MAX_KML_LENGTH) throw new KmlError('KML is too large')
  const doc = parseKmlDocument(text)
  if (doc.getElementsByTagName('script').length > 0) throw new KmlError('KML contains a script element')
  const { name, geojson } = parseKml(text)
  if (geojson.features.length === 0) throw new KmlError('KML has no placemarks with geometry')
  for (const f of geojson.features) {
    if (!allCoords(f.geometry).every(validCoord)) {
      throw new KmlError(`Invalid coordinates in "${f.properties?.name ?? 'feature'}"`)
    }
  }
  return { kml: text, name: name || 'AI layer', geojson }
}

// Remove the KML block from the reply so the chat shows only prose.
export function stripKmlBlock(content) {
  return content.replace(FENCE_RE, (m, tag, body) => (isKmlFence(tag, body) ? '' : m)).trim()
}
