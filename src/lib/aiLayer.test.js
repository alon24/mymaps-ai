import { describe, it, expect } from 'vitest'
import { extractKmlBlock, stripKmlBlock, validateAiKml } from './aiLayer.js'

const kmlDoc = (placemarks) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>בתי קפה</name>${placemarks}</Document></kml>`
const point = (name, coords) => `<Placemark><name>${name}</name><Point><coordinates>${coords}</coordinates></Point></Placemark>`

describe('extractKmlBlock', () => {
  it('extracts a ```kml block', () => {
    const reply = `הנה השכבה:\n\`\`\`kml\n${kmlDoc(point('קפה', '35.2,31.7'))}\n\`\`\`\nבהצלחה`
    expect(extractKmlBlock(reply)).toContain('<kml')
    expect(stripKmlBlock(reply)).toBe('הנה השכבה:\n\nבהצלחה')
  })

  it('accepts ```xml blocks that contain KML and ignores other code', () => {
    const reply = `\`\`\`json\n{"a":1}\n\`\`\`\n\`\`\`xml\n${kmlDoc(point('a', '1,2'))}\n\`\`\``
    expect(extractKmlBlock(reply)).toMatch(/^<\?xml/)
  })

  it('returns null when there is no KML', () => {
    expect(extractKmlBlock('סתם תשובה')).toBeNull()
  })
})

describe('validateAiKml', () => {
  it('accepts valid KML', () => {
    const layer = validateAiKml(kmlDoc(point('קפה הלל', '35.21,31.78')))
    expect(layer.name).toBe('בתי קפה')
    expect(layer.geojson.features).toHaveLength(1)
  })

  it('rejects malformed XML', () => {
    expect(() => validateAiKml('<kml><Document>')).toThrow('not valid XML')
  })

  it('rejects KML without placemarks', () => {
    expect(() => validateAiKml(kmlDoc(''))).toThrow('no placemarks')
  })

  it('rejects out-of-range coordinates (lat/lng swapped beyond limits)', () => {
    expect(() => validateAiKml(kmlDoc(point('רע', '35.2,131.7')))).toThrow('Invalid coordinates')
  })

  it('rejects script elements', () => {
    expect(() => validateAiKml(kmlDoc(point('a', '1,2') + '<script>alert(1)</script>'))).toThrow('script')
  })

  it('rejects oversized output', () => {
    expect(() => validateAiKml('x'.repeat(500_001))).toThrow('too large')
  })
})
