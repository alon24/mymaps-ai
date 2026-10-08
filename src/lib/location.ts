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

export function startTracking(): void {
  const ui = useUi.getState()
  if (!('geolocation' in navigator)) {
    ui.showToast('הדפדפן לא תומך במיקום', { tone: 'error' })
    return
  }
  let first = true
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
      useUi
        .getState()
        .showToast(err.code === err.PERMISSION_DENIED ? 'אין הרשאת מיקום. אפשר אותה בהגדרות הדפדפן.' : 'לא ניתן לקבל מיקום כרגע.', { tone: 'error' })
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
