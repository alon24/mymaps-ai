import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../store/mapStore'
import { useUi } from '../store/uiStore'
import { askAi, type ChatMessage } from '../lib/api'
import { loadSettings, workerAccess } from '../lib/settings'
import { isSignedIn, onAuthChange } from '../google/auth'
import { signIn } from '../lib/driveSync'
import { applyActions, describeActions, highlightedIds, needsRepair, parseAiResponse, REPAIR_PROMPT, type AiAction } from '../ai/actions'
import { QUICK_PROMPTS, SYSTEM_PROMPT, mapContext } from '../ai/prompt'
import { geocodeWithFallback } from '../geo/search'
import * as ops from '../model/ops'
import { Icon } from './ui'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  actions?: AiAction[]
  status?: 'pending' | 'applied' | 'dismissed' | 'applying'
  rejected?: number
  notFound?: string[]
  /** Features actually added when applied */
  added?: number
  /** The model was asked for changes twice and sent none */
  missing?: boolean
  raw?: string
  ask?: string
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
      // Earlier assistant turns go back as the JSON they were, actions included; sending only the text
      // teaches the model (in-context) to answer with text and no actions.
      const messages: ChatMessage[] = history.slice(-12).map((t) => ({
        role: t.role,
        content: t.role === 'assistant' && t.actions?.length ? JSON.stringify({ reply: t.text, actions: t.actions }) : t.text,
      }))
      const system = `${SYSTEM_PROMPT}\n\nCurrent map JSON:\n${context}`
      const raw = await askAi(loadSettings(), system, messages)
      let res = parseAiResponse(raw)
      // The model sometimes says "adding…" but sends no (valid) actions: ask once more for them
      const raws = [raw]
      let missing = false
      if (!readOnly && needsRepair(q, res)) {
        const raw2 = await askAi(loadSettings(), system, [...messages, { role: 'assistant', content: raw }, { role: 'user', content: REPAIR_PROMPT }])
        raws.push(raw2)
        const again = parseAiResponse(raw2)
        if (again.actions.length) res = { ...again, reply: res.reply || again.reply }
        else missing = true
      }
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
          ...(missing ? { missing: true, raw: raws.join('\n\n— ניסיון שני —\n\n'), ask: q } : {}),
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
    const before = useMapStore.getState().doc
    const { doc: next, notFound } = await applyActions(before, turn.actions, (q) => geocodeWithFallback(q, viewbox))
    useMapStore.getState().apply(() => next)
    const added = ops.featureCount(next) - ops.featureCount(before)
    setTurns((t) => t.map((x, j) => (j === i ? { ...x, status: 'applied', notFound, added } : x)))
    useUi.getState().showToast(added > 0 ? `נוספו ${added} מקומות` : 'השינויים הוחלו', { action: { label: 'בטל', run: () => useMapStore.getState().undo() } })
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
                {t.status === 'pending' && <p className="hint">השינויים יתבצעו רק אחרי שתלחץ "החל שינויים".</p>}
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
                {t.status === 'applied' && (
                  <p className={t.notFound?.length ? 'error' : 'hint'}>
                    {t.added ? `הוחל: נוספו ${t.added} מקומות.` : 'הוחל.'}
                    {t.notFound?.length ? ` לא מצאתי במפה: ${t.notFound.join(' · ')}. נסה לבקש שוב עם שם עיר.` : ''}
                  </p>
                )}
                {t.status === 'dismissed' && <p className="hint">לא הוחל.</p>}
              </div>
            )}
            {!!t.rejected && !t.missing && <p className="hint">{t.rejected} פעולות לא תקינות סוננו.</p>}
            {t.missing && (
              <div className="proposal proposal--missing">
                <p className="error">ה-AI לא שלח שינויים שאפשר להחיל, ולכן שום דבר לא נוסף למפה.</p>
                <div className="row">
                  <button type="button" className="btn btn--small" disabled={busy} onClick={() => t.ask && void send(t.ask)}>
                    נסה שוב
                  </button>
                </div>
                <details>
                  <summary>מה ה-AI החזיר (לבדיקה)</summary>
                  <pre dir="ltr">{t.raw?.slice(0, 3000)}</pre>
                </details>
              </div>
            )}
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
