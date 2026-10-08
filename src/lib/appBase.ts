/** Absolute URL of the app root (origin + Vite base), e.g. https://alon24.github.io/mymaps-ai/ */
export const appBase = (): string => new URL(import.meta.env.BASE_URL, window.location.origin).toString()

export interface Route {
  driveFileId?: string
  featureId?: string
}

/** Parse "#/m/<driveFileId>?f=<featureId>" */
export function parseHash(hash: string): Route {
  const m = hash.match(/^#\/m\/([^?/]+)(?:\?(.*))?$/)
  if (!m) return {}
  const params = new URLSearchParams(m[2] ?? '')
  return { driveFileId: decodeURIComponent(m[1]), ...(params.get('f') ? { featureId: params.get('f')! } : {}) }
}
