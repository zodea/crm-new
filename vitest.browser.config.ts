import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vitest/config'
import unoConfig from './uno.config'

// 财务用例在同一个已挂载的工作流中逐档检查布局。
const desktopFlows = [
  'tests/browser/FinanceNativeFlows.test.ts',
  'tests/browser/components/FinanceMigration.browser.test.ts',
]

function chromium(width: number) {
  return {
    browser: 'chromium' as const,
    name: `chromium-${width}`,
    screenshotDirectory: `.tmp/vitest-browser/screenshots/${width}`,
    viewport: { width, height: 900 },
  }
}

export function browserConfig(fullMatrix: boolean) {
  return defineConfig(() => ({
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
      provide: { fullBrowserMatrix: fullMatrix },
      attachmentsDir: '.tmp/vitest-browser/attachments',
      include: ['tests/browser/**/*.test.ts'],
      setupFiles: ['./tests/browser/setup.ts'],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        locators: { testIdAttribute: 'data-ui' },
        instances: fullMatrix
          ? [390, 768, 1024, 1280, 1440].map(chromium)
          : [
              { ...chromium(1280), include: desktopFlows },
              ...[390, 1024, 1440].map(width => ({ ...chromium(width), exclude: desktopFlows })),
            ],
      },
    },
  }))
}

export default browserConfig(false)
