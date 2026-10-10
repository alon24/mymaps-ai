// Injected at build time (vite.config.ts `define`).
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __BUILD_TIME__: string

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : ''
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** "1.0.57 · a1b2c3d" */
export const versionLabel = (): string => [APP_VERSION, APP_COMMIT].filter(Boolean).join(' · ')
