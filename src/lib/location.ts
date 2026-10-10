import { useUi } from '../store/uiStore'
import { haversine, formatDistance } from '../geo/measure'

let watchId: number | null = null

/** Start/stop following the device location. The first fix centers the map. */
export function toggleTracking(): void {
  const ui = useUi.getState()
  if (watchId !== null) {
    // Second tap while tracking: re-center; long-running tracking is stopped from the same button when centered
    if (ui.userLocation) {
      ui.setSearchPin(null)
      ui.focusOn({ point: ui.userLocation })
    }
    return
  }
  startTracking()
}

export function startTracking(opts: { center?: boolean; quiet?: boolean } = {}): void {
  const { center = true, quiet = false } = opts
  const ui = useUi.getState()
  if (!('geolocation' in navigator)) {
    if (!quiet) ui.showToast('הדפדפן לא תומך במיקום', { tone: 'error' })
    return
  }
  if (watchId !== null) return
  let first = center
  ui.setTracking(true)
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const ll: [number, number] = [p.coords.latitude, p.coords.longitude]
      useUi.getState().setUserLocation(ll, p.coords.accuracy)
      if (first) {
        first = false
        useUi.getState().focusOn({ point: ll })
      }
    },
    (err) => {
      stopTracking()
      if (quiet && err.code !== err.PERMISSION_DENIED) return
      useUi
        .getState()
        .showToast(err.code === err.PERMISSION_DENIED ? 'אין הרשאת מיקום. אפשר אותה בהגדרות הדפדפן (סמל המנעול ליד הכתובת).' : 'לא ניתן לקבל מיקום כרגע.', { tone: 'error' })
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  )
}

export function stopTracking(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  useUi.getState().setTracking(false)
}

/** "2.3 ק"מ ממך" for a [lng, lat] position, or '' when location is unknown. */
export function distanceFromMe(me: [number, number] | null, lngLat: number[]): string {
  if (!me) return ''
  return `${formatDistance(haversine([me[1], me[0]], lngLat))} ממך`
}

/** Phones and tablets: a touch-first device, where "where am I" matters most. */
export const isPhoneLike = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)

/**
 * On phones, follow the GPS from startup (asks for permission the first time) so the blue dot,
 * "distance from me", navigation and the AI ("near me") all know where the user is.
 * Skipped when permission was denied — the locate button explains how to allow it.
 */
export async function autoLocate(opts: { centerIfEmpty: boolean }): Promise<void> {
  if (!isPhoneLike() || !('geolocation' in navigator)) return
  let state: PermissionState | 'unknown' = 'unknown'
  try {
    state = (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state ?? 'unknown'
  } catch {
    /* Safari < 16 has no permissions API for geolocation */
  }
  if (state === 'denied') return
  startTracking({ center: opts.centerIfEmpty, quiet: true })
}
