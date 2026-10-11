/**
 * Road routes for layers whose route uses a travel mode, computed in the background when their
 * stops change and shared by the map (the line) and the itinerary (times and distances).
 */
import { create } from 'zustand'
import { useMapStore } from './mapStore'
import * as ops from '../model/ops'
import { stopsOf } from '../model/itinerary'
import type { Layer } from '../model/types'
import { cacheKey, fetchRoute, type RouteResult } from '../geo/routing'

export interface RouteEntry {
  key: string
  status: 'loading' | 'ok' | 'error'
  result?: RouteResult
  error?: string
}

export const useRoutes = create<{ byLayer: Record<string, RouteEntry> }>(() => ({ byLayer: {} }))

/** The cache key of the route a layer needs right now, or null when it needs none. */
export function routeKeyOf(layer: Layer): string | null {
  if (!layer.travel || !ops.hasRoute(layer)) return null
  const pts = stopsOf(layer).map((s) => [s.lng, s.lat] as [number, number])
  return pts.length < 2 ? null : cacheKey(layer.travel, pts)
}

/** The road route for this layer if it matches the current stops. */
export const currentRoute = (layer: Layer, byLayer: Record<string, RouteEntry>): RouteResult | undefined => {
  const e = byLayer[layer.id]
  return e?.status === 'ok' && e.key === routeKeyOf(layer) ? e.result : undefined
}

function sync() {
  const doc = useMapStore.getState().doc
  const prev = useRoutes.getState().byLayer
  const next: Record<string, RouteEntry> = {}
  for (const layer of doc.layers) {
    const key = routeKeyOf(layer)
    if (!key || !layer.travel) continue
    if (prev[layer.id]?.key === key) {
      next[layer.id] = prev[layer.id]
      continue
    }
    next[layer.id] = { key, status: 'loading' }
    const mode = layer.travel
    const pts = stopsOf(layer).map((s) => [s.lng, s.lat] as [number, number])
    fetchRoute(mode, pts)
      .then((result) => set(layer.id, key, { key, status: 'ok', result }))
      .catch((e) => set(layer.id, key, { key, status: 'error', error: e instanceof Error ? e.message : 'שגיאה' }))
  }
  useRoutes.setState({ byLayer: next })
}

/** Store a result only if the layer still wants that route. */
function set(layerId: string, key: string, entry: RouteEntry) {
  const cur = useRoutes.getState().byLayer[layerId]
  if (cur?.key !== key) return
  useRoutes.setState({ byLayer: { ...useRoutes.getState().byLayer, [layerId]: entry } })
}

/** Start following the map; returns the unsubscribe function. Debounced while stops are dragged. */
export function startRouting(): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  sync()
  const unsub = useMapStore.subscribe((s, p) => {
    if (s.doc === p.doc) return
    clearTimeout(t)
    t = setTimeout(sync, 500)
  })
  return () => {
    clearTimeout(t)
    unsub()
  }
}
