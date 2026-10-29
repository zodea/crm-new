import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { createOtherSettlementPay08Source } from '../tests/helpers/other-settlement-pay08-source'
import { selectVerifiedSignatory } from './helpers/contract-signatory'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { createHistoricalClearanceMigrationSource } from './helpers/historical-clearance-migration-source'
import { createOtherSettlementMigrationSource } from './helpers/other-settlement-migration-source'
import { EQUIVALENT_200_PERCENT_VIEWPORT, expectLocalHorizontalScroll, expectNoPageOverflow, tabUntilFocused } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '全新正式构建与隔离合成存储验收，不连接用户数据库')
test('正式施工合同原件往返及其他支出合同结算使用同一合成工程', async ({ page }, info) => {
  test.setTimeout(150_000)
  const f = await createCrewWorkerProductionFixture(page, info)
  try {
    await f.start()
    await f.login()
    const ctx = await (await f.request('/api/read/other-settlements/context')).json()
    const identity = { workspaceId: ctx.workspaceId, actorId: ctx.actorId, baseVersion: null }
    async function command(path: string, capability: string, commandId: string, draft: object) {
      const response = await f.request(`/api/commands/${path}`, { method: 'POST', data: { ...identity, requiredCapability: capability, commandId, action: 'draft', draft, attachments: {} } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const ownResponse = await f.request('/api/commands/our-signatories', { method: 'POST', data: { ...identity, requiredCapability: 'our-signatory:write', commandId: 'f2-real-signer', draft: { name: 'F2合成签约主体', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '合成文书核实', status: 'active' } } })
    expect(ownResponse.ok(), await ownResponse.text()).toBe(true)
    const own = await ownResponse.json()
    const customer = await command('customers', 'customer:write', 'f2-real-customer', { name: 'F2合成客户', contact: '合成人' })
    const supplier = await command('suppliers', 'supplier:write', 'f2-real-supplier', { name: 'F2合成分供方', supplierCategory: '其他', contact: '合成人' })
    const project = await command('projects', 'project:write', 'f2-real-project', { name: 'F2合成工程', customerId: customer.id })
    async function choose(label: string, name: string) {
      await page.getByRole('combobox', { name: label, exact: true }).fill(name)
      await page.getByRole('option').filter({ hasText: name }).first().click()
    }
    await page.goto(`${f.origin}/contract/construction/form`)
    await selectVerifiedSignatory(page, own.id, 'F2合成签约主体')
    await page.getByTestId('contract-name').fill('F2合成施工合同')
    await choose('检索项目', 'F2合成工程')
    await choose('检索客户', 'F2合成客户')
    await page.getByTestId('contract-content').fill('合成施工内容')
    await page.getByTestId('contract-sign-date').fill('2026-07-25')
    await page.getByTestId('contract-amount').fill('100')
    await page.locator('input[type="file"]').setInputFiles({ name: 'f2-synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('synthetic-contract') })
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/contract\/construction\/form\/[^/?]+(?:\?|$)/)
    await expect(page.getByRole('checkbox', { name: '【保存】后关闭' })).toBeChecked()
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await expect(page.getByRole('combobox', { name: '合同状态', exact: true })).toHaveText('审批中')
    const constructionId = new URL(page.url()).pathname.split('/').at(-1)!
    const saved = await f.request(`/api/read/construction-contracts/${constructionId}/form`)
    expect(saved.ok(), await saved.text()).toBe(true)
    expect((await saved.json()).draft).toMatchObject({ projectId: project.id, customerId: customer.id, amount: 100, status: '审批中' })
    const attachments = page.locator('#section-attachments')
    await expect(attachments.getByText('f2-synthetic.pdf', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)
    await page.goto(`${f.origin}/contract/other-expense/form`)
    await page.getByLabel('合同名称 *', { exact: true }).fill('F2合成其他支出合同')
    await choose('搜索工程及施工主合同名称 / 编号', 'F2合成施工合同')
    await choose('检索分供方', 'F2合成分供方')
    await choose('搜索真实签约主体', 'F2合成签约主体')
    await page.getByLabel('主要条款').fill('合成租赁服务')
    await page.getByLabel('签订日期 *').fill('2026-07-25')
    await page.getByLabel('合同金额 *', { exact: true }).fill('80')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await page.getByRole('dialog', { name: '提交合同' }).getByRole('button', { name: '提交', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/other-expense\/form\/[^/?]+(?:\?|$)/)
    await page.goto(`${f.origin}/contract/other-settlement/form`)
    await page.getByRole('combobox', { name: '结算来源', exact: true }).selectOption('contract')
    await page.getByLabel('结算名称 *', { exact: true }).fill('F2合成其他支出结算')
    await choose('检索项目', 'F2合成工程')
    await choose('检索其他支出合同', 'F2合成其他支出合同')
    await page.getByLabel('含税结算金额 *').fill('60')
    await page.getByLabel('结算日期 *').fill('2026-07-25')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '提交', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/other-settlement\/form\/[^/?]+(?:\?|$)/)
    await expect(page.getByRole('button', { name: '确认结算', exact: true })).toBeEnabled()
    const settlementId = new URL(page.url()).pathname.split('/').at(-1)!
    const settlement = await f.request(`/api/read/other-settlements/${settlementId}?origin=real`)
    expect(settlement.ok(), await settlement.text()).toBe(true)
    expect((await settlement.json()).settlement.draft).toMatchObject({ id: settlementId, status: 'pending', projectId: project.id, totalAmount: 60 })
    expect(supplier.id).toBeTruthy()
  }
  finally {
    await f.cleanup()
  }
})
for (const input of ['合成未保存输入甲', '合成未保存输入乙']) {
  test(`付款申请正式来源：${input}在五档视口及200%布局下键盘操作可达`, async ({ page }, info) => {
    test.setTimeout(120_000)
    const f = await createCrewWorkerProductionFixture(page, info)
    try {
      await f.start()
      await f.login()
      await page.goto(`${f.origin}/finance/payment/new`)
      const type = page.getByRole('button', { name: '有合同-材料', exact: true })
      await expect(type).toBeVisible()
      await type.focus()
      await expect(type).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: '新建 · 付款申请' })).toBeVisible()
      const field = page.getByTestId('finance-name')
      const footer = page.getByRole('group', { name: '表单操作' })
      const cancel = footer.getByRole('button', { name: '取消', exact: true })
      const save = footer.getByRole('button', { name: '保存', exact: true })
      await expect(save).toBeEnabled()
      if (input === '合成未保存输入甲') {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByTestId('add-grid-line').first().click({ timeout: 15_000 })
        const grid = page.getByTestId('finance-line-grid').first()
        const scrollRoot = grid.locator(':scope > .overflow-auto')
        await expectLocalHorizontalScroll(scrollRoot, '正式付款申请明细')
        await expect.poll(() => scrollRoot.evaluate(root => [...root.querySelectorAll<HTMLElement>('*')].filter((element) => {
          const overflowX = getComputedStyle(element).overflowX
          return ['auto', 'scroll'].includes(overflowX) && element.scrollWidth > element.clientWidth + 1
        }).length)).toBe(0)
        await scrollRoot.evaluate(root => root.scrollLeft = root.scrollWidth)
        await expect.poll(() => scrollRoot.evaluate(root => root.scrollLeft)).toBeGreaterThan(0)
        const lastAction = grid.getByTitle('删除').last()
        await lastAction.scrollIntoViewIfNeeded()
        await expect(lastAction).toBeInViewport()
        await expectNoPageOverflow(page, '正式付款申请明细 @ 390px')
      }
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `正式付款申请 ${width}px`)
        await field.focus()
        await expect(field).toBeFocused()
        await tabUntilFocused(page, cancel)
        await expect(cancel).toBeInViewport()
        await tabUntilFocused(page, save)
        await expect(save).toBeFocused()
        await expect(save).toBeInViewport()
      }
      await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)
      await expectNoPageOverflow(page, '正式付款申请 200%')
      await field.fill(input)
      await field.focus()
      await tabUntilFocused(page, cancel)
      await tabUntilFocused(page, save)
      await tabUntilFocused(page, cancel, 'backward', 10)
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '放弃修改' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(cancel).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: '放弃修改', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(() => new URL(page.url()).pathname).toBe('/finance/payment')
    }
    finally {
      await f.cleanup()
    }
  })
}
test('真实原费用→结算→申请→实付，整页原键恢复、版本冻结、原件与完整Native迁入冷开五档', async ({ page }, info) => {
  test.setTimeout(180000)
  const f = await createCrewWorkerProductionFixture(page, info)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64')
  try {
    await f.start()
    await f.login()
    const ctx = await (await f.request('/api/read/other-settlements/context')).json()
    const identity = { workspaceId: ctx.workspaceId, actorId: ctx.actorId }
    async function command(path: string, draft: object, commandId: string, capability: string, extra: object = {}) {
      const response = await f.request(`/api/commands/${path.startsWith('finance/') ? 'finance' : path}`, { method: 'POST', data: { ...identity, requiredCapability: capability, commandId, baseVersion: null, action: 'save', draft, attachments: {}, ...extra } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const service = await command('suppliers', { name: '实际服务交易方', supplierCategory: '其他', contact: '合成人' }, 'other-browser-service', 'supplier:write')
    const payee = await command('suppliers', { name: '实际垫付收款人', supplierCategory: '其他', contact: '合成人' }, 'other-browser-payee', 'supplier:write')
    const customer = await command('customers', { name: '合成原费用甲方', contact: '合成人' }, 'other-browser-customer', 'customer:write')
    const project = await command('projects', { name: '合成原费用工程', customerId: customer.id, manager: '合成人' }, 'other-browser-project', 'project:write')
    const signerResponse = await f.request('/api/commands/our-signatories', { method: 'POST', data: { ...identity, requiredCapability: 'our-signatory:write', commandId: 'other-browser-signer', baseVersion: null, draft: { name: '合成原费用签约主体', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '合成核验', status: 'active' } } })
    expect(signerResponse.ok(), await signerResponse.text()).toBe(true)
    const signer = await signerResponse.json()
    const main = await command('construction-contracts', { name: '合成原费用施工主合同', no: 'OTHER-MAIN', projectId: project.id, customerId: customer.id, content: '合成工程', signDate: '2026-10-05', amount: 100, ourSignatoryId: signer.id, ourSignatoryVersion: signer.version }, 'other-browser-main', 'construction-contract:write')
    const scopeContext = await (await f.request('/api/read/auxiliary-contracts/context')).json()
    const mainOption = scopeContext.constructionMains.find((row: { id: string }) => row.id === main.id)
    expect(mainOption).toBeDefined()
    const constructionMain = { id: mainOption.id, projectId: mainOption.projectId, basis: mainOption.basis }
    await command('finance/reimbursement', { projectId: project.id, constructionMain, applicantSupplierId: payee.id, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '实际无合同运输费用', counterpartySupplierId: service.id, amount: 100 }] }, 'other-browser-expense', 'finance-reimbursement:write', { kind: 'reimbursement' })
    await page.goto(`${f.origin}/contract/other-settlement/form`)
    const projectLookup = page.getByRole('combobox', { name: '检索项目' })
    await projectLookup.fill('合成原费用工程')
    await page.getByRole('option', { name: /合成原费用工程/ }).click()
    await page.getByLabel('采用原费用 实际无合同运输费用', { exact: true }).check({ timeout: 15_000 })
    await page.getByLabel('原费用 实际无合同运输费用 采用金额', { exact: true }).fill('70')
    await page.getByLabel('结算名称 *', { exact: true }).fill('实际无合同费用结算')
    await page.getByLabel('结算日期 *', { exact: true }).fill('2026-10-05')
    await page.locator('input[type="file"]').setInputFiles({ name: '真实原结算.png', mimeType: 'image/png', buffer: image })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `原费用结算整页 ${width}px`)
      await page.getByLabel('结算名称 *', { exact: true }).focus()
      await expect(page.getByLabel('结算名称 *', { exact: true })).toBeFocused()
    }
    let sends = 0
    let originalCommand = ''
    let release!: () => void
    let persisted!: () => void
    const held = new Promise<void>(resolve => release = resolve)
    const written = new Promise<void>(resolve => persisted = resolve)
    await page.route('**/api/commands/other-settlements', async (route) => {
      sends++
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      persisted()
      await held
      await route.abort('failed')
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await written
    await page.getByLabel('结算名称 *', { exact: true }).fill('后来的尚未保存输入')
    release()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('结算名称 *', { exact: true })).toHaveValue('后来的尚未保存输入')
    expect(sends).toBe(1)
    await page.unroute('**/api/commands/other-settlements')
    const rows = await (await f.request('/api/read/other-settlements')).json()
    const row = rows.items[0]
    expect(row.draft).toMatchObject({ supplierId: service.id, payeeSupplierId: payee.id, payeeWorkerId: null, totalAmount: 70, contractId: null, projectId: project.id })
    const remote = await command('other-settlements', { ...row.draft, name: '另一已保存版本' }, 'other-browser-concurrent', 'other-settlement:write', { id: row.id, baseVersion: '1' })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('服务器版本 2；当前输入已保留。')).toBeVisible()
    await page.getByRole('button', { name: '核对后采用最新版本', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '采用最新版本', exact: true }).click()
    await expect(page.getByLabel('结算名称 *', { exact: true })).toHaveValue('另一已保存版本')
    let failSavedReads = true
    let failedReadCount = 0
    let savedSends = 0
    let resolveCount = 0
    await page.route(`**/api/read/other-settlements/${row.id}*`, async (route) => {
      if (failSavedReads) {
        failedReadCount++
        await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '已保存后的读取暂不可用', retryable: true, fieldErrors: {}, traceId: null } } })
      }
      else {
        await route.continue()
      }
    })
    await page.route('**/api/commands/other-settlements/resolve', async (route) => {
      resolveCount++
      await route.continue()
    })
    await page.route('**/api/commands/other-settlements', async (route) => {
      savedSends++
      await route.continue()
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText(/已保存待刷新，只重试读取/)).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeEnabled()
    expect(failedReadCount).toBeGreaterThan(0)
    failSavedReads = false
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toHaveCount(0)
    expect(resolveCount).toBe(0)
    expect(savedSends).toBe(1)
    await page.unroute(`**/api/read/other-settlements/${row.id}*`)
    await page.unroute('**/api/commands/other-settlements/resolve')
    await page.unroute('**/api/commands/other-settlements')
    const current = await (await f.request(`/api/read/other-settlements/${row.id}`)).json()
    expect(current.settlement.version).toBe('3')
    const submitted = await command('other-settlements', current.settlement.draft, 'other-browser-submit', 'other-settlement:write', { id: row.id, baseVersion: current.settlement.version, action: 'submit' })
    const confirmed = await command('other-settlements', current.settlement.draft, 'other-browser-confirm', 'other-settlement:write', { id: row.id, baseVersion: submitted.version, action: 'confirm' })
    const application = await command('finance/payment_application', { name: '实际原费用付款申请', projectId: project.id, bizType: '项目费用', supplierId: payee.id, applyAmount: 70, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票', settlementAllocations: [{ settlementId: row.id, allocatedAmount: 70 }] }, 'other-browser-application', 'finance-payment-application:write', { kind: 'payment_application', action: 'submit' })
    const payment = await command('finance/payment_record', { projectId: project.id, supplierId: payee.id, payeeName: '实际垫付收款人', amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-OTHER-VOUCHER', bankSerialNo: 'SYNTHETIC-OTHER-BANK', confirmedBy: '合成财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] }, 'other-browser-payment', 'finance-payment-record:write', { kind: 'payment_record', action: 'confirm' })
    const paid = await (await f.request(`/api/read/other-settlements/${row.id}`)).json()
    expect(paid.settlement.amounts).toMatchObject({ total: '70.00', net: '70.00', applied: '70.00', paid: '30.00', unpaid: '40.00' })
    await page.goto(`${f.origin}/contract/other-settlement/${row.id}?origin=real`)
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('真实原结算.png')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '预览', exact: true })).toBeFocused()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `结算只读 ${width}px`)
    }
    const native = await createOtherSettlementMigrationSource(join(f.directory, 'native-other-source'))
    await page.goto(`${f.origin}/contract/other-settlement/import`)
    await page.getByLabel('选择完整 SQLite 原库').setInputFiles(native.path)
    await expect(page.getByText('实际现行结算 2 条；', { exact: false })).toBeVisible()
    await page.getByLabel('当前真实目标').selectOption(service.id)
    await page.getByLabel('身份核对依据').fill('实际原件与主档逐条核对')
    await page.getByRole('checkbox').check()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `完整结算迁入 ${width}px`)
      await page.getByLabel('身份核对依据').focus()
      await expect(page.getByLabel('身份核对依据')).toBeFocused()
    }
    let importSends = 0
    let importResolves = 0
    let failPostResolveContext = false
    let failedPostResolveContextReads = 0
    let importResult!: { commandId: string }
    await page.route('**/api/commands/other-settlements/import', async (route) => {
      importSends++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      importResult = await response.json()
      await route.abort('failed')
    })
    await page.route('**/api/commands/other-settlements/import/resolve', async (route) => {
      importResolves++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      expect(await response.json()).toMatchObject({ outcome: 'applied', result: { commandId: importResult.commandId } })
      failPostResolveContext = true
      await route.fulfill({ response })
    })
    await page.route('**/api/read/other-settlements/context', async (route) => {
      if (failPostResolveContext) {
        failedPostResolveContextReads++
        await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '后置结算会话读取失败', retryable: true, fieldErrors: {}, traceId: null } } })
      }
      else {
        await route.continue()
      }
    })
    await page.getByRole('button', { name: '确认迁入原结算图', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原迁入', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '核对原迁入', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原迁入', exact: true })).toBeEnabled()
    expect(failedPostResolveContextReads).toBeGreaterThan(0)
    expect(importResolves).toBe(1)
    failPostResolveContext = false
    await page.getByRole('button', { name: '核对原迁入', exact: true }).click()
    await expect(page.getByText('原图已保存并读取核验。')).toBeVisible()
    expect(importSends).toBe(1)
    expect(importResolves).toBe(1)
    await page.unroute('**/api/commands/other-settlements/import')
    await page.unroute('**/api/commands/other-settlements/import/resolve')
    await page.unroute('**/api/read/other-settlements/context')
    await f.stop()
    await f.start()
    await f.login()
    const cold = await (await f.request(`/api/read/other-settlements/${row.id}`)).json()
    expect(cold.settlement.version).toBe(confirmed.version)
    expect(cold.settlement.amounts.paid).toBe('30.00')
    expect(await (await f.request('/api/commands/other-settlements/resolve', { method: 'POST', data: { commandId: originalCommand } })).json()).toMatchObject({ outcome: 'applied', result: { id: row.id, version: '1' } })
    expect(await (await f.request('/api/commands/other-settlements/import/resolve', { method: 'POST', data: { commandId: importResult.commandId } })).json()).toEqual({ outcome: 'applied', result: importResult })
    const rawOriginal = await (await f.request('/api/read/other-settlements/native-other-zero/files/native-other-original')).json()
    expect(Buffer.from(rawOriginal.payloadBase64, 'base64')).toEqual(native.original)
    expect((await (await f.request('/api/read/other-settlements/native-other-unknown')).json()).settlement.amounts.total).toBeNull()
    expect(payment.id).toBeTruthy()
    expect(remote.version).toBe('2')
    expect(errors).toEqual([])
  }
  finally {
    await f.cleanup()
  }
})

test('真实Native历史未知申请经原费用及原件核验，原键冷恢复后新增实付并保全原批复与旧现金', async ({ page }, info) => {
  test.setTimeout(180000)
  const f = await createCrewWorkerProductionFixture(page, info)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await f.start()
    await f.login()
    const native = await createOtherSettlementPay08Source(join(f.directory, 'native-pay08-source'))
    const context = await (await f.request('/api/read/finance/payment_application/context')).json()
    const identity = { workspaceId: context.workspaceId, actorId: context.actorId }
    async function successful(path: string, data: object) {
      const response = await f.request(path, { method: 'POST', data })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const suppliers: { legacyId: string, id: string }[] = []
    for (const [legacyId, name] of [[native.ids.service, '原实际服务交易方'], [native.ids.payee, '原实际垫付收款人']]) {
      const saved = await successful('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: `browser-pay08-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成核验人' } })
      suppliers.push({ legacyId: legacyId!, id: saved.id })
    }
    const preflight = await successful('/api/commands/finance/import/preflight', { ...identity, source: native.source })
    const mappings = suppliers.map((row) => {
      const candidate = preflight.candidates.find((item: { entityType: string, serverId: string }) => item.entityType === 'suppliers' && item.serverId === row.id)
      expect(candidate).toBeTruthy()
      return { entityType: 'suppliers', legacyId: row.legacyId, targetId: row.id, version: candidate.version, sourceVersion: candidate.sourceVersion, reason: '完整原库、实际原件与真实收款身份逐条确认' }
    })
    await successful('/api/commands/finance/import', { ...identity, commandId: 'browser-pay08-finance-import', source: native.source, mappings })
    await successful('/api/commands/other-settlements/import', { ...identity, commandId: 'browser-pay08-other-import', source: native.source, mappings })
    const payeeId = suppliers.find(row => row.legacyId === native.ids.payee)!.id
    const paymentRequest = { ...identity, kind: 'payment_record', requiredCapability: 'finance-payment-record:write', commandId: 'browser-pay08-new-cash-30', baseVersion: null, action: 'confirm', attachments: {}, draft: { supplierId: payeeId, payeeName: '原实际垫付收款人', amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-PAY08-NEW-VOUCHER', bankSerialNo: 'SYNTHETIC-PAY08-NEW-BANK', confirmedBy: '合成财务', applicationAllocations: [{ paymentApplicationId: native.ids.application, allocatedAmount: 30 }] } }
    const blocked = await f.request('/api/commands/finance', { method: 'POST', data: { ...paymentRequest, commandId: 'browser-pay08-without-verification' } })
    expect(blocked.status()).toBe(503)
    expect((await blocked.json()).data).toMatchObject({ code: 'unavailable' })
    const before = await (await f.request(`/api/read/finance/payment_application/form/${native.ids.application}`)).json()
    expect(before.draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 20, paymentVerification: { required: true, status: 'missing', proof: null } })
    const wrongOriginal = await f.request('/api/commands/finance', { method: 'POST', data: { ...identity, kind: 'payment_application', requiredCapability: 'finance-payment-application:write', id: native.ids.application, commandId: 'browser-pay08-wrong-original', baseVersion: before.version, action: 'save', attachments: {}, draft: { id: native.ids.application, verificationEdit: { actualDueAmount: 70, cumulativePayableAmount: 70, basis: '独立核对原件归属', fileIds: [native.ids.settlementFile] } } } })
    expect(wrongOriginal.status()).toBe(503)
    expect((await wrongOriginal.json()).data).toMatchObject({ code: 'unavailable' })

    await page.goto(`${f.origin}/finance/payment/${native.ids.application}?origin=real`)
    const section = page.getByRole('region', { name: '历史付款业务核验', exact: true })
    await expect(section).toBeVisible()
    await expect(page.getByRole('combobox', { name: '选择结算单', exact: true })).toHaveValue('原已确认费用结算')
    await expect(page.getByText('财务候选工人稳定编号无效。', { exact: false })).toHaveCount(0)
    await section.getByLabel('核实累计应付金额', { exact: true }).fill('70')
    await section.getByLabel('核实累计可付金额', { exact: true }).fill('70')
    await section.getByLabel('业务核验依据', { exact: true }).fill('原费用100、真实已确认采用70、旧银行20及4字节原件逐条核验')
    await section.getByLabel('核验依据 原申请核验依据.bin', { exact: true }).check()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `历史业务核验 ${width}px`)
      const basis = section.getByLabel('业务核验依据', { exact: true })
      await basis.scrollIntoViewIfNeeded()
      await basis.focus()
      await expect(basis).toBeFocused()
      await expect(basis).toBeInViewport()
    }
    let posts = 0
    let resolves = 0
    let commandId = ''
    let abortDelivered!: () => void
    const persistedAndAborted = new Promise<void>(resolve => abortDelivered = resolve)
    await page.route('**/api/commands/finance', async (route) => {
      posts++
      const request = route.request().postDataJSON()
      commandId = request.commandId
      expect(request).toMatchObject({ kind: 'payment_application', id: native.ids.application, baseVersion: before.version, action: 'save', attachments: {}, draft: { id: native.ids.application, verificationEdit: { actualDueAmount: 70, cumulativePayableAmount: 70, fileIds: [native.ids.applicationFile] } } })
      expect(Object.keys(request.draft).sort()).toEqual(['id', 'verificationEdit'])
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      expect(await response.json()).toMatchObject({ commandId, id: native.ids.application, version: '2' })
      await route.abort('failed')
      abortDelivered()
    })
    await page.route('**/api/commands/finance/resolve', async (route) => {
      resolves++
      expect(route.request().postDataJSON().commandId).toBe(commandId)
      await route.continue()
    })
    await section.getByRole('button', { name: '保存业务核验', exact: true }).click()
    await persistedAndAborted
    let recover = page.getByRole('button', { name: '核对原提交', exact: true })
    await expect(recover).toBeEnabled()
    const descriptors = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:finance-payment-application:')).map(([, value]) => JSON.parse(value)))
    expect(descriptors).toEqual([{ commandId, workspaceId: identity.workspaceId, actorId: identity.actorId, family: 'finance-payment-application', targetId: native.ids.application, action: 'save' }])
    expect(JSON.stringify(descriptors)).not.toContain('4字节原件')
    let refuseColdForm = true
    let coldReadFailures = 0
    await page.route(`**/api/read/finance/payment_application/form/${native.ids.application}`, async (route) => {
      if (refuseColdForm) {
        coldReadFailures++
        await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '冷恢复已应用后的目标申请读取失败', retryable: true, fieldErrors: {}, traceId: null } } })
      }
      else {
        await route.continue()
      }
    })
    await f.stop()
    await f.start()
    await f.login()
    await page.goto(`${f.origin}/finance/payment/${native.ids.application}?origin=real`)
    recover = page.getByRole('button', { name: '核对原提交', exact: true })
    await expect(recover).toBeEnabled()
    expect(coldReadFailures).toBeGreaterThan(0)
    expect(resolves).toBe(1)
    refuseColdForm = false
    await recover.click()
    await expect(recover).toHaveCount(0)
    await expect(page.locator('dl[aria-label="已冻结业务核验"]')).toContainText('70')
    expect(posts).toBe(1)
    expect(resolves).toBe(1)
    await page.unroute('**/api/commands/finance')
    await page.unroute('**/api/commands/finance/resolve')
    await page.unroute(`**/api/read/finance/payment_application/form/${native.ids.application}`)
    const verified = await (await f.request(`/api/read/finance/payment_application/form/${native.ids.application}`)).json()
    expect(verified.draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paymentVerification: { required: true, status: 'verified', proof: { commandId, applicationVersion: '2', actualDueAmount: 70, cumulativePayableAmount: 70, originals: [{ id: native.ids.applicationFile, fileSize: 4, sha256: native.originalSha256 }] } } })
    expect(verified.draft.paymentVerification.proof.sources.map((row: { owner: string, id: string, version: string }) => [row.owner, row.id, row.version])).toEqual([['other-settlements', native.ids.settlement, '0'], ['finance-expense', native.ids.expenseLine, '1']])
    await page.goto(`${f.origin}/finance/payment/${native.ids.application}/detail?origin=real`)
    await expect(page.getByTestId('payment-application-create-payment')).toBeVisible()
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page).toHaveURL(new RegExp(`/finance/records/new\\?.*paymentApplicationId=${native.ids.application}`))
    await expect(page.getByTestId('finance-name')).toHaveValue('原实际垫付收款人')
    await expect(page.getByTestId('finance-amount')).toHaveValue('50')
    await page.getByTestId('finance-amount').fill('30')
    await page.getByRole('spinbutton', { name: '本次支付分摊金额', exact: true }).fill('30')
    await page.getByTestId('finance-date').fill('2026-10-05')
    await page.getByRole('textbox', { name: '付款凭证号 *', exact: true }).fill('SYNTHETIC-PAY08-NEW-VOUCHER')
    await page.getByTestId('payment-bank-serial').fill('SYNTHETIC-PAY08-NEW-BANK')
    await page.getByTestId('payment-confirmed-by').fill('合成财务')
    const confirmedResponse = page.waitForResponse((response) => {
      const request = response.request()
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/commands/finance')
        return false
      const body = request.postDataJSON()
      return body.kind === 'payment_record' && body.action === 'confirm'
    })
    await page.getByTestId('confirm-payment').click()
    await page.getByRole('dialog', { name: '人工确认支付', exact: true }).getByRole('button', { name: '确认支付', exact: true }).click()
    const actualResponse = await confirmedResponse
    expect(actualResponse.ok(), await actualResponse.text()).toBe(true)
    const actualRequest = actualResponse.request().postDataJSON()
    expect(actualRequest).toMatchObject({ ...identity, kind: 'payment_record', action: 'confirm', draft: { supplierId: payeeId, amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-PAY08-NEW-VOUCHER', bankSerialNo: 'SYNTHETIC-PAY08-NEW-BANK', applicationAllocations: [{ paymentApplicationId: native.ids.application, allocatedAmount: 30 }] } })
    const payment = await actualResponse.json()
    expect(payment).toMatchObject({ commandId: actualRequest.commandId, version: '1' })
    await expect(page.getByTestId('unconfirm-payment')).toBeVisible()
    const actualPayment = await (await f.request(`/api/read/finance/payment_record/form/${payment.id}`)).json()
    expect(actualPayment.draft).toMatchObject({ supplierId: payeeId, amount: 30, confirmationStatus: 'confirmed', bankSerialNo: 'SYNTHETIC-PAY08-NEW-BANK', applicationAllocations: [{ paymentApplicationId: native.ids.application, allocatedAmount: 30 }] })
    const paid = await (await f.request(`/api/read/other-settlements/${native.ids.settlement}`)).json()
    expect(paid.settlement.amounts).toMatchObject({ total: '70.00', net: '70.00', paid: '50.00', unpaid: '20.00' })
    const applicationDetail = await (await f.request(`/api/read/finance/payment_application/detail/${native.ids.application}`)).json()
    expect(applicationDetail.detail).toMatchObject({ approvedAmount: null, approvedAmountState: 'legacy-unknown', paidAmount: '50', unpaidAmount: null })
    await f.stop()
    await f.start()
    await f.login()
    expect(await (await f.request('/api/commands/finance/resolve', { method: 'POST', data: { kind: 'payment_application', commandId } })).json()).toMatchObject({ outcome: 'applied', result: { id: native.ids.application, version: '2', commandId } })
    expect(await (await f.request('/api/commands/finance/resolve', { method: 'POST', data: { kind: 'payment_record', commandId: actualRequest.commandId } })).json()).toEqual({ outcome: 'applied', result: payment })
    const original = await f.request(`/api/read/finance/payment_application/files/${native.ids.application}/${native.ids.applicationFile}`)
    expect(original.ok()).toBe(true)
    expect(await original.body()).toEqual(native.original)
    expect((await (await f.request(`/api/read/other-settlements/${native.ids.settlement}`)).json()).settlement.amounts.paid).toBe('50.00')
    expect(errors).toEqual([])
  }
  finally {
    await f.cleanup()
  }
})

test('Native原纸缺失E100/C30经整页替代核定，合并新70及旧30义务后确认唯一现金100并冷恢复五档', async ({ page }, info) => {
  test.setTimeout(180000)
  const f = await createCrewWorkerProductionFixture(page, info)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const bankEvidence = Buffer.from('合成银行对账说明：核对完整旧费用付款范围，纸单处理份额30尚无银行实付；原账及签收明确对应历史运输原费用100。此文件证明交叉核对，不是金额30的已付款回单。', 'utf8')
  const ledgerEvidence = Buffer.from('合成原账及签收核对：历史运输原费用100，纸单清偿处理份额30；原纸单从未电子化且已缺失，核定文件不是找回原纸单。旧处理份额仍须明确原结算及真实付款关系。', 'utf8')
  const matchingBasis = 'C原稳定行明确引用E；核对真实同公司、服务方、垫付人和原账30份额，保原纸缺失，不新增现金'
  try {
    await f.start()
    await f.login()
    const native = await createHistoricalClearanceMigrationSource(join(f.directory, 'native-clearance-source'))
    await info.attach('historical-clearance-synthetic-source', { body: native.path, contentType: 'text/plain' })
    await info.attach('historical-clearance-synthetic-storage', { body: f.directory, contentType: 'text/plain' })
    const context = await (await f.request('/api/read/finance/reimbursement/context')).json()
    const identity = { workspaceId: context.workspaceId, actorId: context.actorId }
    const suppliers: { legacyId: string, id: string }[] = []
    for (const [legacyId, name] of [[native.ids.service, '实际运输服务方'], [native.ids.payee, '实际垫付收款人']]) {
      const response = await f.request('/api/commands/suppliers', { method: 'POST', data: { ...identity, requiredCapability: 'supplier:write', commandId: `clearance-browser-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成核验人' } } })
      expect(response.ok(), await response.text()).toBe(true)
      suppliers.push({ legacyId: legacyId!, id: (await response.json()).id })
    }
    const serviceId = suppliers.find(row => row.legacyId === native.ids.service)!.id
    const payeeId = suppliers.find(row => row.legacyId === native.ids.payee)!.id
    await page.goto(`${f.origin}/settings/data-migration`)
    const migration = page.getByRole('region', { name: '财务原库迁入', exact: true })
    const sourceFile = migration.getByLabel('选择桌面导出的 SQLite 一致快照')
    await expect(sourceFile).toBeEnabled()
    await sourceFile.setInputFiles(native.path)
    await expect(migration.getByText('费用与报销：2 条（含已移除历史 0 条）', { exact: true })).toBeVisible({ timeout: 30_000 })
    for (const supplier of suppliers)
      await migration.getByRole('combobox', { name: new RegExp(supplier.legacyId) }).selectOption(supplier.id)
    for (const basis of await migration.getByLabel('身份对应的确认依据').all())
      await basis.fill('完整原费用、原清偿账及真实服务/垫付身份逐条核实，保留原纸缺失事实')
    const importResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/finance/import')
    await migration.getByRole('button', { name: '按已核验身份完整采用财务', exact: true }).click()
    const imported = await importResponse
    expect(imported.ok(), await imported.text()).toBe(true)
    await expect(migration.getByText(/已核对迁入 .*2 条财务记录/)).toBeVisible()
    const initialExpense = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.expense}`)).json()
    const initialClearance = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.clearance}`)).json()
    expect(initialExpense.draft.lines).toMatchObject([{ id: native.ids.expenseLine, amount: 100, counterpartySupplierId: serviceId }])
    expect(initialClearance.draft.lines).toMatchObject([{ id: native.ids.clearanceLine, originalExpenseLineId: native.ids.expenseLine, amount: 30 }])
    expect(initialClearance.attachments).toEqual([])
    const initialPayments = await f.request('/api/read/finance/payment_record/list')
    expect(initialPayments.ok(), await initialPayments.text()).toBe(true)
    expect((await initialPayments.json()).items).toEqual([])

    await page.goto(`${f.origin}/finance/reimbursement/${native.ids.expense}?origin=real`)
    const verification = page.getByRole('region', { name: '旧清偿替代核验', exact: true })
    await expect(verification).toBeVisible()
    await verification.getByLabel('选择原费用行', { exact: true }).selectOption(native.ids.expenseLine)
    await expect(verification.getByText('原清偿单缺失状态保留，替代证据不表示原件已找回。', { exact: true })).toBeVisible()
    await page.getByTestId('finance-attachment-input').setInputFiles([
      { name: '替代银行对账说明.txt', mimeType: 'text/plain', buffer: bankEvidence },
      { name: '替代原账签收对应.txt', mimeType: 'text/plain', buffer: ledgerEvidence },
    ])
    await expect(verification.getByRole('button', { name: '保存旧清偿替代核验', exact: true })).toBeDisabled()
    const attachmentSave = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/commands/finance')
        return false
      const request = response.request().postDataJSON()
      return request.kind === 'reimbursement' && request.id === native.ids.expense && request.action === 'save' && request.draft.clearanceAttachmentsOnly === true
    })
    await page.getByRole('button', { name: '保存新增替代原件', exact: true }).click()
    const savedAttachments = await attachmentSave
    expect(savedAttachments.ok(), await savedAttachments.text()).toBe(true)
    expect(savedAttachments.request().postDataJSON().draft).toEqual({ id: native.ids.expense, clearanceAttachmentsOnly: true })
    await verification.getByLabel('选择原费用行', { exact: true }).selectOption(native.ids.expenseLine)
    await expect(verification.getByLabel('替代证据 替代银行对账说明.txt', { exact: true })).toBeVisible()
    await verification.getByRole('button', { name: '新增核定份额', exact: true }).click()
    await verification.getByLabel('第 1 项份额来源', { exact: true }).selectOption(native.ids.clearanceLine)
    await verification.getByLabel('第 1 项核定处理金额', { exact: true }).fill('30')
    await verification.getByLabel('第 1 项原费用匹配依据', { exact: true }).fill(matchingBasis)
    await verification.getByLabel('替代核验说明', { exact: true }).fill('银行流水、原账及签收交叉核实原纸清偿30；原费用100只计成本一次，剩余新采用70及旧未付义务30分别保留')
    await verification.getByLabel('替代证据 替代银行对账说明.txt', { exact: true }).check()
    await verification.getByLabel('替代证据 替代原账签收对应.txt', { exact: true }).check()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `缺原纸清偿替代核定 ${width}px`)
      const basis = verification.getByLabel('替代核验说明', { exact: true })
      await basis.scrollIntoViewIfNeeded()
      await basis.focus()
      await expect(basis).toBeFocused()
      await expect(basis).toBeInViewport()
    }
    const sourceBefore = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.expense}`)).json()
    const originalBefore = sourceBefore.draft.clearanceVerification.sources.find((source: { id: string }) => source.id === native.ids.expenseLine)
    expect(originalBefore).toMatchObject({ amount: 100, clearedAmount: 30, qualification: { state: 'missing', recordedHandledAmount: 30, verifiedHandledAmount: null, newAdoptableAmount: null }, clearances: [{ id: native.ids.clearanceLine, amount: 30, missingOriginalDocument: true, originalDocumentState: 'not-digitized' }] })
    const savedEvidence = sourceBefore.attachments.filter((file: { fileName: string }) => ['替代银行对账说明.txt', '替代原账签收对应.txt'].includes(file.fileName))
    expect(savedEvidence.map((file: { fileName: string }) => file.fileName).sort()).toEqual(['替代原账签收对应.txt', '替代银行对账说明.txt'])
    let verificationPosts = 0
    await page.route('**/api/commands/finance', async (route) => {
      const request = route.request().postDataJSON()
      if (request.kind === 'reimbursement' && request.draft.clearanceVerificationEdit) {
        verificationPosts++
        expect(request).toMatchObject({ kind: 'reimbursement', action: 'save', id: native.ids.expense, baseVersion: sourceBefore.version, attachments: {} })
        expect(Object.keys(request.draft).sort()).toEqual(['clearanceVerificationEdit', 'id'])
        expect(request.draft.clearanceVerificationEdit).toMatchObject({ originalExpenseLineId: native.ids.expenseLine, sourceVersion: originalBefore.version, sourceHash: originalBefore.clearanceSourceHash, items: [{ sourceClearanceLineId: native.ids.clearanceLine, amount: 30 }], existingBindings: [] })
        expect(request.draft.clearanceVerificationEdit.fileIds.sort()).toEqual(savedEvidence.map((file: { id: string }) => file.id).sort())
      }
      await route.continue()
    })
    const verificationResponse = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/commands/finance')
        return false
      return !!response.request().postDataJSON().draft.clearanceVerificationEdit
    })
    const verifyButton = verification.getByRole('button', { name: '保存旧清偿替代核验', exact: true })
    await verifyButton.focus()
    await page.keyboard.press('Enter')
    const verifiedResponse = await verificationResponse
    expect(verifiedResponse.ok(), await verifiedResponse.text()).toBe(true)
    const verificationResult = await verifiedResponse.json()
    expect(verificationResult.clearanceVerificationSha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(verification.getByText('可新增采用额度', { exact: true }).locator('..')).toContainText('70.00')
    await expect(verification.getByText('旧份额待实付', { exact: true }).locator('..')).toContainText('30.00')
    expect(verificationPosts).toBe(1)
    await page.unroute('**/api/commands/finance')
    const afterVerification = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.expense}`)).json()
    const verifiedExpense = afterVerification.draft.clearanceVerification.sources.find((source: { id: string }) => source.id === native.ids.expenseLine)
    expect(verifiedExpense.qualification).toMatchObject({ state: 'verified', recordedHandledAmount: 30, verifiedHandledAmount: 30, confirmedOtherAdoptedAmount: 0, verifiedOverlapAmount: 0, newAdoptableAmount: 70, legacyObligationAmount: 30, legacyPaidAmount: 0, legacyUnpaidAmount: 30 })
    const proof = afterVerification.draft.clearanceVerification.proofs.find((item: { id: string }) => item.id === verificationResult.clearanceVerificationId)
    expect(proof).toMatchObject({ schemaVersion: 'expense-clearance-verification-v1', originalExpenseLineId: native.ids.expenseLine, headerId: native.ids.expense, commandId: verificationResult.commandId, workspaceId: identity.workspaceId, actorId: identity.actorId, items: [{ sourceClearanceLineId: native.ids.clearanceLine, amount: 30, missingOriginalDocument: true }] })
    expect(proof.originals).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerType: 'expense_reimbursement', ownerId: native.ids.expense, fileName: '替代银行对账说明.txt', fileSize: bankEvidence.length, sha256: createHash('sha256').update(bankEvidence).digest('hex') }),
      expect.objectContaining({ ownerType: 'expense_reimbursement', ownerId: native.ids.expense, fileName: '替代原账签收对应.txt', fileSize: ledgerEvidence.length, sha256: createHash('sha256').update(ledgerEvidence).digest('hex') }),
    ]))
    const verificationPayments = await f.request('/api/read/finance/payment_record/list')
    expect(verificationPayments.ok(), await verificationPayments.text()).toBe(true)
    expect((await verificationPayments.json()).items).toEqual([])
    expect((await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.clearance}`)).json()).draft.lines).toMatchObject([{ id: native.ids.clearanceLine, originalExpenseLineId: native.ids.expenseLine, amount: 30 }])
    await f.stop()
    const disk = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(disk.prepare('SELECT amount FROM expense_reimbursement_lines WHERE id=?').get(native.ids.expenseLine)).toEqual({ amount: 100 })
      expect(disk.prepare('SELECT amount,original_expense_line_id FROM expense_reimbursement_lines WHERE id=?').get(native.ids.clearanceLine)).toEqual({ amount: 30, original_expense_line_id: native.ids.expenseLine })
      expect(disk.prepare('SELECT operator,after_data FROM operation_logs WHERE id=?').get(native.ids.clearanceAudit)).toEqual({ operator: '原纸单清偿经办人', after_data: native.originalClearanceAudit })
      expect(disk.prepare('SELECT COUNT(*) AS count FROM file_refs WHERE owner_type=\'expense_reimbursement\' AND owner_id=?').get(native.ids.clearance)).toEqual({ count: 0 })
      expect(disk.prepare('SELECT COUNT(*) AS count FROM payment_records WHERE confirmation_status=\'confirmed\'').get()).toEqual({ count: 0 })
      expect(disk.prepare('SELECT COUNT(*) AS count FROM finance_expense_clearance_verifications WHERE original_expense_line_id=?').get(native.ids.expenseLine)).toEqual({ count: 1 })
    }
    finally {
      disk.close()
    }
    await f.start()
    await f.login()
    const coldVerification = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.expense}`)).json()
    const coldExpense = coldVerification.draft.clearanceVerification.sources.find((source: { id: string }) => source.id === native.ids.expenseLine)
    expect(coldExpense.qualification).toMatchObject({ state: 'verified', newAdoptableAmount: 70, legacyUnpaidAmount: 30 })
    expect(coldVerification.draft.clearanceVerification.proofs).toContainEqual(proof)
    const nativeOriginal = await f.request(`/api/read/finance/reimbursement/files/${native.ids.expense}/${native.ids.expenseFile}`)
    expect(nativeOriginal.ok()).toBe(true)
    expect(await nativeOriginal.body()).toEqual(native.original)
    const recognition = proof.items.find((item: { sourceClearanceLineId: string }) => item.sourceClearanceLineId === native.ids.clearanceLine)
    expect(recognition).toMatchObject({ amount: 30, matchBasis: matchingBasis, missingOriginalDocument: true })
    const candidates = await (await f.request('/api/read/other-settlements/expenses')).json()
    expect(candidates.items.map((item: { id: string }) => item.id)).toEqual([native.ids.expenseLine])
    expect(candidates.items[0]).toMatchObject({ amount: 100, clearedAmount: 30, qualification: { newAdoptableAmount: 70, legacyUnpaidAmount: 30 } })
    await page.goto(`${f.origin}/contract/other-settlement/form`)
    await page.getByLabel('采用原费用 历史运输原费用100', { exact: true }).check()
    await expect(page.getByLabel('原费用 历史运输原费用100 采用金额', { exact: true })).toHaveValue('70')
    await page.getByLabel('原费用 历史运输原费用100 采用金额', { exact: true }).fill('100')
    const binding = page.getByRole('region', { name: '旧份额关联与待实付', exact: true })
    await binding.getByLabel(`承接旧份额 ${matchingBasis}`, { exact: true }).check()
    await binding.getByLabel(`旧份额 ${matchingBasis} 本次金额`, { exact: true }).fill('30')
    await expect(binding.getByText('本次新增采用', { exact: true }).locator('..')).toContainText('70.00')
    await expect(binding.getByText('承接已核旧份额', { exact: true }).locator('..')).toContainText('30.00')
    await expect(binding.getByText('总采用', { exact: true }).locator('..')).toContainText('100.00')
    await expect(binding.getByText('原链待实付', { exact: true }).locator('..')).toContainText('30.00')
    await page.getByLabel('结算名称 *', { exact: true }).fill('纸单旧30与新70合并费用结算')
    await page.getByLabel('结算日期 *', { exact: true }).fill('2026-10-05')
    await page.locator('input[type="file"]').setInputFiles({ name: '合并结算费用依据.txt', mimeType: 'text/plain', buffer: Buffer.from('原E100，明确旧核定份额30与新采用70共同承接，未制造新费用或银行实付。', 'utf8') })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `明确旧30与新70合并 ${width}px`)
      const oldAmount = binding.getByLabel(`旧份额 ${matchingBasis} 本次金额`, { exact: true })
      await oldAmount.scrollIntoViewIfNeeded()
      await oldAmount.focus()
      await expect(oldAmount).toBeFocused()
      await expect(oldAmount).toBeInViewport()
    }
    const submittedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/other-settlements' && response.request().postDataJSON().action === 'submit')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交', exact: true }).click()
    await page.getByRole('dialog', { name: '提交结算', exact: true }).getByRole('button', { name: '提交', exact: true }).click()
    const submitted = await submittedResponse
    expect(submitted.ok(), await submitted.text()).toBe(true)
    expect(submitted.request().postDataJSON().draft).toMatchObject({ contractId: null, projectId: null, supplierId: null, payeeSupplierId: payeeId, totalAmount: 100, originalExpenses: [{ originalExpenseLineId: native.ids.expenseLine, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: recognition.id, amount: 30 }] }] })
    const settlement = await submitted.json()
    const submittedFormResponse = await f.request(`/api/read/other-settlements/${settlement.id}?origin=real&includeDeleted=true`)
    expect(submittedFormResponse.ok(), await submittedFormResponse.text()).toBe(true)
    const submittedForm = await submittedFormResponse.json()
    expect(submittedForm.settlement.draft).toMatchObject({ supplierId: serviceId, payeeSupplierId: payeeId, originalExpenses: [{ originalExpenseLineId: native.ids.expenseLine, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: recognition.id, amount: 30 }] }] })
    const submittedDetailResponse = await f.request(`/api/read/other-settlements/${settlement.id}?origin=real`)
    expect(submittedDetailResponse.ok(), await submittedDetailResponse.text()).toBe(true)
    expect((await submittedDetailResponse.json()).settlement.draft).toMatchObject({ supplierId: serviceId, payeeSupplierId: payeeId, originalExpenses: [{ originalExpenseLineId: native.ids.expenseLine, amount: 100, clearanceAllocations: [{ verificationId: proof.id, itemId: recognition.id, amount: 30 }] }] })
    await expect(page.getByTestId('other-settlement-detail')).toBeVisible()
    await page.getByRole('button', { name: '编辑结算', exact: true }).click()
    const confirmationResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/other-settlements' && response.request().postDataJSON().action === 'confirm')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '确认结算', exact: true }).click()
    await page.getByRole('dialog', { name: '确认结算', exact: true }).getByRole('button', { name: '确认结算', exact: true }).click()
    const confirmed = await confirmationResponse
    expect(confirmed.ok(), await confirmed.text()).toBe(true)
    const confirmedSettlement = await confirmed.json()
    const afterAdoption = await (await f.request(`/api/read/other-settlements/${settlement.id}`)).json()
    expect(afterAdoption.settlement.amounts).toMatchObject({ total: '100.00', net: '100.00', paid: '0.00', unpaid: '100.00' })
    expect(afterAdoption.settlement.clearanceLinks).toEqual([expect.objectContaining({ settlementId: settlement.id, originalExpenseLineId: native.ids.expenseLine, verificationId: proof.id, itemId: recognition.id, amount: 30 })])
    const consumed = await (await f.request('/api/read/other-settlements/expenses')).json()
    expect(consumed.items[0].qualification).toMatchObject({ verifiedHandledAmount: 30, confirmedOtherAdoptedAmount: 100, verifiedOverlapAmount: 30, newAdoptableAmount: 0, legacyUnpaidAmount: 30 })
    const adoptedPayments = await f.request('/api/read/finance/payment_record/list')
    expect(adoptedPayments.ok(), await adoptedPayments.text()).toBe(true)
    expect((await adoptedPayments.json()).items).toEqual([])

    await page.goto(`${f.origin}/finance/payment/new`)
    await page.getByRole('button', { name: '公司付款', exact: true }).click()
    await page.getByTestId('finance-name').fill('原E100及旧30义务合并付款申请')
    await page.getByPlaceholder('检索分供方', { exact: true }).fill('实际垫付收款人')
    await page.getByRole('option', { name: /实际垫付收款人/ }).click()
    await page.getByTestId('finance-amount').fill('100')
    await page.getByTestId('finance-date').fill('2026-10-05')
    await page.getByRole('textbox', { name: '申请人 *', exact: true }).fill('合成财务')
    await page.getByRole('combobox', { name: '回票类型', exact: true }).click()
    await page.getByRole('option', { name: '无需发票', exact: true }).click()
    await page.locator('#section-settlements').getByTestId('add-grid-line').click()
    await page.getByRole('combobox', { name: '选择结算单', exact: true }).fill('纸单旧30与新70合并费用结算')
    await page.getByRole('option', { name: /纸单旧30与新70合并费用结算/ }).click()
    await page.getByRole('spinbutton', { name: '本次关联结算金额', exact: true }).fill('100')
    const applicationResponse = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/commands/finance')
        return false
      const request = response.request().postDataJSON()
      return request.kind === 'payment_application' && request.action === 'submit'
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交', exact: true }).click()
    const submittedApplication = await applicationResponse
    expect(submittedApplication.ok(), await submittedApplication.text()).toBe(true)
    expect(submittedApplication.request().postDataJSON().draft).toMatchObject({ bizType: '公司付款', supplierId: payeeId, applyAmount: 100, approvedAmount: null, invoiceState: '无需发票', settlementAllocations: [{ settlementId: settlement.id, allocatedAmount: 100 }] })
    const application = await submittedApplication.json()
    await page.goto(`${f.origin}/finance/payment/${application.id}/detail?origin=real`)
    await expect(page.getByTestId('payment-application-create-payment')).toBeVisible()
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page.getByTestId('finance-amount')).toHaveValue('100')
    await page.getByTestId('finance-amount').fill('100')
    await page.getByRole('spinbutton', { name: '本次支付分摊金额', exact: true }).fill('100')
    await page.getByTestId('finance-date').fill('2026-10-05')
    await page.getByRole('textbox', { name: '付款凭证号 *', exact: true }).fill('SYNTHETIC-CLEARANCE-VOUCHER-100')
    await page.getByTestId('payment-bank-serial').fill('SYNTHETIC-CLEARANCE-BANK-100')
    await page.getByTestId('payment-confirmed-by').fill('合成财务')
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: '实际银行支付100.txt', mimeType: 'text/plain', buffer: Buffer.from('合成真实回单：SYNTHETIC-CLEARANCE-BANK-100，2026-10-05，实际垫付收款人，银行支付100；唯一申请明确承接旧30及新70。', 'utf8') })
    let cashPosts = 0
    let cashResolves = 0
    let cashCommand = ''
    let payment!: { id: string, commandId: string, version: string }
    let delivered!: () => void
    const persisted = new Promise<void>(resolve => delivered = resolve)
    await page.route('**/api/commands/finance', async (route) => {
      const request = route.request().postDataJSON()
      if (request.kind !== 'payment_record' || request.action !== 'confirm') {
        await route.continue()
        return
      }
      cashPosts++
      cashCommand = request.commandId
      expect(request.draft).toMatchObject({ supplierId: payeeId, amount: 100, bankSerialNo: 'SYNTHETIC-CLEARANCE-BANK-100', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 100 }] })
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      payment = await response.json()
      await route.abort('failed')
      delivered()
    })
    await page.route('**/api/commands/finance/resolve', async (route) => {
      cashResolves++
      expect(route.request().postDataJSON()).toEqual({ kind: 'payment_record', commandId: cashCommand })
      await route.continue()
    })
    await page.getByTestId('confirm-payment').click()
    await page.getByRole('dialog', { name: '人工确认支付', exact: true }).getByRole('button', { name: '确认支付', exact: true }).click()
    await persisted
    const recover = page.getByRole('button', { name: '核对原提交', exact: true })
    await expect(recover).toBeEnabled()
    const descriptors = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:finance-payment-record:')).map(([, value]) => JSON.parse(value)))
    expect(descriptors).toEqual([{ commandId: cashCommand, workspaceId: identity.workspaceId, actorId: identity.actorId, family: 'finance-payment-record', targetId: null, action: 'confirm' }])
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `银行100原键恢复 ${width}px`)
      await recover.scrollIntoViewIfNeeded()
      await recover.focus()
      await expect(recover).toBeFocused()
      await expect(recover).toBeInViewport()
    }
    await page.keyboard.press('Enter')
    await expect(recover).toHaveCount(0)
    await expect(page.getByTestId('unconfirm-payment')).toBeVisible()
    expect(cashPosts).toBe(1)
    expect(cashResolves).toBe(1)
    await page.unroute('**/api/commands/finance')
    await page.unroute('**/api/commands/finance/resolve')
    const confirmedPayments = await f.request('/api/read/finance/payment_record/list')
    expect(confirmedPayments.ok(), await confirmedPayments.text()).toBe(true)
    expect((await confirmedPayments.json()).items).toEqual([expect.objectContaining({ id: payment.id, amount: '100', status: 'confirmed' })])
    const paid = await (await f.request(`/api/read/other-settlements/${settlement.id}`)).json()
    expect(paid.settlement.amounts).toMatchObject({ total: '100.00', net: '100.00', applied: '100.00', paid: '100.00', unpaid: '0.00' })
    const paidSource = await (await f.request('/api/read/other-settlements/expenses')).json()
    expect(paidSource.items[0].qualification).toMatchObject({ state: 'verified', newAdoptableAmount: 0, verifiedOverlapAmount: 30, legacyObligationAmount: 30, legacyPaidAmount: 30, legacyUnpaidAmount: 0 })
    const applicationForm = await (await f.request(`/api/read/finance/payment_application/form/${application.id}`)).json()
    expect(applicationForm.draft).toMatchObject({ approvedAmount: null, paymentVerification: { required: false }, paidAmount: 100 })
    await f.stop()
    await f.start()
    await f.login()
    expect(await (await f.request('/api/commands/finance/resolve', { method: 'POST', data: { kind: 'payment_record', commandId: cashCommand } })).json()).toEqual({ outcome: 'applied', result: payment })
    const coldPaid = await (await f.request(`/api/read/other-settlements/${settlement.id}`)).json()
    expect(coldPaid.settlement.version).toBe(confirmedSettlement.version)
    expect(coldPaid.settlement.amounts).toMatchObject({ total: '100.00', net: '100.00', applied: '100.00', paid: '100.00', unpaid: '0.00' })
    const finalSource = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.expense}`)).json()
    const finalExpense = finalSource.draft.clearanceVerification.sources.find((source: { id: string }) => source.id === native.ids.expenseLine)
    expect(finalExpense).toMatchObject({ amount: 100, clearedAmount: 30, qualification: { state: 'verified', newAdoptableAmount: 0, legacyPaidAmount: 30, legacyUnpaidAmount: 0 }, clearances: [{ id: native.ids.clearanceLine, missingOriginalDocument: true, originalDocumentState: 'not-digitized' }] })
    expect(finalExpense.clearanceProofs).toContainEqual(proof)
    const coldClearance = await (await f.request(`/api/read/finance/reimbursement/form/${native.ids.clearance}`)).json()
    expect(coldClearance.draft.lines).toMatchObject([{ id: native.ids.clearanceLine, originalExpenseLineId: native.ids.expenseLine, amount: 30 }])
    expect(coldClearance.attachments).toEqual([])
    expect(serviceId).not.toBe(payeeId)
    expect(errors).toEqual([])
  }
  finally {
    await f.cleanup()
  }
})
