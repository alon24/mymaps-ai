import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    // numbered rows show 1, 2
    const marks = document.querySelectorAll('[data-sort-list] .frow__mark')
    expect([...marks].slice(0, 2).map((m) => m.textContent)).toEqual(['1', '2'])
  })

  it('hides a layer and selects a feature on click', async () => {
    render(<LayersPanel />)
    await userEvent.click(screen.getAllByRole('button', { name: 'הסתר שכבה' })[1])
    expect(useMapStore.getState().doc.layers[1].visible).toBe(false)
    await userEvent.click(screen.getByText('פלאפל'))
    expect(useMapStore.getState().selectedFeatureId).toBe(useMapStore.getState().doc.layers[0].features[0].properties.id)
  })
})
