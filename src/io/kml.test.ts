import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { exportKml, importKml, importKmz, kmlColor, exportKmz } from './kml'
import { createFeature, createLayer, createMap } from '../model/ops'
import type { MapDoc } from '../model/types'

const fixture = (name: string) => readFileSync(`${process.cwd()}/test/fixtures/${name}`, 'utf8')

describe('importKml', () => {
  it('maps folders to layers with Hebrew names and all geometry types', () => {
    const { title, layers } = importKml(fixture('hebrew-map.kml'))
    expect(title).toBe('טיול בירושלים')
    expect(layers.map((l) => l.name)).toEqual(['אתרים', 'מסלולים'])
    expect(layers[0].features.map((f) => f.properties.name)).toEqual(['הכותל המערבי', 'מגדל דוד'])
    expect(layers[0].features[0].properties.description).toBe('מקום קדוש')
    expect(layers[0].features[0].geometry).toEqual({ type: 'Point', coordinates: [35.2342, 31.7767] })
    expect(layers[1].features.map((f) => f.geometry.type)).toEqual(['LineString', 'Polygon'])
  })

  it('reads Google My Maps styles (StyleMap, color in style id), nested folders and MultiGeometry', () => {
    const { title, layers } = importKml(fixture('mymaps-export.kml'))
    expect(title).toBe('חופשה בצפון')
    expect(layers.map((l) => l.name)).toEqual(['מסעדות', 'מסלול'])
    const [restaurant, cafe] = layers[0].features
    expect(restaurant.properties.name).toBe('מסעדה & בר')
    expect(restaurant.properties.description).toContain('מעולה')
    expect(restaurant.properties.color).toBe('#0288d1')
    expect(cafe.properties.name).toBe('בית קפה') // nested folder merged into top-level layer
    expect(cafe.properties.color).toBe('#ff5252') // unresolved style → color from id
    expect(layers[1].features.map((f) => f.geometry.type)).toEqual(['LineString', 'Point'])
    expect(layers[1].features[0].properties.color).toBe('#e65100')
  })

  it('handles empty folders', () => {
    const { layers } = importKml(fixture('empty-layers.kml'))
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.every((l) => Array.isArray(l.features))).toBe(true)
  })

  it('rejects non-KML input', () => {
    expect(() => importKml('<html><body/></html>')).toThrow()
    expect(() => importKml('not xml <')).toThrow()
  })
})

describe('exportKml', () => {
  const doc = (): MapDoc => {
    const m = createMap('מפה <שלי> & "חברים"')
    m.description = 'תיאור'
    m.layers = [
      createLayer('נקודות', [
        createFeature({ type: 'Point', coordinates: [34.78, 32.08] }, { name: 'תל אביב', description: 'עיר & חוף', color: '#d1495b', icon: '⭐' }),
      ]),
      createLayer('צורות', [
        createFeature({ type: 'LineString', coordinates: [[34, 32], [35, 33]] }, { name: 'קו', color: '#00798c' }),
        createFeature(
          { type: 'Polygon', coordinates: [[[34, 32], [35, 32], [35, 33], [34, 32]]] },
          { name: 'שטח', color: '#edae49' },
        ),
      ]),
      createLayer('ריקה', [], { color: '#7b2d8e', style: 'numbered', day: { date: '2026-11-02', route: false }, visible: false }),
    ]
    return m
  }

  it('converts colors to KML aabbggrr', () => {
    expect(kmlColor('#112233')).toBe('ff332211')
    expect(kmlColor('#112233', '4d')).toBe('4d332211')
  })

  it('escapes XML and produces parseable KML', () => {
    const kml = exportKml(doc())
    expect(kml).toContain('מפה &lt;שלי&gt; &amp; &quot;חברים&quot;')
    expect(new DOMParser().parseFromString(kml, 'text/xml').getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('round-trips: import(export(doc)) keeps layers, names, descriptions, colors, icons and geometry', () => {
    const original = doc()
    const back = importKml(exportKml(original))
    expect(back.title).toBe(original.title)
    const simplify = (layers: MapDoc['layers']) =>
      layers.map((l) => ({
        name: l.name,
        style: l.style,
        day: l.day,
        visible: l.visible,
        features: l.features.map((f) => ({ geometry: f.geometry, ...f.properties, id: undefined })),
      }))
    expect(simplify(back.layers)).toEqual(simplify(original.layers))
    expect(back.layers[2].color).toBe('#7b2d8e')
    const routed = { ...original, layers: [{ ...original.layers[0], route: true }] }
    expect(importKml(exportKml(routed)).layers[0].route).toBe(true)
  })

  it('KMZ round-trip', async () => {
    const blob = await exportKmz(doc())
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('doc.kml')).not.toBeNull()
    const back = await importKmz(await blob.arrayBuffer())
    expect(back.layers.map((l) => l.name)).toEqual(['נקודות', 'צורות', 'ריקה'])
  })
})
