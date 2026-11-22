import { availableParallelism } from 'node:os'
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
  'tests/tooling/production-storage-seed.test.ts',
]
const NON_UNIT_TESTS = ['tests/components/**/*.test.ts', 'tests/browser/**/*.test.ts']
const CONTRACT_TESTS = [
  'tests/ui/**/*.test.ts',
  'tests/tooling/{check-md-links,commitlint,git-hooks}.test.ts',
]
// 只分流专用迁入用例。数据库启动与升级、普通命令读写、刷新恢复和在途权限等仍留在日常项目。
const MIGRATION_TESTS = [
  'tests/migration/**/*.test.ts',
  'tests/{auxiliary-contract,boq,construction-contract,delivery,material-contract,owner-document,quantity,receipt,schedule,subcontract-contract,supplier,target-cost}/*migration*.test.ts',
  'tests/other-settlement/migration.test.ts',
  'tests/payroll/{a-migration-protection,a-receipt-migration,central-a-prices-migration,central-adjustment-migration,central-c2-invalid-migration,controlled-migration,fees-migration-*,hollow-migration-*,numbering-controlled-migration,numbering-migration-chain,workbook-controlled-migration}.test.ts',
  'tests/production/{boq-migration,invoice-company-migration-proof,invoice-migration-catalog*,invoice-migration-preview,invoice-migration-publish,invoice-migration-session,invoice-migration-source,migration-domain-evidence,migration-references,quantity-migration}.test.ts',
  'tests/server/{core-migration-*,invoice-migration-catalog-route,quantity-hollow-migration,quantity-migration,wbs-migration}.test.ts',
  'tests/stores/core-migration.test.ts',
]
const NON_DAILY_UNIT_TESTS = [...NON_UNIT_TESTS, ...CONTRACT_TESTS, ...MIGRATION_TESTS]
// 服务与迁入用例在真实内存库上走完整链路，满负载并行时单例可达数秒；默认 5s 会随机超时。
const unitTimeouts = { testTimeout: 15_000, hookTimeout: 30_000 }
// 重型夹具还竞争磁盘；半数逻辑核在高核数机器上仍可能耗尽 I/O，最多并发 3 个。
const heavyUnitSettings = {
  environment: 'node' as const,
  ...unitTimeouts,
  globalSetup: ['./tests/global-setup.ts'],
  maxWorkers: Math.max(1, Math.min(3, Math.floor(availableParallelism() / 2))),
  sequence: { groupOrder: 1 },
}

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
          exclude: [...NON_DAILY_UNIT_TESTS, ...HEAVY_UNIT_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-heavy',
          ...heavyUnitSettings,
          include: HEAVY_UNIT_TESTS,
          exclude: NON_DAILY_UNIT_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: 'migration',
          ...heavyUnitSettings,
          include: MIGRATION_TESTS,
          exclude: NON_UNIT_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: 'contracts',
          environment: 'node',
          ...unitTimeouts,
          include: CONTRACT_TESTS,
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
