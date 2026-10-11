import { useEffect, useState } from 'react'
import { useMapStore } from '../../store/mapStore'
import { useUi } from '../../store/uiStore'
import { appBase } from '../../lib/appBase'
import { driveEnabled } from '../../env'
import * as drive from '../../google/drive'
import { getToken } from '../../google/auth'
import { saveToDrive } from '../../lib/driveSync'
import { Icon } from '../ui'
import { useSignedIn } from './shared'

// ---------------- Share ----------------
export function ShareDialog() {
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

export default ShareDialog
