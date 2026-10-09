import { useEffect, useRef, useState } from 'react'
import { MapView } from './components/MapView'
import { Toolbar } from './components/Toolbar'
import { LayersPanel } from './components/LayersPanel'
import { ItineraryPanel } from './components/ItineraryPanel'
import { AiPanel } from './components/AiPanel'
import { FeatureEditor } from './components/FeatureEditor'
import { Dialogs } from './components/Dialogs'
import { Icon, IconButton } from './components/ui'
import { useMapStore } from './store/mapStore'
import { useUi, type PanelTab } from './store/uiStore'
import * as ops from './model/ops'
import { parseHash } from './lib/appBase'
import * as storage from './lib/storage'
import { lastMapId, openDriveMap, openLocal, saveToDrive, startAutosave, type OpenOutcome } from './lib/driveSync'
import { driveEnabled } from './env'

const TABS: { id: PanelTab; label: string; icon: string }[] = [
  { id: 'layers', label: 'שכבות', icon: 'layers' },
  { id: 'itinerary', label: 'מסלול', icon: 'route' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
]

const SYNC_LABEL: Record<string, string> = {
  local: 'שמור במכשיר',
  saving: 'שומר ב-Drive…',
  saved: 'שמור ב-Drive',
  offline: 'לא מחובר — יישמר כשהחיבור יחזור',
  'needs-auth': 'התחבר כדי לשמור ב-Drive',
  error: 'השמירה ב-Drive נכשלה',
  'view-only': 'צפייה בלבד',
}

function Title() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(doc.title)
  useEffect(() => {
    setValue(doc.title)
  }, [doc.title])
  if (editing && !readOnly) {
    return (
      <input
        className="title-input"
        value={value}
        autoFocus
        aria-label="שם המפה"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (value.trim() && value !== doc.title) useMapStore.getState().apply((d) => ops.setTitle(d, value.trim()))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    )
  }
  return (
    <h1 className="title">
      <button type="button" onClick={() => setEditing(true)} disabled={readOnly} title={readOnly ? undefined : 'שנה שם'}>
        {doc.title || 'מפה ללא שם'}
      </button>
    </h1>
  )
}

function Menu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const readOnly = useMapStore((s) => s.readOnly)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const go = (d: Parameters<ReturnType<typeof useUi.getState>['openDialog']>[0]) => {
    setOpen(false)
    useUi.getState().openDialog(d)
  }
  return (
    <div className="menu" ref={ref}>
      <IconButton icon="menu" label="תפריט" active={open} onClick={() => setOpen(!open)} />
      {open && (
        <ul className="menu__list" role="menu">
          <li><button role="menuitem" onClick={() => go('maps')}><Icon name="globe" size={18} /> המפות שלי</button></li>
          <li><button role="menuitem" onClick={() => go('import')}><Icon name="upload" size={18} /> ייבוא</button></li>
          <li><button role="menuitem" onClick={() => go('export')}><Icon name="download" size={18} /> ייצוא</button></li>
          <li><button role="menuitem" onClick={() => go('share')}><Icon name="share" size={18} /> שיתוף{readOnly ? '' : ' ושמירה ב-Drive'}</button></li>
          <li><button role="menuitem" onClick={() => go('settings')}><Icon name="edit" size={18} /> הגדרות</button></li>
        </ul>
      )}
    </div>
  )
}

function SyncBadge() {
  const sync = useUi((s) => s.sync)
  const err = useUi((s) => s.syncError)
  const icon = sync === 'offline' || sync === 'error' || sync === 'needs-auth' ? 'cloudOff' : sync === 'local' || sync === 'view-only' ? '' : 'cloud'
  const actionable = sync === 'needs-auth' || sync === 'error'
  if (sync === 'local' && driveEnabled()) {
    return (
      <button type="button" className="sync sync--cta" onClick={() => useUi.getState().openDialog('share')}>
        <Icon name="cloud" size={16} />
        <span>שמור ב-Drive ושתף</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={`sync sync--${sync}`}
      title={err || SYNC_LABEL[sync]}
      disabled={!actionable}
      onClick={() => void saveToDrive({ interactive: true })}
    >
      {icon && <Icon name={icon} size={16} />}
      <span>{actionable ? `${SYNC_LABEL[sync]} · נסה שוב` : SYNC_LABEL[sync]}</span>
    </button>
  )
}

function Toast() {
  const toast = useUi((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useUi.getState().dismissToast(), toast.action ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  return (
    <div className={`toast ${toast.tone === 'error' ? 'toast--error' : ''}`} role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run()
            useUi.getState().dismissToast()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

/** Shown when a shared link needs sign-in or a Picker grant. */
function AccessGate({ outcome, retry }: { outcome: OpenOutcome; retry: (o: { interactive?: boolean; picker?: boolean }) => void }) {
  if (outcome !== 'needs-signin' && outcome !== 'needs-picker') return null
  return (
    <div className="gate" role="alert">
      <p>{outcome === 'needs-signin' ? 'המפה הזו לא פתוחה לצפייה ציבורית. אם היא שותפה איתך, התחבר עם חשבון Google.' : 'כדי לפתוח את המפה, אשר את הגישה לקובץ ב-Google Drive.'}</p>
      <button type="button" className="btn btn--primary" onClick={() => retry(outcome === 'needs-signin' ? { interactive: true } : { picker: true })}>
        {outcome === 'needs-signin' ? 'התחבר עם Google' : 'פתח את הקובץ'}
      </button>
      <button type="button" className="btn" onClick={() => void openLocal(lastMapId()).then(() => retry({}))}>
        למפות שלי
      </button>
    </div>
  )
}

const SNAPS = ['peek', 'half', 'full'] as const

/** Phone bottom-sheet handle: drag to resize (snaps by position and flick velocity), tap to cycle. */
function SheetGrabber({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      className="panel__grabber"
      aria-label="הגדל או הקטן את הפאנל"
      onPointerDown={(e) => {
        const panel = (e.currentTarget as HTMLElement).closest<HTMLElement>('.panel')
        if (!panel || window.innerWidth >= 900) return
        const startY = e.clientY
        const startH = panel.getBoundingClientRect().height
        let lastY = startY
        let lastT = performance.now()
        let v = 0
        let moved = false
        panel.classList.add('is-dragging')
        const move = (ev: PointerEvent) => {
          const now = performance.now()
          v = (ev.clientY - lastY) / Math.max(1, now - lastT)
          lastY = ev.clientY
          lastT = now
          if (Math.abs(ev.clientY - startY) > 6) moved = true
          const h = Math.max(120, Math.min(window.innerHeight - 64, startH - (ev.clientY - startY)))
          panel.style.setProperty('--sheet-h', `${h}px`)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          panel.classList.remove('is-dragging')
          panel.style.removeProperty('--sheet-h')
          if (!moved) return onTap()
          const h = startH - (lastY - startY)
          const heights = { peek: 148, half: window.innerHeight * 0.52, full: window.innerHeight - 72 }
          let target = SNAPS.reduce((best, s) => (Math.abs(heights[s] - h) < Math.abs(heights[best] - h) ? s : best), 'half' as (typeof SNAPS)[number])
          // a flick wins over position
          if (v < -0.6) target = h > heights.half ? 'full' : 'half'
          if (v > 0.6) target = h < heights.half ? 'peek' : 'half'
          useUi.getState().setSheet(target)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTap())}
    >
      <span />
    </button>
  )
}

export default function App() {
  const tab = useUi((s) => s.tab)
  const sheet = useUi((s) => s.sheet)
  const selected = useMapStore((s) => s.selectedFeatureId)
  const readOnly = useMapStore((s) => s.readOnly)
  const [gate, setGate] = useState<{ outcome: OpenOutcome; fileId: string; featureId?: string } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => startAutosave(), [])
  useEffect(() => {
    void storage.requestPersistence()
  }, [])

  // On phones, open the sheet enough to show the editor when something is selected
  useEffect(() => {
    if (selected && useUi.getState().sheet === 'peek') useUi.getState().setSheet('half')
  }, [selected])

  // Routing: #/m/<driveFileId>?f=<featureId> opens a Drive map; otherwise the last local map.
  useEffect(() => {
    const route = async () => {
      const r = parseHash(window.location.hash)
      if (r.driveFileId && driveEnabled()) {
        if (useMapStore.getState().doc.driveFileId === r.driveFileId && ready) {
          if (r.featureId) {
            useMapStore.getState().select(r.featureId)
            useUi.getState().focusOn({ featureId: r.featureId })
          }
          return
        }
        await openLocal(lastMapId()) // something to show underneath
        const outcome = await openDriveMap(r.driveFileId, r.featureId)
        setGate(outcome === 'ok' ? null : { outcome, fileId: r.driveFileId, featureId: r.featureId })
      } else if (!ready) {
        await openLocal(lastMapId())
      }
      setReady(true)
    }
    void route()
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = async (o: { interactive?: boolean; picker?: boolean }) => {
    if (!gate || (!o.interactive && !o.picker)) return setGate(null)
    try {
      const outcome = await openDriveMap(gate.fileId, gate.featureId, o)
      setGate(outcome === 'ok' ? null : { ...gate, outcome })
    } catch (e) {
      useUi.getState().showToast(e instanceof Error ? e.message : 'נכשל', { tone: 'error' })
    }
  }

  const cycleSheet = () => useUi.getState().setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek')
  const tabIndex = TABS.findIndex((t) => t.id === tab)

  return (
    <div className={`app sheet-${sheet} ${readOnly ? 'is-readonly' : ''}`}>
      <main className="stage">
        <MapView />
        <Toolbar />
        {gate && <AccessGate outcome={gate.outcome} retry={retry} />}
      </main>

      <aside className="panel" aria-label="פאנל המפה">
        <SheetGrabber onTap={cycleSheet} />
        <header className="panel__head">
          <div className="panel__title">
            <Title />
            <SyncBadge />
          </div>
          <Menu />
        </header>
        {selected ? (
          <div className="panel__body" data-sort-scroll key={`edit-${selected}`}>
            <FeatureEditor />
          </div>
        ) : (
          <>
            <nav className="tabs" role="tablist" aria-label="תצוגות" style={{ '--i': tabIndex } as React.CSSProperties}>
              <span className="tabs__ink" aria-hidden="true" />
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'is-on' : ''}
                  onClick={() => {
                    useUi.getState().setTab(t.id)
                    if (sheet === 'peek') useUi.getState().setSheet('half')
                  }}
                >
                  <Icon name={t.icon} size={18} /> {t.label}
                </button>
              ))}
            </nav>
            <div className="panel__body" data-sort-scroll role="tabpanel" key={tab}>
              {tab === 'layers' && <LayersPanel />}
              {tab === 'itinerary' && <ItineraryPanel />}
              {tab === 'ai' && <AiPanel />}
            </div>
          </>
        )}
      </aside>
      <Toast />
      <Dialogs />
    </div>
  )
}
