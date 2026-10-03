import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vitest/config'
import unoConfig from './uno.config'

export default defineConfig({
  plugins: [vue(), UnoCSS({
    ...unoConfig,
    configFile: false,
    content: { ...unoConfig.content, filesystem: ['app/components/**/*.{vue,ts}'] },
  })],
  cacheDir: '.tmp/vitest-browser/vite',
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
    dedupe: ['vue'],
  },
  test: {
    attachmentsDir: '.tmp/vitest-browser/attachments',
    include: ['tests/browser/**/*.test.ts'],
    setupFiles: ['./tests/browser/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      locators: { testIdAttribute: 'data-ui' },
      instances: [390, 768, 1024, 1280, 1440].map(width => ({
        browser: 'chromium' as const,
        name: `chromium-${width}`,
        screenshotDirectory: `.tmp/vitest-browser/screenshots/${width}`,
        viewport: { width, height: 900 },
      })),
    },
  },
})
