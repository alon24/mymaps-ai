/**
 * Phone: one big ➕ button instead of the drawing-tools strip. Opens a short action sheet:
 * a point at the map center / at my location / by tapping, a line, an area, measuring, or search.
 * While a tool is active the button turns into ✕ to go back to normal.
 */
import { useEffect, useRef, useState } from 'react'
import { useMapStore, type Tool } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import { addFeatureToActiveLayer } from './MapView'
import { startTracking } from '../lib/location'
import { Icon } from './ui'

const DRAW: { id: Tool; icon: string; label: string }[] = [
  { id: 'point', icon: 'pin', label: 'הוסף נקודה' },
  { id: 'line', icon: 'line', label: 'צייר קו' },
  { id: 'polygon', icon: 'polygon', label: 'צייר אזור' },
  { id: 'measure', icon: 'ruler', label: 'מדידה' },
]

const pointAt = ([lat, lng]: [number, number]) => addFeatureToActiveLayer({ type: 'Point', coordinates: [Number(lng.toFixed(7)), Number(lat.toFixed(7))] })

export function AddFab() {
  const tool = useMapStore((s) => s.tool)
  const readOnly = useMapStore((s) => s.readOnly)
  const selected = useMapStore((s) => s.selectedFeatureId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (readOnly || selected) return null
  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const busy = tool !== 'select'

  return (
    <div className="fab" ref={ref}>
      {open && (
        <ul className="fab__menu" role="menu" aria-label="הוספה">
          <li>
            <button role="menuitem" onClick={run(() => pointAt(useUi.getState().mapCenter))}>
              <Icon name="target" size={20} /> נקודה במרכז המפה
            </button>
          </li>
          <li>
            <button
              role="menuitem"
              onClick={run(() => {
                const me = useUi.getState().userLocation
                if (me) return void pointAt(me)
                startTracking({ center: true })
                useUi.getState().showToast('מחפש את המיקום שלך… נסה שוב בעוד רגע.')
              })}
            >
              <Icon name="locate" size={20} /> נקודה במיקום שלי
            </button>
          </li>
          {DRAW.map((t) => (
            <li key={t.id}>
              <button role="menuitem" onClick={run(() => useMapStore.getState().setTool(t.id))}>
                <Icon name={t.icon} size={20} /> {t.id === 'point' ? 'נקודה בהקשה על המפה' : t.label}
              </button>
            </li>
          ))}
          <li>
            <button role="menuitem" onClick={run(() => document.querySelector<HTMLInputElement>('.search input')?.focus())}>
              <Icon name="search" size={20} /> חפש מקום
            </button>
          </li>
        </ul>
      )}
      <button
        type="button"
        className={`fab__btn ${busy ? 'is-busy' : ''}`}
        aria-label={busy ? 'חזור למצב רגיל' : 'הוסף'}
        aria-expanded={open}
        onClick={() => (busy ? useMapStore.getState().setTool('select') : setOpen(!open))}
      >
        <Icon name={busy || open ? 'close' : 'plus'} size={28} />
      </button>
    </div>
  )
}
