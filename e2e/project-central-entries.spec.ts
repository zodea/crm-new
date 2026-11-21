import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectInViewport, expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS, tabUntilFocused } from './helpers/responsive'

// 中央项目详情只读业务事实，从已接管领域入口穿透；尚未接管的本地阶段、文件柜、
// 成本预算、支出页签、往来支付、到货归档、验收保修页签与档案导出均不出现。

async function expectLink(page: Page, scope: Locator, name: RegExp | string, expected: { path: string, projectId: string, extra?: Record<string, string>, returnHash?: string }) {
  const link = typeof name === 'string' ? scope.getByRole('link', { name, exact: true }) : scope.getByRole('link', { name })
  await expect(link).toBeVisible()
  const target = new URL((await link.getAttribute('href'))!, page.url())
  expect(target.pathname, String(name)).toBe(expected.path)
  expect(target.searchParams.get('projectId'), String(name)).toBe(expected.projectId)
  expect(target.searchParams.get('origin'), String(name)).toBe('real')
  for (const [key, value] of Object.entries(expected.extra ?? {}))
    expect(target.searchParams.get(key), `${String(name)} ${key}`).toBe(value)
  const returnTo = target.searchParams.get('returnTo')
  if (returnTo) {
    const source = new URL(returnTo, page.url())
    expect(source.pathname, String(name)).toBe(`/project/${expected.projectId}`)
    if (expected.returnHash)
      expect(source.hash, String(name)).toBe(expected.returnHash)
  }
  return { link, target }
}

test('中央项目详情：基础资料与各领域入口保持正式身份，未接管的本地能力不出现，各宽度不溢出', async ({ page }) => {
  const input = PROJECT_INPUTS[0]
  const fixture = await installProjectCentralFixture(page, input)
  expect((await fixture.read()).item.budget.value).toBeNull()
  await fixture.open()
  await page.reload()
  await expect(page).toHaveURL(fixture.url)

  const readonly = page.getByRole('status', { name: '中央项目只读详情', exact: true })
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.status)
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.code)
  await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(input.address)
  await expect(readonly.getByRole('group', { name: '参建单位' })).toContainText(input.manager)
  await expect(readonly.getByRole('group', { name: '系统信息' })).toBeVisible()
  await expect(readonly.getByRole('textbox')).toHaveCount(0)
  await expect(readonly.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '编辑项目', exact: true })).toHaveAttribute('href', `/project/form/${fixture.id}?origin=real`)

  for (const name of ['编辑阶段', '导出项目档案包'])
    await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0)
  for (const name of ['成本预算', '支出合同管理', '物资管理', '竣工验收及保修'])
    await expect(page.getByRole('tab', { name, exact: true }), name).toHaveCount(0)
  for (const name of ['项目文件柜', '目标成本分类控制', '往来收款', '往来付款', '支付记录', '项目到货归档'])
    await expect(page.getByRole('region', { name, exact: true }), name).toHaveCount(0)
  await expect(page.getByRole('list', { name: '项目六阶段流程' })).toHaveCount(0)
  await expect(page.getByLabel(/上传.*阶段|上传施工组织设计方案文件/)).toHaveCount(0)

  const commercial = page.getByRole('region', { name: /^项目商务单据/ })
  await expectLink(page, page.getByRole('region', { name: '材料采购合同', exact: true }), '查看材料采购合同（0）', { path: '/contract/material', projectId: fixture.id })
  await expectLink(page, page.getByTestId('auxiliary-journey'), /其他支出合同/, { path: '/contract/other-expense', projectId: fixture.id })
  await expectLink(page, commercial, /分包变洽签/, { path: '/subcontract/change', projectId: fixture.id })
  await expectLink(page, commercial, /分包结算/, { path: '/subcontract/settlement', projectId: fixture.id })
  for (const [label, variant] of [['竣工验收', 'acceptance'], ['保修管理', 'warranty']] as const)
    await expectLink(page, commercial, new RegExp(`^${label}\\s`), { path: '/owner/acceptance', projectId: fixture.id, extra: { variant }, returnHash: `#project-owner-document-card-${variant}` })
  const receipt = await expectLink(page, page.getByRole('region', { name: '项目收款', exact: true }), '查看收款登记', { path: '/finance/receipt', projectId: fixture.id, returnHash: '#project-receipt-link' })

  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await expectInViewport(page.getByRole('link', { name: '编辑项目', exact: true }), `${width}px 正式整页编辑入口`)
    await expectNoPageOverflow(page, `${width}px 中央项目详情`)
  }

  await receipt.link.click()
  await expect(page).toHaveURL(receipt.target.href)
  expect(fixture.errors).toEqual([])
})

test('中央项目详情：材采与竣工验收入口可跳转，侧栏目标成本进入正式来源', async ({ page }) => {
  const fixture = await installProjectCentralFixture(page, PROJECT_INPUTS[1])
  await fixture.open()
  const material = await expectLink(page, page.getByRole('region', { name: '材料采购合同', exact: true }), '查看材料采购合同（0）', { path: '/contract/material', projectId: fixture.id })
  await material.link.click()
  await expect(page).toHaveURL(material.target.href)

  await fixture.open()
  const acceptance = await expectLink(page, page.getByRole('region', { name: /^项目商务单据/ }), /^竣工验收\s/, { path: '/owner/acceptance', projectId: fixture.id, extra: { variant: 'acceptance' } })
  await acceptance.link.click()
  await expect(page).toHaveURL(acceptance.target.href)

  const sidebar = page.locator('[data-sidebar="sidebar"]')
  await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('目标成本')
  const budgets = sidebar.getByRole('link', { name: '目标成本', exact: true })
  await expect(budgets).toHaveAttribute('href', '/project/target-cost')
  await budgets.click()
  await expect(page.getByRole('heading', { name: '目标成本列表', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '预算资料来源', exact: true })).toHaveValue('real')
  expect(fixture.errors).toEqual([])
})

// 现行只读来源穿透与未知事实覆盖保留在 tests/components/ProjectDetailScreen.test.ts、
// tests/production/finance-storage.test.ts；无入口的旧经营投影已清理。
// 中央已接旅程由当前来源感知卡片进入；未接管领域不重建本地十页签。
test('中央项目的材采、商务、工资与收款使用同一项目身份且来源不混合', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await installProjectCentralFixture(page)
  await fixture.open()
  const dto = await fixture.read()
  expect(dto.item.dataOrigin).toBe('real')
  expect(dto.item.project.id).toBe(fixture.id)
  expect(dto.item.budget.value).toBeNull()
  await expect(page.getByRole('region', { name: '材料采购合同', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: /^项目商务单据/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '工资实际收付', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '项目收款', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '项目经营数据', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '施工合同管理', exact: true })).toHaveCount(0)
  await expect(page.getByText('测试数据仅供查看。', { exact: true })).toHaveCount(0)
  expect(fixture.errors).toEqual([])
})

const VIEWPORTS = [
  { label: '390px', width: 390, height: 844, requireLocalScroll: true },
  { label: '768px', width: 768, height: 900, requireLocalScroll: true },
  { label: '1024px', width: 1024, height: 900, requireLocalScroll: false },
  { label: '1280px', width: 1280, height: 900, requireLocalScroll: false },
  { label: '1440px', width: 1440, height: 1000, requireLocalScroll: false },
  { label: '1440px @ 200%', width: 720, height: 900, requireLocalScroll: true },
] as const

test('中央项目各宽度保持页面边界，工资密表局部滚动及导航键盘可达', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await installProjectCentralFixture(page)
  await fixture.open()
  const table = page.getByRole('region', { name: '工资实际收付明细，可横向滚动', exact: true })
  await expect(table).toBeVisible()
  const receipts = page.getByRole('region', { name: '项目收款', exact: true }).getByRole('link', { name: '查看收款登记', exact: true })
  await tabUntilFocused(page, receipts)
  await expect(receipts).toBeInViewport()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(table).toBeVisible()
    await expectNoPageOverflow(page, `${viewport.label} 中央项目详情`)
    if (viewport.requireLocalScroll) {
      await expectLocalHorizontalScroll(table, `${viewport.label} 工资实际收付`)
      await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
    await receipts.scrollIntoViewIfNeeded()
    await expect(receipts, viewport.label).toBeInViewport()
  }
  expect(fixture.errors).toEqual([])
})

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetProjectBackend(request: APIRequestContext, sessionId: string) {
  const response = await request.post('/api/testing/projects/reset', {
    headers: {
      'x-ruihang-test-reset': '1',
      'x-ruihang-test-session': sessionId,
    },
    data: { scenario: 'ready' },
  })
  expect(response.ok()).toBe(true)
}

async function openProjectList(page: Page) {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects')
    && candidate.url().includes('includeDemo=true')
    && candidate.request().method() === 'GET',
  )
  await page.goto('/project')
  expect((await response).ok()).toBe(true)
  return page.getByRole('link', { name: '合和新城', exact: true }).first()
}

test.describe('Issue #312：项目 Target Registry', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.addInitScript((storageKey) => {
      localStorage.setItem(storageKey, 'true')
    }, DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetProjectBackend(page.context().request, sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetProjectBackend(page.context().request, testSession(testInfo))
  })

  test('中央语义目标生成稳定详情链接，点击与刷新都保持同一身份', async ({ page }) => {
    const projectLink = await openProjectList(page)
    await expect(projectLink).toBeVisible({ timeout: 20_000 })
    const href = await projectLink.getAttribute('href')
    expect(href).not.toBeNull()
    const target = new URL(href!, 'http://localhost')
    const returnContext = target.searchParams.get('returnContext')
    expect(target.pathname).toBe('/project/proj_demo_001')
    expect(target.searchParams.get('origin')).toBe('demo')
    expect(returnContext).toMatch(/^origin_[\w-]+$/)
    expect(target.searchParams.get('returnTo'))
      .toBe(`/project?nav=${returnContext}#project-row-demo%3Aproj_demo_001`)

    await projectLink.click()
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`)
      .toBe(href)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()

    await page.reload()
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`)
      .toBe(href)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()
  })

  test('错误来源与缺失身份分别呈现稳定空态，不按名称回退', async ({ page }) => {
    await page.goto('/project/proj_demo_001?origin=real')
    await expect(page.getByRole('status', { name: '项目身份与来源不匹配' }))
      .toContainText('项目存在，但 URL 来源与中央身份不一致')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '返回项目列表' })).toHaveAttribute('href', '/project')

    await page.goto('/project/__missing_project__?origin=demo')
    await expect(page.getByRole('status', { name: '项目不存在或当前来源不可见' }))
      .toBeVisible()
    await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toHaveCount(0)
  })
})
