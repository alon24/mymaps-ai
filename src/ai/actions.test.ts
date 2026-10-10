import { describe, expect, it, vi } from 'vitest'
import { applyActions, changesMap, describeActions, extractJson, highlightedIds, needsRepair, parseAiResponse, type AiAction } from './actions'
import { mapContext } from './prompt'
import * as ops from '../model/ops'
import { tripDays } from '../model/itinerary'

function sample() {
  const m = ops.createMap('תל אביב')
  const a = ops.createFeature({ type: 'Point', coordinates: [34.77, 32.08] }, { name: 'חוף', description: '<b>ים</b>' })
  const b = ops.createFeature({ type: 'Point', coordinates: [34.78, 32.07] }, { name: 'שוק' })
  const c = ops.createFeature({ type: 'Point', coordinates: [34.79, 32.06] }, { name: 'מוזיאון' })
  m.layers = [ops.createLayer('מקומות', [a, b, c])]
  return { m, a, b, c }
}

const geocode = vi.fn(async (q: string) => (q.includes('לא קיים') ? null : { lat: 32.1, lng: 34.8, name: `מצאתי ${q}` }))

describe('parseAiResponse', () => {
  it('extracts JSON from fences and surrounding prose', () => {
    expect(extractJson('hi ```json\n{"reply":"x"}\n``` bye')).toEqual({ reply: 'x' })
    expect(extractJson('text {"a":1} more')).toEqual({ a: 1 })
    expect(extractJson('no json')).toBeNull()
  })

  it('keeps valid actions, counts invalid ones, and falls back to plain text', () => {
    const r = parseAiResponse(
      JSON.stringify({
        reply: 'בסדר',
        actions: [
          { type: 'delete_features', ids: ['x'] },
          { type: 'delete_features', ids: [] },
          { type: 'teleport' },
          { type: 'add_layer', layer_name: 'L', features: [{ place: 'x', lat: 1 }], color: 'red' },
        ],
      }),
    )
    expect(r.reply).toBe('בסדר')
    expect(r.actions.map((a) => a.type)).toEqual(['delete_features'])
    expect(r.rejected).toBe(3)
    expect(parseAiResponse('רק טקסט')).toEqual({ reply: 'רק טקסט', actions: [], rejected: 0 })
  })

  it('normalizes colors', () => {
    const r = parseAiResponse('{"reply":"","actions":[{"type":"set_layer","layer_name":"a","color":"D1495B"}]}')
    expect(r.actions[0]).toMatchObject({ color: '#d1495b' })
  })
})

describe('applyActions', () => {
  it('splits places into trip days (layers + move + order) in one pass', async () => {
    const { m, a, b, c } = sample()
    const { actions } = parseAiResponse(
      JSON.stringify({
        reply: 'חילקתי',
        actions: [
          { type: 'add_layer', layer_name: 'יום 1', day: { date: '2026-11-02' } },
          { type: 'add_layer', layer_name: 'יום 2', day: {} },
          { type: 'move_features', ids: [c.properties.id, a.properties.id], layer_name: 'יום 1' },
          { type: 'move_features', ids: [b.properties.id], layer_name: 'יום 2' },
          { type: 'reorder_layer', layer_name: 'יום 1', ids: [a.properties.id, c.properties.id] },
        ],
      }),
    )
    expect(changesMap(actions)).toBe(true)
    const { doc } = await applyActions(m, actions, geocode)
    const days = tripDays(doc)
    expect(days.map((d) => [d.layer.name, d.layer.style, d.stops.map((s) => s.feature.properties.name)])).toEqual([
      ['יום 1', 'numbered', ['חוף', 'מוזיאון']],
      ['יום 2', 'numbered', ['שוק']],
    ])
    expect(doc.layers[0].features).toHaveLength(0)
    expect(new Set(doc.layers.map((l) => l.color)).size).toBe(3)
  })

  it('geocodes new places (never trusts model coordinates) and reports misses', async () => {
    const { m } = sample()
    const { actions } = parseAiResponse(
      JSON.stringify({
        reply: '',
        actions: [{ type: 'add_places', layer_name: 'הצעות', features: [{ place: 'קפה טוב', icon: '☕' }, { place: 'מקום לא קיים' }] }],
      }),
    )
    const { doc, notFound } = await applyActions(m, actions, geocode)
    const layer = doc.layers.find((l) => l.name === 'הצעות')!
    expect(layer.features).toHaveLength(1)
    expect(layer.features[0].geometry.coordinates).toEqual([34.8, 32.1])
    expect(layer.features[0].properties).toMatchObject({ name: 'מצאתי קפה טוב', icon: '☕' })
    expect(notFound).toEqual(['מקום לא קיים'])
  })

  it('updates, deletes, ignores unknown ids, and leaves highlight as no-op', async () => {
    const { m, a, b } = sample()
    const { actions } = parseAiResponse(
      JSON.stringify({
        reply: '',
        actions: [
          { type: 'update_features', updates: [{ id: a.properties.id, description: 'חוף יפה', icon: '🏖️' }, { id: 'nope', name: 'x' }] },
          { type: 'delete_features', ids: [b.properties.id, 'nope'] },
          { type: 'highlight', ids: [a.properties.id] },
        ],
      }),
    )
    expect(describeActions(m, actions)[1]).toContain('שוק')
    const { doc } = await applyActions(m, actions, geocode)
    expect(ops.findFeature(doc, a.properties.id)?.feature.properties).toMatchObject({ description: 'חוף יפה', icon: '🏖️' })
    expect(ops.findFeature(doc, b.properties.id)).toBeUndefined()
    expect(highlightedIds(actions)).toEqual([a.properties.id])
    expect(changesMap([actions[2]])).toBe(false)
  })
})

describe('mapContext', () => {
  it('includes ids, positions, stripped descriptions and trip days', () => {
    const { m, a } = sample()
    m.layers[0].day = { route: true }
    const ctx = JSON.parse(mapContext(m, { center: [32.08, 34.78] }))
    expect(ctx.layers[0].trip_day).toEqual({ route: true })
    expect(ctx.layers[0].features[0]).toMatchObject({ id: a.properties.id, name: 'חוף', at: [32.08, 34.77], description: 'ים' })
    expect(ctx.map_center).toEqual([32.08, 34.78])
  })
})

describe('lenient parsing of real-world model output', () => {
  it('keeps an action when only an optional field is bad (e.g. color "orange")', () => {
    const r = parseAiResponse(
      JSON.stringify({ reply: 'מוסיף', actions: [{ type: 'add_layer', layer_name: 'הצעות', color: 'orange', features: [{ place: 'Jaffa Port, Tel Aviv', icon: 'a very long icon' }] }] }),
    )
    expect(r.rejected).toBe(0)
    expect(r.actions).toHaveLength(1)
  })

  it('accepts common aliases: places/layer/name, string places, query/address', () => {
    const r = parseAiResponse(
      JSON.stringify({
        reply: 'ok',
        actions: [
          { type: 'add_layer', name: 'הצעות', places: ['Carmel Market, Tel Aviv', { query: 'Sarona Market, Tel Aviv' }, { name: 'Jaffa Clock Tower', address: 'Yefet St, Jaffa' }] },
          { type: 'add_places', layer: 'הצעות', features: [{ name: 'Habima Square, Tel Aviv' }] },
        ],
      }),
    )
    expect(r.rejected).toBe(0)
    const [a, b] = r.actions as Extract<AiAction, { type: 'add_layer' | 'add_places' }>[]
    expect(a.layer_name).toBe('הצעות')
    expect(a.features.map((f) => ('place' in f ? f.place : ''))).toEqual(['Carmel Market, Tel Aviv', 'Sarona Market, Tel Aviv', 'Jaffa Clock Tower, Yefet St, Jaffa'])
    expect(b.layer_name).toBe('הצעות')
    expect('place' in b.features[0] && b.features[0].place).toBe('Habima Square, Tel Aviv')
  })
})

describe('needsRepair', () => {
  it('asks again when the reply promises changes but no valid actions came', () => {
    expect(needsRepair('הצע 5 מקומות והוסף לשכבה', { reply: 'בסדר, מוסיף 5 מקומות לשכבה החדשה', actions: [], rejected: 0 })).toBe(true)
    expect(needsRepair('add places', { reply: 'Adding them now', actions: [], rejected: 0 })).toBe(true)
    expect(needsRepair('x', { reply: '', actions: [], rejected: 2 })).toBe(true)
    // the reply doesn't promise anything, but the user clearly asked for a change
    expect(needsRepair('הצע 5 מקומות והוסף אותם לשכבה חדשה', { reply: 'הנה 5 מקומות מומלצים: …', actions: [], rejected: 0 })).toBe(true)
  })
  it('does not retry questions or replies that already carry actions', () => {
    expect(needsRepair('כמה נקודות יש?', { reply: 'יש 3 נקודות', actions: [], rejected: 0 })).toBe(false)
    expect(needsRepair('מה הכי קרוב לים?', { reply: 'החוף הכי קרוב', actions: [], rejected: 0 })).toBe(false)
    expect(needsRepair('הוסף', { reply: 'מוסיף', actions: [{ type: 'highlight', ids: ['a'] }], rejected: 0 })).toBe(false)
  })
})

describe('action container shapes', () => {
  it('accepts a single action object, or "action"/"changes" keys', () => {
    const one = { type: 'add_layer', layer_name: 'הצעות', features: [{ place: 'Jaffa Port, Tel Aviv' }] }
    expect(parseAiResponse(JSON.stringify({ reply: 'x', actions: one })).actions).toHaveLength(1)
    expect(parseAiResponse(JSON.stringify({ reply: 'x', action: one })).actions).toHaveLength(1)
    expect(parseAiResponse(JSON.stringify({ reply: 'x', changes: [one] })).actions).toHaveLength(1)
  })
})

describe('add_layer safety', () => {
  const add = { type: 'add_layer' as const, layer_name: 'הצעות', features: [{ place: 'Fake Steakhouse, Nowhere' }] }
  it('creates no empty layer when none of the places are found', async () => {
    const doc = ops.createMap('t')
    const r = await applyActions(doc, [add], async () => null)
    expect(r.doc.layers.map((l) => l.name)).not.toContain('הצעות')
    expect(r.notFound).toEqual(['Fake Steakhouse, Nowhere'])
  })
  it('adds to an existing layer with the same name instead of duplicating it', async () => {
    const doc = ops.createMap('t')
    const found = async () => ({ lat: 31.9, lng: 34.8, name: 'x' })
    const once = (await applyActions(doc, [add], found)).doc
    const twice = (await applyActions(once, [add], found)).doc
    expect(twice.layers.filter((l) => l.name === 'הצעות')).toHaveLength(1)
    expect(twice.layers.find((l) => l.name === 'הצעות')!.features).toHaveLength(2)
  })
})
