import { useMemo, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as ops from '../model/ops'
import type { Layer, LayerStyle, MapFeature } from '../model/types'
import { PALETTE } from '../model/types'
import { dayRouteUrls, sequenceNumbers, stopsOf } from '../model/itinerary'
import { formatDistance } from '../geo/measure'
import { startSort } from '../lib/sortable'
import { Icon, IconButton, Swatches } from './ui'
import { featureColor } from './MapView'

/** Show/hide layers. Viewers of shared maps can toggle too (not saved, no undo entry). */
export function setVisible(layerId: string | 'all', visible: boolean) {
  const st = useMapStore.getState()
  const fn = (d: typeof st.doc) =>
    layerId === 'all' ? ops.batch(d, d.layers.map((l) => (x) => ops.setLayerVisible(x, l.id, visible))) : ops.setLayerVisible(d, layerId, visible)
  if (st.readOnly) useMapStore.setState({ doc: fn(st.doc) })
  else st.apply(fn)
}

const TYPE_LABEL = { Point: 'נקודה', LineString: 'קו', Polygon: 'אזור' } as const

export function FeatureRow({ f, layer, number, onOpen }: { f: MapFeature; layer: Layer; number?: number; onOpen: () => void }) {
  const selected = useMapStore((s) => s.selectedFeatureId === f.properties.id)
  const readOnly = useMapStore((s) => s.readOnly)
  const highlighted = useUi((s) => s.highlights.includes(f.properties.id))
  const color = featureColor(f, layer)
  return (
    <li className={`frow ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlight' : ''}`} data-sort-item={f.properties.id}>
      {!readOnly && (
        <span
          className="frow__grip"
          data-sort-handle
          aria-hidden="true"
          onPointerDown={(e) =>
            startSort(e.nativeEvent, e.currentTarget, (r) => useMapStore.getState().apply((d) => ops.placeFeature(d, r.itemId, r.listId, r.index)))
          }
        >
          <Icon name="grip" size={18} />
        </span>
      )}
      <button type="button" className="frow__main" onClick={onOpen}>
        <span className={`frow__mark frow__mark--${f.geometry.type}`} style={{ '--c': color } as React.CSSProperties}>
          {number ?? (f.geometry.type === 'Point' ? f.properties.icon : '')}
        </span>
        <span className="frow__name">{f.properties.name || <em>{TYPE_LABEL[f.geometry.type]} ללא שם</em>}</span>
      </button>
    </li>
  )
}

/** Total distance + Google Maps directions through the layer's points, in order. */
export function RouteInfo({ layer }: { layer: Layer }) {
  if (!ops.hasRoute(layer)) return null
  const stops = stopsOf(layer)
  if (stops.length < 2) return <p className="hint">הוסף לפחות שתי נקודות כדי לראות מסלול.</p>
  const total = stops.reduce((s, x) => s + x.legMeters, 0)
  const urls = dayRouteUrls(stops)
  return (
    <div className="route-info">
      <span>
        {stops.length} עצירות · {formatDistance(total)} בקו אווירי
      </span>
      <div className="row row--wrap">
        {urls.map((u, i) => (
          <a key={u} className="btn btn--small" href={u} target="_blank" rel="noopener noreferrer">
            <Icon name="route" size={16} /> {urls.length > 1 ? `מסלול חלק ${i + 1}` : 'פתח מסלול ב-Google Maps'}
          </a>
        ))}
      </div>
    </div>
  )
}

function LayerMenu({ layer, index, count, onClose }: { layer: Layer; index: number; count: number; onClose: () => void }) {
  const apply = useMapStore((s) => s.apply)
  const focusOn = useUi((s) => s.focusOn)
  const styles: [LayerStyle, string][] = [
    ['individual', 'צבע לכל פריט'],
    ['uniform', 'צבע אחיד'],
    ['numbered', 'מספרים לפי הסדר'],
  ]
  return (
    <div className="layer-menu" role="group" aria-label={`הגדרות ${layer.name}`}>
      <label className="field">
        <span>שם השכבה</span>
        <input defaultValue={layer.name} onBlur={(e) => e.target.value.trim() && e.target.value !== layer.name && apply((d) => ops.renameLayer(d, layer.id, e.target.value.trim()))} />
      </label>
      <fieldset className="field">
        <legend>סגנון</legend>
        <div className="seg">
          {styles.map(([s, label]) => (
            <button key={s} type="button" className={layer.style === s ? 'is-on' : ''} aria-pressed={layer.style === s} onClick={() => apply((d) => ops.setLayerStyle(d, layer.id, { style: s }))}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <span>צבע השכבה {layer.style === 'numbered' ? '(צבע המספרים)' : ''}</span>
        <Swatches value={layer.color} colors={PALETTE} onChange={(c) => apply((d) => ops.setLayerStyle(d, layer.id, { color: c }))} />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(layer.day)}
          onChange={(e) => apply((d) => ops.setLayerDay(d, layer.id, e.target.checked ? { route: true } : null))}
        />
        <span>יום בטיול (עצירות ממוספרות ומסלול)</span>
      </label>
      {layer.day && (
        <label className="field">
          <span>תאריך</span>
          <input type="date" value={layer.day.date ?? ''} onChange={(e) => apply((d) => ops.setLayerDay(d, layer.id, { ...layer.day!, date: e.target.value || undefined }))} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={ops.hasRoute(layer)} onChange={(e) => apply((d) => ops.setLayerRoute(d, layer.id, e.target.checked))} />
        <span>מסלול בין המקומות לפי הסדר</span>
      </label>
      <RouteInfo layer={layer} />
      <div className="row row--wrap">
        <button type="button" className="btn" onClick={() => focusOn({ layerId: layer.id })} disabled={!layer.features.length}>
          <Icon name="target" size={18} /> התמקד בשכבה
        </button>
        <button type="button" className="btn" disabled={index === 0} onClick={() => apply((d) => ops.moveLayer(d, layer.id, index - 1))}>
          העבר למעלה
        </button>
        <button type="button" className="btn" disabled={index === count - 1} onClick={() => apply((d) => ops.moveLayer(d, layer.id, index + 1))}>
          העבר למטה
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            if (layer.features.length && !confirm(`למחוק את "${layer.name}" ואת ${layer.features.length} הפריטים שבה?`)) return
            apply((d) => ops.removeLayer(d, layer.id))
            onClose()
            useUi.getState().showToast(`השכבה "${layer.name}" נמחקה`, { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
          }}
        >
          <Icon name="trash" size={18} /> מחק שכבה
        </button>
      </div>
    </div>
  )
}

export function LayersPanel() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const activeLayerId = useMapStore((s) => s.activeLayerId)
  const { apply, setActiveLayer, select } = useMapStore.getState()
  const focusOn = useUi((s) => s.focusOn)
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const numbers = useMemo(() => sequenceNumbers(doc), [doc])
  const q = filter.trim().toLowerCase()
  const matches = (f: MapFeature) => !q || f.properties.name.toLowerCase().includes(q) || f.properties.description.toLowerCase().includes(q)

  const open = (f: MapFeature) => {
    select(f.properties.id)
    focusOn({ featureId: f.properties.id })
  }

  return (
    <div className="layers">
      <div className="layers__tools">
        <label className="search-field">
          <Icon name="search" size={18} />
          <input type="search" placeholder="סינון פריטים במפה" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="סינון פריטים" />
        </label>
        {!readOnly && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              const l = ops.createLayer('שכבה חדשה', [], { color: ops.nextLayerColor(doc) })
              apply((d) => ops.addLayer(d, l))
              setActiveLayer(l.id)
              setMenuFor(l.id)
            }}
          >
            <Icon name="plus" size={18} /> שכבה
          </button>
        )}
      </div>

      {doc.layers.length === 0 && <p className="empty">אין שכבות. הוסף שכבה כדי להתחיל לסמן מקומות.</p>}

      {doc.layers.map((layer, i) => {
        const visible = layer.features.filter(matches)
        const isCollapsed = collapsed.has(layer.id) && !q
        return (
          <section key={layer.id} className={`layer ${layer.id === activeLayerId && !readOnly ? 'is-active' : ''}`} style={{ '--c': layer.color } as React.CSSProperties}>
            <header className="layer__head">
              <IconButton
                icon={layer.visible ? 'eye' : 'eyeOff'}
                label={layer.visible ? 'הסתר שכבה' : 'הצג שכבה'}
                onClick={() => setVisible(layer.id, !layer.visible)}
              />
              <button
                type="button"
                className="layer__name"
                onClick={() => {
                  if (!readOnly) setActiveLayer(layer.id)
                  setCollapsed((c) => {
                    const n = new Set(c)
                    if (layer.id === activeLayerId || readOnly) {
                      if (n.has(layer.id)) n.delete(layer.id)
                      else n.add(layer.id)
                    }
                    return n
                  })
                }}
                aria-expanded={!isCollapsed}
              >
                <span className="layer__title">
                  {layer.day ? <Icon name="calendar" size={16} /> : ops.hasRoute(layer) ? <Icon name="route" size={16} /> : null} {layer.name}
                </span>
                <span className="layer__meta">
                  {layer.features.length} פריטים{layer.id === activeLayerId && !readOnly ? ' · פריטים חדשים יתווספו כאן' : ''}
                </span>
              </button>
              {!readOnly && <IconButton icon="more" label={`הגדרות שכבה ${layer.name}`} active={menuFor === layer.id} onClick={() => setMenuFor(menuFor === layer.id ? null : layer.id)} />}
            </header>
            {menuFor === layer.id && <LayerMenu layer={layer} index={i} count={doc.layers.length} onClose={() => setMenuFor(null)} />}
            {!isCollapsed && (
              <ul className="frows" data-sort-list={layer.id}>
                {visible.map((f) => (
                  <FeatureRow key={f.properties.id} f={f} layer={layer} number={numbers.get(f.properties.id)} onOpen={() => open(f)} />
                ))}
                {layer.features.length === 0 && <li className="frows__empty">{readOnly ? 'השכבה ריקה' : 'גרור לכאן פריטים, או הוסף מהמפה'}</li>}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
