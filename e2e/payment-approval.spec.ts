import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'
import { expectNoPageOverflow } from './helpers/responsive'

const widths = [390, 768, 1024, 1280, 1440]
test.use({ actionTimeout: 15_000 })

async function newApplication(page: Page) {
  await page.goto('/finance/payment/new')
  await page.getByRole('button', { name: '公司付款', exact: true }).click()
  await expect(page.getByTestId('finance-name')).toBeVisible()
}

async function saveDraft(page: Page) {
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/\/finance\/payment\/new$/)
  const button = page.getByRole('button', { name: '保存草稿', exact: true })
  await expect(button).not.toHaveAttribute('aria-busy', 'true')
  await expect(button).toBeDisabled()
}

async function openApplicationFromList(page: Page, name: string) {
  await page.locator('[data-ui="kit-table"]').getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).first().click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function reopenSavedApplication(page: Page, closeUnrestoredDetail = false) {
  await page.getByRole('button', { name: '返回付款申请', exact: true }).click()
  await expect(page).toHaveURL(/\/finance\/payment$/)
  await page.reload()
  if (closeUnrestoredDetail)
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '关闭 付款申请详情', exact: true }).click()
  await openApplicationFromList(page, '批复输入往返样例')
}

async function legacyApplication(page: Page) {
  await page.goto('/finance/payment-management')
  await expect(page.getByTestId('payment-management-table')).toBeVisible()
  await updateProductionSnapshot(page, (database) => {
    database.run(`
      INSERT INTO payment_applications (id, name, biz_type, apply_amount, approved_amount, approved_amount_origin, status)
        VALUES ('approval-legacy', '历史批复核验样例', '公司付款', 100, 0, 'legacy', 'approved');
      INSERT INTO payment_records (id, no, payee_name, payment_date, amount, voucher_no, bank_serial_no, confirmation_status, confirmed_by)
        VALUES ('approval-paid', 'ZF-439', '银行真实收款方', '2026-09-11', 30, 'V-439', 'BANK-439', 'needs_review', '核对人');
      INSERT INTO payment_record_application_allocations (id, payment_record_id, payment_application_id, allocated_amount)
        VALUES ('approval-paid-link', 'approval-paid', 'approval-legacy', 30);
      UPDATE payment_records SET confirmation_status = 'confirmed', confirmed_at = '2026-09-11T00:00:00.000Z' WHERE id = 'approval-paid';
    `)
  })
  await page.reload()
  await page.getByRole('button', { name: '付款状态，已选 1 项' }).click()
  await page.getByRole('button', { name: '清除', exact: true }).click()
  await openApplicationFromList(page, '历史批复核验样例')
}

test.describe('Issue #439 批复空值与明确零', () => {
  test('新建空批复、明确零、清空保存和刷新沿用真实输入语义', async ({ page }) => {
    test.setTimeout(120_000)
    await newApplication(page)
    await page.getByTestId('finance-name').fill('批复输入往返样例')
    await page.getByTestId('finance-amount').fill('100')
    const approval = page.getByRole('spinbutton', { name: '本期批复金额', exact: true })
    await expect(approval).toHaveValue('')
    await saveDraft(page)
    await reopenSavedApplication(page)
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('未填写')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥100.00')

    await page.getByTestId('payment-application-edit').click()
    await expect(approval).toHaveValue('')
    await approval.fill('0')
    await saveDraft(page)
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '批复输入往返样例 · 付款申请', exact: true }).click()
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('¥0.00')
    await page.getByTestId('payment-application-edit').click()
    await reopenSavedApplication(page, true)
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('¥0.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥0.00')
    await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)

    await page.getByTestId('payment-application-edit').click()
    await expect(approval).toHaveValue('0')
    await approval.fill('')
    await saveDraft(page)
    await reopenSavedApplication(page, true)
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥100.00')
  })

  test('历史零保持待核验与已付事实，取消不确认来源；五档视口可核对和编辑', async ({ page }, testInfo) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await legacyApplication(page)
    await expect(page.getByRole('group', { name: '已确认支付', exact: true })).toContainText('¥30.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('历史批复待核验')
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page.getByTestId('finance-amount')).toHaveValue('70')
    await page.getByRole('link', { name: '付款申请', exact: true }).click()
    await openApplicationFromList(page, '历史批复核验样例')
    await page.getByTestId('payment-application-edit').click()
    await page.getByRole('spinbutton', { name: '本期批复金额', exact: true }).fill('80')
    await page.getByRole('button', { name: '返回付款申请', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
    await openApplicationFromList(page, '历史批复核验样例')
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('历史批复待核验')

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `批复详情 ${width}`)
      const edit = page.getByTestId('payment-application-edit')
      await edit.focus()
      await expect(edit).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`approval-detail-${width}.png`), fullPage: true })
      await edit.press('Enter')
      const approval = page.getByRole('spinbutton', { name: '本期批复金额', exact: true })
      await approval.scrollIntoViewIfNeeded()
      await approval.focus()
      await expect(approval).toBeFocused()
      await expect(approval).toHaveValue('0')
      await expectNoPageOverflow(page, `批复表单 ${width}`)
      await page.screenshot({ path: testInfo.outputPath(`approval-form-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: '返回付款申请', exact: true }).click()
      await openApplicationFromList(page, '历史批复核验样例')
    }
    await page.getByRole('link', { name: '付款管理', exact: true }).click()
    await expect(page.getByText('历史批复核验样例', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('group', { name: '批复金额', exact: true })).toContainText('合计不完整')
    await expect(page.getByRole('group', { name: '应付余额', exact: true })).toContainText('合计不完整')
    await page.screenshot({ path: testInfo.outputPath('approval-management.png'), fullPage: true })
    expect(errors).toEqual([])
  })
})
