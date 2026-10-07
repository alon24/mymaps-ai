import { describe, it, expect } from 'vitest'
import { getCachedKml, setCachedKml, pruneCache } from './kmlCache.js'

describe('kmlCache', () => {
  it('stores and returns KML per map id', () => {
    expect(getCachedKml('a')).toBeNull()
    expect(setCachedKml('a', '<kml/>')).toBe(true)
    expect(getCachedKml('a')).toBe('<kml/>')
  })

  it('refuses oversized maps instead of filling storage', () => {
    expect(setCachedKml('big', 'x'.repeat(2_000_001))).toBe(false)
    expect(getCachedKml('big')).toBeNull()
  })

  it('prunes maps that are no longer recent, leaving other keys alone', () => {
    setCachedKml('keep', '1')
    setCachedKml('drop', '2')
    localStorage.setItem('mymaps-ai.settings', '{}')
    pruneCache(['keep'])
    expect(getCachedKml('keep')).toBe('1')
    expect(getCachedKml('drop')).toBeNull()
    expect(localStorage.getItem('mymaps-ai.settings')).toBe('{}')
  })
})
