import { describe, expect, it, vi } from 'vitest'
import { fetchRoute, formatDuration, MAX_POINTS } from './routing'

const osrm = (pts: [number, number][]) =>
  Response.json({
    code: 'Ok',
    routes: [{ legs: pts.slice(1).map(() => ({ distance: 1000, duration: 120 })), geometry: { coordinates: pts } }],
  })

describe('routing', () => {
  it('returns legs and the road line, and caches by mode + stops', async () => {
    const pts: [number, number][] = [[34.8, 31.9], [34.81, 31.91], [34.82, 31.92]]
    const f = vi.fn(async (url: string) => osrm(decodeURIComponent(url).split('/driving/')[1].split('?')[0].split(';').map((p) => p.split(',').map(Number) as [number, number])))
    const r = await fetchRoute('car', pts, f as unknown as typeof fetch)
    expect(r.legs).toEqual([{ meters: 1000, seconds: 120 }, { meters: 1000, seconds: 120 }])
    expect(r.line).toHaveLength(3)
    await fetchRoute('car', pts, f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('splits long days into overlapping requests without duplicating the joint', async () => {
    const pts = Array.from({ length: MAX_POINTS + 5 }, (_, i) => [35 + i * 0.001, 32] as [number, number])
    const f = vi.fn(async (url: string) => osrm(decodeURIComponent(url).split('/driving/')[1].split('?')[0].split(';').map((p) => p.split(',').map(Number) as [number, number])))
    const r = await fetchRoute('bike', pts, f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(2)
    expect(r.legs).toHaveLength(pts.length - 1)
    expect(r.line).toHaveLength(pts.length)
  })

  it('reports a failed route', async () => {
    const f = vi.fn(async () => Response.json({ code: 'NoRoute' }))
    await expect(fetchRoute('car', [[0, 0], [1, 1]], f as unknown as typeof fetch)).rejects.toThrow('לא נמצא מסלול')
  })

  it('formats durations in Hebrew', () => {
    expect(formatDuration(30)).toBe("1 ד'")
    expect(formatDuration(12 * 60)).toBe("12 ד'")
    expect(formatDuration(80 * 60)).toBe("1 ש' 20 ד'")
    expect(formatDuration(120 * 60)).toBe("2 ש'")
  })
})
