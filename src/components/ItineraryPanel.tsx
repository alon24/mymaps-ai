import { useMemo } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as ops from '../model/ops'
import { dayRouteUrls, navigateUrl, tripDays } from '../model/itinerary'
import { formatDistance } from '../geo/measure'
import { formatDate, itineraryHtml } from '../io/itineraryHtml'
import { downloadBlob } from '../io'
import { startSort } from '../lib/sortable'
import { EmptyArt, Icon } from './ui'
import { appBase } from '../lib/appBase'
import { distanceFromMe } from '../lib/location'
import { googleSearchUrl } from '../model/itinerary'

export function ItineraryPanel() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const selectedId = useMapStore((s) => s.selectedFeatureId)
  const me = useUi((s) => s.userLocation)
  const { apply, select } = useMapStore.getState()
  const focusOn = useUi((s) => s.focusOn)
  const days = useMemo(() => tripDays(doc), [doc])
  const unscheduled = useMemo(
    () => doc.layers.filter((l) => !l.day).flatMap((l) => l.features.filter((f) => f.geometry.type === 'Point').map((f) => ({ f, layer: l }))),
    [doc],
  )

  const addDay = () => {
    const n = days.length + 1
    const last = days.at(-1)?.layer.day?.date
    let date: string | undefined
    if (last) {
      const d = new Date(`${last}T12:00:00`)
      d.setDate(d.getDate() + 1)
      date = d.toISOString().slice(0, 10)
    }
    const l = ops.createLayer(`יום ${n}`, [], { color: ops.nextLayerColor(doc), style: 'numbered', day: { route: true, ...(date ? { date } : {}) } })
    apply((d) => ops.addLayer(d, l))
    useMapStore.getState().setActiveLayer(l.id)
  }

  const exportHtml = () => {
    const html = itineraryHtml(doc, { appBase: appBase() })
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${(doc.title || 'trip').replace(/[\\/:*?"<>|]+/g, '_')} - מסלול.html`)
    useUi.getState().showToast(doc.driveFileId ? 'קובץ המסלול הורד' : 'קובץ המסלול הורד. שמור את המפה ב-Drive כדי שיהיו בו גם קישורים חזרה למפה.')
  }

  const onDrop = (r: { itemId: string; listId: string; index: number }) => {
    if (r.listId === '__unscheduled') return
    apply((d) => ops.placeFeature(d, r.itemId, r.listId, r.index))
  }

  const sortHandle = () =>
    readOnly ? null : (
      <span className="frow__grip" data-sort-handle aria-hidden="true" onPointerDown={(e) => startSort(e.nativeEvent, e.currentTarget, onDrop)}>
        <Icon name="grip" size={18} />
      </span>
    )

  return (
    <div className="itinerary">
      <div className="row row--wrap itinerary__actions">
        {!readOnly && (
          <button type="button" className="btn" onClick={addDay}>
            <Icon name="plus" size={18} /> הוסף יום
          </button>
        )}
        {days.length > 0 && (
          <>
            <button type="button" className="btn" onClick={exportHtml}>
              <Icon name="download" size={18} /> מסלול לטיול (HTML)
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              הדפס
            </button>
          </>
        )}
      </div>

      {!days.length && (
        <div className="empty welcome">
          <EmptyArt />
          <p><strong>אין עדיין ימי טיול.</strong></p>
          <p>הוסף יום, או סמן שכבה קיימת כ"יום בטיול" בהגדרות השכבה. אפשר גם לבקש מה-AI לחלק את המקומות לימים.</p>
        </div>
      )}

      {days.map((day) => {
        const routes = dayRouteUrls(day.stops)
        return (
          <section key={day.layer.id} className="day" style={{ '--c': day.layer.color } as React.CSSProperties}>
            <header className="day__head">
              <button type="button" className="day__title" onClick={() => focusOn({ layerId: day.layer.id })}>
                <strong>{day.layer.name}</strong>
                <span>
                  {[formatDate(day.layer.day?.date), `${day.stops.length} עצירות`, day.totalMeters ? formatDistance(day.totalMeters) : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
              {routes.map((u, i) => (
                <a key={u} className="btn btn--small" href={u} target="_blank" rel="noopener noreferrer">
                  <Icon name="route" size={16} /> {routes.length > 1 ? `חלק ${i + 1}` : 'מסלול'}
                </a>
              ))}
            </header>
            <ol className="stops" data-sort-list={day.layer.id} data-sort-scroll>
              {day.layer.features.map((f) => {
                const stop = day.stops.find((s) => s.feature === f)
                return (
                  <li key={f.properties.id} className={`stop ${selectedId === f.properties.id ? 'is-selected' : ''}`} data-sort-item={f.properties.id}>
                    {sortHandle()}
                    <button
                      type="button"
                      className="stop__main"
                      onClick={() => {
                        select(f.properties.id)
                        focusOn({ featureId: f.properties.id })
                      }}
                    >
                      <span className="stop__num">{stop ? stop.number : '–'}</span>
                      <span className="stop__text">
                        {stop && (stop.legMeters > 0 || me) && (
                          <span className="stop__leg">
                            {[stop.legMeters > 0 ? `${formatDistance(stop.legMeters)} מהקודמת` : '', distanceFromMe(me, [stop.lng, stop.lat])].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        <span className="stop__name">
                          {f.properties.icon} {f.properties.name || 'ללא שם'}
                        </span>
                      </span>
                    </button>
                    {stop && (
                      <a className="icon-btn" href={googleSearchUrl(f.properties.name, stop)} target="_blank" rel="noopener noreferrer" aria-label={`חפש את ${f.properties.name} ב-Google Maps`} title="חפש ב-Google Maps">
                        <Icon name="search" size={18} />
                      </a>
                    )}
                    {stop && (
                      <a className="icon-btn" href={navigateUrl(stop)} target="_blank" rel="noopener noreferrer" aria-label={`ניווט אל ${f.properties.name}`} title="ניווט">
                        <Icon name="nav" size={18} />
                      </a>
                    )}
                  </li>
                )
              })}
              {!day.layer.features.length && <li className="frows__empty">{readOnly ? 'אין עצירות' : 'גרור לכאן מקומות'}</li>}
            </ol>
          </section>
        )
      })}

      {!readOnly && days.length > 0 && unscheduled.length > 0 && (
        <details className="unscheduled" open={unscheduled.length <= 12}>
          <summary>מקומות שעוד לא שובצו ({unscheduled.length})</summary>
          <p className="hint">גרור מקום לאחד הימים.</p>
          <ul className="stops" data-sort-list="__unscheduled">
            {unscheduled.map(({ f, layer }) => (
              <li key={f.properties.id} className="stop" data-sort-item={f.properties.id}>
                {sortHandle()}
                <button type="button" className="stop__main" onClick={() => focusOn({ featureId: f.properties.id })}>
                  <span className="stop__num stop__num--muted" style={{ '--c': layer.color } as React.CSSProperties} />
                  <span className="stop__text">
                    <span className="stop__name">{f.properties.icon} {f.properties.name || 'ללא שם'}</span>
                    <span className="stop__leg">{layer.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
