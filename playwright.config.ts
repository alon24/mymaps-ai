import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // 'github' turns failures into annotations on the workflow run
  reporter: process.env.CI ? [['github'], ['line']] : 'line',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'he-IL',
    // The PWA service worker would hide requests from page.route mocks
    serviceWorkers: 'block',
    // In some sandboxes Chromium is preinstalled at a fixed path
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
