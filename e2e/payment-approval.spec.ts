import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { test as base, expect } from '@playwright/test'
import { createOtherSettlementPay08Source } from '../tests/helpers/other-settlement-pay08-source'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

const test = base.extend<{ production: Awaited<ReturnType<typeof createCrewWorkerProductionFixture>> }>({
  async production({ page }, run, testInfo) {
    const fixture = await createCrewWorkerProductionFixture(page, testInfo)
    try {
      await fixture.start()
      await fixture.login()
      await run(fixture)
    }
    finally {
      await fixture.cleanup()
    }
  },
})

const widths = [390, 768, 1024, 1280, 1440]
test.use({ actionTimeout: 15_000 })

async function newApplication(page: Page, origin: string) {
  await page.goto(`${origin}/finance/payment/new`)
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

async function legacyApplication(fixture: Awaited<ReturnType<typeof createCrewWorkerProductionFixture>>) {
  const native = await createOtherSettlementPay08Source(join(fixture.directory, 'native-approval'), { applicationName: '历史批复核验样例', applicationStatus: 'approved', settlementAmount: 100, paidAmount: 30 })
  const context = await fixture.request('/api/read/finance/payment_application/context')
  expect(context.ok(), await context.text()).toBe(true)
  const { workspaceId, actorId } = await context.json()
  const identity = { workspaceId, actorId }
  async function post(path: string, data: object) {
    const response = await fixture.request(path, { method: 'POST', data })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const suppliers = await Promise.all([
    { legacyId: native.ids.service, name: '原实际服务交易方' },
    { legacyId: native.ids.payee, name: '原实际垫付收款人' },
  ].map(async ({ legacyId, name }) => ({ legacyId, id: (await post('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: `approval-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成核验人' } })).id })))
  const { candidates } = await post('/api/commands/finance/import/preflight', { ...identity, source: native.source })
  const mappings = suppliers.map(({ legacyId, id }) => {
    const candidate = candidates.find((row: { entityType: string, serverId: string }) => row.entityType === 'suppliers' && row.serverId === id)
    expect(candidate).toBeTruthy()
    return { entityType: 'suppliers', legacyId, targetId: id, version: candidate.version, sourceVersion: candidate.sourceVersion, reason: '逐项核对原费用服务方及原付款收款方' }
  })
  await post('/api/commands/finance/import', { ...identity, commandId: 'approval-finance-import', source: native.source, mappings })
  await post('/api/commands/other-settlements/import', { ...identity, commandId: 'approval-settlement-import', source: native.source, mappings })
  return native
}

test.describe('Issue #439 批复空值与明确零', () => {
  test('新建空批复、明确零、清空保存和刷新沿用真实输入语义', async ({ page, production }) => {
    test.setTimeout(120_000)
    await newApplication(page, production.origin)
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

  test('历史零保持待核验与已付事实，取消不确认来源；五档视口可核对和编辑', async ({ page, production }, testInfo) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { ids, originalSha256 } = await legacyApplication(production)
    const detailUrl = `${production.origin}/finance/payment/${ids.application}/detail?origin=real`
    await page.goto(detailUrl)
    await expect(page.getByRole('group', { name: '已确认支付', exact: true })).toContainText('¥30.00')
    await expect(page.getByRole('group', { name: '待支付', exact: true })).toContainText('历史批复待核验')
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page.getByTestId('finance-amount')).toHaveValue('70')
    const before = await production.request(`/api/read/finance/payment_application/form/${ids.application}`)
    expect(before.ok(), await before.text()).toBe(true)
    expect((await before.json()).draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 30, paymentVerification: { required: true, status: 'missing', proof: null } })
    await page.goto(detailUrl)
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
    await page.getByRole('button', { name: '付款状态，已选 1 项', exact: true }).click()
    await page.getByRole('button', { name: '清除', exact: true }).click()
    await expect(page.getByTestId('payment-management-table').getByText('历史批复核验样例', { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '批复金额', exact: true })).toContainText('合计不完整')
    await expect(page.getByRole('group', { name: '应付余额', exact: true })).toContainText('合计不完整')
    await page.screenshot({ path: testInfo.outputPath('approval-management.png'), fullPage: true })

    await page.goto(detailUrl)
    await page.getByTestId('payment-application-edit').click()
    const verification = page.getByRole('region', { name: '历史付款业务核验', exact: true })
    await verification.getByLabel('核实累计应付金额', { exact: true }).fill('100')
    await verification.getByLabel('核实累计可付金额', { exact: true }).fill('100')
    await verification.getByLabel('业务核验依据', { exact: true }).fill('核对原结算100元及原银行实付30元，保留旧批复记录')
    await verification.getByLabel('核验依据 原申请核验依据.bin', { exact: true }).check()
    const verified = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/finance')
    await verification.getByRole('button', { name: '保存业务核验', exact: true }).click()
    const receipt = await verified
    expect(receipt.ok(), await receipt.text()).toBe(true)
    await expect(page.locator('dl[aria-label="已冻结业务核验"]')).toContainText('100')
    const read = await production.request(`/api/read/finance/payment_application/form/${ids.application}`)
    expect(read.ok(), await read.text()).toBe(true)
    expect((await read.json()).draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 30, paymentVerification: { status: 'verified', proof: { actualDueAmount: 100, cumulativePayableAmount: 100, originals: [{ id: ids.applicationFile, sha256: originalSha256 }] } } })
    await page.goto(detailUrl)
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page.getByTestId('finance-amount')).toHaveValue('70')
    expect(errors).toEqual([])
  })
})
