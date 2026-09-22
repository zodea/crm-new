import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetCustomerBackend(request: APIRequestContext, sessionId: string) {
  const response = await request.post('/api/testing/customers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId },
    data: { scenario: 'ready' },
  })
  expect(response.ok()).toBe(true)
}

async function seedFormalCustomers(request: APIRequestContext, sessionId: string, count: number) {
  const ids: string[] = []
  for (let index = 1; index <= count; index += 1) {
    const response = await request.post('/api/commands/customers', {
      headers: { 'x-ruihang-test-session': sessionId },
      data: {
        workspaceId: 'workspace-default',
        actorId: 'actor-default',
        requiredCapability: 'customer:write',
        commandId: `command-page-${index}`,
        baseVersion: null,
        action: 'save',
        draft: { name: `补充分页客户 ${String(index).padStart(2, '0')}`, contact: '陈经理', status: 'active' },
        attachments: {},
      },
    })
    expect(response.ok()).toBe(true)
    ids.push((await response.json() as { id: string }).id)
  }
  return ids
}

async function createFormalCustomer(page: Page, name: string) {
  await page.goto('/base/customer')
  await expect(page.getByRole('heading', { name: '客户档案' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '新建客户' }).first().click()
  await page.getByLabel('客户名称 *').fill(name)
  await page.getByLabel('联系人').fill('陈经理')
  await page.getByLabel('联系电话').fill('13800000000')
  const response = page.waitForResponse(candidate => candidate.url().includes('/api/commands/customers')
    && candidate.request().method() === 'POST')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('Issue #314：客户中央列表—详情—显式编辑链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetCustomerBackend(page.context().request, sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetCustomerBackend(page.context().request, testSession(testInfo))
  })

  test('新建、详情显式编辑、保存刷新与带筛选返回都经过中央后台', async ({ page }) => {
    await createFormalCustomer(page, '中央链路客户')
    const customerId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!

    await page.getByRole('link', { name: '返回客户列表' }).click()
    const search = page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })
    await search.fill('中央链路')
    const rowLink = page.getByRole('link', { name: '中央链路客户', exact: true }).first()
    await expect(rowLink).toBeVisible()
    await rowLink.click()

    await expect(page).toHaveURL(new RegExp(`/base/customer/${customerId}\\?origin=real&returnTo=.*&returnContext=`))
    await page.getByRole('link', { name: '编辑客户' }).click()
    await expect(page).toHaveURL(new RegExp(`/base/customer/form/${customerId}\\?origin=real`))
    await page.getByLabel('客户名称 *').fill('中央链路客户（已编辑）')
    const update = page.waitForResponse(candidate => candidate.url().includes(`/api/commands/customers/${customerId}`)
      && candidate.request().method() === 'PUT')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    expect((await update).ok()).toBe(true)
    await expect(page).toHaveURL(new RegExp(`/base/customer/${customerId}\\?origin=real`))
    await expect(page.getByRole('heading', { name: '中央链路客户（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央链路客户（已编辑）' })).toBeVisible()

    const serverName = await page.evaluate(async id => (await (await fetch(`/api/read/customers/${id}/form`)).json()).draft.name as string, customerId)
    expect(serverName).toBe('中央链路客户（已编辑）')
    await page.getByRole('link', { name: '返回客户列表' }).click()
    await expect(search).toHaveValue('中央链路')
    await expect(page.getByRole('link', { name: '中央链路客户（已编辑）', exact: true }).first()).toBeFocused()
  })

  test('真实关系、零关系、关系缺失与无权限都在中央详情中保持语义', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const [emptyCustomerId] = await seedFormalCustomers(page.context().request, testSession(testInfo), 1)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.goto('/base/customer?search=合和')
    const customerSearch = page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })
    await expect(customerSearch).toHaveValue('合和', { timeout: 20_000 })
    await page.getByRole('link', { name: '合和地产集团', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: '合和地产集团' })).toBeVisible({ timeout: 20_000 })

    const project = page.getByRole('link', { name: '合和新城' })
    await expect(project).toHaveAttribute('href', /\/project\/proj_demo_001\?origin=demo&returnTo=/)
    await project.click()
    await expect(page).toHaveURL(/\/project\/proj_demo_001\?origin=demo/)
    await page.reload()
    await page.getByRole('link', { name: '返回客户详情' }).click()
    await expect(page.getByRole('heading', { name: '合和地产集团' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /名下项目/ })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: /施工合同/ }).click()
    const contract = page.getByRole('link', { name: '合和新城施工总承包合同' })
    await expect(contract).toHaveAttribute('href', /\/contract\/con_demo_sg01\?origin=demo&contractKind=construction&returnTo=/)
    await contract.click()
    await expect(page).toHaveURL(/\/contract\/con_demo_sg01/)
    await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
    await expect(contract).toBeFocused()

    await page.getByRole('tab', { name: /收款明细/ }).click()
    const receipt = page.getByRole('link', { name: 'SK-2026-001' })
    await receipt.click()
    await expect(page).toHaveURL(/\/finance\/receipt\/rr_mz0x1_0\?origin=demo/)
    await expect(page.getByRole('heading', { name: 'SK-2026-001' })).toBeFocused()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'SK-2026-001' })).toBeVisible()
    await page.getByRole('link', { name: '返回客户收款明细' }).click()
    await expect(page.getByRole('tab', { name: /收款明细/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('未记录', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回客户列表' }).click()
    await expect(page).toHaveURL(/search=%E5%90%88%E5%92%8C/)
    await expect(customerSearch).toHaveValue('合和')
    await expect(page.getByRole('link', { name: '合和地产集团', exact: true }).first()).toBeFocused()

    await page.goto('/base/customer/customer_demo_003?origin=demo')
    await expect(page.getByRole('tab', { name: '名下项目 0', exact: true })).toBeVisible()
    await expect(page.locator('[data-customer-project-id]')).toHaveCount(0)

    await page.goto(`/base/customer/${emptyCustomerId}?origin=real`)
    await expect(page.getByRole('tabpanel', { name: '名下项目' }).getByText('暂无名下项目', { exact: true }).nth(1))
      .toBeVisible()
  })

  test('未携带中央来源的既有收款降级为普通文本，编辑仍是独立动作', async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.goto('/finance/receipt')
    await expect(page.getByTestId('non-central-receipt-name').filter({ hasText: '合和地产集团' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '合和地产集团', exact: true })).toHaveCount(0)

    await page.getByTitle('编辑').first().click()
    await expect(page).toHaveURL('/finance/receipt/form/rr_mz0x1_0')
    await expect(page.getByRole('heading', { name: '编辑 · 收款登记' })).toBeVisible()
  })

  test('返回列表恢复状态、排序、非默认页码、每页条数、滚动与行焦点', async ({ page }, testInfo) => {
    await seedFormalCustomers(page.context().request, testSession(testInfo), 10)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setViewportSize({ width: 1024, height: 300 })
    await page.goto('/base/customer?status=active&sort=name-asc&page=2&pageSize=20')
    await expect(page.getByRole('button', { name: '关闭测试数据' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('每页条数')).toHaveValue('20')
    await expect(page.getByRole('combobox', { name: '排序' })).toContainText('名称升序')
    await expect(page.getByRole('combobox', { name: '档案状态' })).toContainText('active')

    const workspace = page.locator('[data-shell-workspace]')
    await workspace.evaluate((element) => {
      element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight)
    })
    const expectedScroll = await workspace.evaluate(element => element.scrollTop)
    expect(expectedScroll).toBeGreaterThan(0)
    const rowLink = page.locator('[data-ui="customer-list-table"] a.cell--link').first()
    const customerName = (await rowLink.textContent())?.trim() ?? ''
    expect(customerName).not.toBe('')
    await rowLink.click()
    await expect(page.getByRole('heading', { name: customerName })).toBeVisible()
    await expect(page.getByRole('heading', { name: customerName })).toBeFocused()
    await page.reload()
    await expect(page.getByRole('heading', { name: customerName })).toBeVisible()
    await page.getByRole('link', { name: '返回客户列表' }).click()

    await expect(page).toHaveURL(/status=active/)
    await expect(page).toHaveURL(/sort=name-asc/)
    await expect(page).toHaveURL(/page=2/)
    await expect(page).toHaveURL(/pageSize=20/)
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('每页条数')).toHaveValue('20')
    await expect(page.getByRole('combobox', { name: '排序' })).toContainText('名称升序')
    await expect(page.getByRole('combobox', { name: '档案状态' })).toContainText('active')
    await expect(page.getByRole('link', { name: customerName, exact: true }).first()).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(expectedScroll)

    const missingContext = 'origin_missingrow123'
    const missingAnchor = 'customer-row-real%3Amissing'
    const missingReturnTo = `/base/customer?nav=${missingContext}#customer-row-real%253Amissing`
    await page.evaluate(({ contextId, anchorId, returnTo }) => {
      sessionStorage.setItem(`ruihang:customer-return:${contextId}`, JSON.stringify({
        id: contextId,
        returnTo,
        tabKey: '/base/customer',
        anchorId,
        scrollTop: 0,
        expiresAt: Date.now() + 60_000,
      }))
    }, { contextId: missingContext, anchorId: missingAnchor, returnTo: missingReturnTo })
    await page.goto(missingReturnTo)
    await expect(page.locator('[data-customer-list-return-fallback]')).toBeFocused()
  })

  test('来源错配、缺失和无权限不是空列表伪装', async ({ page }, testInfo) => {
    await page.goto('/base/customer/customer_demo_001?origin=real')
    await expect(page.getByRole('alert', { name: '客户详情加载失败' })).toContainText('来源')

    await page.goto('/base/customer/not-exists?origin=real')
    await expect(page.getByRole('status', { name: '客户不存在或已删除' })).toBeVisible()

    await resetCustomerBackend(page.context().request, testSession(testInfo))
    await page.context().request.post('/api/testing/customers/reset', {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': testSession(testInfo) },
      data: { scenario: 'forbidden' },
    })
    await page.goto('/base/customer')
    await expect(page.getByRole('status', { name: '客户列表加载失败' })).toContainText('无客户查看权限')
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 客户列表—详情—表单不产生页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await createFormalCustomer(page, `响应式客户 ${width}`)
      await expectNoPageOverflow(page, `#314 客户详情 @ ${width}px`)
      await page.getByRole('link', { name: '编辑客户' }).click()
      await expect(page.getByRole('heading', { name: '编辑 · 客户' })).toBeVisible()
      await expectNoPageOverflow(page, `#314 客户表单 @ ${width}px`)
      await page.getByRole('button', { name: '取消' }).click()
      await page.getByRole('link', { name: '返回客户列表' }).click()
      await expectNoPageOverflow(page, `#314 客户列表 @ ${width}px`)
    })
  }
})
