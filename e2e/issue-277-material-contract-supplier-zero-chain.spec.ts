import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string) {
  for (const domain of ['suppliers', 'projects', 'material-contracts'] as const) {
    const response = await request.post(`/api/testing/${domain}/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario: 'ready' },
    })
    expect(response.ok()).toBe(true)
  }
}

test.describe('Issue #277：项目—材采合同—分供方零值只读样板链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('既有正式合同共用中央分供方身份，零结算进入真实空表并恢复来源上下文', async ({ page }) => {
    await page.goto('/project?search=中央正式材料&page=1&pageSize=20')
    const projectLink = page.getByRole('link', { name: '中央正式材料项目', exact: true })
    await expect(projectLink).toBeVisible({ timeout: 20_000 })
    await projectLink.click()

    const workspace = page.locator('[data-shell-workspace]')
    const materialJourneyLink = page.getByRole('link', { name: '查看材料采购合同（1）' })
    await workspace.evaluate(element => element.scrollTop = 48)
    await materialJourneyLink.focus()
    const projectScrollTop = await workspace.evaluate(element => element.scrollTop)
    await materialJourneyLink.press('Enter')
    await page.getByLabel('搜索材料采购合同').fill('既有中央')
    const contractLink = page.getByRole('link', { name: '既有中央材料采购合同' })
    await expect(contractLink).toBeVisible()
    await contractLink.click()

    const supplierLink = page.getByRole('link', { name: '中央正式材料供应商' })
    await expect(supplierLink).toHaveAttribute('href', '/base/supplier/supplier-real-318?origin=real')
    await page.getByRole('tab', { name: /支出结算/ }).click()
    const supplierFactLink = page.getByRole('link', { name: '查看分供方结算事实' })
    await workspace.evaluate(element => element.scrollTop = 96)
    await supplierFactLink.focus()
    const contractScrollTop = await workspace.evaluate(element => element.scrollTop)
    await supplierFactLink.press('Enter')

    await expect(page.getByRole('heading', { name: '中央正式材料供应商' })).toBeVisible()
    const summary = page.getByTestId('supplier-summary')
    await expect(summary).toContainText('累计结算金额¥0.00')
    await expect(page).toHaveURL(/\/base\/supplier\/supplier-real-318\?.*tab=settlements.*returnTo=/)
    await expect(page.getByText('暂无结算事实', { exact: true }).nth(1)).toBeVisible()

    await page.getByRole('link', { name: '返回材料采购合同' }).click()
    await expect(page.getByRole('link', { name: '查看分供方结算事实' })).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(contractScrollTop)
    await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
    await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('既有中央')
    await expect(page.getByRole('link', { name: '既有中央材料采购合同' })).toBeFocused()
    await page.getByRole('link', { name: '返回项目详情' }).click()
    await expect(page.getByRole('link', { name: '查看材料采购合同（1）' })).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(projectScrollTop)
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })).toHaveValue('中央正式材料')
    await expect(page.getByRole('link', { name: '中央正式材料项目', exact: true })).toBeFocused()
  })
})
