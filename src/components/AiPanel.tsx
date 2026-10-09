import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import { askAi, type ChatMessage } from '../lib/api'
import { loadSettings, workerAccess } from '../lib/settings'
import { isSignedIn, onAuthChange } from '../google/auth'
import { signIn } from '../lib/driveSync'
import { applyActions, describeActions, highlightedIds, parseAiResponse, type AiAction } from '../ai/actions'
import { QUICK_PROMPTS, SYSTEM_PROMPT, mapContext } from '../ai/prompt'
import { geocode } from '../geo/search'
import * as ops from '../model/ops'
import { Icon } from './ui'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  actions?: AiAction[]
  status?: 'pending' | 'applied' | 'dismissed' | 'applying'
  rejected?: number
  notFound?: string[]
  error?: boolean
}

export function AiPanel() {
  const doc = useMapStore((s) => s.doc)
  const readOnly = useMapStore((s) => s.readOnly)
  const highlights = useUi((s) => s.highlights)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const [signed, setSigned] = useState(isSignedIn())
  useEffect(() => onAuthChange(setSigned), [])
  const access = workerAccess(loadSettings(), signed)

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must not return one
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns.length, busy])

  // Start a fresh conversation when another map is opened
  useEffect(() => {
    setTurns([])
  }, [doc.id])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    const history = [...turns, { role: 'user' as const, text: q }]
    setTurns(history)
    setBusy(true)
    try {
      const ui = useUi.getState()
      const context = mapContext(useMapStore.getState().doc, { center: ui.mapCenter, userLocation: ui.userLocation ?? undefined })
      const messages: ChatMessage[] = history.slice(-12).map((t) => ({ role: t.role, content: t.text }))
      const raw = await askAi(loadSettings(), `${SYSTEM_PROMPT}\n\nCurrent map JSON:\n${context}`, messages)
      const res = parseAiResponse(raw)
      const ids = highlightedIds(res.actions)
      if (ids.length) {
        ui.setHighlights(ids)
        ui.focusOn({ featureId: ids[0] })
      }
      const editable = res.actions.filter((a) => a.type !== 'highlight')
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: res.reply || (editable.length ? 'הנה השינויים שאני מציע:' : '…'),
          actions: readOnly ? [] : editable,
          status: editable.length && !readOnly ? 'pending' : undefined,
          rejected: res.rejected,
        },
      ])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: e instanceof Error ? e.message : 'משהו השתבש', error: true }])
    } finally {
      setBusy(false)
    }
  }

  async function apply(i: number) {
    const turn = turns[i]
    if (!turn.actions?.length) return
    setTurns((t) => t.map((x, j) => (j === i ? { ...x, status: 'applying' } : x)))
    const viewbox = useUi.getState().mapBounds ?? undefined
    const { doc: next, notFound } = await applyActions(useMapStore.getState().doc, turn.actions, (q) => geocode(q, viewbox).catch(() => null))
    useMapStore.getState().apply(() => next)
    setTurns((t) => t.map((x, j) => (j === i ? { ...x, status: 'applied', notFound } : x)))
    useUi.getState().showToast('השינויים הוחלו', { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
    useUi.getState().focusOn({ all: true })
  }

  if (access === 'needs-signin') {
    return (
      <div className="ai ai--setup">
        <Icon name="sparkle" size={28} />
        <p>כדי להשתמש בעוזר ה-AI, התחבר עם חשבון Google.</p>
        <button type="button" className="btn btn--primary" onClick={() => void signIn()}>
          <Icon name="cloud" size={18} /> התחבר עם Google
        </button>
      </div>
    )
  }

  if (access !== 'ready') {
    return (
      <div className="ai ai--setup">
        <Icon name="sparkle" size={28} />
        <p>כדי להשתמש בעוזר ה-AI צריך לחבר את ה-Worker.</p>
        <button type="button" className="btn btn--primary" onClick={() => useUi.getState().openDialog('settings')}>
          פתח הגדרות
        </button>
      </div>
    )
  }

  return (
    <div className="ai">
      <div className="ai__log" aria-live="polite">
        {turns.length === 0 && (
          <div className="ai__intro">
            <p>שאל על המפה או בקש שינוי. כל שינוי מוצג לאישור לפני שהוא מתבצע, ואפשר לבטל אותו.</p>
            <div className="chips">
              {QUICK_PROMPTS.filter((p) => !readOnly || !p.text.includes('הוסף')).map((p) => (
                <button key={p.label} type="button" className="chip" onClick={() => send(p.text)} disabled={busy}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg msg--${t.role} ${t.error ? 'msg--error' : ''}`}>
            <p>{t.text}</p>
            {!!t.actions?.length && (
              <div className={`proposal proposal--${t.status}`}>
                <ul>
                  {describeActions(doc, t.actions).map((line, k) => (
                    <li key={k}>{line}</li>
                  ))}
                </ul>
                {t.status === 'pending' && (
                  <div className="row">
                    <button type="button" className="btn btn--primary" onClick={() => apply(i)}>
                      <Icon name="check" size={18} /> החל שינויים
                    </button>
                    <button type="button" className="btn" onClick={() => setTurns((x) => x.map((y, j) => (j === i ? { ...y, status: 'dismissed' } : y)))}>
                      התעלם
                    </button>
                  </div>
                )}
                {t.status === 'applying' && <p className="hint">מחפש מקומות ומחיל…</p>}
                {t.status === 'applied' && <p className="hint">הוחל.{t.notFound?.length ? ` לא נמצאו: ${t.notFound.join(', ')}` : ''}</p>}
                {t.status === 'dismissed' && <p className="hint">לא הוחל.</p>}
              </div>
            )}
            {!!t.rejected && <p className="hint">{t.rejected} פעולות לא תקינות סוננו.</p>}
          </div>
        ))}
        {busy && <div className="msg msg--assistant msg--typing" aria-label="חושב">…</div>}
        <div ref={endRef} />
      </div>
      <form
        className="ai__input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={readOnly ? 'שאל על המפה' : 'שאל או בקש שינוי, למשל: חלק ל-3 ימים'}
          rows={2}
          aria-label="הודעה לעוזר"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
        />
        <button type="submit" className="icon-btn icon-btn--primary" aria-label="שלח" disabled={busy || !input.trim()}>
          <Icon name="send" />
        </button>
      </form>
      {highlights.length > 0 && (
        <button type="button" className="btn btn--small ai__clear" onClick={() => useUi.getState().setHighlights([])}>
          נקה סימונים
        </button>
      )}
      {ops.featureCount(doc) > 400 && <p className="hint">המפה גדולה: ה-AI רואה את 400 הפריטים הראשונים.</p>}
    </div>
  )
}
