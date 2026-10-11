import { useState } from 'react'
import { useUi } from '../../store/uiStore'
import { askAi } from '../../lib/api'
import { isConfigured, isValidWorkerUrl, loadSettings, saveSettings, type Settings } from '../../lib/settings'
import { driveEnabled } from '../../env'
import { signOut } from '../../google/auth'
import { signIn } from '../../lib/driveSync'
import { useSignedIn } from './shared'

// ---------------- Settings ----------------
/**
 * Everyday settings first (account, AI check). The Worker address and the admin APP_TOKEN only matter
 * to the owner once Google sign-in is set up, so they sit under "Advanced" then.
 */
export function SettingsDialog() {
  const [s, setS] = useState<Settings>(loadSettings)
  const [test, setTest] = useState('')
  const signed = useSignedIn()
  const google = driveEnabled()
  const valid = !s.workerUrl || isValidWorkerUrl(s.workerUrl)

  const workerFields = (
    <>
      <label className="field">
        <span>כתובת ה-Worker</span>
        <input value={s.workerUrl} onChange={(e) => setS({ ...s, workerUrl: e.target.value })} placeholder="https://mymaps-ai-worker.<you>.workers.dev" dir="ltr" aria-invalid={!valid} />
      </label>
      {!valid && <p className="error">הכתובת צריכה להתחיל ב-https://</p>}
      <label className="field">
        <span>APP_TOKEN {google ? '(מפתח מנהל, לא חובה)' : ''}</span>
        <input type="password" value={s.appToken} onChange={(e) => setS({ ...s, appToken: e.target.value })} autoComplete="off" dir="ltr" />
      </label>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={!valid}>
          שמור
        </button>
      </div>
    </>
  )

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
      {google && (
        <>
          <h3>חשבון Google</h3>
          <p className="hint">{signed ? 'מחובר. המפות נשמרות ב-Drive שלך ועוזר ה-AI פעיל.' : 'התחבר כדי לשמור מפות ב-Drive, לראות אותן בכל מכשיר ולהשתמש בעוזר ה-AI.'}</p>
          {signed ? (
            <button type="button" className="btn" onClick={() => void signOut()}>
              התנתק מ-Google
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void signIn()}>
              התחבר עם Google
            </button>
          )}
        </>
      )}

      <h3>עוזר AI</h3>
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
      {google && !signed && !s.appToken && <p className="hint">כדי להשתמש ב-AI צריך להתחבר עם Google.</p>}

      {google ? (
        <details className="advanced">
          <summary>מתקדם (לבעל האפליקציה)</summary>
          {workerFields}
        </details>
      ) : (
        workerFields
      )}

      <p className="hint">מפות נשמרות במכשיר הזה{google ? ' וב-Google Drive שלך' : ''}. ה-AI מקבל את תוכן המפה כדי לענות.</p>
    </form>
  )
}

export default SettingsDialog
