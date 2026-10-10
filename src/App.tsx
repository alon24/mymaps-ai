import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapView } from './components/MapView'
import { Toolbar } from './components/Toolbar'
import { LayersPanel } from './components/LayersPanel'
import { ItineraryPanel } from './components/ItineraryPanel'
import { AiPanel } from './components/AiPanel'
import { FeatureEditor } from './components/FeatureEditor'
import { Dialogs } from './components/Dialogs'
import { Icon, IconButton, RenameField } from './components/ui'
import { useLongPress } from './lib/longPress'
import { useMapStore } from './store/mapStore'
import { useUi, type PanelTab } from './store/uiStore'
import * as ops from './model/ops'
import { parseHash } from './lib/appBase'
import * as storage from './lib/storage'
import { lastMapId, openDriveMap, openLocal, refreshCurrentFromDrive, saveToDrive, signIn, startAutosave, uploadLocalMaps, type OpenOutcome } from './lib/driveSync'
import { driveEnabled } from './env'
import { isSignedIn, onAuthChange, signOut, wasSignedIn } from './google/auth'
import { versionLabel } from './version'

function useSignedIn() {
  const [signed, setSigned] = useState(isSignedIn())
  useEffect(() => onAuthChange(setSigned), [])
  return signed
}

/** Header buttons: my maps (always) and Google sign-in (when Drive is configured). */
function HeaderActions() {
  const signed = useSignedIn()
  return (
    <>
      <IconButton icon="globe" label="המפות שלי" onClick={() => useUi.getState().openDialog('maps')} />
      {driveEnabled() && !signed && (
        <button type="button" className="btn btn--small signin" onClick={() => void signIn()}>
          <Icon name="cloud" size={16} /> התחבר
        </button>
      )}
    </>
  )
}

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

/** Map title. Rename: long press (touch) or click (mouse/keyboard); a plain tap does nothing. */
function Title() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const [editing, setEditing] = useState(false)
  const press = useLongPress(() => !readOnly && setEditing(true), { onClick: () => !readOnly && setEditing(true) })
  if (editing && !readOnly) {
    return (
      <RenameField
        className="title-rename"
        label="שם המפה"
        value={doc.title}
        onSave={(v) => useMapStore.getState().apply((d) => ops.setTitle(d, v))}
        onDone={() => setEditing(false)}
      />
    )
  }
  return (
    <h1 className="title">
      <button type="button" {...press} disabled={readOnly} title={readOnly ? undefined : 'לחיצה ארוכה לשינוי שם'}>
        {doc.title || 'מפה ללא שם'}
      </button>
    </h1>
  )
}

function Menu() {
  const [open, setOpen] = useState(false)
  const signed = useSignedIn()
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
          {driveEnabled() && (
            <li>
              {signed ? (
                <button role="menuitem" onClick={() => { setOpen(false); void signOut().then(() => useUi.getState().showToast('התנתקת מ-Google')) }}>
                  <Icon name="cloudOff" size={18} /> התנתק
                </button>
              ) : (
                <button role="menuitem" onClick={() => { setOpen(false); void signIn() }}>
                  <Icon name="cloud" size={18} /> התחבר עם Google
                </button>
              )}
            </li>
          )}
          <li><button role="menuitem" onClick={() => go('about')}><Icon name="info" size={18} /> אודות</button></li>
          <li className="menu__version">גרסה <bdi dir="ltr">{versionLabel()}</bdi></li>
        </ul>
      )}
    </div>
  )
}

function SyncBadge() {
  const sync = useUi((s) => s.sync)
  const err = useUi((s) => s.syncError)
  const icon = sync === 'offline' || sync === 'error' || sync === 'needs-auth' ? 'cloudOff' : sync === 'local' || sync === 'view-only' ? '' : 'cloud'
  const signed = useSignedIn()
  const actionable = sync === 'needs-auth' || sync === 'error'
  if (sync === 'local' && driveEnabled() && !signed) {
    // The header's "התחבר" button is the call to action; here we only state where the map lives
    return (
      <span className="sync sync--local" title="התחבר כדי לשמור ב-Google Drive">
        <span>שמור רק במכשיר הזה</span>
      </span>
    )
  }
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
      onClick={() => void (sync === 'needs-auth' && !signed ? signIn() : saveToDrive({ interactive: true }))}
    >
      {icon && <Icon name={icon} size={16} />}
      <span>{actionable ? `${SYNC_LABEL[sync]} · נסה שוב` : SYNC_LABEL[sync]}</span>
    </button>
  )
}

/**
 * While a modal <dialog> is open, everything outside it is inert (visible but not clickable),
 * so the toast is rendered inside the open dialog; otherwise at the app root.
 */
function Toast() {
  const toast = useUi((s) => s.toast)
  const dialog = useUi((s) => s.dialog)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useUi.getState().dismissToast(), toast.action ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  const host = dialog ? document.querySelector<HTMLDialogElement>('dialog[open]') : null
  const node = (
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
  return host ? createPortal(node, host) : node
}

/** Shown when a shared link needs sign-in or a Picker grant. */
function AccessGate({ outcome, retry }: { outcome: OpenOutcome; retry: (o: { interactive?: boolean; picker?: boolean }) => void }) {
  if (outcome !== 'needs-signin' && outcome !== 'needs-picker') return null
  return (
    <div className="gate" role="alert">
      <p>
        {outcome === 'needs-picker'
          ? 'כדי לפתוח את המפה, אשר את הגישה לקובץ ב-Google Drive.'
          : wasSignedIn()
            ? 'ההתחברות ל-Google פגה. התחבר שוב כדי לפתוח את המפה.'
            : 'המפה הזו לא פתוחה לצפייה ציבורית. אם היא שלך או שותפה איתך, התחבר עם חשבון Google.'}
      </p>
      <button type="button" className="btn btn--primary" onClick={() => retry(outcome === 'needs-signin' ? { interactive: true } : { picker: true })}>
        {outcome === 'needs-signin' ? 'התחבר עם Google' : 'פתח את הקובץ'}
      </button>
      <button type="button" className="btn" onClick={() => void openLocal(lastMapId()).then(() => retry({}))}>
        למפות שלי
      </button>
    </div>
  )
}

let startupSynced = false

const SNAPS = ['peek', 'half', 'full'] as const

/**
 * Phone bottom sheet: drag to resize (snaps by position and flick velocity).
 * Started from the grabber or from the panel header; `onTap` runs when the finger didn't move.
 */
function startSheetDrag(e: React.PointerEvent, onTap?: () => void) {
  const panel = (e.currentTarget as HTMLElement).closest<HTMLElement>('.panel')
  if (!panel || window.innerWidth >= 900 || e.pointerType === 'mouse' && e.button !== 0) return
  const startY = e.clientY
  const startH = panel.getBoundingClientRect().height
  let lastY = startY
  let lastT = performance.now()
  let v = 0
  let moved = false
  const move = (ev: PointerEvent) => {
    const now = performance.now()
    v = (ev.clientY - lastY) / Math.max(1, now - lastT)
    lastY = ev.clientY
    lastT = now
    if (!moved && Math.abs(ev.clientY - startY) <= 10) return // small jitter is still a tap / long press
    if (!moved) panel.classList.add('is-dragging')
    moved = true
    const h = Math.max(120, Math.min(window.innerHeight - 64, startH - (ev.clientY - startY)))
    panel.style.setProperty('--sheet-h', `${h}px`)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    panel.classList.remove('is-dragging')
    panel.style.removeProperty('--sheet-h')
    if (!moved) return onTap?.()
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
}

function SheetGrabber({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      className="panel__grabber"
      aria-label="הגדל או הקטן את הפאנל"
      onPointerDown={(e) => startSheetDrag(e, onTap)}
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
      // Signed in from an earlier visit: pull the latest copy and move any local-only maps to Drive
      if (isSignedIn() && !startupSynced) {
        startupSynced = true
        await refreshCurrentFromDrive().catch(() => undefined)
        void uploadLocalMaps().catch(() => undefined)
      }
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
      </main>

      <aside className="panel" aria-label="פאנל המפה">
        <SheetGrabber onTap={cycleSheet} />
        <header
          className="panel__head"
          onPointerDown={(e) => {
            // The whole header drags the sheet, except its buttons (the title still drags; it renames on long press)
            const t = e.target as HTMLElement
            if (t.closest('input, .menu, .icon-btn, .btn, .sync, .rename')) return
            startSheetDrag(e)
          }}
        >
          <div className="panel__title">
            <Title />
            <SyncBadge />
          </div>
          <HeaderActions />
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
      {/* Outside the stage so it sits above the panel / bottom sheet too */}
      {gate && <AccessGate outcome={gate.outcome} retry={retry} />}
      <Toast />
      <Dialogs />
    </div>
  )
}
