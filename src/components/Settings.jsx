import { useState } from 'react'
import { isValidWorkerUrl } from '../lib/settings.js'

export default function Settings({ initial, onSave, onCancel }) {
  const [workerUrl, setWorkerUrl] = useState(initial.workerUrl)
  const [appToken, setAppToken] = useState(initial.appToken)
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!isValidWorkerUrl(workerUrl)) {
      setError('כתובת Worker לא תקינה (צריכה להתחיל ב-https://)')
      return
    }
    if (!appToken.trim()) {
      setError('יש להזין APP_TOKEN')
      return
    }
    onSave({ workerUrl, appToken })
  }

  return (
    <form className="card settings" onSubmit={submit} aria-label="הגדרות">
      <h2>הגדרות</h2>
      <label>
        כתובת ה-Worker
        <input
          type="url"
          dir="ltr"
          placeholder="https://mymaps-ai-worker.example.workers.dev"
          value={workerUrl}
          onChange={(e) => setWorkerUrl(e.target.value)}
        />
      </label>
      <label>
        APP_TOKEN
        <input
          type="password"
          dir="ltr"
          autoComplete="off"
          value={appToken}
          onChange={(e) => setAppToken(e.target.value)}
        />
      </label>
      <p className="hint">הנתונים נשמרים רק בדפדפן הזה.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="submit">שמירה</button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>ביטול</button>}
      </div>
    </form>
  )
}
