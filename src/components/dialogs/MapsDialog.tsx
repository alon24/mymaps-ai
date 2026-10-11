import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../../store/mapStore'
import { useUi } from '../../store/uiStore'
import * as ops from '../../model/ops'
import * as storage from '../../lib/storage'
import { downloadBlob } from '../../io/download'
import { driveEnabled } from '../../env'
import * as drive from '../../google/drive'
import { getToken, isSignedIn, signOut } from '../../google/auth'
import { deleteDriveMap, openDriveMap, openLocal, saveToDrive, signIn, uploadLocalMaps } from '../../lib/driveSync'
import { Icon } from '../ui'
import { useSignedIn, when } from './shared'

// ---------------- Maps ----------------
const title = (f: drive.DriveFileMeta) => f.name.replace(/\.mymap\.json$/, '') || 'ללא שם'

export function MapsDialog() {
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

export default MapsDialog
