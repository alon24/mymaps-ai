import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../geo/search', () => ({
  searchPlaces: vi.fn(async () => [{ name: 'דיזנגוף 50', label: 'דיזנגוף 50, תל אביב', lat: 32.0775, lng: 34.7745 }]),
}))

import { FeatureEditor } from './FeatureEditor'
import { useMapStore } from '../store/mapStore'
import * as ops from '../model/ops'

let id = ''
beforeEach(() => {
  const m = ops.createMap('t')
  const f = ops.createFeature({ type: 'Point', coordinates: [35, 32] }, { name: 'בית קפה' })
  id = f.properties.id
  m.layers = [ops.createLayer('אוכל', [f])]
  useMapStore.getState().load(m)
  useMapStore.getState().select(id)
})

const point = () => ops.findFeature(useMapStore.getState().doc, id)?.feature

describe('FeatureEditor', () => {
  it('fixes the address: search, pick a result, the point moves (one undo step)', async () => {
    render(<FeatureEditor />)
    await userEvent.type(screen.getByLabelText('כתובת חדשה'), 'דיזנגוף 50')
    await userEvent.click(screen.getByRole('button', { name: 'חפש' }))
    await userEvent.click(await screen.findByRole('button', { name: /דיזנגוף 50, תל אביב/ }))
    expect(point()?.geometry.coordinates).toEqual([34.7745, 32.0775])
    useMapStore.getState().undo()
    expect(point()?.geometry.coordinates).toEqual([35, 32])
  })

  it('renames with ✓ and deletes from the header', async () => {
    render(<FeatureEditor />)
    await userEvent.click(screen.getByRole('button', { name: /בית קפה/ }))
    const input = screen.getByLabelText('שם')
    await userEvent.clear(input)
    await userEvent.type(input, 'מאפייה')
    await userEvent.click(screen.getByRole('button', { name: 'שמור שם' }))
    expect(point()?.properties.name).toBe('מאפייה')

    await userEvent.click(screen.getByRole('button', { name: 'מחק פריט' }))
    expect(point()).toBeUndefined()
  })
})
