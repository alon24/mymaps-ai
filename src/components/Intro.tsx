/** Three short screens on the very first launch; skippable, never shown again. */
import { useState } from 'react'
import { driveEnabled } from '../env'
import { signIn } from '../lib/driveSync'
import { Dialog, Icon } from './ui'

const SEEN_KEY = 'mymaps-ai.intro-seen'

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // no storage: don't nag on every launch
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

const STEPS = [
  { icon: 'pin', title: 'מפה משלך', text: 'הוסף מקומות בכפתור ➕ (בטלפון) או בחיפוש למעלה. לחיצה ארוכה על המפה מוסיפה נקודה במקום.' },
  { icon: 'route', title: 'שכבות וימי טיול', text: 'סדר מקומות בשכבות, הפוך שכבה ליום בטיול עם עצירות ממוספרות, וגרור כדי לשנות את הסדר.' },
  { icon: 'sparkle', title: 'שמירה ועוזר AI', text: 'התחבר עם Google: המפות נשמרות ב-Drive ומופיעות בכל מכשיר, ועוזר ה-AI מציע מקומות ומתכנן ימים.' },
]

export function Intro() {
  // Not on top of a shared or imported map link: the person came for that map
  const [open, setOpen] = useState(() => !introSeen() && !/^#\/(m|import)\//.test(window.location.hash))
  const [i, setI] = useState(0)
  const close = () => {
    markSeen()
    setOpen(false)
  }
  const step = STEPS[i]
  const last = i === STEPS.length - 1
  return (
    <Dialog open={open} onClose={close} title="ברוך הבא ל-MyMaps AI">
      <div className="intro">
        <div className="intro__icon">
          <Icon name={step.icon} size={34} />
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="intro__dots" aria-label={`שלב ${i + 1} מתוך ${STEPS.length}`}>
          {STEPS.map((_, k) => (
            <span key={k} className={k === i ? 'is-on' : ''} />
          ))}
        </div>
        <div className="row row--wrap intro__actions">
          {last && driveEnabled() && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                close()
                void signIn()
              }}
            >
              <Icon name="cloud" size={18} /> התחבר עם Google
            </button>
          )}
          <button type="button" className={`btn ${last && driveEnabled() ? '' : 'btn--primary'}`} onClick={() => (last ? close() : setI(i + 1))}>
            {last ? 'התחל' : 'הבא'}
          </button>
          {!last && (
            <button type="button" className="link-btn" onClick={close}>
              דלג
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
