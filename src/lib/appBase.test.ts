import { describe, expect, it } from 'vitest'
import { parseHash } from './appBase'

describe('parseHash', () => {
  it('reads Drive map links with an optional feature', () => {
    expect(parseHash('#/m/abc123')).toEqual({ driveFileId: 'abc123' })
    expect(parseHash('#/m/abc123?f=feat-1')).toEqual({ driveFileId: 'abc123', featureId: 'feat-1' })
    expect(parseHash('')).toEqual({})
    expect(parseHash('#/other')).toEqual({})
  })
})
