import { create } from 'zustand'
import type { Place } from '../geo/search'

export type PanelTab = 'layers' | 'itinerary' | 'ai'
export type DialogName = 'maps' | 'import' | 'export' | 'share' | 'settings' | 'conflict' | null
export type SyncStatus = 'local' | 'saving' | 'saved' | 'offline' | 'needs-auth' | 'error' | 'view-only'
export type BaseLayer = 'streets' | 'satellite' | 'terrain'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
}

interface UiState {
  tab: PanelTab
  /** Mobile bottom sheet height */
  sheet: 'peek' | 'half' | 'full'
  dialog: DialogName
  toast: Toast | null
  /** Fly-to request; `n` changes on every request so repeated requests still fire */
  focus: { featureId?: string; layerId?: string; all?: boolean; point?: [number, number]; n: number } | null
  highlights: string[]
  /** Feature just added from the map: its row flashes in the list (not opened for editing) */
  justAdded: string | null
  searchPin: Place | null
  userLocation: [number, number] | null
  /** GPS accuracy radius, meters */
  userAccuracy: number
  /** Live location tracking is on */
  tracking: boolean
  mapCenter: [number, number]
  mapBounds: [number, number, number, number] | null
  base: BaseLayer
  sync: SyncStatus
  syncError: string
  setTab: (t: PanelTab) => void
  setSheet: (s: UiState['sheet']) => void
  openDialog: (d: DialogName) => void
  showToast: (text: string, opts?: Omit<Toast, 'id' | 'text'>) => void
  dismissToast: () => void
  focusOn: (target: Omit<NonNullable<UiState['focus']>, 'n'>) => void
  setHighlights: (ids: string[]) => void
  setJustAdded: (id: string | null) => void
  setSearchPin: (p: Place | null) => void
  setUserLocation: (p: [number, number] | null, accuracy?: number) => void
  setTracking: (on: boolean) => void
  setView: (center: [number, number], bounds: [number, number, number, number]) => void
  setBase: (b: BaseLayer) => void
  setSync: (s: SyncStatus, error?: string) => void
}

let toastSeq = 0

export const useUi = create<UiState>((set) => ({
  tab: 'layers',
  sheet: 'peek',
  dialog: null,
  toast: null,
  focus: null,
  highlights: [],
  justAdded: null,
  searchPin: null,
  userLocation: null,
  userAccuracy: 0,
  tracking: false,
  mapCenter: [31.77, 35.21],
  mapBounds: null,
  base: (() => {
    try {
      const b = localStorage.getItem('mymaps-ai.base')
      return b === 'satellite' || b === 'terrain' ? b : 'streets'
    } catch {
      return 'streets'
    }
  })(),
  sync: 'local',
  syncError: '',
  setTab: (tab) => set({ tab }),
  setSheet: (sheet) => set({ sheet }),
  openDialog: (dialog) => set({ dialog }),
  showToast: (text, opts) => set({ toast: { id: ++toastSeq, text, ...opts } }),
  dismissToast: () => set({ toast: null }),
  focusOn: (target) => set((s) => ({ focus: { ...target, n: (s.focus?.n ?? 0) + 1 } })),
  setHighlights: (highlights) => set({ highlights }),
  setJustAdded: (justAdded) => {
    set({ justAdded })
    // the flash is one-shot: clear it so the row doesn't flash again when re-rendered elsewhere
    if (justAdded) setTimeout(() => useUi.getState().justAdded === justAdded && set({ justAdded: null }), 1700)
  },
  setSearchPin: (searchPin) => set({ searchPin }),
  setUserLocation: (userLocation, userAccuracy = 0) => set({ userLocation, userAccuracy }),
  setTracking: (tracking) => set({ tracking }),
  setView: (mapCenter, mapBounds) => set({ mapCenter, mapBounds }),
  setBase: (base) => {
    try {
      localStorage.setItem('mymaps-ai.base', base)
    } catch {
      /* ignore */
    }
    set({ base })
  },
  setSync: (sync, syncError = '') => set({ sync, syncError }),
}))
