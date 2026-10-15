import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// 冷进程、整库迁入与正式库读写等重夹具文件：单独成组、限制并发，避免与其余文件争抢 CPU 后随机超时。
const HEAVY_UNIT_TESTS = [
  'tests/production/**/*.test.ts',
  'tests/**/*migration*.test.ts',
  'tests/auxiliary-contract/central.test.ts',
  'tests/other-settlement/{clearance,production,native,stable-payee}-*.test.ts',
  'tests/material-quotation/{storage,graph}.test.ts',
  'tests/payroll/central-hollow-processed-proof.test.ts',
]
const NON_UNIT_TESTS = ['tests/components/**/*.test.ts', 'tests/browser/**/*.test.ts']
// 服务与迁入用例在真实内存库上走完整链路，满负载并行时单例可达数秒；默认 5s 会随机超时。
const unitTimeouts = { testTimeout: 15_000, hookTimeout: 30_000 }

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 与 Nuxt 4 srcDir 对齐：~ → app/
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    experimental: {
      // 跨次运行复用模块转译结果；位置与清除办法见 docs/testing/README.md。
      fsModuleCache: true,
      fsModuleCachePath: '.tmp/vitest-cache',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          ...unitTimeouts,
          globalSetup: ['./tests/global-setup.ts'],
          include: ['tests/**/*.test.ts'],
          exclude: [...NON_UNIT_TESTS, ...HEAVY_UNIT_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-heavy',
          environment: 'node',
          ...unitTimeouts,
          globalSetup: ['./tests/global-setup.ts'],
          include: HEAVY_UNIT_TESTS,
          exclude: NON_UNIT_TESTS,
          // maxWorkers 与其余项目不同，Vitest 要求独立 groupOrder：先跑 unit/component，再以半数逻辑核并发跑本组。
          maxWorkers: '50%',
          sequence: { groupOrder: 1 },
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
