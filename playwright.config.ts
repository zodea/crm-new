import { globSync } from 'node:fs'
import { basename, matchesGlob, resolve } from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { isolatedDevServer } from './e2e/helpers/playwright-server'

const externalURL = process.env.PLAYWRIGHT_BASE_URL
const uiURL = 'http://127.0.0.1:3100'
const specs = globSync('**/*.{spec,test}.*', { cwd: 'e2e' })
  .filter(path => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))
  .map(path => path.replaceAll('\\', '/'))
  .sort()
const production = specs.filter(path => basename(path).startsWith('production-'))
// 仅浏览器上下文、只读界面或页面内模拟；新增文件默认交给独占服务。
const uiNames = new Set([
  'document-list-reference',
  'form-footer',
  'invoice-export-borders',
  'invoice-ledger-print-mode',
  'invoice-print-layout',
  'issue-171-sheet-project-switcher',
  'issue-186-detail-shell',
  'kit-button',
  'kit-shared-primitives-dc',
  'kit-table-responsive',
  'kit-type-select',
  'kit-ui-config-export',
  'kit-ui-export',
  'kit-ui-import-mapping',
  'kit-ui-keyboard',
  'kit-ui-motion',
  'list-enum-filters',
  'lookup-select',
  'owner-document-lists',
  'owner-document-snapshot',
  'payroll-statement-detail',
  'project-detail',
  'project-import',
  'shell-visual',
  'sidebar-accordion',
  'target-cost-detail',
])
const ui = specs.filter(path => uiNames.has(path.replace(/\.spec\.ts$/, '')))
const central = specs.filter(path => path !== 'runtime-visual-matrix.spec.ts' && !production.includes(path) && !ui.includes(path))
const shards = [0, 1, 2].map(index => ({
  name: `e2e-central-shard-${index + 1}`,
  files: central.filter((_, position) => position % 3 === index),
  port: 3102 + index,
}))
const groups = [
  { name: 'e2e-ui-parallel', files: ui, port: 3100, workers: 4 },
  ...shards.map(shard => ({ ...shard, workers: 1 })),
  { name: 'e2e-production', files: production, port: 0, workers: 2 },
]

// webServer 为全局配置。精确文件和项目选择只启动所需服务；
// 部分文件名、正则及其他不明确的参数交给 Playwright 完整筛选。
const args = process.argv.slice(process.argv.indexOf('test') + 1)
const projectFilters: string[] = []
const fileArgs: string[] = []
let ambiguousOptions = false
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if (arg === '--project') {
    while (args[i + 1] && !args[i + 1]!.startsWith('-'))
      projectFilters.push(args[++i]!)
  }
  else if (arg.startsWith('--project=')) {
    projectFilters.push(arg.slice('--project='.length))
  }
  else if (['-g', '--grep', '-G', '--grep-invert', '-j', '--workers', '--output', '--reporter', '--retries', '--timeout'].includes(arg)) {
    i++
  }
  else if (arg.startsWith('-') && !arg.includes('=') && !['--headed', '--list', '--quiet'].includes(arg)) {
    ambiguousOptions = true
  }
  else if (!arg.startsWith('-')) {
    fileArgs.push(arg.replaceAll('\\', '/').replace(/^(?:\.\/)?e2e\//, '').replace(/:\d+(?::\d+)?$/, ''))
  }
}
const exactFiles = !ambiguousOptions && fileArgs.length > 0 && fileArgs.every(path => specs.includes(path))
// 旧的 --project chromium 仍以一个 worker 连接独占的开发实例。
const legacyFiles = projectFilters.some(name => name.toLowerCase() === 'chromium')
  ? specs.filter(path => path !== 'runtime-visual-matrix.spec.ts')
  : []
groups.push({ name: 'chromium', files: legacyFiles, port: 3102, workers: 1 })
const selected = groups.filter(group =>
  (!projectFilters.length || projectFilters.some(pattern => matchesGlob(group.name.toLowerCase(), pattern.toLowerCase())))
  && (!exactFiles || group.files.some(path => fileArgs.includes(path))),
)
const startUI = !externalURL && selected.some(group => group.files === ui)
const detachedProductionSpecs = ['issue-330-auxiliary-contracts.spec.ts', 'payment-approval.spec.ts', 'tab-reopen.spec.ts']
const needsProductionBuild = selected.some(group =>
  ((group.files === production || group.files === legacyFiles) && process.env.CRM_PRODUCTION_ACCEPTANCE === '1')
  || detachedProductionSpecs.some(path => group.files.includes(path) && (!exactFiles || fileArgs.includes(path))),
)

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: externalURL || legacyFiles.length ? 1 : 4,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  // 分片名仅影响调度，已有 Chromium 截图仍按浏览器与平台定位。
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium-{platform}{ext}',
  projects: groups.map(group => ({
    name: group.name,
    testMatch: group.files.map(path => resolve('e2e', path).replaceAll('\\', '/')),
    workers: externalURL ? 1 : group.workers,
    fullyParallel: !externalURL && group.files === ui,
    use: { baseURL: externalURL ?? (group.port ? `http://127.0.0.1:${group.port}` : undefined) },
  })),
  globalSetup: !startUI && needsProductionBuild ? './e2e/helpers/build-application.ts' : undefined,
  webServer: [
    ...(startUI
      ? [{
          name: 'compiled-ui',
          command: 'pnpm build && node .output/server/index.mjs',
          env: { NITRO_HOST: '127.0.0.1', NITRO_PORT: '3100', CRM_RUN_MODE: 'development', NUXT_DEVTOOLS: 'false', NUXT_PUBLIC_VISUAL_BASELINE_MODE: '' },
          url: uiURL,
          reuseExistingServer: false,
          timeout: 600_000,
        }]
      : []),
    ...(externalURL
      ? []
      : shards
          .filter(shard => selected.some(group => group.port === shard.port && group.files.some(path => path !== 'tab-reopen.spec.ts' && (!exactFiles || fileArgs.includes(path)))))
          .map(shard => isolatedDevServer(shard.port))),
  ],
})
