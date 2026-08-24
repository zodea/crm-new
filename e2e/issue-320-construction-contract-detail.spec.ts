import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'
const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/construction-contracts/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #320：施工合同专属中央详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('施工专属列表进入七分区详情，null 竣工事实与真实空态刷新保持', async ({ page }) => {
    await page.goto('/contract/construction?search=合和新城')
    await expect(page.getByTestId('construction-contract-list')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('实际竣工日期').first()).toBeVisible()
    await expect(page.getByText('未记录').first()).toBeVisible()
    await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/con_demo_sg01\?origin=demo&contractKind=construction&returnTo=/)
    await expect(page.getByRole('tab')).toHaveCount(7)
    await expect(page.getByTestId('construction-actual-completion')).toHaveText('未记录')
    await expect(page.getByTestId('construction-actual-completion')).not.toHaveText('2025-09-01')
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('link', { name: '合和地产集团' })).toHaveAttribute('href', '/base/customer/customer_demo_001?origin=demo')

    await page.getByRole('tab', { name: /补充合同/ }).click()
    await expect(page.getByText('材料调价补充协议')).toBeVisible()
    await page.getByRole('tab', { name: /甲方变洽签/ }).click()
    await expect(page.getByText('已审定甲方变洽签')).toBeVisible()
    await expect(page.getByRole('link', { name: '已审定甲方变洽签' })).toHaveCount(0)
    await page.getByRole('tab', { name: '验收结算' }).click()
    await expect(page.getByText('2026 年 6 月月度报量')).toBeVisible()
    await expect(page.getByRole('link', { name: '2026 年 6 月月度报量' })).toHaveCount(0)
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无验收或最终结算' })).toBeVisible()
    await page.getByRole('tab', { name: '票税管理' }).click()
    await expect(page.getByText('2026年6月进度开票申请')).toBeVisible()
    await expect(page.getByRole('link', { name: '2026年6月进度开票申请' })).toHaveCount(0)
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '开票申请状态不冒充已开票事实' })).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '开票申请状态不冒充已开票事实' })).toBeVisible()
    await page.getByRole('tab', { name: /收款登记/ }).click()
    await expect(page.getByRole('link', { name: '合和地产集团进度收款' })).toHaveAttribute('href', '/finance/receipt/rr_mz0x1_0?origin=demo&customerId=customer_demo_001')
    await page.getByRole('tab', { name: '竣工验收及保修' }).click()
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无竣工验收记录' })).toBeVisible()
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无保修到期记录' })).toBeVisible()
  })

  test('既有正式合同从显式编辑保存后返回同一详情并可刷新', async ({ page }) => {
    await page.goto('/contract/construction?search=既有中央')
    await page.getByRole('link', { name: '既有中央施工合同' }).click()
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible()
    await expect(page.getByTestId('construction-contract-boq')).toHaveAttribute('href', '/contract/boq?project=project-real-320&contract=construction-contract-existing-320')
    await page.getByRole('tab', { name: /收款登记/ }).click()
    await expect(page).toHaveURL(/tab=receipts/)
    await page.getByTestId('construction-contract-edit').click()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央施工合同')
    await page.getByLabel('合同名称 *').fill('既有中央施工合同（已编辑）')
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/construction-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '既有中央施工合同（已编辑）' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /收款登记/ })).toHaveAttribute('aria-selected', 'true')
    await page.reload()
    await expect(page.getByRole('heading', { name: '既有中央施工合同（已编辑）' })).toBeVisible()
  })

  test('BOQ 稳定目标不存在时保持原身份并显示不可用态', async ({ page }) => {
    await page.goto('/contract/boq?project=proj_demo_001&contract=con_demo_sg01')
    await expect(page.getByTestId('boq-workspace-header').getByRole('link', { name: '合和新城施工总承包合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: '主合同管理' }).click()
    await page.locator('nav a[href="/contract/construction"]').click()
    await page.getByRole('textbox', { name: '搜索施工合同' }).fill('既有中央')
    await page.getByRole('link', { name: '既有中央施工合同' }).click()
    await page.getByTestId('construction-contract-boq').click()

    await expect(page).toHaveURL(/\/contract\/boq\?project=project-real-320&contract=construction-contract-existing-320$/)
    await expect(page.getByText('指定的施工合同清单不可用')).toBeVisible()
    await expect(page.getByTestId('boq-workspace-header').getByRole('link', { name: '合和新城施工总承包合同' })).toHaveCount(0)
    await expect(page.getByTestId('boq-workspace-header').getByText('既有中央施工合同')).toHaveCount(0)
  })

  test('正式施工合同经中央命令新建、详情与刷新闭合', async ({ page }) => {
    await page.goto('/contract/construction/form')
    await expect(page.getByRole('heading', { name: /新建 · 施工合同/ })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('合同名称 *').fill('中央正式施工合同')
    await page.getByRole('combobox', { name: '检索项目' }).click()
    await page.getByText('中央正式施工项目').click()
    await page.getByRole('combobox', { name: '检索客户' }).click()
    await page.getByText('中央正式甲方客户').click()
    await page.getByLabel('合同内容简述 *').fill('正式住宅施工')
    await page.getByLabel('签约日期 *').fill('2026-08-24')
    const created = page.waitForResponse(response => response.url().endsWith('/api/commands/construction-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    const createdResponse = await created
    expect(createdResponse.status(), await createdResponse.text()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '中央正式施工合同' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式施工合同' })).toBeVisible()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 列表与七分区详情无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/contract/construction?search=合和新城')
      await expect(page.getByTestId('construction-contract-list')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#320 施工合同列表 @ ${width}px`)
      await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
      await expect(page.getByTestId('construction-contract-detail')).toBeVisible()
      await expectNoPageOverflow(page, `#320 施工合同详情 @ ${width}px`)
      await page.getByRole('tab', { name: '验收结算' }).click()
      await expectNoPageOverflow(page, `#320 施工合同验收结算 @ ${width}px`)
    })
  }
})
