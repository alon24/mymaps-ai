import { describe, expect, it, vi } from 'vitest'
import { runTool } from './tools'
import { applyActions, parseAiResponse } from './actions'
import * as ops from '../model/ops'
import type { PlaceResult } from '../geo/places'

const found: PlaceResult = { id: 'osm:node/9', name: 'Cafe Real', lat: 31.9, lng: 34.8, category: 'cafe', opening_hours: '08:00-20:00', distance_km: 0.4 }

describe('search_places tool', () => {
  it('searches near the user, records results, and returns them without trusting the model for coordinates', async () => {
    const registry = new Map<string, PlaceResult>()
    const search = vi.fn(async () => [found])
    const out = JSON.parse(
      await runTool({ id: 'c1', function: { name: 'search_places', arguments: '{"category":"cafe","near":"me","radius_km":2}' } }, { mapCenter: [32, 35], userLocation: [31.9, 34.8], registry, search }),
    )
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ center: [31.9, 34.8], category: 'cafe', radiusKm: 2 }))
    expect(out.results[0]).toMatchObject({ result_id: 'osm:node/9', name: 'Cafe Real', opening_hours: '08:00-20:00' })
    expect(registry.get('osm:node/9')).toBe(found)
  })

  it('geocodes a named area; reports when it cannot', async () => {
    const search = vi.fn(async () => [])
    const geocodeFn = vi.fn(async () => null)
    const out = JSON.parse(await runTool({ id: 'c', function: { name: 'search_places', arguments: '{"near":"Nowhere"}' } }, { mapCenter: [0, 0], registry: new Map(), search, geocodeFn }))
    expect(out.error).toMatch(/Nowhere/)
    expect(search).not.toHaveBeenCalled()
  })

  it('places picked by result_id land at the searched coordinates; unknown ids are reported', async () => {
    const res = parseAiResponse(JSON.stringify({ reply: 'x', actions: [{ type: 'add_layer', layer_name: 'הצעות', features: [{ result_id: 'osm:node/9', icon: '☕' }, { result_id: 'osm:node/404' }] }] }))
    expect(res.rejected).toBe(0)
    const { doc, notFound } = await applyActions(ops.createMap('t'), res.actions, async () => null, (id) => (id === found.id ? { lat: found.lat, lng: found.lng, name: found.name } : undefined))
    const layer = doc.layers.find((l) => l.name === 'הצעות')!
    expect(layer.features).toHaveLength(1)
    expect(layer.features[0].geometry.coordinates).toEqual([34.8, 31.9])
    expect(layer.features[0].properties.name).toBe('Cafe Real')
    expect(notFound).toEqual(['osm:node/404'])
  })
})

describe('web_search tool', () => {
  const call = (args: object, id = 'w1') => ({ id, function: { name: 'web_search', arguments: JSON.stringify(args) } })
  it('runs once per question, keeps sources, and points the model to search_places', async () => {
    const web = vi.fn(async () => ({ places: [{ name: 'Café Xoho', town: 'Tel Aviv', why: 'brunch', url: 'https://e.com/a' }], sources: [{ url: 'https://e.com/a', title: 'Best brunch' }] }))
    const ctx = { mapCenter: [32, 34.8] as [number, number], registry: new Map(), web, webUsed: 0, sources: [] as { url: string; title: string }[] }
    const first = JSON.parse(await runTool(call({ query: 'best brunch', near: 'Tel Aviv' }), ctx))
    expect(first.places[0].name).toBe('Café Xoho')
    expect(first.next).toContain('search_places')
    expect(web).toHaveBeenCalledWith('best brunch', 'Tel Aviv')
    expect(ctx.sources).toEqual([{ url: 'https://e.com/a', title: 'Best brunch' }])
    const second = JSON.parse(await runTool(call({ query: 'again' }, 'w2'), ctx))
    expect(second.error).toMatch(/already used/)
    expect(web).toHaveBeenCalledTimes(1)
  })
  it('falls back to search_places when unavailable or failing', async () => {
    const none = JSON.parse(await runTool(call({ query: 'x' }), { mapCenter: [0, 0], registry: new Map() }))
    expect(none.error).toMatch(/not available/)
    const failing = JSON.parse(await runTool(call({ query: 'x' }), { mapCenter: [0, 0], registry: new Map(), web: async () => { throw new Error('boom') } }))
    expect(failing.error).toBe('boom')
  })
})
