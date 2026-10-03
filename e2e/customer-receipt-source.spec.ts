import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
test.setTimeout(120_000)

const RECEIPT_INPUT = { customerId: 'customer-real-320', customerName: '中央正式甲方客户', projectId: 'project-real-320', contractId: 'construction-contract-existing-320', no: 'SK-CUSTOMER-426', amount: '900000.00', expectedAmount: '¥900,000.00', date: '2026-09-11', referenceTime: '2026-09-15T04:00:00.000Z' }
const SOURCE_CASES = [
  { scenario: 'forbidden', title: '无权查看收款明细', role: 'status', retryable: false, status: 403 },
  { scenario: 'unavailable', title: '收款明细加载失败', role: 'alert', retryable: true, status: 503 },
] as const

async function reset(page: Page, domain: string, scenario: string, seed = false) {
  const response = await page.context().request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1' },
    data: { scenario, seed },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `customer-receipt-426-${randomUUID()}` })
  await page.clock.install({ time: new Date(RECEIPT_INPUT.referenceTime) })
  await page.goto('/base/customer')
  await expect(page.getByRole('heading', { name: '客户', exact: true })).toBeVisible({ timeout: 60_000 })
  await reset(page, 'customers', 'ready')
  await reset(page, 'construction-contracts', 'ready')
  await reset(page, 'receipts', 'ready', true)
})

async function seedReceipt(page: Page) {
  const contextResponse = await page.context().request.get('/api/read/receipts/context')
  expect(contextResponse.ok(), await contextResponse.text()).toBe(true)
  const { workspaceId, actorId } = await contextResponse.json()
  const response = await page.context().request.post('/api/commands/receipts', { data: {
    workspaceId,
    actorId,
    commandId: randomUUID(),
    requiredCapability: 'receipt:write',
    baseVersion: null,
    action: 'submit',
    origin: 'real',
    attachments: {},
    draft: { no: RECEIPT_INPUT.no, receiptDate: RECEIPT_INPUT.date, projectId: RECEIPT_INPUT.projectId, customerId: RECEIPT_INPUT.customerId, contractId: RECEIPT_INPUT.contractId, amount: RECEIPT_INPUT.amount, payerAccount: '', paymentMethod: '银行转账', acceptanceBillNo: '', billDueDate: '', periodNo: '', bankSerialNo: '', handler: '', reviewStatus: '待审核', status: 'draft', note: '' },
  } })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).id as string
}

const customerPath = `/base/customer/${RECEIPT_INPUT.customerId}?origin=real&tab=receipts`

test('中央收款按当前会话读取，源撤回后客户与收款详情都不保留固定样例', async ({ page }) => {
  await page.goto(customerPath)
  await expect(page.getByRole('heading', { name: RECEIPT_INPUT.customerName, exact: true })).toBeVisible()
  await expect(page.getByText('暂无收款记录', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText('¥0.00')
  const receiptId = await seedReceipt(page)
  await page.reload()
  await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText(RECEIPT_INPUT.expectedAmount)
  await page.getByRole('link', { name: RECEIPT_INPUT.no, exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === `/finance/receipt/${receiptId}` && url.searchParams.get('origin') === 'real')
  await expect(page.getByRole('heading', { name: RECEIPT_INPUT.no, exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText(RECEIPT_INPUT.expectedAmount)
  await reset(page, 'receipts', 'ready', true)
  const withdrawn = await page.context().request.get(`/api/read/receipts/${receiptId}/record?origin=real`)
  expect(withdrawn.status()).toBe(404)
  await page.reload()
  await expect(page.getByRole('status', { name: '详情不存在或已删除', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '登记金额', exact: true })).toHaveCount(0)
  await page.goto(customerPath)
  await expect(page.getByText('暂无收款记录', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText('¥0.00')
})

for (const input of SOURCE_CASES) {
  test(`收款来源${input.scenario}时保留客户、隐藏旧金额，恢复后可用键盘重试`, async ({ page }) => {
    const receiptId = await seedReceipt(page)
    await page.goto(customerPath)
    await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText(RECEIPT_INPUT.expectedAmount)
    await reset(page, 'receipts', input.scenario)
    await page.reload()
    await expect(page.getByRole('heading', { name: RECEIPT_INPUT.customerName, exact: true })).toBeVisible()
    await expect(page.getByRole(input.role, { name: input.title, exact: true })).toBeVisible()
    for (const label of ['有效收款', '待收差额'])
      await expect(page.getByRole('group', { name: label, exact: true })).toContainText('—')
    await expect(page.getByRole('link', { name: RECEIPT_INPUT.no, exact: true })).toHaveCount(0)
    const restricted = await page.context().request.get(`/api/read/receipts/${receiptId}/record?origin=real`)
    expect(restricted.status()).toBe(input.status)
    expect(await restricted.text()).not.toContain(RECEIPT_INPUT.amount)
    await reset(page, 'receipts', 'ready')
    if (input.retryable) {
      const retry = page.getByRole('button', { name: '重新加载收款明细', exact: true })
      await retry.focus()
      await page.keyboard.press('Enter')
    }
    else {
      await page.reload()
    }
    await expect(page.getByRole('link', { name: RECEIPT_INPUT.no, exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '有效收款', exact: true })).toContainText(RECEIPT_INPUT.expectedAmount)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1024 })
      await expectNoPageOverflow(page, `客户收款 ${width}px`)
      const receipt = page.getByRole('link', { name: RECEIPT_INPUT.no, exact: true })
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
}
