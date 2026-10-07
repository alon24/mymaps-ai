import { useEffect } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'

// react-leaflet's GeoJSON ignores data changes, so remount when the object changes
const ids = new WeakMap()
let nextId = 0
function keyFor(obj) {
  if (!ids.has(obj)) ids.set(obj, ++nextId)
  return ids.get(obj)
}

function FitBounds({ a, b }) {
  const map = useMap()
  useEffect(() => {
    const layers = [a, b].filter(Boolean).filter((d) => d.features.length)
    if (!layers.length) return
    const bounds = L.featureGroup(layers.map((d) => L.geoJSON(d))).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
  }, [a, b, map])
  return null
}

function layerProps(color) {
  return {
    style: { color, weight: 3 },
    // Circle markers avoid Leaflet's bundled marker-image path issues
    pointToLayer: (_f, latlng) =>
      L.circleMarker(latlng, { radius: 7, color, fillColor: color, fillOpacity: 0.8 }),
    onEachFeature: (f, layer) => {
      const { name, description } = f.properties ?? {}
      if (name || description) {
        const el = document.createElement('div')
        const b = document.createElement('strong')
        b.textContent = name ?? ''
        el.append(b)
        if (description) {
          const p = document.createElement('p')
          p.textContent = description.value ?? String(description)
          el.append(p)
        }
        layer.bindPopup(el)
      }
    },
  }
}

export default function MapView({ geojson, aiGeojson }) {
  return (
    <MapContainer center={[31.77, 35.21]} zoom={7} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {geojson && <GeoJSON key={`map-${keyFor(geojson)}`} data={geojson} {...layerProps('#1a73e8')} />}
      {aiGeojson && <GeoJSON key={`ai-${keyFor(aiGeojson)}`} data={aiGeojson} {...layerProps('#e8710a')} />}
      <FitBounds a={geojson} b={aiGeojson} />
    </MapContainer>
  )
}
