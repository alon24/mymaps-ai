import type { Layer, LayerStyle, MapDoc, MapFeature, MapGeometry, FeatureProps, TripDay } from './types'
import { PALETTE, SCHEMA_VERSION } from './types'

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const touch = (doc: MapDoc): MapDoc => ({ ...doc, updatedAt: new Date().toISOString() })

export function createMap(title = 'מפה ללא שם'): MapDoc {
  return {
    schema: SCHEMA_VERSION,
    id: newId(),
    title,
    description: '',
    layers: [createLayer('שכבה ללא שם')],
    updatedAt: new Date().toISOString(),
  }
}

export function createLayer(name: string, features: MapFeature[] = [], opts: Partial<Omit<Layer, 'id' | 'features'>> = {}): Layer {
  return {
    id: newId(),
    name,
    visible: true,
    color: opts.color ?? PALETTE[0],
    style: opts.style ?? 'individual',
    ...(opts.day ? { day: opts.day } : {}),
    ...(opts.route ? { route: true } : {}),
    ...(opts.visible === false ? { visible: false } : {}),
    features,
  }
}

/** Next palette color not yet used by a layer. */
export function nextLayerColor(doc: MapDoc): string {
  const used = new Set(doc.layers.map((l) => l.color))
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[doc.layers.length % PALETTE.length]
}

/** Bring any stored/imported document up to the current schema. */
export function migrate(raw: unknown): MapDoc {
  const d = raw as Partial<MapDoc> & { layers?: Partial<Layer>[] }
  if (!d || typeof d !== 'object' || !Array.isArray(d.layers)) throw new Error('קובץ מפה לא תקין')
  return {
    schema: SCHEMA_VERSION,
    id: typeof d.id === 'string' ? d.id : newId(),
    title: typeof d.title === 'string' ? d.title : 'מפה',
    description: typeof d.description === 'string' ? d.description : '',
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
    ...(d.driveFileId ? { driveFileId: d.driveFileId } : {}),
    ...(d.driveVersion ? { driveVersion: d.driveVersion } : {}),
    layers: d.layers.map((l, i) => ({
      id: typeof l.id === 'string' ? l.id : newId(),
      name: typeof l.name === 'string' ? l.name : `שכבה ${i + 1}`,
      visible: l.visible !== false,
      color: typeof l.color === 'string' ? l.color : PALETTE[i % PALETTE.length],
      style: l.style === 'uniform' || l.style === 'numbered' ? l.style : 'individual',
      ...(l.day ? { day: { route: l.day.route !== false, ...(l.day.date ? { date: l.day.date } : {}) } } : {}),
      ...(l.route ? { route: true } : {}),
      features: Array.isArray(l.features) ? l.features : [],
    })),
  }
}

export function createFeature(
  geometry: MapGeometry,
  props: Partial<Omit<FeatureProps, 'id'>> = {},
): MapFeature {
  return {
    type: 'Feature',
    geometry,
    properties: {
      id: newId(),
      name: props.name ?? '',
      description: props.description ?? '',
      color: props.color ?? PALETTE[0],
      ...(props.icon ? { icon: props.icon } : {}),
    },
  }
}

const mapLayer = (doc: MapDoc, layerId: string, fn: (l: Layer) => Layer): MapDoc =>
  touch({ ...doc, layers: doc.layers.map((l) => (l.id === layerId ? fn(l) : l)) })

export const setTitle = (doc: MapDoc, title: string, description = doc.description): MapDoc =>
  touch({ ...doc, title, description })

export const addLayer = (doc: MapDoc, layer: Layer): MapDoc =>
  touch({ ...doc, layers: [...doc.layers, layer] })

export const removeLayer = (doc: MapDoc, layerId: string): MapDoc =>
  touch({ ...doc, layers: doc.layers.filter((l) => l.id !== layerId) })

export const renameLayer = (doc: MapDoc, layerId: string, name: string): MapDoc =>
  mapLayer(doc, layerId, (l) => ({ ...l, name }))

export const setLayerVisible = (doc: MapDoc, layerId: string, visible: boolean): MapDoc =>
  mapLayer(doc, layerId, (l) => ({ ...l, visible }))

export const addFeature = (doc: MapDoc, layerId: string, feature: MapFeature): MapDoc =>
  mapLayer(doc, layerId, (l) => ({ ...l, features: [...l.features, feature] }))

export function findFeature(doc: MapDoc, featureId: string): { layer: Layer; feature: MapFeature } | undefined {
  for (const layer of doc.layers) {
    const feature = layer.features.find((f) => f.properties.id === featureId)
    if (feature) return { layer, feature }
  }
  return undefined
}

export function updateFeature(
  doc: MapDoc,
  featureId: string,
  patch: Partial<Omit<FeatureProps, 'id'>> & { geometry?: MapGeometry },
): MapDoc {
  const { geometry, ...props } = patch
  return touch({
    ...doc,
    layers: doc.layers.map((l) => ({
      ...l,
      features: l.features.map((f) =>
        f.properties.id === featureId
          ? { ...f, geometry: geometry ?? f.geometry, properties: { ...f.properties, ...props } }
          : f,
      ),
    })),
  })
}

export const removeFeature = (doc: MapDoc, featureId: string): MapDoc =>
  touch({
    ...doc,
    layers: doc.layers.map((l) => ({ ...l, features: l.features.filter((f) => f.properties.id !== featureId) })),
  })

export function moveFeatureToLayer(doc: MapDoc, featureId: string, toLayerId: string): MapDoc {
  const found = findFeature(doc, featureId)
  const target = doc.layers.find((l) => l.id === toLayerId)
  if (!found || !target || found.layer.id === toLayerId) return doc
  return placeFeature(doc, featureId, toLayerId, target.features.length)
}

const TYPE_NAMES = { Point: 'נקודה', LineString: 'קו', Polygon: 'אזור' } as const

/** Default name for a new feature: "נקודה 3" = third point in that layer. */
export function defaultName(layer: Layer | undefined, type: MapGeometry['type']): string {
  const n = (layer?.features.filter((f) => f.geometry.type === type).length ?? 0) + 1
  return `${TYPE_NAMES[type]} ${n}`
}

export const featureCount = (doc: MapDoc): number =>
  doc.layers.reduce((n, l) => n + l.features.length, 0)

export const setLayerStyle = (doc: MapDoc, layerId: string, patch: { style?: LayerStyle; color?: string }): MapDoc =>
  mapLayer(doc, layerId, (l) => ({ ...l, ...patch }))

/** Does this layer draw a route line? */
export const hasRoute = (l: Layer): boolean => Boolean(l.day ? l.day.route : l.route)

/** Turn the route line on/off for any layer (numbered markers by default when turning on). */
export const setLayerRoute = (doc: MapDoc, layerId: string, on: boolean): MapDoc =>
  mapLayer(doc, layerId, (l) => {
    if (l.day) return { ...l, day: { ...l.day, route: on } }
    const { route: _r, ...rest } = l
    void _r
    return on ? { ...rest, route: true, style: l.route ? l.style : 'numbered' } : rest
  })

/** Mark a layer as a trip day (numbered by default) or clear it with `null`. */
export const setLayerDay = (doc: MapDoc, layerId: string, day: TripDay | null): MapDoc =>
  mapLayer(doc, layerId, (l) => {
    if (!day) {
      const { day: _drop, ...rest } = l
      void _drop
      return rest
    }
    return { ...l, day, style: l.day ? l.style : 'numbered' }
  })

export function moveLayer(doc: MapDoc, layerId: string, toIndex: number): MapDoc {
  const from = doc.layers.findIndex((l) => l.id === layerId)
  if (from < 0) return doc
  const layers = [...doc.layers]
  const [l] = layers.splice(from, 1)
  layers.splice(Math.max(0, Math.min(toIndex, layers.length)), 0, l)
  return touch({ ...doc, layers })
}

/**
 * Move a feature to `toLayerId` at position `toIndex` (index in the target list after removal).
 * Handles reordering within a layer and dragging between layers.
 */
export function placeFeature(doc: MapDoc, featureId: string, toLayerId: string, toIndex: number): MapDoc {
  const found = findFeature(doc, featureId)
  if (!found || !doc.layers.some((l) => l.id === toLayerId)) return doc
  const fromIndex = found.layer.features.indexOf(found.feature)
  if (found.layer.id === toLayerId && fromIndex === toIndex) return doc
  const layers = doc.layers.map((l) => ({ ...l, features: l.features.filter((f) => f.properties.id !== featureId) }))
  const target = layers.find((l) => l.id === toLayerId)!
  const i = Math.max(0, Math.min(toIndex, target.features.length))
  // A feature still wearing its old layer's color takes the new layer's color; custom colors are kept
  const moved =
    found.layer.id !== toLayerId && found.feature.properties.color === found.layer.color
      ? { ...found.feature, properties: { ...found.feature.properties, color: target.color } }
      : found.feature
  target.features = [...target.features.slice(0, i), moved, ...target.features.slice(i)]
  return touch({ ...doc, layers })
}

/** Apply several edits as one (one undo step). */
export const batch = (doc: MapDoc, edits: ((d: MapDoc) => MapDoc)[]): MapDoc => edits.reduce((d, e) => e(d), doc)

export function duplicateMap(doc: MapDoc): MapDoc {
  const copy = migrate(JSON.parse(JSON.stringify(doc)))
  return {
    ...copy,
    id: newId(),
    title: `${doc.title} (עותק)`,
    driveFileId: undefined,
    driveVersion: undefined,
    layers: copy.layers.map((l) => ({
      ...l,
      id: newId(),
      features: l.features.map((f) => ({ ...f, properties: { ...f.properties, id: newId() } })),
    })),
    updatedAt: new Date().toISOString(),
  }
}
