import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用全新正式构建与隔离合成数据库，不连接用户数据库')
test.use({ actionTimeout: 15_000 })

test('正式付款批复的空值、明确零和清空保存后保持不同语义', async ({ page }, info) => {
  test.setTimeout(120_000)
  const fixture = await createCrewWorkerProductionFixture(page, info)
  try {
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/finance/payment?origin=real`)
    await page.getByRole('button', { name: '新建付款申请', exact: true }).click()
    await page.getByRole('button', { name: '公司付款', exact: true }).click()
    await page.getByTestId('finance-name').fill('批复输入往返样例')
    await page.getByTestId('finance-amount').fill('100')
    const approval = page.getByRole('spinbutton', { name: '本期批复金额', exact: true })
    await expect(approval).toHaveValue('')
    const save = page.getByRole('button', { name: '保存草稿', exact: true })
    await save.click()
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/\/finance\/payment\/new/)
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()

    await page.getByRole('button', { name: '返回付款申请', exact: true }).click()
    await page.reload()
    await page.locator('[data-ui="kit-table"]').getByRole('button', { name: /^批复输入往返样例(?:\s|$)/ }).first().click()
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('未填写')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥100.00')
    await page.getByTestId('payment-application-edit').click()
    await expect(approval).toHaveValue('')
    await approval.fill('0')
    await save.click()
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible()
    await expect(save).toBeDisabled()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '批复输入往返样例 · 付款申请', exact: true }).click()
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('¥0.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥0.00')
    await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)
    await page.getByTestId('payment-application-edit').click()
    await expect(approval).toHaveValue('0')
    await approval.fill('')
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/finance') && response.request().method() === 'POST')
    await save.click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible()
    await expect(save).toBeDisabled()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '批复输入往返样例 · 付款申请', exact: true }).click()
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥100.00')
    await page.reload()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '关闭 付款申请详情', exact: true }).click()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '付款申请', exact: true }).click()
    await page.locator('[data-ui="kit-table"]').getByRole('button', { name: /^批复输入往返样例(?:\s|$)/ }).first().click()
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥100.00')
    await page.getByTestId('payment-application-edit').click()
    await approval.fill('0')
    await save.click()
    await expect(save).toBeDisabled()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '批复输入往返样例 · 付款申请', exact: true }).click()
    await page.reload()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '关闭 付款申请详情', exact: true }).click()
    await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '付款申请', exact: true }).click()
    await page.locator('[data-ui="kit-table"]').getByRole('button', { name: /^批复输入往返样例(?:\s|$)/ }).first().click()
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('¥0.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥0.00')
  }
  finally {
    await fixture.cleanup()
  }
})

test('正式历史零保留未核验和已付事实，取消编辑及五档视口不改变原记录', async ({ page }, info) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const fixture = await createCrewWorkerProductionFixture(page, info)
  try {
    await fixture.start()
    await fixture.stop()
    // 仅在本测试新建的独立数据库中准备旧版批复和银行实付事实。
    const database = new DatabaseSync(join(fixture.directory, 'ruihang.sqlite'))
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        BEGIN;
        INSERT INTO payment_applications (id, name, biz_type, apply_amount, approved_amount, approved_amount_origin, status)
          VALUES ('approval-legacy', '历史批复核验样例', '公司付款', 100, 0, 'legacy', 'approved');
        INSERT INTO finance_versions (kind, id, version, updated_at)
          VALUES ('payment_application', 'approval-legacy', 1, '2026-09-11T00:00:00.000Z');
        INSERT INTO payment_records (id, no, payee_name, payment_date, amount, voucher_no, bank_serial_no, confirmation_status, confirmed_by)
          VALUES ('approval-paid', 'ZF-439', '合成收款方', '2026-09-11', 30, 'V-439', 'BANK-439', 'needs_review', '合成核对人');
        INSERT INTO payment_record_application_allocations (id, payment_record_id, payment_application_id, allocated_amount)
          VALUES ('approval-paid-link', 'approval-paid', 'approval-legacy', 30);
        UPDATE payment_records SET confirmation_status = 'confirmed', confirmed_at = '2026-09-11T00:00:00.000Z' WHERE id = 'approval-paid';
        COMMIT;
      `)
    }
    finally {
      database.close()
    }
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/finance/payment/approval-legacy/detail?origin=real`)
    await expect(page.getByRole('group', { name: '已确认支付', exact: true })).toContainText('¥30.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('历史批复待核验')
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page.getByTestId('finance-amount')).toHaveValue('70')
    await page.goto(`${fixture.origin}/finance/payment/approval-legacy/detail?origin=real`)
    await page.getByTestId('payment-application-edit').click()
    const approval = page.getByRole('spinbutton', { name: '本期批复金额', exact: true })
    await expect(approval).toHaveValue('0')
    await approval.fill('80')
    await page.getByRole('button', { name: '返回付款申请', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
    await page.goto(`${fixture.origin}/finance/payment/approval-legacy/detail?origin=real`)
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('历史批复待核验')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `历史批复详情 ${width}`)
      const edit = page.getByTestId('payment-application-edit')
      await edit.focus()
      await expect(edit).toBeFocused()
      await edit.press('Enter')
      await approval.scrollIntoViewIfNeeded()
      await approval.focus()
      await expect(approval).toBeFocused()
      await expect(approval).toHaveValue('0')
      await expectNoPageOverflow(page, `历史批复表单 ${width}`)
      await page.goto(`${fixture.origin}/finance/payment/approval-legacy/detail?origin=real`)
    }
    await page.goto(`${fixture.origin}/finance/payment-management?origin=real`)
    await page.getByRole('button', { name: '付款状态，已选 1 项' }).click()
    await page.getByRole('button', { name: '清除', exact: true }).click()
    await expect(page.getByText('历史批复核验样例', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('group', { name: '批复金额', exact: true })).toContainText('合计不完整')
    await expect(page.getByRole('group', { name: '应付余额', exact: true })).toContainText('合计不完整')
    expect(errors).toEqual([])
  }
  finally {
    await fixture.cleanup()
  }
})
