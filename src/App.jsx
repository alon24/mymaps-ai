import { useState } from 'react'
import Settings from './components/Settings.jsx'
import MapView from './components/MapView.jsx'
import AiPanel from './components/AiPanel.jsx'
import { loadSettings, saveSettings, isConfigured } from './lib/settings.js'
import { extractMapId, myMapsViewUrl, myMapsEmbedUrl } from './lib/mapId.js'
import { fetchKml } from './lib/api.js'
import { parseKml } from './lib/kml.js'

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(() => !isConfigured(loadSettings()))
  const [link, setLink] = useState('')
  const [map, setMap] = useState(null)
  const [aiGeojson, setAiGeojson] = useState(null)
  const [view, setView] = useState('google') // 'google' | 'interactive'
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  function handleSave(next) {
    setSettings(saveSettings(next))
    setShowSettings(false)
  }

  async function loadMap(e) {
    e.preventDefault()
    setError('')
    const mid = extractMapId(link)
    if (!mid) {
      setError('לא נמצא מזהה מפה. הדבק קישור ל-My Maps שמכיל mid=')
      return
    }
    setStatus('טוען מפה…')
    try {
      const parsed = parseKml(await fetchKml(settings, mid))
      setMap({ mid, ...parsed })
      setAiGeojson(null)
      setView('google')
    } catch (err) {
      setError(err.message)
    } finally {
      setStatus('')
    }
  }

  return (
    <div className="app">
      <header>
        <h1>MyMaps AI</h1>
        {!showSettings && (
          <button type="button" className="secondary" onClick={() => setShowSettings(true)}>הגדרות</button>
        )}
      </header>

      {showSettings ? (
        <Settings
          initial={settings}
          onSave={handleSave}
          onCancel={isConfigured(settings) ? () => setShowSettings(false) : null}
        />
      ) : (
        <main>
          <form className="card row" onSubmit={loadMap}>
            <input
              aria-label="קישור למפה"
              dir="ltr"
              placeholder="https://www.google.com/maps/d/viewer?mid=..."
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button type="submit">טעינה</button>
          </form>
          {status && <p role="status">{status}</p>}
          {error && <p role="alert" className="error">{error}</p>}
          {map && (
            <p className="map-info">
              <strong>{map.name || 'מפה'}</strong> · {map.geojson.features.length} פריטים ·{' '}
              <a href={myMapsViewUrl(map.mid)} target="_blank" rel="noreferrer">פתח ב-My Maps</a>
            </p>
          )}
          {map && (
            <div className="tabs" role="tablist" aria-label="תצוגת מפה">
              <button type="button" role="tab" aria-selected={view === 'google'} onClick={() => setView('google')}>
                My Maps (Google)
              </button>
              <button type="button" role="tab" aria-selected={view === 'interactive'} onClick={() => setView('interactive')}>
                תצוגה עם שכבת AI
              </button>
            </div>
          )}
          {map && view === 'google' ? (
            <iframe
              className="map"
              title="Google My Maps"
              src={myMapsEmbedUrl(map.mid)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <MapView geojson={map?.geojson} aiGeojson={aiGeojson} />
          )}
          <AiPanel
            settings={settings}
            map={map}
            onLayer={(g) => {
              setAiGeojson(g)
              setView('interactive') // AI layers can only be drawn on our own map
            }}
          />
        </main>
      )}
    </div>
  )
}
