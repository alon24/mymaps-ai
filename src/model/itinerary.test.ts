import { describe, expect, it } from 'vitest'
import * as ops from './ops'
import { appFeatureUrl, dayRouteUrls, googleSearchUrl, MAX_WAYPOINTS, sequenceNumbers, tripDays } from './itinerary'
import { itineraryHtml, stripTags } from '../io/itineraryHtml'

const pt = (name: string, lng: number, lat: number) => ops.createFeature({ type: 'Point', coordinates: [lng, lat] }, { name })
const line = ops.createFeature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { name: 'שביל' })

function trip() {
  const m = ops.createMap('טיול לצפון')
  m.layers = [
    ops.createLayer('רעיונות', [pt('x', 35, 32)]),
    ops.createLayer('יום ב', [pt('ג', 35.5, 32.8)], { day: { date: '2026-11-03', route: true }, style: 'numbered', color: '#d1495b' }),
    ops.createLayer('יום בלי תאריך', [pt('ד', 35, 33)], { day: { route: true }, style: 'numbered' }),
    ops.createLayer('יום א', [pt('א', 35.0, 32.0), line, pt('ב <b>', 35.1, 32.1)], { day: { date: '2026-11-02', route: true }, style: 'numbered' }),
  ]
  return m
}

describe('itinerary', () => {
  it('orders days by date, undated last; numbers only points; sums legs', () => {
    const days = tripDays(trip())
    expect(days.map((d) => d.layer.name)).toEqual(['יום א', 'יום ב', 'יום בלי תאריך'])
    const d1 = days[0]
    expect(d1.stops.map((s) => [s.number, s.feature.properties.name])).toEqual([[1, 'א'], [2, 'ב <b>']])
    expect(d1.others.map((f) => f.properties.name)).toEqual(['שביל'])
    expect(d1.stops[0].legMeters).toBe(0)
    expect(d1.totalMeters).toBeGreaterThan(14000)
    expect(d1.totalMeters).toBeLessThan(16000)
  })

  it('assigns sequence numbers only in numbered layers, following list order after a reorder', () => {
    const m = trip()
    const day = m.layers[3]
    const second = day.features[2].properties.id
    expect(sequenceNumbers(m).get(second)).toBe(2)
    const moved = ops.placeFeature(m, second, day.id, 0)
    expect(sequenceNumbers(moved).get(second)).toBe(1)
    expect(sequenceNumbers(m).has(m.layers[0].features[0].properties.id)).toBe(false)
  })

  it('splits long days into Google Maps URLs with ≤ 9 waypoints, chaining legs', () => {
    const stops = Array.from({ length: 25 }, (_, i) => ({ lat: 32 + i / 100, lng: 35 }))
    const urls = dayRouteUrls(stops)
    expect(urls.length).toBe(3)
    for (const u of urls) {
      const wp = new URL(u).searchParams.get('waypoints')?.split('|') ?? []
      expect(wp.length).toBeLessThanOrEqual(MAX_WAYPOINTS)
    }
    const p = (u: string) => new URL(u).searchParams
    expect(p(urls[0]).get('origin')).toBe('32,35')
    expect(p(urls[1]).get('origin')).toBe(p(urls[0]).get('destination'))
    expect(p(urls.at(-1)!).get('destination')).toBe('32.24,35')
    expect(dayRouteUrls([])).toEqual([])
  })

  it('builds in-app links only for Drive maps', () => {
    expect(appFeatureUrl('https://x.io/app/', undefined)).toBeUndefined()
    expect(appFeatureUrl('https://x.io/app/', 'abc', 'f1')).toBe('https://x.io/app/#/m/abc?f=f1')
  })
})

describe('itinerary HTML', () => {
  it('renders days, numbered stops, navigation links, and escapes content', () => {
    const m = trip()
    m.driveFileId = 'FILE1'
    const html = itineraryHtml(m, { appBase: 'https://x.io/app/' })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl')
    expect([...doc.querySelectorAll('.day h2')].map((h) => h.textContent)).toEqual(['יום א', 'יום ב', 'יום בלי תאריך'])
    expect(html).toContain('ב &lt;b&gt;')
    expect(html).not.toContain('<b>')
    const nav = [...doc.querySelectorAll('a')].filter((a) => a.textContent === 'ניווט')
    expect(nav).toHaveLength(4)
    expect(nav[0].getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=32,35')
    expect(html).toContain('https://x.io/app/#/m/FILE1?f=')
    expect(doc.querySelectorAll('svg.sketch')).toHaveLength(1) // only day א has ≥2 stops
  })

  it('shows an empty state without days and strips HTML from descriptions', () => {
    expect(itineraryHtml(ops.createMap('x'), { appBase: '/' })).toContain('אין ימי טיול')
    expect(stripTags('<p>שורה</p><br/>שנייה <a href="#">קישור</a>')).toBe('שורה\n\nשנייה קישור')
  })
})

describe('Google Maps search links', () => {
  it('searches by name near the point, or by coordinates when unnamed', () => {
    expect(googleSearchUrl('קפה לנדוור', { lat: 32.08, lng: 34.78 })).toBe(
      `https://www.google.com/maps/search/${encodeURIComponent('קפה לנדוור')}/@32.08,34.78,17z`,
    )
    expect(googleSearchUrl('  ', { lat: 1, lng: 2 })).toBe('https://www.google.com/maps/search/?api=1&query=1,2')
  })

  it('itinerary HTML has search links, stop coordinates and a distance-from-me button', () => {
    const m = ops.createMap('x')
    m.layers = [ops.createLayer('יום', [pt('קפה', 34.78, 32.08), pt('ים', 34.77, 32.09)], { day: { route: true } })]
    const html = itineraryHtml(m, { appBase: '/' })
    expect(html).toContain('data-lat="32.08" data-lng="34.78"')
    expect(html).toContain('חפש ב-Google Maps')
    expect(html).toContain('id="locate"')
  })
})

describe('route layers', () => {
  it('any layer can show a route; turning it on numbers the layer; day layers use day.route', () => {
    const m = ops.createMap('x')
    const id = m.layers[0].id
    const on = ops.setLayerRoute(m, id, true)
    expect(on.layers[0]).toMatchObject({ route: true, style: 'numbered' })
    expect(ops.hasRoute(on.layers[0])).toBe(true)
    expect(ops.hasRoute(ops.setLayerRoute(on, id, false).layers[0])).toBe(false)
    const day = ops.setLayerDay(m, id, { route: true })
    expect(ops.hasRoute(ops.setLayerRoute(day, id, false).layers[0])).toBe(false)
  })
})
