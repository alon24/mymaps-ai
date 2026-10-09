import { describe, expect, it } from 'vitest'
import * as ops from './ops'

const pt = (name: string) => ops.createFeature({ type: 'Point', coordinates: [35, 32] }, { name })

describe('MapDoc operations', () => {
  it('adds, updates, moves and removes features immutably', () => {
    const m0 = ops.createMap('m')
    const l1 = m0.layers[0].id
    const f = pt('a')
    const m1 = ops.addFeature(m0, l1, f)
    expect(m0.layers[0].features).toHaveLength(0)
    expect(ops.featureCount(m1)).toBe(1)

    const m2 = ops.updateFeature(m1, f.properties.id, { name: 'b', geometry: { type: 'Point', coordinates: [1, 2] } })
    expect(ops.findFeature(m2, f.properties.id)?.feature.properties.name).toBe('b')
    expect(ops.findFeature(m2, f.properties.id)?.feature.geometry.coordinates).toEqual([1, 2])

    const l2 = ops.createLayer('second')
    const m3 = ops.moveFeatureToLayer(ops.addLayer(m2, l2), f.properties.id, l2.id)
    expect(ops.findFeature(m3, f.properties.id)?.layer.id).toBe(l2.id)

    const m4 = ops.removeFeature(m3, f.properties.id)
    expect(ops.featureCount(m4)).toBe(0)
  })

  it('renames, hides and removes layers', () => {
    const m = ops.createMap()
    const id = m.layers[0].id
    expect(ops.renameLayer(m, id, 'x').layers[0].name).toBe('x')
    expect(ops.setLayerVisible(m, id, false).layers[0].visible).toBe(false)
    expect(ops.removeLayer(m, id).layers).toHaveLength(0)
  })
})

describe('ordering and layer settings', () => {
  const setup = () => {
    const m = ops.createMap()
    const a = pt('a'), b = pt('b'), c = pt('c')
    m.layers = [ops.createLayer('L1', [a, b, c]), ops.createLayer('L2', [])]
    return { m, a, b, c }
  }
  const names = (l: { features: { properties: { name: string } }[] }) => l.features.map((f) => f.properties.name)

  it('reorders within a layer and moves between layers at a position', () => {
    const { m, a, c } = setup()
    expect(names(ops.placeFeature(m, c.properties.id, m.layers[0].id, 0).layers[0])).toEqual(['c', 'a', 'b'])
    expect(names(ops.placeFeature(m, a.properties.id, m.layers[0].id, 2).layers[0])).toEqual(['b', 'c', 'a'])
    const moved = ops.placeFeature(m, a.properties.id, m.layers[1].id, 5)
    expect(names(moved.layers[0])).toEqual(['b', 'c'])
    expect(names(moved.layers[1])).toEqual(['a'])
    expect(ops.placeFeature(m, a.properties.id, m.layers[0].id, 0)).toBe(m) // no-op returns same doc
    expect(ops.placeFeature(m, 'missing', m.layers[0].id, 0)).toBe(m)
  })

  it('reorders layers', () => {
    const { m } = setup()
    expect(ops.moveLayer(m, m.layers[1].id, 0).layers.map((l) => l.name)).toEqual(['L2', 'L1'])
  })

  it('makes a trip day numbered by default and clears it', () => {
    const { m } = setup()
    const id = m.layers[0].id
    const d = ops.setLayerDay(m, id, { date: '2026-11-02', route: true })
    expect(d.layers[0]).toMatchObject({ style: 'numbered', day: { date: '2026-11-02', route: true } })
    expect(ops.setLayerDay(d, id, null).layers[0].day).toBeUndefined()
  })

  it('migrates old documents (layers without color/style) and rejects garbage', () => {
    const old = { id: 'x', title: 't', layers: [{ id: 'l', name: 'n', visible: true, features: [] }] }
    const m = ops.migrate(old)
    expect(m.schema).toBe(1)
    expect(m.layers[0]).toMatchObject({ style: 'individual', color: expect.stringMatching(/^#/) })
    expect(() => ops.migrate({ foo: 1 })).toThrow()
  })

  it('duplicates with fresh ids and no Drive link', () => {
    const { m } = setup()
    m.driveFileId = 'd'
    const copy = ops.duplicateMap(m)
    expect(copy.id).not.toBe(m.id)
    expect(copy.driveFileId).toBeUndefined()
    expect(copy.layers[0].features[0].properties.id).not.toBe(m.layers[0].features[0].properties.id)
    expect(names(copy.layers[0])).toEqual(['a', 'b', 'c'])
  })
})

describe('defaultName', () => {
  it('numbers new features per type within the layer', () => {
    const l = ops.createLayer('x', [pt('a'), pt('b'), ops.createFeature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })])
    expect(ops.defaultName(l, 'Point')).toBe('נקודה 3')
    expect(ops.defaultName(l, 'LineString')).toBe('קו 2')
    expect(ops.defaultName(l, 'Polygon')).toBe('אזור 1')
    expect(ops.defaultName(undefined, 'Point')).toBe('נקודה 1')
  })
})

describe('moving between layers', () => {
  it('adopts the target layer color unless the feature has a custom color', () => {
    const m = ops.createMap()
    const plain = ops.createFeature({ type: 'Point', coordinates: [1, 1] }, { name: 'plain', color: '#1f6f5c' })
    const custom = ops.createFeature({ type: 'Point', coordinates: [1, 1] }, { name: 'custom', color: '#7b2d8e' })
    m.layers = [ops.createLayer('A', [plain, custom], { color: '#1f6f5c' }), ops.createLayer('B', [], { color: '#d1495b' })]
    const b = m.layers[1].id
    let d = ops.placeFeature(m, plain.properties.id, b, 0)
    d = ops.moveFeatureToLayer(d, custom.properties.id, b)
    expect(d.layers[1].features.map((f) => [f.properties.name, f.properties.color])).toEqual([
      ['plain', '#d1495b'],
      ['custom', '#7b2d8e'],
    ])
  })
})
