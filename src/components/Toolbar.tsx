import { useEffect, useRef, useState } from 'react'
import { useMapStore, type Tool } from '../store/mapStore'
import { useUi, type BaseLayer } from '../store/uiStore'
import { searchPlaces, type Place } from '../geo/search'
import { Icon, IconButton } from './ui'
import { setVisible } from './LayersPanel'
import { toggleTracking, stopTracking } from '../lib/location'

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select', icon: 'pointer', label: 'בחירה' },
  { id: 'point', icon: 'pin', label: 'הוסף נקודה' },
  { id: 'line', icon: 'line', label: 'צייר קו' },
  { id: 'polygon', icon: 'polygon', label: 'צייר אזור' },
  { id: 'measure', icon: 'ruler', label: 'מדידה' },
]

const BASES: { id: BaseLayer; label: string }[] = [
  { id: 'streets', label: 'רחובות' },
  { id: 'satellite', label: 'לוויין' },
  { id: 'terrain', label: 'שטח' },
]

export function Toolbar() {
  const tool = useMapStore((s) => s.tool)
  const readOnly = useMapStore((s) => s.readOnly)
  const canUndo = useMapStore((s) => s.past.length > 0)
  const canRedo = useMapStore((s) => s.future.length > 0)
  const { setTool, undo, redo } = useMapStore.getState()
  const base = useUi((s) => s.base)

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Escape') {
        setTool('select')
        useMapStore.getState().select(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = useMapStore.getState()
        if (st.selectedFeatureId && !st.readOnly) {
          const id = st.selectedFeatureId
          st.apply((d) => ({ ...d, layers: d.layers.map((l) => ({ ...l, features: l.features.filter((f) => f.properties.id !== id) })) }))
          useUi.getState().showToast('הפריט נמחק', { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTool, undo, redo])

  return (
    <div className="toolbar" role="toolbar" aria-label="כלים">
      <SearchBox />
      <div className="toolbar__group">
        {!readOnly &&
          TOOLS.map((t) => (
            <IconButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} onClick={() => setTool(tool === t.id && t.id !== 'select' ? 'select' : t.id)} />
          ))}
        {readOnly && <IconButton icon="ruler" label="מדידה" active={tool === 'measure'} onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')} />}
      </div>
      {!readOnly && (
        <div className="toolbar__group">
          <IconButton icon="undo" label="בטל (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <IconButton icon="redo" label="בצע שוב" onClick={redo} disabled={!canRedo} />
        </div>
      )}
      <div className="toolbar__group">
        <LocateButton />
        <LayerToggles />
        <IconButton icon="target" label="הצג את כל המפה" onClick={() => useUi.getState().focusOn({ all: true })} />
        <label className="base-select" title="סוג מפה">
          <Icon name="layers" />
          <select value={base} onChange={(e) => useUi.getState().setBase(e.target.value as BaseLayer)} aria-label="סוג מפה">
            {BASES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function LocateButton() {
  const tracking = useUi((s) => s.tracking)
  const timer = useRef(0)
  return (
    <button
      type="button"
      className={`icon-btn ${tracking ? 'is-active' : ''}`}
      aria-label={tracking ? 'מרכז על המיקום שלי (לחיצה ארוכה: כבה מעקב)' : 'הצג את המיקום שלי'}
      title={tracking ? 'מרכז על המיקום שלי · לחיצה ארוכה מכבה' : 'הצג את המיקום שלי'}
      aria-pressed={tracking}
      onPointerDown={() => {
        timer.current = window.setTimeout(() => {
          timer.current = 0
          stopTracking()
          useUi.getState().showToast('מעקב המיקום כובה')
        }, 650)
      }}
      onPointerUp={() => {
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = 0
          toggleTracking()
        }
      }}
      onPointerLeave={() => clearTimeout(timer.current)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleTracking())}
    >
      <Icon name="locate" />
    </button>
  )
}

function LayerToggles() {
  const layers = useMapStore((s) => s.doc.layers)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="pop" ref={ref}>
      <IconButton icon="eye" label="הצג או הסתר שכבות" active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="pop__card" role="group" aria-label="שכבות במפה">
          <div className="row">
            <button type="button" className="btn btn--small" onClick={() => setVisible('all', true)}>
              הצג הכל
            </button>
            <button type="button" className="btn btn--small" onClick={() => setVisible('all', false)}>
              הסתר הכל
            </button>
          </div>
          <ul>
            {layers.map((l) => (
              <li key={l.id}>
                <label className="check">
                  <input type="checkbox" checked={l.visible} onChange={(e) => setVisible(l.id, e.target.checked)} />
                  <span className="pop__dot" style={{ background: l.color }} />
                  <span>{l.name}</span>
                  <span className="pop__count">{l.features.length}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SearchBox() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      ctrl.current?.abort()
      ctrl.current = new AbortController()
      try {
        const res = await searchPlaces(query, { viewbox: useUi.getState().mapBounds ?? undefined, signal: ctrl.current.signal })
        setResults(res)
        setError(res.length ? '' : 'לא נמצאו תוצאות')
        setOpen(true)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('החיפוש נכשל. בדוק את החיבור.')
      }
    }, 450)
    return () => clearTimeout(t)
  }, [q])

  const pick = (p: Place) => {
    useUi.getState().setSearchPin(p)
    setOpen(false)
  }

  return (
    <div className="search" role="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && pick(results[0])}
        placeholder="חיפוש מקום, כתובת או קואורדינטות"
        aria-label="חיפוש מקום"
        aria-expanded={open}
        aria-controls="search-results"
      />
      {open && (results.length > 0 || error) && (
        <ul className="search__results" id="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                <strong>{r.name}</strong>
                <span>{r.label}</span>
              </button>
            </li>
          ))}
          {error && !results.length && <li className="search__empty">{error}</li>}
          <li className="search__attr">חיפוש: © OpenStreetMap</li>
        </ul>
      )}
    </div>
  )
}
