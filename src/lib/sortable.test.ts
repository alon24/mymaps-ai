import { describe, expect, it } from 'vitest'
import { dropIndex } from './sortable'

describe('dropIndex', () => {
  const rects = [
    { id: 'a', top: 0, height: 40 },
    { id: 'b', top: 40, height: 40 },
    { id: 'c', top: 80, height: 40 },
  ]
  it('finds the insertion index excluding the dragged item', () => {
    expect(dropIndex(rects, 'c', 5)).toBe(0) // c to top
    expect(dropIndex(rects, 'a', 70)).toBe(1) // a below b
    expect(dropIndex(rects, 'a', 200)).toBe(2) // a to end
    expect(dropIndex(rects, 'x', 50)).toBe(1) // from another list
    expect(dropIndex([], 'a', 10)).toBe(0)
  })
})
