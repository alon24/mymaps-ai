const MID_RE = /^[A-Za-z0-9_-]{10,100}$/

// Accepts a raw map id or any My Maps URL containing ?mid=...
export function extractMapId(input) {
  const text = (input ?? '').trim()
  if (MID_RE.test(text)) return text
  try {
    const mid = new URL(text).searchParams.get('mid')
    return mid && MID_RE.test(mid) ? mid : null
  } catch {
    return null
  }
}

export function myMapsViewUrl(mid) {
  return `https://www.google.com/maps/d/viewer?mid=${encodeURIComponent(mid)}`
}

// The only My Maps page Google allows inside another site (read-only, link-shared maps).
export function myMapsEmbedUrl(mid) {
  return `https://www.google.com/maps/d/embed?mid=${encodeURIComponent(mid)}`
}
