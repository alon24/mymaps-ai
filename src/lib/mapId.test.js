import { describe, it, expect } from 'vitest'
import { extractMapId, myMapsEmbedUrl } from './mapId.js'

describe('extractMapId', () => {
  const mid = '1AbC_def-GhIjKlMnOp'
  it.each([
    [mid, mid],
    [`https://www.google.com/maps/d/viewer?mid=${mid}&ll=31,35&z=8`, mid],
    [`https://www.google.com/maps/d/edit?mid=${mid}&usp=sharing`, mid],
    [`  https://www.google.com/maps/d/u/0/embed?mid=${mid}  `, mid],
  ])('extracts from %s', (input, expected) => {
    expect(extractMapId(input)).toBe(expected)
  })

  it.each(['', 'short', 'https://example.com/?x=1', 'https://www.google.com/maps/d/viewer?mid=bad!chars<>xx', 'not a url'])(
    'rejects %s',
    (input) => expect(extractMapId(input)).toBeNull(),
  )
})

describe('myMapsEmbedUrl', () => {
  it('builds the embed URL with an encoded mid', () => {
    expect(myMapsEmbedUrl('abc_DEF-123456')).toBe('https://www.google.com/maps/d/embed?mid=abc_DEF-123456')
    expect(myMapsEmbedUrl('a&b')).toBe('https://www.google.com/maps/d/embed?mid=a%26b')
  })
})
