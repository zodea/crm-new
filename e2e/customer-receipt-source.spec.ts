import type { Page, TestInfo } from '@playwright/test'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
test.setTimeout(120_000)

async function reset(page: Page, domain: string, scenario: string) {
  const response = await page.context().request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1' },
    data: { scenario },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function setup(page: Page, info: TestInfo) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `customer-receipt-426-${info.testId.replace(/[^\w-]/g, '-')}` })
  await page.goto('/base/customer')
  await expect(page.getByRole('heading', { name: '客户', exact: true })).toBeVisible({ timeout: 60_000 })
  await reset(page, 'customers', 'ready')
  await reset(page, 'construction-contracts', 'ready')
  await reset(page, 'owner-documents', 'empty')
}

const customerPath = '/base/customer/customer-real-320?origin=real&tab=receipts'

test('中央收款按当前会话读取，源撤回后客户与收款详情都不保留固定样例', async ({ page }, info) => {
  await setup(page, info)
  await page.goto(customerPath)
  await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
  await expect(page.getByText('暂无收款记录', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText('¥0.00')
  await reset(page, 'owner-documents', 'ready')
  await page.reload()
  await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText('¥900,000.00')
  await page.getByRole('link', { name: 'SK-2026-325', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'SK-2026-325', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('¥900,000.00')
  await reset(page, 'owner-documents', 'empty')
  await page.reload()
  await expect(page.getByRole('heading', { name: '收款记录不存在或已删除', exact: true })).toBeVisible()
  await page.goto(customerPath)
  await expect(page.getByText('暂无收款记录', { exact: true }).filter({ visible: true }).first()).toBeVisible()
})

test('收款来源失败或无权时保留客户、隐藏旧金额，恢复后可用键盘重试', async ({ page }, info) => {
  await setup(page, info)
  for (const scenario of ['forbidden', 'unavailable']) {
    await reset(page, 'owner-documents', scenario)
    await page.goto(customerPath)
    await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: scenario === 'forbidden' ? '无权查看收款明细' : '收款明细加载失败', exact: true })).toBeVisible()
    for (const label of ['有效收款', '待收差额'])
      await expect(page.getByRole('group', { name: label, exact: true })).toContainText('—')
    await expect(page.getByRole('link', { name: 'SK-2026-325', exact: true })).toHaveCount(0)
    if (scenario === 'unavailable') {
      await reset(page, 'owner-documents', 'ready')
      const retry = page.getByRole('button', { name: '重新加载收款明细', exact: true })
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('link', { name: 'SK-2026-325', exact: true })).toBeVisible()
    }
  }
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1024 })
    await expectNoPageOverflow(page, `客户收款 ${width}px`)
    const receipt = page.getByRole('link', { name: 'SK-2026-325', exact: true })
    await receipt.focus()
    await expect(receipt).toBeFocused()
    const scroll = page.locator('[data-customer-relations] .vxe-table--scroll-x-handle').first()
    if (width < 1440) {
      const moved = await scroll.evaluate((element) => {
        element.scrollLeft = Math.min(120, element.scrollWidth - element.clientWidth)
        return element.scrollLeft
      })
      expect(moved).toBeGreaterThan(0)
      await scroll.evaluate(element => element.scrollLeft = 0)
    }
    if (process.env.CRM_EVIDENCE_DIR)
      await page.screenshot({ path: `${process.env.CRM_EVIDENCE_DIR}/customer-receipts-${width}.png`, fullPage: true })
  }
})
