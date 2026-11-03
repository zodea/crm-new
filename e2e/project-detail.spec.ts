import type { ProjectListSourceRow } from '../app/lib/project/read-contract'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildProjectDetailRead, buildProjectListPage, parseProjectDetailQuery, parseProjectListQuery } from '../app/lib/project/read-page'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from '../server/utils/read-meta'

// 固定合成只读来源，不依赖演示种子里的业务名称或 ID。
const PROJECTS = [
  { id: 'project-synthetic-detail-1', name: '合成详情项目甲' },
  { id: 'project-synthetic-detail-2', name: '合成详情项目乙' },
] as const
const asOf = '2026-09-08T00:00:00.000Z'
const rows: ProjectListSourceRow[] = PROJECTS.map(project => ({
  ...project,
  dataOrigin: 'demo',
  code: project.id,
  status: '施工中',
  contractAmount: null,
  operationType: '',
  startDate: null,
  plannedEnd: null,
  actualEnd: null,
  plannedDuration: null,
  manager: '',
  execManager: '',
  builder: '',
  customerId: null,
  customerName: null,
  customerPermission: 'allowed',
  secondaryCustomerId: null,
  secondaryCustomerName: null,
  secondaryCustomerPermission: 'allowed',
  contractName: '',
  contractor: '',
  region: '',
  riskLevel: '',
  address: '',
  income: null,
  budget: null,
  updatedAt: asOf,
}))

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `project-detail-${randomUUID()}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
  const response = await page.request.get('/api/read/business-session')
  expect(response.ok(), await response.text()).toBe(true)
  const session = await response.json()
  const sources = [{ key: 'projects', state: 'readable' as const, sourceVersion: 'synthetic-project-detail-v1', asOf }]
  await page.route(/\/api\/read\/projects(?:\/project-synthetic-detail-[12])?(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    const input = Object.fromEntries(url.searchParams)
    const id = url.pathname.split('/').at(-1)!
    if (id === 'projects') {
      const query = parseProjectListQuery(input)
      const meta = (dataOrigin: 'demo' | 'real') => createReadMeta({ session, schemaVersion: 'project-read-v2', operation: 'project:list', dataOrigin, asOf, coverage: 'complete', scope: { query: readQueryScope(query) }, sources })
      return route.fulfill({ json: withOriginReadMeta(buildProjectListPage({ rows, query, asOf, sourceVersion: 'synthetic-project-detail-v1', capabilities: session.capabilities }), { real: meta('real'), demo: meta('demo') }) })
    }
    const query = parseProjectDetailQuery(id, input)
    const detail = buildProjectDetailRead({ rows, query, asOf, sourceVersion: 'synthetic-project-detail-v1', capabilities: session.capabilities })
    const meta = createReadMeta({ session, schemaVersion: 'project-read-v2', operation: 'project:detail', dataOrigin: 'demo', asOf, coverage: 'complete', scope: { query: readQueryScope(query) }, sources })
    return route.fulfill({ json: withReadMeta(detail, meta) })
  })
})

for (const project of PROJECTS) {
  test(`项目列表↔详情：${project.name} 保留来源且复用同一页签`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/project')
    const tabBar = page.getByRole('navigation', { name: '已打开页面' })

    await page.getByRole('link', { name: project.name, exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}\\?origin=demo`))
    await expect(tabBar.getByRole('button', { name: project.name, exact: true }))
      .toHaveCount(1)
    await expect(page.getByRole('heading', { name: project.name, exact: true }))
      .toBeVisible()

    const tabCount = await tabBar.locator('[data-tab-trigger]').count()
    await tabBar.getByRole('button', { name: '项目列表', exact: true }).click()
    await expect(page).toHaveURL(/\/project$/)
    await page.getByRole('link', { name: project.name, exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}\\?origin=demo`))
    await expect(tabBar.locator('[data-tab-trigger]')).toHaveCount(tabCount)
    await expect(tabBar.getByRole('button', { name: project.name, exact: true }))
      .toHaveCount(1)

    expect(pageErrors, '列表到详情的只读关联旅程不应产生客户端运行错误').toEqual([])
  })
}

test('项目详情：缺失实体显示明确空态而非永远加载中', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/__missing_project__')
  await expect(page.getByText('项目不存在或当前来源不可见')).toBeVisible()
  await expect(page.getByRole('link', { name: '返回项目列表' })).toBeVisible()

  expect(pageErrors, '详情缺失态不应产生客户端运行错误').toEqual([])
})
