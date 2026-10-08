import { describe, expect, it } from 'vitest'
import { exportCsv, importCsv, parseCsv, parseWkt, toWkt } from './csv'
import { exportGeoJson, importGeoJson } from './index'
import { createFeature, createLayer, createMap } from '../model/ops'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, newlines, BOM and ; delimiter', () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n"multi\nline",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2'],
    ])
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('WKT', () => {
  it('parses Google My Maps WKT and round-trips', () => {
    expect(parseWkt('POINT (35.2 31.7)')).toEqual([{ type: 'Point', coordinates: [35.2, 31.7] }])
    expect(parseWkt('LINESTRING Z (1 2 0, 3 4 0)')).toEqual([{ type: 'LineString', coordinates: [[1, 2], [3, 4]] }])
    const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    expect(parseWkt(toWkt(poly))).toEqual([poly])
    expect(parseWkt('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))')).toHaveLength(2)
    expect(parseWkt('garbage')).toEqual([])
  })
})

describe('importCsv', () => {
  it('reads lat/lng with Hebrew headers, layer column, and collects address-only rows', () => {
    const csv = 'שם,קו רוחב,קו אורך,שכבה,כתובת\nא,31.7,35.2,אוכל,\nב,32,34.8,,\nג,,,,"דיזנגוף 50, תל אביב"\n,,,,\n'
    const r = importCsv(csv, 'ייבוא')
    expect(r.layers.map((l) => l.name)).toEqual(['אוכל', 'ייבוא'])
    expect(r.layers[0].features[0].geometry).toEqual({ type: 'Point', coordinates: [35.2, 31.7] })
    expect(r.pending).toEqual([{ name: 'ג', description: '', address: 'דיזנגוף 50, תל אביב' }])
  })

  it('rejects CSV without location columns', () => {
    expect(() => importCsv('name,foo\na,b')).toThrow(/עמודות מיקום/)
  })

  it('round-trips export → import', () => {
    const m = createMap('x')
    m.layers = [
      createLayer('L1', [createFeature({ type: 'Point', coordinates: [35, 31] }, { name: 'p, "q"', description: 'd\nline', color: '#d1495b' })]),
      createLayer('L2', [createFeature({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }, { name: 'line' })]),
    ]
    const back = importCsv(exportCsv(m))
    expect(back.layers.map((l) => l.name)).toEqual(['L1', 'L2'])
    expect(back.layers[0].features[0].properties).toMatchObject({ name: 'p, "q"', description: 'd\nline', color: '#d1495b' })
    expect(back.layers[1].features[0].geometry.type).toBe('LineString')
  })
})

describe('GeoJSON', () => {
  it('round-trips with layers and colors', () => {
    const m = createMap('x')
    m.layers = [createLayer('שכבה', [createFeature({ type: 'Point', coordinates: [35, 31] }, { name: 'נ', color: '#00798c', icon: '☕' })])]
    const back = importGeoJson(exportGeoJson(m))
    expect(back.layers[0].name).toBe('שכבה')
    expect(back.layers[0].features[0].properties).toMatchObject({ name: 'נ', color: '#00798c', icon: '☕' })
  })

  it('splits Multi* geometries and rejects bad JSON', () => {
    const r = importGeoJson(JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] } }))
    expect(r.layers[0].features).toHaveLength(2)
    expect(() => importGeoJson('{')).toThrow()
  })
})
