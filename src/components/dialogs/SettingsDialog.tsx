import { useState } from 'react'
import { useUi } from '../../store/uiStore'
import { askAi } from '../../lib/api'
import { isConfigured, isValidWorkerUrl, loadSettings, saveSettings, type Settings } from '../../lib/settings'
import { driveEnabled } from '../../env'
import { getToken, signOut } from '../../google/auth'
import { useSignedIn } from './shared'

// ---------------- Settings ----------------
export function SettingsDialog() {
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

export default SettingsDialog
