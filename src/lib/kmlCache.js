// Offline copies of recently loaded maps, so they still open without signal.
const PREFIX = 'mymaps-ai.kml.'
const MAX_CHARS = 2_000_000 // keep well under the ~5MB localStorage quota

export function getCachedKml(mid) {
  try {
    return localStorage.getItem(PREFIX + mid)
  } catch {
    return null
  }
}

export function setCachedKml(mid, text) {
  if (text.length > MAX_CHARS) return false
  try {
    localStorage.setItem(PREFIX + mid, text)
    return true
  } catch {
    return false // quota exceeded or storage blocked
  }
}

// Drop cached maps that are no longer in the recent list.
export function pruneCache(keepMids) {
  try {
    const keep = new Set(keepMids)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX) && !keep.has(key.slice(PREFIX.length))) localStorage.removeItem(key)
    }
  } catch { /* ignore */ }
}
