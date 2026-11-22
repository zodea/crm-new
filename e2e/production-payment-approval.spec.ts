import { Buffer } from 'node:buffer'
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
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY })
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
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY })
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

test('正式申请批复后登记部分支付并撤回，冷读重算余额且保留 15 份附件', async ({ page }, info) => {
  test.setTimeout(150_000)
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY })
  const applicationName = '合成付款确认与撤回'
  const supplierName = '合成部分付款收款方'
  const paymentWrite = (kind: string, action: string) => page.waitForResponse((response) => {
    const request = response.request()
    if (request.method() !== 'POST' || new URL(response.url()).pathname !== '/api/commands/finance')
      return false
    const body = request.postDataJSON()
    return body.kind === kind && body.action === action
  })

  try {
    await fixture.start()
    await fixture.login()
    const identity = await (await fixture.request('/api/read/business-session')).json()
    const supplier = await fixture.request('/api/commands/suppliers', { method: 'POST', data: {
      workspaceId: identity.workspaceId,
      actorId: identity.actorId,
      requiredCapability: 'supplier:write',
      commandId: 'synthetic-partial-payment-payee',
      baseVersion: null,
      action: 'save',
      attachments: {},
      draft: { name: supplierName, supplierCategory: '其他', contact: '合成人' },
    } })
    expect(supplier.ok(), await supplier.text()).toBe(true)
    await page.goto(`${fixture.origin}/finance/payment/new`)
    await page.getByRole('button', { name: '公司付款', exact: true }).click()
    await page.getByTestId('finance-name').fill(applicationName)
    await page.getByRole('combobox', { name: '检索分供方', exact: true }).fill(supplierName)
    await page.getByRole('option').filter({ hasText: supplierName }).click()
    await page.getByTestId('finance-amount').fill('100')
    await page.getByTestId('finance-date').fill('2026-09-11')
    await page.getByRole('textbox', { name: '申请人 *', exact: true }).fill('合成申请人')
    await page.getByRole('combobox', { name: '回票类型', exact: true }).click()
    await page.getByRole('option', { name: '无需发票', exact: true }).click()
    await page.getByRole('spinbutton', { name: '本期批复金额', exact: true }).fill('80')

    const names = Array.from({ length: 16 }, (_, index) => `合成付款附件-${String(index + 1).padStart(2, '0')}.txt`)
    await page.getByTestId('finance-attachment-input').setInputFiles(names.map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })))
    await expect(page.getByText('最多保留 15 份附件，本次只加入前 15 份', { exact: true })).toBeVisible()
    const submitted = paymentWrite('payment_application', 'submit')
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    const applicationResponse = await submitted
    expect(applicationResponse.ok(), await applicationResponse.text()).toBe(true)
    const application = await applicationResponse.json() as { id: string, version: string }
    const savedForm = await fixture.request(`/api/read/finance/payment_application/form/${application.id}`)
    expect(savedForm.ok(), await savedForm.text()).toBe(true)
    const saved = await savedForm.json()
    expect(saved.draft).toMatchObject({ approvedAmount: 80, status: 'submitted' })
    expect(saved.attachments.map((row: { fileName: string }) => row.fileName).sort()).toEqual(names.slice(0, 15))

    // 付款管理只接收已批复的申请。以既有正式命令记录合成批复。
    const approved = await fixture.request('/api/commands/finance', { method: 'POST', data: {
      workspaceId: identity.workspaceId,
      actorId: identity.actorId,
      requiredCapability: 'finance-payment-application:write',
      commandId: 'synthetic-partial-payment-approval',
      id: application.id,
      baseVersion: application.version,
      kind: 'payment_application',
      action: 'save',
      draft: { ...saved.draft, status: 'approved' },
      attachments: {},
    } })
    expect(approved.ok(), await approved.text()).toBe(true)
    expect(await approved.json()).toMatchObject({ id: application.id })

    const management = `${fixture.origin}/finance/payment-management?origin=real`
    const detail = `${fixture.origin}/finance/payment/${application.id}/detail?origin=real`
    const managementTable = page.getByTestId('payment-management-table')
    const managementRow = managementTable.getByRole('row').filter({ has: page.getByRole('cell', { name: supplierName, exact: true }) })
    await page.goto(management)
    await managementTable.getByRole('button', { name: `${applicationName}付款操作`, exact: true }).click()
    await page.getByRole('menuitem', { name: '登记支付记录', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`paymentApplicationId=${application.id}`))
    await expect(page.getByTestId('finance-amount')).toHaveValue('80')
    await page.getByTestId('finance-amount').fill('30')
    await page.getByRole('spinbutton', { name: '本次支付分摊金额', exact: true }).fill('30')
    await page.getByTestId('finance-date').fill('2026-09-12')
    await page.getByRole('textbox', { name: '付款凭证号 *', exact: true }).fill('SYN-PARTIAL-VOUCHER')
    await page.getByTestId('payment-bank-serial').fill('SYN-PARTIAL-BANK')
    await page.getByTestId('payment-confirmed-by').fill('合成确认人')
    const confirmed = paymentWrite('payment_record', 'confirm')
    await page.getByTestId('confirm-payment').click()
    await page.getByRole('dialog', { name: '人工确认支付', exact: true }).getByRole('button', { name: '确认支付', exact: true }).click()
    const paymentResponse = await confirmed
    expect(paymentResponse.ok(), await paymentResponse.text()).toBe(true)
    const payment = await paymentResponse.json() as { id: string }
    await expect(page.getByTestId('unconfirm-payment')).toBeVisible()

    await page.goto(management)
    await expect(managementRow).toContainText('部分支付')
    await expect(managementRow.getByRole('cell', { name: '¥30.00', exact: true })).toBeVisible()
    await expect(managementRow.getByRole('cell', { name: '¥50.00', exact: true })).toBeVisible()
    await page.goto(detail)
    await expect(page.getByRole('group', { name: '已确认支付', exact: true })).toContainText('¥30.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥50.00')

    await page.goto(`${fixture.origin}/finance/records/${payment.id}?origin=real`)
    const withdrawn = paymentWrite('payment_record', 'unconfirm')
    await page.getByTestId('unconfirm-payment').click()
    await page.getByRole('dialog', { name: '撤回支付确认' }).getByRole('button', { name: '撤回确认', exact: true }).click()
    const withdrawal = await withdrawn
    expect(withdrawal.ok(), await withdrawal.text()).toBe(true)
    expect(await withdrawal.json()).toMatchObject({ id: payment.id })

    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(detail)
    await expect(page.getByRole('group', { name: '已确认支付', exact: true })).toContainText('¥0.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('¥80.00')
    const coldApplication = await fixture.request(`/api/read/finance/payment_application/form/${application.id}`)
    expect(coldApplication.ok(), await coldApplication.text()).toBe(true)
    const coldForm = await coldApplication.json()
    expect(coldForm.draft).toMatchObject({ approvedAmount: 80, status: 'approved' })
    expect(coldForm.attachments.map((row: { fileName: string }) => row.fileName).sort()).toEqual(names.slice(0, 15))
    const coldRecord = await fixture.request(`/api/read/finance/payment_record/form/${payment.id}`)
    expect(coldRecord.ok(), await coldRecord.text()).toBe(true)
    expect((await coldRecord.json()).draft).toMatchObject({ confirmationStatus: 'needs_review', amount: 30, applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] })
    await page.goto(management)
    await expect(managementRow.getByRole('cell', { name: '待支付', exact: true })).toBeVisible()
    await expect(managementRow.getByRole('cell', { name: '¥0.00', exact: true })).toBeVisible()
    await expect(managementRow.getByRole('cell', { name: '¥80.00', exact: true })).toHaveCount(2)
  }
  finally {
    await fixture.cleanup()
  }
})
