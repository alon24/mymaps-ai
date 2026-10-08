import type { Settings } from './settings'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call(settings: Settings, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${settings.workerUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'X-App-Token': settings.appToken },
    })
  } catch {
    throw new ApiError('לא ניתן להתחבר ל-Worker. בדוק את הכתובת בהגדרות.', 0)
  }
  if (res.status === 401) throw new ApiError('ה-APP_TOKEN שגוי. בדוק את ההגדרות.', 401)
  if (!res.ok) {
    let msg = `שגיאה ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg += `: ${body.error}`
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status)
  }
  return res
}

/** KML of a Google My Maps map shared as "anyone with the link" (via the Worker). */
export async function fetchMyMapsKml(settings: Settings, mid: string): Promise<string> {
  const res = await call(settings, `/kml?mid=${encodeURIComponent(mid)}`)
  return res.text()
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function askAi(settings: Settings, system: string, messages: ChatMessage[]): Promise<string> {
  const res = await call(settings, '/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages }),
  })
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new ApiError('תשובה לא צפויה מה-AI', 502)
  return content
}

const MID_RE = /^[A-Za-z0-9_-]{10,100}$/

/** Accepts a raw My Maps id or any My Maps URL containing ?mid=... */
export function extractMyMapsId(input: string): string | null {
  const text = (input ?? '').trim()
  if (MID_RE.test(text)) return text
  try {
    const mid = new URL(text).searchParams.get('mid')
    return mid && MID_RE.test(mid) ? mid : null
  } catch {
    return null
  }
}
