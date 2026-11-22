import { readdirSync } from 'node:fs'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const VISUAL_SPEC = /(?:runtime-visual-matrix|issue-169-responsibility-dialog)\.spec\.ts/
const PRODUCTION_SPEC = /[\\/]production-[^\\/]+\.spec\.ts$/

// 中央 spec 按文件名排序后交替分入两组，各连一个独立 dev server（独立进程内存、构建与 Vite 缓存目录）。
// 每组内仍只有一个 worker：迁入验收会重置该组 dev server 的默认中央仓库，每案独占重置、接管和回读旅程。
const centralSpecs = readdirSync('e2e').filter(name => name.endsWith('.spec.ts') && !name.startsWith('production-') && !VISUAL_SPEC.test(name)).sort()
const centralGroups = [0, 1].map(group => centralSpecs.filter((_, index) => index % 2 === group).map(name => `**/e2e/${name}`))
const centralServerOptions: { port: number, env: Record<string, string> }[] = [
  { port: Number(process.env.PLAYWRIGHT_PORT ?? 3100), env: {} },
  { port: Number(process.env.PLAYWRIGHT_PORT_B ?? 3102), env: { NUXT_BUILD_DIR: process.env.PLAYWRIGHT_NUXT_BUILD_DIR_B ?? '.tmp/e2e-nuxt-b' } },
]
const centralServers = centralServerOptions.map(server => ({ ...server, url: `http://127.0.0.1:${server.port}` }))

// 只选 production 项目时不启动 dev server：这些 spec 各自启动 .output 构建产物与隔离数据目录。
// 与 Playwright CLI 一致：`--project a b` 连续取值到下一个选项为止，`--project=a` 取单值。
const selectedProjects: string[] = []
process.argv.forEach((arg, index, all) => {
  if (arg.startsWith('--project=')) {
    selectedProjects.push(arg.slice('--project='.length))
  }
  else if (arg === '--project') {
    const end = all.findIndex((next, at) => at > index && next.startsWith('-'))
    selectedProjects.push(...all.slice(index + 1, end === -1 ? undefined : end))
  }
})
const productionOnly = selectedProjects.length > 0 && selectedProjects.every(name => name === 'production')
const activeCentralServers = selectedProjects.length === 0
  ? centralServers
  : centralServers.filter((_, group) => selectedProjects.includes(group ? 'chromium-b' : 'chromium'))

export default defineConfig({
  testDir: './e2e',
  testIgnore: VISUAL_SPEC,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // CI 的开发服务器在 HTML 可响应时，客户端模块仍可能在首次按需编译。
  // 先用隔离浏览器确认外壳就绪，不改变任何业务测试的断言或超时。
  globalSetup: process.env.CI && process.env.E2E_PROJECT ? './e2e/helpers/warm-dev-server.ts' : undefined,
  retries: process.env.CI ? 2 : 0,
  // 本机冷启动的模块加载可能超过默认 5 秒；仍需等到相同的可观察结果。
  expect: { timeout: 15_000 },
  // 两个中央组各 1 个 worker，production 组 3 个。
  workers: 5,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    screenshot: 'only-on-failure',
    // 首次失败也保留追踪，重试通过时仍可定位间歇性的导航和加载问题。
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    ...(externalBaseURL
      ? [{ name: 'chromium', testIgnore: [VISUAL_SPEC, PRODUCTION_SPEC], workers: 1, use: { ...devices['Desktop Chrome'], baseURL: externalBaseURL } }]
      : centralServers.map((server, group) => ({
          name: group ? 'chromium-b' : 'chromium',
          testMatch: centralGroups[group],
          workers: 1,
          // 截图基线文件名默认含项目名；两组同为 Desktop Chrome，共用已检入的 chromium 基线。
          snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium{-snapshotSuffix}{ext}',
          use: { ...devices['Desktop Chrome'], baseURL: server.url },
        }))),
    {
      // 各自 spawn .output/server/index.mjs、探测空闲端口并使用 mkdtemp 数据目录，与中央 dev server 互不影响；须先 nuxt build。
      name: 'production',
      testMatch: PRODUCTION_SPEC,
      workers: 3,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalBaseURL || productionOnly
    ? undefined
    : activeCentralServers.map(server => ({
        command: `node ./node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port ${server.port}`,
        env: {
          NUXT_DEVTOOLS: 'false',
          NUXT_IGNORE_LOCK: '1',
          ...server.env,
        },
        url: server.url,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      })),
})
