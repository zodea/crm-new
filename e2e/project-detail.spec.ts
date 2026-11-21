import type { ProjectListSourceRow } from '../app/lib/project/read-contract'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildProjectDetailRead, buildProjectListPage, parseProjectDetailQuery, parseProjectListQuery } from '../app/lib/project/read-page'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from '../server/utils/read-meta'
import { installProjectCentralFixture } from './helpers/project-central-fixture'

test.describe('项目详情', () => {
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
})

test.describe('项目指标', () => {
  // 旧发票归档与项目范围的正向覆盖保留在 tests/stores/invoice-archive.test.ts、
  // tests/project/detail-aggregate.test.ts、tests/project/management-fee.test.ts 和 tests/components/ProjectDetailScreen.test.ts。
  // 中央详情不把本地票面差额、缺失收款来源或未接管税款展示成真实税额。
  const SOURCE_FAILURES = [
    { status: 'unavailable', reason: 'receipt-source:unavailable', label: '收款来源暂时不可用，请重新读取' },
    { status: 'forbidden', reason: 'receipt-source:forbidden', label: '当前无权读取收款事实' },
  ] as const

  for (const failure of SOURCE_FAILURES) {
    test(`收款来源 ${failure.status}：未知金额不冒零，基础资料仍可查看`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page)
      const dto = await fixture.read()
      await page.route(`**/api/read/projects/${fixture.id}?*`, route => route.fulfill({
        json: { ...dto, item: { ...dto.item, income: { ...dto.item.income, value: null, status: 'undefined', missingSources: [failure.reason] } } },
      }))
      await fixture.open()

      const receipts = page.getByRole('region', { name: '项目收款', exact: true })
      await expect(receipts).toContainText(failure.label)
      await expect(receipts.getByText('有效收款 ¥0.00', { exact: true })).toHaveCount(0)
      await expect(receipts.getByRole('link', { name: '查看收款登记', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: '票据信息', exact: true })).toHaveCount(0)
      await expect(page.getByRole('group', { name: '增值税', exact: true })).toHaveCount(0)
      await expect(page.getByRole('group', { name: '税负率', exact: true })).toHaveCount(0)
      expect(fixture.errors).toEqual([])
    })
  }
})

test.describe('项目子表', () => {
  // 归档发票范围与金额仍由 tests/project/detail-aggregate.test.ts 保护；
  // 当前领域取数由对应中央存储、读取及来源故障测试保护，无入口的旧子表已清理。
  // 当前项目商务卡片进入各领域中央列表，不再要求本地十页签或固定演示金额。
  const JOURNEYS = [
    { name: '甲方变洽签', path: '/owner/change', kind: 'change' },
    { name: '月度报量', path: '/owner/report', kind: 'report' },
    { name: '竣工验收', path: '/owner/acceptance', kind: 'acceptance', variant: 'acceptance' },
    { name: '保修管理', path: '/owner/acceptance', kind: 'warranty', variant: 'warranty' },
    { name: '最终结算', path: '/owner/final-settlement', kind: 'final-settlement' },
    { name: '甲方罚扣', path: '/owner/penalty', kind: 'penalty' },
    { name: '项目罚扣', path: '/project/penalty', kind: 'project-penalty' },
    { name: '分包结算', path: '/subcontract/settlement', kind: 'sub-settlement' },
    { name: '分包变洽签', path: '/subcontract/change', kind: 'sub-change' },
  ] as const

  for (const journey of JOURNEYS) {
    test(`项目商务 ${journey.name}：中央目标保留项目、来源与返回锚点`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page)
      await fixture.open()
      const section = page.getByRole('region', { name: /^项目商务单据/ })
      const link = section.getByRole('link', { name: new RegExp(`^${journey.name}\\s`) })
      await expect(link).toBeVisible()
      const target = new URL((await link.getAttribute('href'))!, page.url())
      expect(target.pathname).toBe(journey.path)
      expect(target.searchParams.get('projectId')).toBe(fixture.id)
      expect(target.searchParams.get('origin')).toBe('real')
      expect(target.searchParams.get('variant')).toBe('variant' in journey ? journey.variant : null)
      const returnTo = new URL(target.searchParams.get('returnTo')!, page.url())
      expect(returnTo.pathname).toBe(`/project/${fixture.id}`)
      expect(returnTo.searchParams.get('origin')).toBe('real')
      expect(returnTo.searchParams.get('ownerJourney')).toBeTruthy()
      expect(returnTo.hash).toBe(`#project-owner-document-card-${journey.kind}`)

      await link.click()
      await expect(page).toHaveURL(target.href)
      expect(fixture.errors).toEqual([])
    })
  }
})
