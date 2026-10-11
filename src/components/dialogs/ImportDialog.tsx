import { useRef, useState } from 'react'
import { useMapStore } from '../../store/mapStore'
import { useUi } from '../../store/uiStore'
import * as ops from '../../model/ops'
import * as storage from '../../lib/storage'
import { importFile, SUPPORTED_EXTENSIONS, type PendingAddress } from '../../io'
import { importKml } from '../../io/kml'
import { geocode } from '../../geo/search'
import { extractMyMapsId, fetchMyMapsKml } from '../../lib/api'
import { isConfigured, loadSettings } from '../../lib/settings'
import { openLocal } from '../../lib/driveSync'
import type { Layer } from '../../model/types'
import { Icon } from '../ui'

// ---------------- Import ----------------
export function ImportDialog() {
  const [mode, setMode] = useState<'current' | 'new'>('current')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const readOnly = useMapStore((s) => s.readOnly)
  const close = () => useUi.getState().openDialog(null)

  async function geocodePending(pending: PendingAddress[], layer: Layer): Promise<Layer> {
    const features = [...layer.features]
    const max = Math.min(pending.length, 150)
    for (let i = 0; i < max; i++) {
      setStatus(`מאתר כתובות ${i + 1}/${max}…`)
      const hit = await geocode(pending[i].address).catch(() => null)
      if (hit)
        features.push(
          ops.createFeature({ type: 'Point', coordinates: [hit.lng, hit.lat] }, { name: pending[i].name, description: [pending[i].description, pending[i].address].filter(Boolean).join('\n'), color: layer.color }),
        )
    }
    return { ...layer, features }
  }

  async function finish(title: string | undefined, layers: Layer[]) {
    const count = layers.reduce((n, l) => n + l.features.length, 0)
    if (mode === 'new' || readOnly) {
      const d = { ...ops.createMap(title ?? 'מפה מיובאת'), layers }
      await storage.saveMap(d)
      await openLocal(d.id)
    } else {
      useMapStore.getState().apply((d) => ops.batch(d, layers.map((l) => (x) => ops.addLayer(x, l))))
      useUi.getState().focusOn({ all: true })
    }
    useUi.getState().showToast(`יובאו ${count} פריטים ב-${layers.length} שכבות`)
    close()
  }

  async function onFiles(files: FileList | File[]) {
    setError('')
    const all: Layer[] = []
    let title: string | undefined
    try {
      for (const file of Array.from(files)) {
        setStatus(`קורא את ${file.name}…`)
        const r = await importFile(file)
        title ??= r.title ?? file.name.replace(/\.[^.]+$/, '')
        const layers = [...r.layers]
        if (r.pending.length) layers[0] = await geocodePending(r.pending, layers[0])
        all.push(...layers)
      }
      await finish(title, all)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל')
    } finally {
      setStatus('')
    }
  }

  async function fromMyMaps() {
    setError('')
    const mid = extractMyMapsId(link)
    if (!mid) return setError('לא זוהה קישור של Google My Maps. הדבק קישור שמכיל mid=')
    const settings = loadSettings()
    if (!isConfigured(settings)) return setError('ייבוא מקישור דורש Worker. הגדר אותו בהגדרות.')
    try {
      setStatus('מוריד מ-Google My Maps…')
      const r = importKml(await fetchMyMapsKml(settings, mid))
      await finish(r.title, r.layers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל')
    } finally {
      setStatus('')
    }
  }

  return (
    <div className="import">
      {!readOnly && (
        <fieldset className="seg" aria-label="לאן לייבא">
          <button type="button" className={mode === 'current' ? 'is-on' : ''} aria-pressed={mode === 'current'} onClick={() => setMode('current')}>
            לתוך המפה הנוכחית
          </button>
          <button type="button" className={mode === 'new' ? 'is-on' : ''} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            כמפה חדשה
          </button>
        </fieldset>
      )}
      <div
        className={`drop ${drag ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void onFiles(e.dataTransfer.files)
        }}
      >
        <Icon name="upload" size={28} />
        <p>גרור קבצים לכאן או</p>
        <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>
          בחר קובץ
        </button>
        <p className="hint">KML, KMZ, GeoJSON, CSV, GPX. קבצי CSV צריכים עמודות lat/lng, WKT או כתובת.</p>
        <input ref={fileRef} type="file" hidden multiple accept={SUPPORTED_EXTENSIONS.join(',')} onChange={(e) => e.target.files && void onFiles(e.target.files)} />
      </div>
      <div className="field">
        <span>או ייבוא מקישור של Google My Maps (משותף לכל מי שיש לו קישור)</span>
        <div className="row">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.google.com/maps/d/…?mid=…" dir="ltr" />
          <button type="button" className="btn" onClick={fromMyMaps} disabled={!link.trim()}>
            ייבא
          </button>
        </div>
      </div>
      {status && <p className="status" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

export default ImportDialog
