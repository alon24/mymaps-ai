import { useEffect, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as ops from '../model/ops'
import { ICONS, PALETTE } from '../model/types'
import { describeGeometry } from '../geo/measure'
import { googleSearchUrl, navigateUrl } from '../model/itinerary'
import { distanceFromMe } from '../lib/location'
import { stripTags } from '../io/itineraryHtml'
import { Icon, IconButton, RenameField, Swatches } from './ui'
import { searchPlaces, type Place } from '../geo/search'

const linkify = (text: string) =>
  text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )

/** Directions from the user's current location + Google Maps search for the place. */
function PlaceLinks({ name, coords }: { name: string; coords: number[] }) {
  const at = { lat: coords[1], lng: coords[0] }
  return (
    <div className="row row--wrap place-links">
      <a className="btn btn--primary" href={navigateUrl(at)} target="_blank" rel="noopener noreferrer">
        <Icon name="nav" size={18} /> ניווט מהמיקום שלי
      </a>
      <a className="btn" href={googleSearchUrl(name, at)} target="_blank" rel="noopener noreferrer">
        <Icon name="search" size={18} /> חפש ב-Google Maps
      </a>
    </div>
  )
}

/** Move a point to a searched address (or pasted coordinates). Dragging the pin also works. */
export function LocationField({ featureId }: { featureId: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const search = async () => {
    if (q.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      const r = await searchPlaces(q, { viewbox: useUi.getState().mapBounds ?? undefined, limit: 5 })
      setResults(r)
      if (!r.length) setError('לא נמצאה כתובת כזו')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'החיפוש נכשל')
    } finally {
      setBusy(false)
    }
  }
  const moveTo = (pl: Place) => {
    useMapStore.getState().apply((d) =>
      ops.updateFeature(d, featureId, { geometry: { type: 'Point', coordinates: [Number(pl.lng.toFixed(7)), Number(pl.lat.toFixed(7))] } }),
    )
    useUi.getState().focusOn({ featureId })
    useUi.getState().showToast('המיקום עודכן', { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
    setResults(null)
    setQ('')
  }
  return (
    <div className="field location">
      <span>תיקון מיקום</span>
      <form
        className="location__search"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setResults(null)
          }}
          placeholder="כתובת או קואורדינטות"
          aria-label="כתובת חדשה"
          enterKeyHint="search"
        />
        <button type="submit" className="btn btn--small" disabled={busy || q.trim().length < 2}>
          {busy ? '…' : 'חפש'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && results.length > 0 && (
        <ul className="location__results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" onClick={() => moveTo(r)}>
                <strong>{r.name}</strong>
                <span>{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">או גרור את הסיכה על המפה.</p>
    </div>
  )
}

export function FeatureEditor() {
  const doc = useMapStore((s) => s.doc)
  const id = useMapStore((s) => s.selectedFeatureId)
  const readOnly = useMapStore((s) => s.readOnly)
  const me = useUi((s) => s.userLocation)
  const { apply, select } = useMapStore.getState()
  const found = id ? ops.findFeature(doc, id) : undefined
  // Local drafts so typing doesn't create an undo step per keystroke
  const [renaming, setRenaming] = useState(false)
  const [desc, setDesc] = useState('')
  useEffect(() => setRenaming(false), [id])
  useEffect(() => {
    setDesc(found ? stripTags(found.feature.properties.description) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, found?.feature.properties.description])

  if (!found) return null
  const { feature: f, layer } = found
  const p = f.properties
  const isPoint = f.geometry.type === 'Point'
  const commit = (patch: Partial<typeof p>) => apply((d) => ops.updateFeature(d, p.id, patch))

  if (readOnly) {
    return (
      <article className="editor" aria-label="פרטי פריט">
        <header className="editor__head">
          <h2>{p.icon} {p.name || 'ללא שם'}</h2>
          <IconButton icon="close" label="סגור" onClick={() => select(null)} />
        </header>
        {p.description && <p className="editor__desc">{linkify(stripTags(p.description))}</p>}
        <p className="editor__meta">{[layer.name, describeGeometry(f.geometry), isPoint ? distanceFromMe(me, f.geometry.coordinates as number[]) : ''].filter(Boolean).join(' · ')}</p>
        {isPoint && <PlaceLinks name={p.name} coords={f.geometry.coordinates as number[]} />}
      </article>
    )
  }

  return (
    <article className="editor" aria-label="עריכת פריט">
      <header className="editor__head">
        {renaming ? (
          <RenameField label="שם" value={p.name} onSave={(v) => commit({ name: v })} onDone={() => setRenaming(false)} />
        ) : (
          <h2 className="editor__title">
            <button type="button" onClick={() => setRenaming(true)} title="שנה שם">
              {p.icon} {p.name || 'ללא שם'} <Icon name="edit" size={16} />
            </button>
          </h2>
        )}
        <IconButton
          icon="trash"
          label="מחק פריט"
          onClick={() => {
            apply((d) => ops.removeFeature(d, p.id))
            useUi.getState().showToast(`"${p.name || 'הפריט'}" נמחק`, { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
          }}
        />
        <IconButton icon="close" label="סיום עריכה" onClick={() => select(null)} />
      </header>
      <textarea
        className="editor__desc-input"
        value={desc}
        placeholder="תיאור, קישורים, הערות"
        aria-label="תיאור"
        rows={3}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => desc !== stripTags(p.description) && commit({ description: desc })}
      />
      <p className="editor__meta">{[describeGeometry(f.geometry), isPoint ? distanceFromMe(me, f.geometry.coordinates as number[]) : ''].filter(Boolean).join(' · ')}</p>
      {isPoint && <PlaceLinks name={p.name} coords={f.geometry.coordinates as number[]} />}
      {isPoint && <LocationField key={p.id} featureId={p.id} />}

      <div className="field">
        <span>צבע{layer.style !== 'individual' ? ' (השכבה מוגדרת לצבע אחיד — שנה בהגדרות השכבה)' : ''}</span>
        <Swatches value={p.color} colors={PALETTE} onChange={(c) => commit({ color: c })} />
      </div>

      {isPoint && (
        <div className="field">
          <span>סמל{layer.style === 'numbered' ? ' (בשכבה ממוספרת מוצג מספר)' : ''}</span>
          <div className="icons" role="radiogroup" aria-label="סמל">
            {ICONS.map((ic) => (
              <button
                key={ic || 'none'}
                type="button"
                role="radio"
                aria-checked={(p.icon ?? '') === ic}
                className={`icon-choice ${(p.icon ?? '') === ic ? 'is-on' : ''}`}
                onClick={() => commit({ icon: ic || undefined })}
                aria-label={ic || 'ללא סמל'}
              >
                {ic || '•'}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>שכבה</span>
        <select value={layer.id} onChange={(e) => apply((d) => ops.moveFeatureToLayer(d, p.id, e.target.value))}>
          {doc.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      {!isPoint && <p className="hint">גרור את הנקודות הלבנות על המפה כדי לשנות את הצורה.</p>}
    </article>
  )
}
