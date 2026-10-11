import { describe, expect, it, vi } from 'vitest'

vi.mock('../geo/routing', async (orig) => ({
  ...(await orig<typeof import('../geo/routing')>()),
  fetchRoute: vi.fn(async (_m: string, pts: [number, number][]) => ({ legs: pts.slice(1).map(() => ({ meters: 500, seconds: 60 })), line: pts })),
}))

import { currentRoute, routeKeyOf, startRouting, useRoutes } from './routeStore'
import { useMapStore } from './mapStore'
import * as ops from '../model/ops'

const pt = (lng: number, lat: number) => ops.createFeature({ type: 'Point', coordinates: [lng, lat] })

describe('route store', () => {
  it('computes routes for layers with a travel mode and drops them when stops change', async () => {
    const m = ops.createMap('t')
    m.layers = [ops.createLayer('day', [pt(34.8, 31.9), pt(34.81, 31.91)], { route: true, travel: 'car' }), ops.createLayer('plain', [pt(1, 1), pt(2, 2)], { route: true })]
    useMapStore.getState().load(m)
    const stop = startRouting()
    const [day, plain] = useMapStore.getState().doc.layers
    expect(routeKeyOf(plain)).toBeNull()
    await vi.waitFor(() => expect(currentRoute(day, useRoutes.getState().byLayer)?.legs).toHaveLength(1))
    // a moved stop makes the old route stale immediately
    useMapStore.getState().apply((d) => ops.updateFeature(d, day.features[1].properties.id, { geometry: { type: 'Point', coordinates: [34.9, 32] } }))
    const moved = useMapStore.getState().doc.layers[0]
    expect(currentRoute(moved, useRoutes.getState().byLayer)).toBeUndefined()
    await vi.waitFor(() => expect(currentRoute(moved, useRoutes.getState().byLayer)?.line.at(-1)).toEqual([34.9, 32]))
    stop()
  })
})
