import { describe, it, expect } from 'vitest'
import { parseKml, summarizeFeatures, KmlError } from './kml.js'
import { fixture } from '../../test/fixtures.js'

describe('parseKml', () => {
  it('parses Hebrew names across folders and geometry types', () => {
    const { name, geojson } = parseKml(fixture('hebrew-map.kml'))
    expect(name).toBe('טיול בירושלים')
    expect(geojson.features.map((f) => f.properties.name)).toEqual([
      'הכותל המערבי', 'מגדל דוד', 'הליכה בעיר העתיקה', 'הרובע היהודי',
    ])
    expect(geojson.features.map((f) => f.geometry.type)).toEqual(['Point', 'Point', 'LineString', 'Polygon'])
    expect(geojson.features[0].geometry.coordinates.slice(0, 2)).toEqual([35.2342, 31.7767])
  })

  it('handles empty layers and placemarks without geometry', () => {
    const { name, geojson } = parseKml(fixture('empty-layers.kml'))
    expect(name).toBe('מפה ריקה')
    expect(geojson.features).toEqual([])
  })

  it('rejects non-XML and non-KML input', () => {
    expect(() => parseKml('<html><body>Sign in')).toThrow(KmlError)
    expect(() => parseKml('<?xml version="1.0"?><html></html>')).toThrow('Document is not KML')
  })
})

describe('summarizeFeatures', () => {
  it('lists names with point coordinates and geometry types', () => {
    const { geojson } = parseKml(fixture('hebrew-map.kml'))
    const text = summarizeFeatures(geojson)
    expect(text).toContain('- הכותל המערבי [Point 31.77670,35.23420]')
    expect(text).toContain('- הרובע היהודי [Polygon]')
  })

  it('truncates long maps', () => {
    const { geojson } = parseKml(fixture('hebrew-map.kml'))
    expect(summarizeFeatures(geojson, 1)).toContain('... and 3 more')
  })
})
