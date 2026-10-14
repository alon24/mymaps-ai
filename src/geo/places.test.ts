import { describe, expect, it, vi } from 'vitest'
import { overpassQuery, parseOverpass, searchNearby } from './places'

const center: [number, number] = [31.8947, 34.8093] // Rehovot
const sample = {
  elements: [
    { type: 'node', id: 1, lat: 31.9, lon: 34.81, tags: { name: 'Far Grill', amenity: 'restaurant', cuisine: 'steak_house;grill' } },
    { type: 'way', id: 2, center: { lat: 31.895, lon: 34.81 }, tags: { name: 'Near Sushi', 'name:he': 'סושי קרוב', cuisine: 'sushi', opening_hours: 'Mo-Su 12:00-23:00', website: 'https://sushi.example' } },
    { type: 'node', id: 3, lat: 31.92, lon: 34.83, tags: { name: 'Famous Museum', wikidata: 'Q1' } },
    { type: 'node', id: 4, lat: 31.9, lon: 34.81, tags: {} }, // no name: skipped
  ],
}

describe('places', () => {
  it('builds an Overpass query for named places of a category around a point', () => {
    const q = overpassQuery('restaurant', 31.9, 34.8, 3000)
    expect(q).toContain('nwr["amenity"="restaurant"]["name"](around:3000,31.900000,34.800000);')
    expect(q).toContain('out center tags')
  })

  it('parses results: Hebrew names, centers of ways, tags, notable first then nearest', () => {
    const r = parseOverpass(sample as never, center, 'restaurant')
    expect(r.map((x) => x.name)).toEqual(['Famous Museum', 'סושי קרוב', 'Far Grill'])
    const sushi = r[1]
    expect(sushi).toMatchObject({ id: 'osm:way/2', lat: 31.895, cuisine: 'sushi', opening_hours: 'Mo-Su 12:00-23:00', website: 'https://sushi.example' })
    expect(r[2].cuisine).toBe('steak_house, grill')
    expect(r[0].notable).toBe(true)
  })

  it('narrows a category search by a word (cuisine or name)', async () => {
    const f = vi.fn(async () => Response.json(sample)) as unknown as typeof fetch
    const r = await searchNearby({ center, category: 'restaurant', query: 'sushi' }, f)
    expect(r.map((x) => x.name)).toEqual(['סושי קרוב'])
  })

  it('answers the same search twice from the cache (one Overpass request)', async () => {
    const f = vi.fn(async () => Response.json(sample)) as unknown as typeof fetch
    const s = { center: [32.08, 34.78] as [number, number], category: 'cafe' as const }
    await searchNearby(s, f)
    await searchNearby(s, f)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
