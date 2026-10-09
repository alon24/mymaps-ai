import { useRef } from 'react'
import type React from 'react'

/** How long a finger must rest (and how far it may drift) for a long press. */
export const LONG_PRESS_MS = 500
export const MOVE_TOLERANCE = 8

/**
 * Long press for touch, plus a plain click for mouse/keyboard.
 * A touch tap does nothing (`onTap` is opt-in) so dragging/scrolling across the element
 * never triggers it by accident. The click that follows a long press is swallowed.
 */
export function useLongPress(onLongPress: () => void, opts: { onClick?: () => void; onTap?: () => void } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const pointer = useRef<string>('')
  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      pointer.current = e.pointerType
      fired.current = false
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fired.current = true
        start.current = null
        navigator.vibrate?.(15)
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // Android shows a context menu on long press; we handle the long press ourselves
      if (pointer.current !== 'mouse') e.preventDefault()
    },
    onClick: (e: React.MouseEvent) => {
      if (fired.current) {
        fired.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (pointer.current === 'touch' || pointer.current === 'pen') opts.onTap?.()
      else opts.onClick?.() // mouse or keyboard
    },
  }
}
