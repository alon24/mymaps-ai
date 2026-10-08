import { describe, expect, it } from 'vitest'
import { haversine, pathLength, polygonArea, formatDistance, formatArea, anchor } from './measure'
import { buildSearchUrl, parseCoordinates } from './search'

describe('measure', () => {
  it('computes distances (Tel Aviv → Jerusalem ≈ 54 km)', () => {
    const d = haversine([34.7818, 32.0853], [35.2137, 31.7683])
    expect(d / 1000).toBeGreaterThan(52)
    expect(d / 1000).toBeLessThan(56)
    expect(pathLength([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(2 * haversine([0, 0], [0, 1]))
  })

  it('computes polygon area (1°×1° at equator ≈ 12,364 km²), minus holes', () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    expect(polygonArea([sq]) / 1e6).toBeCloseTo(12364, -2)
    const hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]
    expect(polygonArea([sq, hole])).toBeLessThan(polygonArea([sq]))
  })

  it('formats in Hebrew units', () => {
    expect(formatDistance(250)).toBe("250 מ'")
    expect(formatDistance(2500)).toBe('2.50 ק"מ')
    expect(formatArea(5000)).toBe('5000 מ"ר')
    expect(formatArea(25000)).toBe('25.0 דונם')
  })

  it('anchors polygons at their vertex average', () => {
    expect(anchor({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] })).toEqual([1, 1])
  })
})

describe('search', () => {
  it('parses pasted coordinates', () => {
    expect(parseCoordinates('31.7767, 35.2342')).toEqual({ lat: 31.7767, lng: 35.2342 })
    expect(parseCoordinates('31.7 35.2')).toEqual({ lat: 31.7, lng: 35.2 })
    expect(parseCoordinates('תל אביב')).toBeNull()
    expect(parseCoordinates('95, 10')).toBeNull()
  })

  it('builds a Nominatim URL with Hebrew and a viewbox', () => {
    const url = new URL(buildSearchUrl('קפה', { viewbox: [34, 31, 35, 32] }))
    expect(url.searchParams.get('q')).toBe('קפה')
    expect(url.searchParams.get('viewbox')).toBe('34,31,35,32')
    expect(url.searchParams.get('format')).toBe('jsonv2')
  })
})
