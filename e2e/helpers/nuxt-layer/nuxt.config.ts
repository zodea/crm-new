import { resolve } from 'node:path'
import process from 'node:process'
import { defineNuxtConfig } from 'nuxt/config'

// 此层仅由 Playwright 的回环开发服务加载，缓存按端口复用，数据按次隔离。
const directory = resolve('.tmp/playwright', process.env.CRM_E2E_SERVER_PORT!)

export default defineNuxtConfig({
  buildDir: resolve(directory, 'nuxt'),
  vite: { cacheDir: resolve(directory, 'vite'), server: { hmr: false } },
  nitro: {
    devStorage: { data: { driver: 'fs', base: resolve(directory, 'data', process.env.CRM_E2E_RUN_ID!) } },
  },
})
