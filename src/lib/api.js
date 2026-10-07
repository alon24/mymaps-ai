export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function call(settings, path, init = {}) {
  let res
  try {
    res = await fetch(`${settings.workerUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'X-App-Token': settings.appToken },
    })
  } catch {
    throw new ApiError('לא ניתן להתחבר ל-Worker. בדוק את הכתובת בהגדרות.', 0)
  }
  if (res.status === 401) throw new ApiError('ה-APP_TOKEN שגוי. בדוק את ההגדרות.', 401)
  if (!res.ok) {
    let msg = `שגיאה ${res.status}`
    try {
      const body = await res.json()
      if (body.error) msg += `: ${body.error}`
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status)
  }
  return res
}

export async function fetchKml(settings, mid) {
  const res = await call(settings, `/kml?mid=${encodeURIComponent(mid)}`)
  return res.text()
}

export async function askAi(settings, system, messages) {
  const res = await call(settings, '/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages }),
  })
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new ApiError('תשובה לא צפויה מה-AI', 502)
  return content
}
