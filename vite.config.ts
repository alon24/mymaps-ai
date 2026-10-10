/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { execSync } from 'node:child_process'
import pkg from './package.json' with { type: 'json' }

// On GitHub Pages the app lives under /<repo>/. The deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

// Version shown in the app (menu + About): major.minor from package.json, patch = CI build number.
const [major, minor] = pkg.version.split('.')
const appVersion = process.env.GITHUB_RUN_NUMBER ? `${major}.${minor}.${process.env.GITHUB_RUN_NUMBER}` : `${pkg.version}-dev`
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
})()

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'MyMaps AI',
        short_name: 'MyMaps',
        description: 'Maps with layers, points, KML import/export, Google Drive and AI',
        theme_color: '#1f6f5c',
        background_color: '#f6f4ef',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30 } },
          },
          {
            // Cache map tiles so opened areas work offline
            urlPattern: /^https:\/\/(.*\.)?(tile\.openstreetmap\.org|arcgisonline\.com|tile\.opentopomap\.org)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
