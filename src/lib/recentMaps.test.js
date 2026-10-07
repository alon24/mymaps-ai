import { describe, it, expect } from 'vitest'
import { loadRecent, addRecent, removeRecent } from './recentMaps.js'

describe('recentMaps', () => {
  it('starts empty and survives corrupt storage', () => {
    expect(loadRecent()).toEqual([])
    localStorage.setItem('mymaps-ai.recent', '{bad')
    expect(loadRecent()).toEqual([])
    localStorage.setItem('mymaps-ai.recent', '[{"mid":5},null,{"mid":"a","name":"x"}]')
    expect(loadRecent()).toEqual([{ mid: 'a', name: 'x' }])
  })

  it('puts the newest first and dedupes by mid, updating the name', () => {
    addRecent({ mid: 'a', name: 'Old' })
    addRecent({ mid: 'b', name: 'B' })
    const list = addRecent({ mid: 'a', name: 'טיול' })
    expect(list).toEqual([{ mid: 'a', name: 'טיול' }, { mid: 'b', name: 'B' }])
    expect(loadRecent()).toEqual(list)
  })

  it('falls back to the mid when the map has no name', () => {
    expect(addRecent({ mid: 'zzz', name: '' })).toEqual([{ mid: 'zzz', name: 'zzz' }])
  })

  it('keeps at most 10 and can remove one', () => {
    for (let i = 0; i < 12; i++) addRecent({ mid: `m${i}`, name: `n${i}` })
    expect(loadRecent()).toHaveLength(10)
    expect(loadRecent()[0].mid).toBe('m11')
    expect(removeRecent('m11')[0].mid).toBe('m10')
  })
})
