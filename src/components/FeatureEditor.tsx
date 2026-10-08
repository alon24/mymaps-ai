import { useEffect, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as ops from '../model/ops'
import { ICONS, PALETTE } from '../model/types'
import { describeGeometry } from '../geo/measure'
import { googleSearchUrl, navigateUrl } from '../model/itinerary'
import { distanceFromMe } from '../lib/location'
import { stripTags } from '../io/itineraryHtml'
import { Icon, IconButton, Swatches } from './ui'

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

export function FeatureEditor() {
  const doc = useMapStore((s) => s.doc)
  const id = useMapStore((s) => s.selectedFeatureId)
  const readOnly = useMapStore((s) => s.readOnly)
  const me = useUi((s) => s.userLocation)
  const { apply, select } = useMapStore.getState()
  const found = id ? ops.findFeature(doc, id) : undefined
  // Local drafts so typing doesn't create an undo step per keystroke
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  useEffect(() => {
    setName(found?.feature.properties.name ?? '')
    setDesc(found ? stripTags(found.feature.properties.description) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, found?.feature.properties.name, found?.feature.properties.description])

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
        <input
          className="editor__name"
          value={name}
          placeholder="שם"
          aria-label="שם"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== p.name && commit({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          autoFocus={!p.name}
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
      {isPoint && <PlaceLinks name={name || p.name} coords={f.geometry.coordinates as number[]} />}

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

      <div className="row row--wrap">
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            apply((d) => ops.removeFeature(d, p.id))
            useUi.getState().showToast(`"${p.name || 'הפריט'}" נמחק`, { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
          }}
        >
          <Icon name="trash" size={18} /> מחק
        </button>
      </div>
      {!isPoint && <p className="hint">גרור את הנקודות הלבנות על המפה כדי לשנות את הצורה.</p>}
      {isPoint && <p className="hint">גרור את הסמן על המפה כדי להזיז אותו.</p>}
    </article>
  )
}
