import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { VISUAL_BASE_URL, VISUAL_DATA_PROFILE } from './e2e/helpers/visual-environment'

if (process.platform !== 'win32')
  throw new Error('视觉基线固定在 Windows/Chromium 环境运行，请使用 Windows CI 或开发机。')

if (process.env.PLAYWRIGHT_BASE_URL)
  throw new Error('视觉基线禁止连接外部 PLAYWRIGHT_BASE_URL，只能使用隔离的本地演示服务。')

export default defineConfig({
  testDir: './e2e',
  testMatch: /runtime-visual-matrix\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/visual',
  use: {
    baseURL: VISUAL_BASE_URL,
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
  webServer: {
    command: 'node ./node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 3101',
    env: {
      NUXT_DEVTOOLS: 'false',
      NUXT_IGNORE_LOCK: '1',
      NUXT_PUBLIC_VISUAL_BASELINE_MODE: VISUAL_DATA_PROFILE,
    },
    url: VISUAL_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
