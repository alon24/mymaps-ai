import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayersPanel } from './LayersPanel'
import { useMapStore } from '../store/mapStore'
import * as ops from '../model/ops'

const pt = (name: string) => ops.createFeature({ type: 'Point', coordinates: [35, 32] }, { name })

describe('LayersPanel', () => {
  beforeEach(() => {
    const m = ops.createMap('t')
    m.layers = [ops.createLayer('אוכל', [pt('פלאפל'), pt('חומוס')]), ops.createLayer('לינה', [pt('מלון')])]
    useMapStore.getState().load(m)
  })

  it('lists layers and features, and filters by text', async () => {
    render(<LayersPanel />)
    expect(screen.getByText('אוכל')).toBeInTheDocument()
    expect(screen.getByText('מלון')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('סינון פריטים'), 'חומ')
    expect(screen.queryByText('פלאפל')).not.toBeInTheDocument()
    expect(screen.getByText('חומוס')).toBeInTheDocument()
  })

  it('switches a layer to sequence numbers from the layer menu', async () => {
    render(<LayersPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'הגדרות שכבה אוכל' }))
    await userEvent.click(screen.getByRole('button', { name: 'מספרים לפי הסדר' }))
    expect(useMapStore.getState().doc.layers[0].style).toBe('numbered')
    // every row shows its position in the layer
    const positions = document.querySelectorAll('ul[data-sort-list] .frow__pos')
    expect([...positions].map((m) => m.textContent)).toEqual(['1', '2', '1'])
  })

  it('hides a layer and selects a feature on click', async () => {
    render(<LayersPanel />)
    await userEvent.click(screen.getAllByRole('button', { name: 'הסתר שכבה' })[1])
    expect(useMapStore.getState().doc.layers[1].visible).toBe(false)
    await userEvent.click(screen.getByText('פלאפל'))
    expect(useMapStore.getState().selectedFeatureId).toBe(useMapStore.getState().doc.layers[0].features[0].properties.id)
  })
})

describe('LayersPanel layout', () => {
  beforeEach(() => {
    const m = ops.createMap('t')
    m.layers = [ops.createLayer('אוכל', [pt('פלאפל'), pt('חומוס')]), ops.createLayer('לינה', [pt('מלון')])]
    useMapStore.getState().load(m)
  })

  it('always shows drag handles, no item counts, and accepts drops on layer headers', () => {
    render(<LayersPanel />)
    expect(document.querySelectorAll('.frow__grip')).toHaveLength(3)
    expect(screen.queryByText(/פריטים/)).not.toBeInTheDocument()
    const ids = useMapStore.getState().doc.layers.map((l) => l.id)
    expect([...document.querySelectorAll('header[data-sort-list]')].map((h) => h.getAttribute('data-sort-list'))).toEqual(ids)
  })

  it('hides drag handles for view-only maps', () => {
    useMapStore.getState().load(useMapStore.getState().doc, { readOnly: true })
    render(<LayersPanel />)
    expect(document.querySelectorAll('.frow__grip')).toHaveLength(0)
  })

  it('long press on a layer name renames it; ✕ cancels, ✓ saves; a short tap does not rename', async () => {
    vi.useFakeTimers()
    try {
      render(<LayersPanel />)
      const name = () => screen.getByRole('button', { name: /אוכל/, expanded: true })
      const press = (ms: number) => {
        fireEvent.pointerDown(name(), { pointerType: 'touch', clientX: 10, clientY: 10 })
        act(() => void vi.advanceTimersByTime(ms))
      }
      press(200)
      fireEvent.pointerUp(name())
      expect(screen.queryByLabelText('שם השכבה')).not.toBeInTheDocument()

      press(600)
      fireEvent.change(screen.getByLabelText('שם השכבה'), { target: { value: 'מסעדות' } })
      fireEvent.click(screen.getByRole('button', { name: 'בטל שינוי שם' }))
      expect(useMapStore.getState().doc.layers[0].name).toBe('אוכל')

      press(600)
      fireEvent.change(screen.getByLabelText('שם השכבה'), { target: { value: 'מסעדות' } })
      fireEvent.click(screen.getByRole('button', { name: 'שמור שם' }))
      expect(useMapStore.getState().doc.layers[0].name).toBe('מסעדות')
    } finally {
      vi.useRealTimers()
    }
  })
})
