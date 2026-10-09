import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from './mapStore'
import * as ops from '../model/ops'

const s = () => useMapStore.getState()

describe('map store undo/redo', () => {
  beforeEach(() => s().load(ops.createMap('t')))

  it('undoes and redoes edits, and a new edit clears redo', () => {
    const layer = s().activeLayerId
    const f = ops.createFeature({ type: 'Point', coordinates: [1, 2] }, { name: 'a' })
    s().apply((d) => ops.addFeature(d, layer, f))
    s().apply((d) => ops.updateFeature(d, f.properties.id, { name: 'b' }))
    expect(ops.findFeature(s().doc, f.properties.id)?.feature.properties.name).toBe('b')

    s().undo()
    expect(ops.findFeature(s().doc, f.properties.id)?.feature.properties.name).toBe('a')
    s().undo()
    expect(ops.featureCount(s().doc)).toBe(0)
    s().redo()
    expect(ops.featureCount(s().doc)).toBe(1)

    s().apply((d) => ops.renameLayer(d, layer, 'x'))
    expect(s().future).toHaveLength(0)
  })

  it('keeps Drive metadata across undo and ignores edits when read-only', () => {
    s().apply((d) => ops.setTitle(d, 'new'))
    s().patchMeta({ driveFileId: 'abc', driveVersion: '7' })
    s().undo()
    expect(s().doc.title).toBe('t')
    expect(s().doc.driveFileId).toBe('abc')

    s().load(ops.createMap('shared'), { readOnly: true })
    s().apply((d) => ops.setTitle(d, 'hacked'))
    expect(s().doc.title).toBe('shared')
  })

  it('clears selection when the selected feature is removed', () => {
    const f = ops.createFeature({ type: 'Point', coordinates: [1, 2] })
    s().apply((d) => ops.addFeature(d, s().activeLayerId, f))
    s().select(f.properties.id)
    s().apply((d) => ops.removeFeature(d, f.properties.id))
    expect(s().selectedFeatureId).toBeNull()
  })
})

describe('ui justAdded', () => {
  it('clears itself after the flash', async () => {
    const { useUi } = await import('./uiStore')
    vi.useFakeTimers()
    useUi.getState().setJustAdded('x')
    expect(useUi.getState().justAdded).toBe('x')
    vi.advanceTimersByTime(1800)
    expect(useUi.getState().justAdded).toBeNull()
    vi.useRealTimers()
  })
})
