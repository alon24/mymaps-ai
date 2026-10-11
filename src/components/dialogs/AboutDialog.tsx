import { useEffect, useState } from 'react'
import { useUi } from '../../store/uiStore'
import { driveEnabled } from '../../env'
import * as drive from '../../google/drive'
import { getToken, signOut } from '../../google/auth'
import { signIn } from '../../lib/driveSync'
import { APP_COMMIT, APP_VERSION, BUILD_TIME } from '../../version'
import { checkForUpdate } from '../../lib/update'
import { Icon } from '../ui'
import { useSignedIn } from './shared'

// ---------------- About ----------------
function UpdateButton() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'offline'>('idle')
  const [latest, setLatest] = useState('')
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={state === 'checking'}
        onClick={async () => {
          setState('checking')
          const r = await checkForUpdate()
          if (r.status === 'updating') useUi.getState().showToast(`מעדכן לגרסה ${r.latest}…`)
          else {
            setState(r.status === 'latest' ? 'latest' : 'offline')
            setLatest(r.latest ?? '')
          }
        }}
      >
        <Icon name="download" size={18} /> {state === 'checking' ? 'בודק…' : 'בדוק עדכונים'}
      </button>
      {state === 'latest' && <p className="hint about__status">אתה בגרסה האחרונה ({latest}).</p>}
      {state === 'offline' && <p className="error about__status">אין חיבור לשרת. נסה שוב כשיש אינטרנט.</p>}
    </>
  )
}

export function AboutDialog() {
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
        <UpdateButton />
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

export default AboutDialog
