import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import * as ops from '../model/ops'
import * as storage from '../lib/storage'
import { downloadBlob, exportDoc, importFile, SUPPORTED_EXTENSIONS, type ExportFormat, type PendingAddress } from '../io'
import { importKml } from '../io/kml'
import { itineraryHtml } from '../io/itineraryHtml'
import { tripDays } from '../model/itinerary'
import { geocode } from '../geo/search'
import { askAi, extractMyMapsId, fetchMyMapsKml } from '../lib/api'
import { isConfigured, isValidWorkerUrl, loadSettings, saveSettings, type Settings } from '../lib/settings'
import { appBase } from '../lib/appBase'
import { driveEnabled } from '../env'
import * as drive from '../google/drive'
import { getToken, isSignedIn, onAuthChange, signOut } from '../google/auth'
import { deleteDriveMap, openDriveMap, openLocal, resolveConflict, saveToDrive, signIn, uploadLocalMaps } from '../lib/driveSync'
import type { Layer } from '../model/types'
import { APP_COMMIT, APP_VERSION, BUILD_TIME } from '../version'
import { Dialog, Icon } from './ui'

export function Dialogs() {
  const dialog = useUi((s) => s.dialog)
  const close = () => useUi.getState().openDialog(null)
  return (
    <>
      <Dialog open={dialog === 'maps'} onClose={close} title="המפות שלי" wide>
        <MapsDialog />
      </Dialog>
      <Dialog open={dialog === 'import'} onClose={close} title="ייבוא">
        <ImportDialog />
      </Dialog>
      <Dialog open={dialog === 'export'} onClose={close} title="ייצוא">
        <ExportDialog />
      </Dialog>
      <Dialog open={dialog === 'share'} onClose={close} title="שיתוף">
        <ShareDialog />
      </Dialog>
      <Dialog open={dialog === 'settings'} onClose={close} title="הגדרות">
        <SettingsDialog />
      </Dialog>
      <Dialog open={dialog === 'conflict'} onClose={close} title="המפה שונתה במקום אחר">
        <ConflictDialog />
      </Dialog>
      <Dialog open={dialog === 'about'} onClose={close} title="אודות MyMaps AI">
        <AboutDialog />
      </Dialog>
    </>
  )
}

function useSignedIn() {
  const [signed, setSigned] = useState(isSignedIn())
  useEffect(() => onAuthChange(setSigned), [])
  return signed
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ---------------- Maps ----------------
const title = (f: drive.DriveFileMeta) => f.name.replace(/\.mymap\.json$/, '') || 'ללא שם'

function MapsDialog() {
  const currentId = useMapStore((s) => s.doc.id)
  const currentDriveId = useMapStore((s) => s.doc.driveFileId)
  const [local, setLocal] = useState<storage.MapSummary[]>([])
  const [remote, setRemote] = useState<drive.DriveFileMeta[] | null>(null)
  const [user, setUser] = useState<drive.DriveUser | null>(null)
  const [busy, setBusy] = useState(false)
  const signed = useSignedIn()
  const close = () => useUi.getState().openDialog(null)

  const refresh = () => storage.listMaps().then(setLocal)
  const refreshRemote = () =>
    getToken()
      .then((token) => Promise.all([drive.listMaps({ token }), drive.getUser({ token }).catch(() => ({}))]))
      .then(([files, u]) => {
        setRemote(files)
        setUser(u)
      })
      .catch(() => setRemote([]))
  useEffect(() => {
    void refresh()
  }, [])
  useEffect(() => {
    if (signed && driveEnabled()) void refreshRemote()
  }, [signed])

  const localByDrive = new Map(local.filter((m) => m.driveFileId).map((m) => [m.driveFileId!, m]))
  const remoteIds = new Set(remote?.map((f) => f.id) ?? [])
  // When signed in, maps already in Drive are listed there; the device list keeps only the rest
  const deviceOnly = signed && remote ? local.filter((m) => !m.driveFileId || !remoteIds.has(m.driveFileId)) : local

  const afterNew = async (id: string) => {
    await openLocal(id)
    close()
    if (isSignedIn()) void saveToDrive()
  }

  return (
    <div className="maps">
      <div className="row row--wrap">
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => {
            const d = ops.createMap()
            await storage.saveMap(d)
            await afterNew(d.id)
          }}
        >
          <Icon name="plus" size={18} /> מפה חדשה
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const copy = ops.duplicateMap(useMapStore.getState().doc)
            await storage.saveMap(copy)
            await afterNew(copy.id)
            useUi.getState().showToast('נוצר עותק של המפה')
          }}
        >
          שכפל את המפה הנוכחית
        </button>
      </div>

      {driveEnabled() && !signed && (
        <div className="signin-card">
          <p>
            <strong>שמור את המפות ב-Google Drive</strong>
            <br />
            התחבר עם Google, והמפות שלך יישמרו ב-Drive ויופיעו בכל מכשיר שבו תתחבר.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={async () => {
              if (await signIn()) void refresh()
            }}
          >
            <Icon name="cloud" size={18} /> התחבר עם Google
          </button>
        </div>
      )}

      {driveEnabled() && signed && (
        <>
          <div className="account">
            <span>
              <Icon name="cloud" size={16} /> מחובר{user?.emailAddress ? ` כ-${user.emailAddress}` : ' ל-Google Drive'}
            </span>
            <button type="button" className="link-btn" onClick={() => void signOut()}>
              התנתק
            </button>
          </div>
          <h3>ב-Google Drive</h3>
          {remote === null && <p className="hint">טוען…</p>}
          {remote?.length === 0 && <p className="hint">אין עדיין מפות ב-Drive. כל מפה שתערוך תישמר כאן אוטומטית.</p>}
          <ul className="map-list">
            {remote
              ?.slice()
              .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
              .map((f) => {
                const here = localByDrive.get(f.id)
                return (
                  <li key={f.id} className={f.id === currentDriveId ? 'is-current' : ''}>
                    <button
                      type="button"
                      className="map-list__main"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const r = await openDriveMap(f.id, undefined, { interactive: true })
                        setBusy(false)
                        if (r === 'ok') close()
                      }}
                    >
                      <strong>{title(f)}</strong>
                      <span>
                        {here ? `${here.count} פריטים · ` : ''}
                        {when(f.modifiedTime)}
                        {f.ownedByMe === false ? ' · שותפה איתך' : ''}
                      </span>
                    </button>
                    {f.ownedByMe !== false && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`מחק את ${title(f)}`}
                        title="מחק (יועבר לסל של Drive)"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`למחוק את "${title(f)}"?\nהמפה תועבר לסל של Google Drive, ואפשר לשחזר אותה משם במשך 30 יום.`)) return
                          setBusy(true)
                          const ok = await deleteDriveMap(f.id, title(f), () => {
                            void refresh()
                            void refreshRemote()
                          })
                          setBusy(false)
                          if (ok) {
                            setRemote((r) => r?.filter((x) => x.id !== f.id) ?? r)
                            void refresh()
                          }
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    )}
                  </li>
                )
              })}
          </ul>
          <button
            type="button"
            className="btn btn--small"
            onClick={async () => {
              const r = await openDriveMap('', undefined, { picker: true })
              if (r === 'ok') close()
            }}
          >
            פתח קובץ אחר מ-Drive…
          </button>
        </>
      )}

      {deviceOnly.length > 0 && (
        <>
          <h3>{signed ? 'רק במכשיר הזה' : 'במכשיר הזה'}</h3>
          {signed && deviceOnly.some((m) => !m.driveFileId) && (
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const n = await uploadLocalMaps()
                setBusy(false)
                useUi.getState().showToast(n ? `${n} מפות נשמרו ב-Drive` : 'אין מפות עם תוכן להעלאה')
                void refresh()
                void refreshRemote()
              }}
            >
              <Icon name="upload" size={16} /> העלה הכל ל-Drive
            </button>
          )}
          <ul className="map-list">
            {deviceOnly.map((m) => (
              <li key={m.id} className={m.id === currentId ? 'is-current' : ''}>
                <button
                  type="button"
                  className="map-list__main"
                  onClick={async () => {
                    await openLocal(m.id)
                    close()
                  }}
                >
                  <strong>{m.title || 'ללא שם'}</strong>
                  <span>
                    {m.count} פריטים · {when(m.updatedAt)} {m.driveFileId ? '· ב-Drive' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`מחק את ${m.title} מהמכשיר`}
                  title="מחק מהמכשיר"
                  disabled={m.id === currentId}
                  onClick={async () => {
                    if (!confirm(`למחוק את "${m.title}" מהמכשיר?${m.driveFileId ? ' העותק ב-Drive יישאר.' : ''}`)) return
                    await storage.deleteMap(m.id)
                    void refresh()
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <BackupBar onRestored={() => void refresh()} />
    </div>
  )
}

/** Backup all local maps to one file / restore from it. Shown where the maps are listed. */
function BackupBar({ onRestored }: { onRestored: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])
  return (
    <div className="backup">
      <p className="hint">
        {driveEnabled()
          ? 'גיבוי לקובץ: כל המפות שבמכשיר הזה, גם אלה שלא ב-Drive.'
          : 'המפות נשמרות רק בדפדפן הזה. ניקוי נתוני הדפדפן ימחק אותן, לכן כדאי לגבות מדי פעם.'}
        {persisted ? ' הדפדפן סימן את האחסון כקבוע.' : ''}
      </p>
      <div className="row row--wrap">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const backup = await storage.exportAll()
            downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `mymaps-backup-${backup.createdAt.slice(0, 10)}.json`)
            useUi.getState().showToast(`גובו ${backup.maps.length} מפות`)
          }}
        >
          <Icon name="download" size={18} /> גבה את כל המפות
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> שחזר מגיבוי
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              const r = await storage.importAll(JSON.parse(await file.text()), ops.migrate)
              useUi.getState().showToast(`שוחזרו ${r.added} מפות, עודכנו ${r.updated}`)
              onRestored()
            } catch (err) {
              useUi.getState().showToast(err instanceof Error ? err.message : 'השחזור נכשל', { tone: 'error' })
            }
          }}
        />
      </div>
    </div>
  )
}

// ---------------- Import ----------------
function ImportDialog() {
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

// ---------------- Export ----------------
function ExportDialog() {
  const doc = useMapStore((s) => s.doc)
  const hasDays = tripDays(doc).length > 0
  const run = async (f: ExportFormat) => {
    const { blob, filename } = await exportDoc(doc, f)
    downloadBlob(blob, filename)
  }
  const formats: { f: ExportFormat; title: string; text: string }[] = [
    { f: 'kml', title: 'KML', text: 'לייבוא ל-Google My Maps ול-Google Earth' },
    { f: 'kmz', title: 'KMZ', text: 'KML דחוס' },
    { f: 'geojson', title: 'GeoJSON', text: 'לכלי GIS ומפתחים' },
    { f: 'csv', title: 'CSV', text: 'לאקסל ול-Google Sheets' },
  ]
  return (
    <div className="export">
      <ul className="export__list">
        {formats.map((x) => (
          <li key={x.f}>
            <button type="button" className="export__item" onClick={() => void run(x.f)}>
              <Icon name="download" />
              <span>
                <strong>{x.title}</strong>
                <span>{x.text}</span>
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="export__item"
            disabled={!hasDays}
            onClick={() => downloadBlob(new Blob([itineraryHtml(doc, { appBase: appBase() })], { type: 'text/html;charset=utf-8' }), `${doc.title || 'trip'} - מסלול.html`)}
          >
            <Icon name="route" />
            <span>
              <strong>מסלול לטיול (HTML)</strong>
              <span>{hasDays ? 'דף אחד עם הימים, העצירות וקישורי ניווט. עובד גם בלי אינטרנט.' : 'זמין כשיש במפה ימי טיול'}</span>
            </span>
          </button>
        </li>
      </ul>
      <p className="hint">כדי להעביר ל-Google My Maps: ייצא KML, ואז ב-My Maps בחר "ייבוא" בשכבה חדשה.</p>
    </div>
  )
}

// ---------------- Share ----------------
function ShareDialog() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const signed = useSignedIn()
  const [perms, setPerms] = useState<drive.Permission[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'writer' | 'reader'>('writer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileId = doc.driveFileId
  const link = fileId ? drive.shareUrl(appBase(), fileId) : ''
  const linkOn = perms?.some((p) => p.type === 'anyone') ?? false

  const load = async () => {
    if (!fileId || !signed) return
    try {
      setPerms(await drive.listPermissions({ token: await getToken() }, fileId))
    } catch (e) {
      setPerms([])
      setError(e instanceof Error ? e.message : '')
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, signed])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: doc.title, url: link })
      else {
        await navigator.clipboard.writeText(link)
        useUi.getState().showToast('הקישור הועתק')
      }
    } catch {
      /* cancelled */
    }
  }

  if (!driveEnabled()) {
    return (
      <div className="share">
        <p>שיתוף עובד דרך Google Drive, וצריך להגדיר אותו פעם אחת באפליקציה (מזהה OAuth של Google). ההוראות בקובץ README של הפרויקט.</p>
        <p className="hint">בינתיים אפשר לשתף קובץ: ייצא KML או מסלול HTML ושלח אותו.</p>
        <button type="button" className="btn" onClick={() => useUi.getState().openDialog('export')}>
          פתח ייצוא
        </button>
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="share">
        <p>זו מפה ששותפה איתך לצפייה.</p>
        {link && (
          <button type="button" className="btn btn--primary" onClick={copy}>
            העתק קישור
          </button>
        )}
      </div>
    )
  }

  if (!fileId) {
    return (
      <div className="share">
        <p>כדי לשתף, שמור את המפה ב-Google Drive שלך. היא תישמר בתיקייה "MyMaps AI" ותתעדכן אוטומטית.</p>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => guard(async () => void (await saveToDrive({ interactive: true })))}>
          <Icon name="cloud" size={18} /> שמור ב-Drive
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    )
  }

  if (!signed) {
    return (
      <div className="share">
        <p>התחבר ל-Google כדי לנהל את השיתוף.</p>
        <button type="button" className="btn btn--primary" onClick={() => getToken(true).catch((e) => setError(e.message))}>
          התחבר ל-Google
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="share">
      <section>
        <label className="check">
          <input
            type="checkbox"
            checked={linkOn}
            disabled={busy || perms === null}
            onChange={(e) => guard(async () => drive.setLinkSharing({ token: await getToken() }, fileId, e.target.checked))}
          />
          <span>כל מי שיש לו את הקישור יכול לצפות (בלי להתחבר)</span>
        </label>
        <div className="row">
          <input readOnly value={link} dir="ltr" aria-label="קישור למפה" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={copy}>
            {typeof navigator.share === 'function' ? 'שתף' : 'העתק'}
          </button>
        </div>
        {!linkOn && <p className="hint">כשהאפשרות כבויה, הקישור עובד רק לאנשים שהוזמנו.</p>}
      </section>

      <section>
        <h3>הזמנת אנשים</h3>
        <form
          className="row row--wrap"
          onSubmit={(e) => {
            e.preventDefault()
            if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('כתובת מייל לא תקינה')
            void guard(async () => {
              await drive.shareWith({ token: await getToken() }, fileId, email, role, `${doc.title}\n${link}`)
              setEmail('')
              useUi.getState().showToast('ההזמנה נשלחה')
            })
          }}
        >
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" dir="ltr" aria-label="מייל" required />
          <select value={role} onChange={(e) => setRole(e.target.value as 'writer' | 'reader')} aria-label="הרשאה">
            <option value="writer">עריכה</option>
            <option value="reader">צפייה</option>
          </select>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            הזמן
          </button>
        </form>
        <ul className="people">
          {perms
            ?.filter((p) => p.type !== 'anyone')
            .map((p) => (
              <li key={p.id}>
                <span>
                  <strong>{p.displayName || p.emailAddress}</strong>
                  <span>{p.role === 'owner' ? 'בעלים' : p.role === 'writer' ? 'עריכה' : 'צפייה'}</span>
                </span>
                {p.role !== 'owner' && (
                  <button type="button" className="icon-btn" aria-label={`הסר את ${p.emailAddress}`} disabled={busy} onClick={() => guard(async () => drive.removePermission({ token: await getToken() }, fileId, p.id))}>
                    <Icon name="close" size={18} />
                  </button>
                )}
              </li>
            ))}
        </ul>
        <p className="hint">מוזמנים פותחים את הקישור ונכנסים עם חשבון Google. בפעם הראשונה Google תבקש מהם לאשר את הקובץ.</p>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// ---------------- Settings ----------------
function SettingsDialog() {
  const [s, setS] = useState<Settings>(loadSettings)
  const [test, setTest] = useState('')
  const signed = useSignedIn()
  const valid = !s.workerUrl || isValidWorkerUrl(s.workerUrl)
  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault()
        setS(saveSettings(s))
        useUi.getState().showToast('ההגדרות נשמרו')
        useUi.getState().openDialog(null)
      }}
    >
      <h3>עוזר AI</h3>
      <label className="field">
        <span>כתובת ה-Worker</span>
        <input value={s.workerUrl} onChange={(e) => setS({ ...s, workerUrl: e.target.value })} placeholder="https://mymaps-ai-worker.<you>.workers.dev" dir="ltr" aria-invalid={!valid} />
      </label>
      {!valid && <p className="error">הכתובת צריכה להתחיל ב-https://</p>}
      <label className="field">
        <span>APP_TOKEN {driveEnabled() ? '(לא חובה, משתמשים מחוברים עם Google לא צריכים)' : ''}</span>
        <input type="password" value={s.appToken} onChange={(e) => setS({ ...s, appToken: e.target.value })} autoComplete="off" dir="ltr" />
      </label>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={!isConfigured(s)}
          onClick={async () => {
            setTest('בודק…')
            try {
              await askAi(s, 'Reply with {"reply":"ok"}', [{ role: 'user', content: 'ping' }])
              setTest('החיבור עובד ✓')
            } catch (e) {
              setTest(e instanceof Error ? e.message : 'נכשל')
            }
          }}
        >
          בדוק חיבור
        </button>
        {test && <span role="status">{test}</span>}
      </div>

      {driveEnabled() && (
        <>
          <h3>Google Drive</h3>
          {signed ? (
            <button type="button" className="btn" onClick={() => void signOut()}>
              התנתק מ-Google
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => getToken(true).catch((e) => useUi.getState().showToast(e.message, { tone: 'error' }))}>
              התחבר ל-Google
            </button>
          )}
        </>
      )}

      <div className="row dialog__foot">
        <button type="submit" className="btn btn--primary" disabled={!valid}>
          שמור
        </button>
      </div>
      <p className="hint">מפות נשמרות במכשיר הזה{driveEnabled() ? ' וב-Google Drive שלך' : ''}. ה-AI מקבל את תוכן המפה כדי לענות.</p>
    </form>
  )
}

// ---------------- Conflict ----------------
function ConflictDialog() {
  return (
    <div className="conflict">
      <p>מישהו (או מכשיר אחר) שמר את המפה ב-Drive אחרי השמירה האחרונה שלך. מה לעשות?</p>
      <div className="stack">
        <button type="button" className="btn btn--primary" onClick={() => void resolveConflict('copy')}>
          שמור את הגרסה שלי כמפה חדשה
        </button>
        <button type="button" className="btn" onClick={() => void resolveConflict('theirs')}>
          טען את הגרסה מ-Drive (השינויים שלי יאבדו)
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void resolveConflict('mine')}>
          דרוס עם הגרסה שלי
        </button>
      </div>
    </div>
  )
}

// ---------------- About ----------------
async function checkForUpdate(): Promise<void> {
  const ui = useUi.getState()
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg) {
      location.reload()
      return
    }
    await reg.update()
    ui.showToast('טוען את הגרסה האחרונה…')
    // autoUpdate activates a new worker right away; reload to run it
    setTimeout(() => location.reload(), 800)
  } catch {
    location.reload()
  }
}

function AboutDialog() {
  const signed = useSignedIn()
  const [email, setEmail] = useState('')
  useEffect(() => {
    if (!signed || !driveEnabled()) return setEmail('')
    getToken()
      .then((token) => drive.getUser({ token }))
      .then((u) => setEmail(u.emailAddress ?? ''))
      .catch(() => setEmail(''))
  }, [signed])
  const built = BUILD_TIME ? new Date(BUILD_TIME).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <div className="about">
      <p>מפות אישיות בסגנון Google My Maps: שכבות, נקודות, קווים ואזורים, מסלולי טיול לפי ימים, ייבוא וייצוא KML, שמירה ושיתוף ב-Google Drive, ועוזר AI.</p>
      <dl className="about__facts">
        <dt>גרסה</dt>
        <dd dir="ltr">{APP_VERSION}</dd>
        {APP_COMMIT && (
          <>
            <dt>Commit</dt>
            <dd dir="ltr">
              <a href={`https://github.com/alon24/mymaps-ai/commit/${APP_COMMIT}`} target="_blank" rel="noopener noreferrer">{APP_COMMIT}</a>
            </dd>
          </>
        )}
        {built && (
          <>
            <dt>נבנתה</dt>
            <dd>{built}</dd>
          </>
        )}
        {driveEnabled() && (
          <>
            <dt>חשבון Google</dt>
            <dd>{signed ? email || 'מחובר' : 'לא מחובר'}</dd>
          </>
        )}
      </dl>
      <div className="row row--wrap">
        <button type="button" className="btn" onClick={() => void checkForUpdate()}>
          <Icon name="download" size={18} /> בדוק עדכונים
        </button>
        {driveEnabled() &&
          (signed ? (
            <button type="button" className="btn" onClick={() => void signOut().then(() => useUi.getState().showToast('התנתקת מ-Google'))}>
              <Icon name="cloudOff" size={18} /> התנתק
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void signIn()}>
              <Icon name="cloud" size={18} /> התחבר עם Google
            </button>
          ))}
      </div>
      <p className="hint">
        מפות: <bdi dir="ltr">© OpenStreetMap contributors · Esri · OpenTopoMap</bdi>. חיפוש: Nominatim. ספריות: Leaflet, Leaflet-Geoman. המפות נשמרות במכשיר וב-Google Drive שלך בלבד; ה-AI מקבל את תוכן המפה כדי לענות.
      </p>
      <p className="hint">
        <a href="https://github.com/alon24/mymaps-ai" target="_blank" rel="noopener noreferrer">קוד המקור ב-GitHub</a>
      </p>
    </div>
  )
}
