import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 与 Nuxt 4 srcDir 对齐：~ → app/
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/components/**/*.test.ts', 'tests/browser/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.ts'],
          setupFiles: ['./tests/components/setup.ts'],
        },
      },
    ],
  },
})
