import { useState } from 'react'
import { askAi } from '../lib/api.js'
import { buildSystemPrompt } from '../lib/prompt.js'
import { extractKmlBlock, stripKmlBlock, validateAiKml } from '../lib/aiLayer.js'

function downloadKml(layer) {
  const blob = new Blob([layer.kml], { type: 'application/vnd.google-earth.kml+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${layer.name.replace(/[\\/:*?"<>|]+/g, '_')}.kml`
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function AiPanel({ settings, map, onLayer }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [layer, setLayer] = useState(null)

  async function send(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setError('')
    setBusy(true)
    try {
      const reply = await askAi(settings, buildSystemPrompt(map), next)
      const kmlText = extractKmlBlock(reply)
      let note = ''
      if (kmlText) {
        try {
          const valid = validateAiKml(kmlText)
          setLayer(valid)
          onLayer(valid.geojson)
        } catch (err) {
          note = `\n\n⚠️ השכבה שה-AI יצר לא תקינה (${err.message}) ולא הוצגה.`
        }
      }
      setMessages([...next, { role: 'assistant', content: reply, display: (stripKmlBlock(reply) || 'נוצרה שכבה.') + note }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card ai" aria-label="עוזר AI">
      <h2>עוזר AI</h2>
      <ul className="chat">
        {messages.map((m, i) => (
          <li key={i} className={m.role}>{m.display ?? m.content}</li>
        ))}
        {busy && <li className="assistant pending">חושב…</li>}
      </ul>
      {error && <p role="alert" className="error">{error}</p>}
      {layer && (
        <div className="layer">
          <span>שכבה: {layer.name} ({layer.geojson.features.length} פריטים)</span>
          <button type="button" onClick={() => downloadKml(layer)}>הורדת KML</button>
          <p className="hint">ב-My Maps: הוספת שכבה ← ייבוא ← בחר את הקובץ.</p>
        </div>
      )}
      <form onSubmit={send} className="row">
        <input
          aria-label="הודעה ל-AI"
          placeholder="למשל: צור שכבה עם 5 בתי קפה ליד הנקודות במפה"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()}>שליחה</button>
      </form>
    </section>
  )
}
