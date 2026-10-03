import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: './e2e',
  testIgnore: /runtime-visual-matrix\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // 迁入验收共享默认中央仓库；每个用例须独占重置及接管旅程。
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'node ./node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 3100',
        env: {
          NUXT_DEVTOOLS: 'false',
          NUXT_IGNORE_LOCK: '1',
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
