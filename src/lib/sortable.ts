/**
 * Pointer-based drag-to-reorder that works with mouse and touch, across several lists.
 * Lists: elements with [data-sort-list="<listId>"]; items inside: [data-sort-item="<itemId>"].
 * Drag starts from an element with [data-sort-handle].
 */
export interface DropResult {
  itemId: string
  listId: string
  /** Index among the target list's items, excluding the dragged item */
  index: number
}

/** Pure: where does a pointer at `y` land among item rects (excluding the dragged one)? */
export function dropIndex(rects: { id: string; top: number; height: number }[], draggedId: string, y: number): number {
  const others = rects.filter((r) => r.id !== draggedId)
  for (let i = 0; i < others.length; i++) {
    if (y < others[i].top + others[i].height / 2) return i
  }
  return others.length
}

export function startSort(e: PointerEvent, handle: HTMLElement, onDrop: (r: DropResult) => void): void {
  const item = handle.closest<HTMLElement>('[data-sort-item]')
  if (!item || e.button > 0) return
  e.preventDefault()
  const itemId = item.dataset.sortItem!
  const rect = item.getBoundingClientRect()
  const offsetY = e.clientY - rect.top
  const ghost = item.cloneNode(true) as HTMLElement
  ghost.classList.add('sort-ghost')
  Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, pointerEvents: 'none', zIndex: '9999' })
  document.body.appendChild(ghost)
  item.classList.add('sort-source')
  const marker = document.createElement('div')
  marker.className = 'sort-marker'
  let target: { list: HTMLElement; index: number } | null = null
  let scrollTimer = 0

  const scroller = item.closest<HTMLElement>('[data-sort-scroll]')

  const update = (x: number, y: number) => {
    ghost.style.top = `${y - offsetY}px`
    const under = document.elementFromPoint(x, y)
    const list = under?.closest<HTMLElement>('[data-sort-list]') ?? null
    if (!list) {
      marker.remove()
      target = null
      return
    }
    const items = [...list.querySelectorAll<HTMLElement>(':scope [data-sort-item]')].filter((el) => el.closest('[data-sort-list]') === list)
    const rects = items.map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.sortItem!, top: r.top, height: r.height }
    })
    const index = dropIndex(rects, itemId, y)
    target = { list, index }
    const others = items.filter((el) => el.dataset.sortItem !== itemId)
    const before = others[index]
    if (before) before.before(marker)
    else if (others.length) others[others.length - 1].after(marker)
    else list.appendChild(marker)

    // auto-scroll near the edges of the scroll container
    window.clearInterval(scrollTimer)
    if (scroller) {
      const sr = scroller.getBoundingClientRect()
      const dir = y < sr.top + 40 ? -1 : y > sr.bottom - 40 ? 1 : 0
      if (dir) scrollTimer = window.setInterval(() => (scroller.scrollTop += dir * 12), 16)
    }
  }

  const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY)
  const end = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.clearInterval(scrollTimer)
    ghost.remove()
    marker.remove()
    item.classList.remove('sort-source')
    if (ev.type === 'pointerup' && target) onDrop({ itemId, listId: target.list.dataset.sortList!, index: target.index })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  update(e.clientX, e.clientY)
}
