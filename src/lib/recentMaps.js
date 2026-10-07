const KEY = 'mymaps-ai.recent'
const MAX = 10

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list)
      ? list.filter((m) => m && typeof m.mid === 'string' && typeof m.name === 'string').slice(0, MAX)
      : []
  } catch {
    return []
  }
}

// Newest first, one entry per mid. Returns the updated list.
export function addRecent({ mid, name }) {
  const next = [{ mid, name: name || mid }, ...loadRecent().filter((m) => m.mid !== mid)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* storage full or blocked: the list just won't persist */ }
  return next
}

export function removeRecent(mid) {
  const next = loadRecent().filter((m) => m.mid !== mid)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* ignore */ }
  return next
}
