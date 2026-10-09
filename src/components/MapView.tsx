import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import { useMapStore } from '../store/mapStore'
import { useUi, type BaseLayer } from '../store/uiStore'
import * as ops from '../model/ops'
import type { Layer, MapFeature, MapGeometry } from '../model/types'
import { sequenceNumbers } from '../model/itinerary'
import { bounds as geomBounds, formatArea, formatDistance, pathLength, polygonArea } from '../geo/measure'

const BASES: Record<BaseLayer, { url: string; attribution: string; maxZoom: number }> = {
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Effective color of a feature given its layer style. */
export const featureColor = (f: MapFeature, layer: Layer) => (layer.style === 'individual' ? f.properties.color : layer.color)

function pinIcon(color: string, label: string, opts: { selected: boolean; highlighted: boolean; numbered: boolean; drop?: boolean; pop?: boolean }) {
  const cls = ['pin', opts.selected && 'pin--selected', opts.highlighted && 'pin--highlight', opts.numbered && 'pin--num', opts.drop && 'pin--drop', opts.pop && 'pin--pop']
    .filter(Boolean)
    .join(' ')
  const size = opts.selected ? 40 : 32
  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="${cls}" style="--pin:${esc(color)}"><svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z"/></svg><span>${esc(label)}</span></div>`,
    iconSize: [size, size * 1.31],
    iconAnchor: [size / 2, size * 1.31],
    popupAnchor: [0, -size * 1.2],
    tooltipAnchor: [0, -size * 0.8],
  })
}

/** Height of the mobile bottom sheet covering the map (0 on desktop). */
const sheetCover = () => {
  if (window.innerWidth >= 900) return 0
  const panel = document.querySelector('.panel')
  return panel ? Math.min(panel.getBoundingClientRect().height, window.innerHeight * 0.7) : 0
}

/** Fly so that `latlng` is centered in the visible part of the map (above the sheet). */
function flyToVisible(map: L.Map, latlng: L.LatLngExpression, zoom: number) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cover = sheetCover()
  const target = cover ? map.unproject(map.project(latlng, zoom).add([0, cover / 2]), zoom) : latlng
  map.flyTo(target, zoom, { duration: reduce ? 0 : 0.6, animate: !reduce })
}

const toLatLngs = (coords: number[][]) => coords.map((c) => L.latLng(c[1], c[0]))

function geometryFromLayer(layer: L.Layer): MapGeometry | null {
  const gj = (layer as L.Polyline).toGeoJSON?.() as GeoJSON.Feature | undefined
  const g = gj?.geometry
  if (!g) return null
  if (g.type === 'Point' || g.type === 'LineString' || g.type === 'Polygon') return g
  if (g.type === 'MultiLineString') return { type: 'LineString', coordinates: g.coordinates[0] }
  if (g.type === 'MultiPolygon') return { type: 'Polygon', coordinates: g.coordinates[0] }
  return null
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseRef = useRef<L.TileLayer | null>(null)
  const drawnRef = useRef<L.LayerGroup | null>(null)
  const extrasRef = useRef<L.LayerGroup | null>(null)
  const measureRef = useRef<{ pts: L.LatLng[]; group: L.LayerGroup }>({ pts: [], group: L.layerGroup() })
  // For one-shot animations: which pins existed in the previous render, and the previous selection
  const seenRef = useRef<{ docId: string; ids: Set<string>; selected: string | null }>({ docId: '', ids: new Set(), selected: null })
  const [measureText, setMeasureText] = useState('')

  const doc = useMapStore((s) => s.doc)
  const selectedId = useMapStore((s) => s.selectedFeatureId)
  const tool = useMapStore((s) => s.tool)
  const readOnly = useMapStore((s) => s.readOnly)
  const highlights = useUi((s) => s.highlights)
  const focus = useUi((s) => s.focus)
  const base = useUi((s) => s.base)
  const searchPin = useUi((s) => s.searchPin)
  const userLocation = useUi((s) => s.userLocation)
  const userAccuracy = useUi((s) => s.userAccuracy)

  // ---------- init ----------
  useEffect(() => {
    if (!el.current || mapRef.current) return
    const map = L.map(el.current, { zoomControl: false, attributionControl: true, tapHold: true } as L.MapOptions).setView([31.77, 35.21], 8)
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    map.attributionControl.setPrefix(false)
    map.pm.setLang('he' as never)
    map.pm.setGlobalOptions({ snappable: false, continueDrawing: false } as never)
    drawnRef.current = L.layerGroup().addTo(map)
    extrasRef.current = L.layerGroup().addTo(map)
    measureRef.current.group.addTo(map)
    mapRef.current = map

    const report = () => {
      const c = map.getCenter()
      const b = map.getBounds()
      useUi.getState().setView([c.lat, c.lng], [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    map.on('moveend', report)
    report()

    // Long-press (touch) / right-click: offer to add a point here
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      if (useMapStore.getState().readOnly) return
      const box = document.createElement('div')
      box.className = 'popup-actions'
      box.innerHTML = `<div class="popup-coords">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</div>`
      const btn = document.createElement('button')
      btn.className = 'btn btn--primary'
      btn.textContent = 'הוסף נקודה כאן'
      btn.onclick = () => {
        addPointAt(e.latlng)
        map.closePopup()
      }
      box.appendChild(btn)
      L.popup({ closeButton: true }).setLatLng(e.latlng).setContent(box).openOn(map)
    })

    // Click on empty map
    map.on('click', (e: L.LeafletMouseEvent) => {
      const st = useMapStore.getState()
      if (st.tool === 'point') addPointAt(e.latlng)
      else if (st.tool === 'measure') {
        measureRef.current.pts.push(e.latlng)
        drawMeasure()
      } else if (st.tool === 'select') st.select(null)
    })

    map.on('pm:create', (e: { layer: L.Layer }) => {
      const geometry = geometryFromLayer(e.layer)
      map.removeLayer(e.layer)
      useMapStore.getState().setTool('select')
      if (geometry) addFeatureToActiveLayer(geometry)
    })

    map.on('locationfound', (e: L.LocationEvent) => {
      useUi.getState().setUserLocation([e.latlng.lat, e.latlng.lng])
    })
    map.on('locationerror', () => useUi.getState().showToast('לא ניתן לקבל מיקום. בדוק שהרשאת המיקום מופעלת.', { tone: 'error' }))

    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addPointAt(latlng: L.LatLng) {
    if (useMapStore.getState().readOnly) return
    addFeatureToActiveLayer({ type: 'Point', coordinates: [Number(latlng.lng.toFixed(7)), Number(latlng.lat.toFixed(7))] })
    useMapStore.getState().setTool('select')
  }

  function drawMeasure() {
    const { pts, group } = measureRef.current
    group.clearLayers()
    if (!pts.length) {
      setMeasureText('')
      return
    }
    pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#17302a', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(group))
    if (pts.length > 1) L.polyline(pts, { color: '#17302a', weight: 3, dashArray: '6 6' }).addTo(group)
    const coords = pts.map((p) => [p.lng, p.lat])
    let text = formatDistance(pathLength(coords))
    if (pts.length > 2) {
      L.polygon(pts, { color: '#17302a', weight: 0, fillOpacity: 0.08, interactive: false }).addTo(group)
      text += ` · שטח ${formatArea(polygonArea([[...coords, coords[0]]]))}`
    }
    setMeasureText(text)
  }

  // ---------- tools ----------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.pm.disableDraw()
    if (tool === 'line') map.pm.enableDraw('Line', { finishOn: 'dblclick', templineStyle: { color: '#17302a' }, hintlineStyle: { color: '#17302a', dashArray: [5, 5] } } as never)
    if (tool === 'polygon') map.pm.enableDraw('Polygon', { finishOn: 'dblclick', templineStyle: { color: '#17302a' }, hintlineStyle: { color: '#17302a', dashArray: [5, 5] } } as never)
    if (tool !== 'measure') {
      measureRef.current.pts = []
      drawMeasure()
    }
    el.current?.classList.toggle('map--crosshair', tool !== 'select')
    if (tool !== 'select') map.closePopup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // ---------- base layer ----------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    baseRef.current?.remove()
    const b = BASES[base]
    baseRef.current = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, crossOrigin: true }).addTo(map)
    baseRef.current.bringToBack()
  }, [base])

  // ---------- render features ----------
  useEffect(() => {
    const group = drawnRef.current
    const map = mapRef.current
    if (!group || !map) return
    group.clearLayers()
    const numbers = sequenceNumbers(doc)
    const hl = new Set(highlights)
    const seen = seenRef.current
    const sameDoc = seen.docId === doc.id
    const nextIds = new Set<string>()

    for (const layer of doc.layers) {
      if (!layer.visible) continue
      // route line for trip days
      if (ops.hasRoute(layer)) {
        const pts = layer.features.filter((f) => f.geometry.type === 'Point').map((f) => f.geometry.coordinates as number[])
        if (pts.length > 1)
          L.polyline(toLatLngs(pts), { color: layer.color, weight: 4, opacity: 0.75, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(group)
      }
      for (const f of layer.features) {
        const id = f.properties.id
        const selected = id === selectedId
        const color = featureColor(f, layer)
        const editable = selected && !readOnly && tool === 'select'
        let lyr: L.Layer
        const g = f.geometry
        if (g.type === 'Point') {
          const n = numbers.get(id)
          const label = n !== undefined ? String(n) : f.properties.icon ?? ''
          nextIds.add(id)
          const marker = L.marker([g.coordinates[1], g.coordinates[0]], {
            icon: pinIcon(color, label, {
              selected,
              highlighted: hl.has(id),
              numbered: n !== undefined,
              drop: sameDoc && !seen.ids.has(id),
              pop: selected && seen.selected !== id,
            }),
            draggable: editable,
            autoPan: true,
            zIndexOffset: selected ? 1000 : hl.has(id) ? 500 : 0,
            keyboard: true,
            title: f.properties.name,
            alt: f.properties.name || 'נקודה',
          })
          marker.on('dragend', () => {
            const ll = marker.getLatLng()
            useMapStore.getState().apply((d) => ops.updateFeature(d, id, { geometry: { type: 'Point', coordinates: [Number(ll.lng.toFixed(7)), Number(ll.lat.toFixed(7))] } }))
          })
          lyr = marker
        } else if (g.type === 'LineString') {
          lyr = L.polyline(toLatLngs(g.coordinates), { color, weight: selected ? 6 : 4, opacity: 0.9, bubblingMouseEvents: false })
        } else {
          lyr = L.polygon(g.coordinates.map(toLatLngs), { color, weight: selected ? 4 : 2, fillColor: color, fillOpacity: selected ? 0.35 : 0.22, bubblingMouseEvents: false })
        }
        if (f.properties.name) (lyr as L.Path).bindTooltip(esc(f.properties.name), { direction: 'top', className: 'feature-tip' })
        lyr.on('click', (e: L.LeafletMouseEvent) => {
          if (useMapStore.getState().tool !== 'select') return
          L.DomEvent.stopPropagation(e)
          useMapStore.getState().select(id)
          useUi.getState().setSheet(useUi.getState().sheet === 'peek' ? 'half' : useUi.getState().sheet)
        })
        lyr.addTo(group)
        if (g.type !== 'Point' && sameDoc && !seen.ids.has(id)) {
          const el = (lyr as L.Path).getElement?.()
          el?.classList.add('shape--new')
        }
        nextIds.add(id)
        if (editable && g.type !== 'Point') {
          ;(lyr as L.Polyline).pm.enable({ allowSelfIntersection: true, snappable: false } as never)
          lyr.on('pm:update', () => {
            const geometry = geometryFromLayer(lyr)
            if (geometry) useMapStore.getState().apply((d) => ops.updateFeature(d, id, { geometry }))
          })
        }
      }
    }
    seenRef.current = { docId: doc.id, ids: nextIds, selected: selectedId }
  }, [doc, selectedId, highlights, readOnly, tool])

  // ---------- extras: search pin, user location ----------
  useEffect(() => {
    const group = extrasRef.current
    const map = mapRef.current
    if (!group || !map) return
    group.clearLayers()
    if (userLocation) {
      if (userAccuracy > 15)
        L.circle(userLocation, { radius: userAccuracy, color: '#2b7de9', weight: 1, fillColor: '#2b7de9', fillOpacity: 0.1, interactive: false }).addTo(group)
      L.circleMarker(userLocation, { radius: 8, color: '#fff', weight: 3, fillColor: '#2b7de9', fillOpacity: 1, interactive: false })
        .bindTooltip('המיקום שלי', { direction: 'top' })
        .addTo(group)
    }
    if (searchPin) {
      const box = document.createElement('div')
      box.className = 'popup-actions'
      box.innerHTML = `<strong>${esc(searchPin.name)}</strong><div class="popup-coords">${esc(searchPin.label)}</div>`
      if (!useMapStore.getState().readOnly) {
        const btn = document.createElement('button')
        btn.className = 'btn btn--primary'
        btn.textContent = 'הוסף למפה'
        btn.onclick = () => {
          addFeatureToActiveLayer({ type: 'Point', coordinates: [searchPin.lng, searchPin.lat] }, { name: searchPin.name, description: searchPin.label })
          useUi.getState().setSearchPin(null)
        }
        box.appendChild(btn)
      }
      const m = L.circleMarker([searchPin.lat, searchPin.lng], { radius: 9, color: '#17302a', weight: 3, fillColor: '#f2c14e', fillOpacity: 1 }).addTo(group)
      m.bindPopup(box).openPopup()
      m.on('popupclose', () => useUi.getState().searchPin === searchPin && useUi.getState().setSearchPin(null))
      flyToVisible(map, [searchPin.lat, searchPin.lng], Math.max(map.getZoom(), 15))
    }
  }, [searchPin, userLocation, userAccuracy])

  // ---------- focus requests ----------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    const { doc: d } = useMapStore.getState()
    const fly = (b: L.LatLngBounds, maxZoom = 16) => {
      if (!b.isValid()) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      map.flyToBounds(b, { paddingTopLeft: [48, 120], paddingBottomRight: [48, 48 + sheetCover()], maxZoom, duration: reduce ? 0 : 0.6, animate: !reduce })
    }
    if (focus.point) {
      flyToVisible(map, focus.point, Math.max(map.getZoom(), 15))
      return
    }
    if (focus.featureId) {
      const found = ops.findFeature(d, focus.featureId)
      if (found) fly(L.latLngBounds(geomBounds(found.feature.geometry)))
    } else {
      const layers = focus.layerId ? d.layers.filter((l) => l.id === focus.layerId) : d.layers.filter((l) => l.visible)
      const b = L.latLngBounds([])
      for (const l of layers) for (const f of l.features) b.extend(L.latLngBounds(geomBounds(f.geometry)))
      fly(b, 15)
    }
  }, [focus])

  return (
    <div className="map-shell">
      <div ref={el} className="map" dir="ltr" role="application" aria-label="מפה" />
      {tool === 'measure' && (
        <div className="map-hint" role="status">
          {measureText || 'הקש על המפה כדי למדוד מרחק. שלוש נקודות ומעלה מציגות גם שטח.'}
          {measureText && (
            <button
              className="btn btn--small"
              onClick={() => {
                measureRef.current.pts = []
                drawMeasure()
              }}
            >
              נקה
            </button>
          )}
        </div>
      )}
      {(tool === 'line' || tool === 'polygon') && (
        <div className="map-hint" role="status">
          {tool === 'line' ? 'הקש כדי להוסיף נקודות לקו.' : 'הקש כדי להוסיף פינות לאזור.'}
          <button className="btn btn--small" onClick={() => finishDraw(mapRef.current, tool)}>
            סיים
          </button>
          <button className="btn btn--small" onClick={() => undoVertex(mapRef.current, tool)}>
            בטל נקודה
          </button>
        </div>
      )}
      {tool === 'point' && <div className="map-hint" role="status">הקש על המפה כדי להוסיף נקודה.</div>}
    </div>
  )
}

/**
 * Add a feature to the active layer (creating a layer if there is none) without opening the editor:
 * it gets a default name, its row flashes in the list, and a toast offers to edit it.
 */
export function addFeatureToActiveLayer(geometry: MapGeometry, props: { name?: string; description?: string } = {}): string {
  const st = useMapStore.getState()
  let layerId = st.activeLayerId
  if (!st.doc.layers.some((l) => l.id === layerId)) {
    const l = ops.createLayer('שכבה ללא שם')
    st.apply((d) => ops.addLayer(d, l))
    layerId = l.id
  }
  const layer = useMapStore.getState().doc.layers.find((l) => l.id === layerId)
  const f = ops.createFeature(geometry, { color: layer?.color, name: props.name ?? ops.defaultName(layer, geometry.type), description: props.description })
  useMapStore.getState().apply((d) => ops.addFeature(d, layerId, f))
  const ui = useUi.getState()
  ui.setJustAdded(f.properties.id)
  ui.showToast(`"${f.properties.name}" נוסף לשכבה "${layer?.name ?? ''}"`, {
    action: { label: 'ערוך', run: () => useMapStore.getState().select(f.properties.id) },
  })
  return f.properties.id
}

/* Geoman exposes these on the draw handlers; they're stable across 2.x. */
type DrawHandler = { _finishShape?: () => void; _removeLastVertex?: () => void; _layer?: L.Polyline }
const handler = (map: L.Map | null, tool: 'line' | 'polygon') =>
  (map?.pm.Draw as unknown as Record<string, DrawHandler> | undefined)?.[tool === 'line' ? 'Line' : 'Polygon']

function finishDraw(map: L.Map | null, tool: 'line' | 'polygon') {
  const h = handler(map, tool)
  const count = h?._layer?.getLatLngs().length ?? 0
  if (count < (tool === 'line' ? 2 : 3)) {
    useUi.getState().showToast(tool === 'line' ? 'קו צריך לפחות שתי נקודות' : 'אזור צריך לפחות שלוש נקודות')
    return
  }
  h?._finishShape?.()
}

function undoVertex(map: L.Map | null, tool: 'line' | 'polygon') {
  handler(map, tool)?._removeLastVertex?.()
}
