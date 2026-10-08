import { create } from 'zustand'
import type { MapDoc } from '../model/types'
import { createMap } from '../model/ops'

const HISTORY_LIMIT = 100

export type Tool = 'select' | 'point' | 'line' | 'polygon' | 'measure'

interface MapState {
  doc: MapDoc
  past: MapDoc[]
  future: MapDoc[]
  /** Layer new features are added to */
  activeLayerId: string
  selectedFeatureId: string | null
  tool: Tool
  /** Shared, read-only view of someone else's map */
  readOnly: boolean
  /** Replace the whole document (open/new map). Clears history. */
  load: (doc: MapDoc, opts?: { readOnly?: boolean }) => void
  /** Apply an edit. Recorded for undo. */
  apply: (fn: (doc: MapDoc) => MapDoc) => void
  /** Update metadata without an undo entry (e.g. Drive ids after a save). */
  patchMeta: (patch: Partial<Pick<MapDoc, 'driveFileId' | 'driveVersion'>>) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  setActiveLayer: (id: string) => void
  setTool: (t: Tool) => void
}

const firstLayer = (doc: MapDoc) => doc.layers[0]?.id ?? ''

const keepActive = (doc: MapDoc, id: string) => (doc.layers.some((l) => l.id === id) ? id : firstLayer(doc))

const keepSelected = (doc: MapDoc, id: string | null) =>
  id && doc.layers.some((l) => l.features.some((f) => f.properties.id === id)) ? id : null

export const useMapStore = create<MapState>((set, get) => {
  const initial = createMap()
  return {
    doc: initial,
    past: [],
    future: [],
    activeLayerId: firstLayer(initial),
    selectedFeatureId: null,
    tool: 'select',
    readOnly: false,

    load: (doc, opts) =>
      set({
        doc,
        past: [],
        future: [],
        activeLayerId: firstLayer(doc),
        selectedFeatureId: null,
        tool: 'select',
        readOnly: opts?.readOnly ?? false,
      }),

    apply: (fn) => {
      const { doc, past, readOnly, activeLayerId, selectedFeatureId } = get()
      if (readOnly) return
      const next = fn(doc)
      if (next === doc) return
      set({
        doc: next,
        past: [...past, doc].slice(-HISTORY_LIMIT),
        future: [],
        activeLayerId: keepActive(next, activeLayerId),
        selectedFeatureId: keepSelected(next, selectedFeatureId),
      })
    },

    patchMeta: (patch) => set({ doc: { ...get().doc, ...patch } }),

    undo: () => {
      const { doc, past, future, activeLayerId, selectedFeatureId } = get()
      const prev = past.at(-1)
      if (!prev) return
      // keep Drive metadata from the current doc; it describes the remote file, not the edit
      const restored = { ...prev, driveFileId: doc.driveFileId, driveVersion: doc.driveVersion, updatedAt: new Date().toISOString() }
      set({
        doc: restored,
        past: past.slice(0, -1),
        future: [doc, ...future],
        activeLayerId: keepActive(restored, activeLayerId),
        selectedFeatureId: keepSelected(restored, selectedFeatureId),
      })
    },

    redo: () => {
      const { doc, past, future, activeLayerId, selectedFeatureId } = get()
      const next = future[0]
      if (!next) return
      const restored = { ...next, driveFileId: doc.driveFileId, driveVersion: doc.driveVersion, updatedAt: new Date().toISOString() }
      set({
        doc: restored,
        past: [...past, doc],
        future: future.slice(1),
        activeLayerId: keepActive(restored, activeLayerId),
        selectedFeatureId: keepSelected(restored, selectedFeatureId),
      })
    },

    select: (id) => set({ selectedFeatureId: id }),
    setActiveLayer: (id) => set({ activeLayerId: id }),
    setTool: (tool) => set({ tool }),
  }
})
