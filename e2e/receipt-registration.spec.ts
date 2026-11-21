import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

const widths = [390, 768, 1024, 1280, 1440]
test.use({ actionTimeout: 15_000 })
test.beforeEach(async ({ page }, info) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `receipt-436-${info.testId}` })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })
  const reset = await page.request.post('/api/testing/receipts/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready', seed: true } })
  expect(reset.ok()).toBe(true)
})

async function context(page: Page) {
  const response = await page.request.get('/api/read/receipts/context')
  expect(response.ok()).toBe(true)
  return response.json()
}
async function scenario(page: Page, value: string) {
  const response = await page.request.post('/api/testing/receipts/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: value } })
  expect(response.ok()).toBe(true)
}
async function seedReceipt(page: Page, no: string, blank = false) {
  const data = await context(page)
  const contract = data.contracts[0]
  const response = await page.request.post('/api/commands/receipts', { data: {
    workspaceId: data.workspaceId,
    actorId: data.actorId,
    requiredCapability: 'receipt:write',
    commandId: crypto.randomUUID(),
    baseVersion: null,
    origin: 'real',
    action: blank ? 'draft' : 'submit',
    attachments: {},
    draft: { no, receiptDate: blank ? '' : '2026-09-11', projectId: blank ? null : contract.projectId, customerId: blank ? null : 'customer-real-320', contractId: blank ? null : contract.id, amount: blank ? null : '120.35', payerAccount: '', paymentMethod: '银行转账', acceptanceBillNo: '', billDueDate: '', periodNo: '', bankSerialNo: '', handler: '', reviewStatus: '待审核', status: 'draft', note: '' },
  } })
  expect(response.ok()).toBe(true)
  return { ...await response.json(), context: data, contract }
}
async function openFromList(page: Page, no: string) {
  await page.locator('[data-ui="kit-table"]').getByRole('link', { name: no, exact: true }).click()
  await expect(page.getByRole('heading', { name: no, exact: true })).toBeVisible()
}

test.describe('Issue #436 普通收款中央全链', () => {
  test('整页新建提交、真实附件读取和五档列表详情表单', async ({ page }, info) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const source = await context(page)
    await page.goto('/finance/receipt')
    await page.getByRole('link', { name: '新增收款' }).click()
    await page.getByRole('textbox', { name: '收款单号', exact: true }).fill('SK-UI-436')
    await page.getByLabel('收款日期', { exact: true }).fill('2026-09-11')
    await page.getByPlaceholder('选择项目', { exact: true }).click()
    await page.getByRole('option', { name: source.projects[0].name, exact: true }).click()
    await page.getByPlaceholder('可不关联施工合同').click()
    await page.getByRole('option', { name: new RegExp(source.contracts[0].name) }).click()
    await page.getByRole('textbox', { name: '收款金额', exact: true }).fill('1234.56')
    await page.getByRole('textbox', { name: '付款方账号', exact: true }).fill('6222-436')
    await page.getByRole('textbox', { name: '银行流水号', exact: true }).fill('BANK-UI-436')
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: 'receipt-voucher.txt', mimeType: 'text/plain', buffer: Buffer.from('普通收款真实凭证 436', 'utf8') })
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\/receipt(?:\?|$)/)
    await openFromList(page, 'SK-UI-436')
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('1,234.56')
    await expect(page.getByRole('group', { name: '合同累计收款', exact: true })).toContainText('1,234.56')
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src', /^blob:/)
    await page.getByRole('dialog').press('Escape')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载', exact: true }).click()
    const download = await downloadPromise
    const file = info.outputPath('receipt-voucher.txt')
    await download.saveAs(file)
    expect(await readFile(file, 'utf8')).toBe('普通收款真实凭证 436')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'SK-UI-436', exact: true })).toBeVisible()
    await expect(page.getByText('receipt-voucher.txt', { exact: true })).toBeVisible()
    const receiptTabKey = await page.locator('[data-tab-key]:has([data-tab-trigger][aria-current="page"])').getAttribute('data-tab-key')
    expect(receiptTabKey).toBeTruthy()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `收款详情 ${width}`)
      await page.getByRole('link', { name: '编辑收款' }).focus()
      await expect(page.getByRole('link', { name: '编辑收款' })).toBeFocused()
      await page.getByRole('region', { name: '收款凭证附件' }).scrollIntoViewIfNeeded()
      await page.getByRole('link', { name: '编辑收款' }).press('Enter')
      await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('1234.56')
      await expect(page.getByPlaceholder('选择项目', { exact: true })).toHaveValue(source.projects[0].name)
      await expect(page.getByPlaceholder('选择项目主客户', { exact: true })).toHaveValue(source.customers.find((customer: { id: string }) => customer.id === source.projects[0].customerId).name)
      await expect(page.getByPlaceholder('可不关联施工合同')).toHaveValue(source.contracts[0].name)
      await expect(page.locator(`[data-tab-key="${receiptTabKey}"] [data-tab-trigger]`)).toContainText('SK-UI-436')
      await expectNoPageOverflow(page, `收款表单 ${width}`)
      await page.locator('#section-attachments').scrollIntoViewIfNeeded()
      await expect(page.getByRole('group', { name: '表单操作' })).toBeVisible()
      await expectNoPageOverflow(page, `收款附件表单 ${width}`)
      await page.getByRole('button', { name: '返回来源页面', exact: true }).click()
      await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
      await expect(page).toHaveURL(/\/finance\/receipt\?/)
      await expectNoPageOverflow(page, `收款列表 ${width}`)
      await openFromList(page, 'SK-UI-436')
    }
    await page.getByRole('link', { name: '编辑收款' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('未登记附件。', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '编辑收款' }).click()
    await page.getByRole('button', { name: '恢复', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('receipt-voucher.txt', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('无客户草稿保持空金额，真实零与原提交未应用封存后的新命令保存', async ({ page }) => {
    test.setTimeout(90_000)
    const saved = await seedReceipt(page, 'SK-BLANK-436', true)
    const listPath = '/finance/receipt?search=SK-BLANK&page=1&pageSize=10'
    const list = page.locator('[data-list-shell].list-shell--continuous [data-ui="kit-table"]')
    await page.goto(listPath)
    await expect(list.locator('[data-ui="receipt-list-amount"]')).toHaveText('—')
    await expect(list.getByText('正式', { exact: true })).toHaveAttribute('data-ui', 'status-tag')
    await openFromList(page, 'SK-BLANK-436')
    await expect(page).not.toHaveURL(/customerId=/)
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('未填写')
    await page.getByRole('link', { name: '编辑收款' }).click()
    await page.getByRole('textbox', { name: '收款金额', exact: true }).fill('0')
    const commands: string[] = []
    let failing = true
    await page.route('**/api/commands/receipts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      if (failing) {
        failing = false
        await route.abort('failed')
      }
      else {
        await route.continue()
      }
    })
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page.getByRole('status', { name: '原提交恢复' })).toContainText('原提交结果未知')
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('0')
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    await expect(page.getByRole('status', { name: '原提交恢复' })).toHaveCount(0)
    expect(commands).toHaveLength(1)
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('0.00')
    expect(commands).toHaveLength(2)
    expect(commands[0]).not.toBe(commands[1])
    const record = await (await page.request.get(`/api/read/receipts/${saved.id}/record?origin=real`)).json()
    expect(record.record.draft.amount).toBe('0.00')
    await page.getByRole('button', { name: '返回来源页面', exact: true }).click()
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('0.00')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'SK-BLANK-436', exact: true })).toBeVisible()
    await page.goto(listPath)
    await expect(list.locator('[data-ui="receipt-list-amount"]')).toHaveText('¥0.00')
    await openFromList(page, 'SK-BLANK-436')
    await scenario(page, 'forbidden')
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await expect(page.getByRole('link', { name: '编辑收款' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toHaveCount(0)
  })

  test('客户、合同、项目和最终结算的来源返回保持各自记录与金额', async ({ page }) => {
    test.setTimeout(150_000)
    const saved = await seedReceipt(page, 'SK-SOURCE-436')
    const projectId = saved.contract.projectId
    await page.goto('/base/customer/customer-real-320?origin=real&tab=receipts')
    await page.getByRole('link', { name: 'SK-SOURCE-436', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'SK-SOURCE-436', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await expect(page).toHaveURL(/\/base\/customer\/customer-real-320\?.*tab=receipts/)
    await expect(page.getByRole('link', { name: 'SK-SOURCE-436', exact: true })).toBeFocused()
    await page.goto(`/contract/${saved.contract.id}?origin=real&contractKind=construction&tab=receipts`)
    await page.locator('[data-testid="construction-contract-fact-scroll"]').getByRole('link', { name: 'SK-SOURCE-436', exact: true }).click()
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await expect(page).toHaveURL(/tab=receipts.*#construction-contract-receipt-/)
    await expect(page.locator('[data-testid="construction-contract-fact-scroll"]').getByRole('link', { name: 'SK-SOURCE-436', exact: true })).toBeFocused()
    await page.goto(`/project/${projectId}?origin=real`)
    await expect(page.getByRole('region', { name: '项目收款' })).toContainText('120.35')
    await page.getByRole('link', { name: '查看收款登记', exact: true }).click()
    await openFromList(page, 'SK-SOURCE-436')
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await expect(page).toHaveURL(/#project-receipt-link$/)
    await expect(page.getByRole('link', { name: '查看收款登记', exact: true })).toBeFocused()
    const settlements = await (await page.request.get('/api/read/owner-documents/final_settlement', { params: { origin: 'real', projectId } })).json()
    const settlementId = settlements.items[0].id
    await page.goto(`/owner/final-settlement/${settlementId}?origin=real`)
    await page.getByRole('link', { name: '查看收款', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'SK-SOURCE-436', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await expect(page).toHaveURL(/#final-settlement-receipt-/)
    await expect(page.getByRole('link', { name: '查看收款', exact: true })).toBeFocused()
  })

  test('已应用但响应丢失的原编号跨刷新恢复，保存后读回失败只重读并保留输入', async ({ page }) => {
    test.setTimeout(90_000)
    const saved = await seedReceipt(page, 'SK-RECOVERY-A03')
    await page.goto(`/finance/receipt/form/${saved.id}?origin=real`)
    await page.getByRole('textbox', { name: '收款金额', exact: true }).fill('220.25')
    const commands: string[] = []
    await page.route('**/api/commands/receipts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      await route.fetch()
      await route.abort('failed')
    })
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('status', { name: '原提交恢复' })).toContainText('原提交结果未知')
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('220.25')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('220.25')
    await expect(page.getByRole('status', { name: '原提交恢复' })).toHaveCount(0)
    expect(commands).toHaveLength(1)
    await page.unroute('**/api/commands/receipts')
    await page.route('**/api/commands/receipts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      await route.continue()
    })
    let failRead = true
    await page.route(`**/api/read/receipts/${saved.id}/record?**`, async (route) => {
      if (failRead) {
        await route.fulfill({ status: 503, json: { code: 'unavailable', message: '保存后读取暂不可用', retryable: true, fieldErrors: {}, traceId: null } })
      }
      else {
        await route.continue()
      }
    })
    await page.getByRole('textbox', { name: '收款金额', exact: true }).fill('330.50')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('status', { name: '原提交恢复' })).toContainText('已保存待刷新')
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('330.50')
    await expect(page).toHaveURL(new RegExp(`/finance/receipt/form/${saved.id}`))
    await expect(page.getByRole('button', { name: '重新读取已保存记录' })).toBeEnabled()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `收款恢复 ${width}`)
      await page.getByRole('button', { name: '重新读取已保存记录' }).focus()
      await expect(page.getByRole('button', { name: '重新读取已保存记录' })).toBeFocused()
    }
    failRead = false
    await page.getByRole('button', { name: '重新读取已保存记录' }).press('Enter')
    await expect(page.getByRole('status', { name: '原提交恢复' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('330.50')
    expect(commands).toHaveLength(2)
    const record = await (await page.request.get(`/api/read/receipts/${saved.id}/record?origin=real`)).json()
    expect(record.record.version).toBe('3')
    expect(record.record.draft.amount).toBe('330.50')
  })

  test('演示收款单独累计、按演示身份读取且没有写入口', async ({ page }) => {
    test.setTimeout(90_000)
    await seedReceipt(page, 'SK-REAL-ONLY-436')
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.goto('/finance/receipt')
    const summary = page.locator('[data-list-shell-summary]')
    await expect(summary).toContainText('正式 1 笔')
    await expect(summary).toContainText('¥120.35')
    await expect(summary).toContainText('演示 1 笔')
    await expect(summary).toContainText('¥25,367,027.00')
    await openFromList(page, 'SK-2026-001')
    await expect(page).toHaveURL(/origin=demo/)
    await expect(page.getByRole('link', { name: '编辑收款' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('25,367,027.00')
    await expect(page.getByRole('link', { name: '合和新城', exact: true })).toHaveAttribute('href', /origin=demo/)
  })

  test('新建空草稿保存后转为自己的编辑路由，列表重新打开保留空金额', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/finance/receipt/new?origin=real')
    await page.getByRole('textbox', { name: '收款单号', exact: true }).fill('SK-NEW-DRAFT-436')
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\/receipt\/form\//)
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('')
    await page.getByRole('button', { name: '返回来源页面', exact: true }).click()
    await openFromList(page, 'SK-NEW-DRAFT-436')
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('未填写')
  })

  test('缺项目提交将首错聚焦到可编辑选择控件并保留金额', async ({ page }) => {
    await page.goto('/finance/receipt/new?origin=real')
    await page.getByLabel('收款日期', { exact: true }).fill('2026-09-11')
    await page.getByRole('textbox', { name: '收款金额', exact: true }).fill('10.25')
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    const input = page.locator('input[data-field="projectId"]')
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAttribute('aria-describedby', 'receipt-projectId-error')
    await expect(page.locator('#receipt-projectId-error')).toHaveText('请选择项目')
    await expect(page.getByRole('textbox', { name: '收款金额', exact: true })).toHaveValue('10.25')
  })

  test('同 ID 正式演示详情缓存切换，以及新建表单来源 A 到 B 往返', async ({ page }) => {
    test.setTimeout(90_000)
    const formal = await seedReceipt(page, 'SK-CACHE-REAL-436')
    const mixed = await (await page.request.get('/api/read/receipts?includeDemo=true')).json()
    const demo = mixed.items.find((row: { record: { dataOrigin: string } }) => row.record.dataOrigin === 'demo')
    // 仅制造跨来源 ID 碰撞；两行内容与权限来自各自真实中央读模型。
    const sameIdDemo = { ...demo, record: { ...demo.record, id: formal.id, attachments: demo.record.attachments.map((file: Record<string, unknown>) => ({ ...file, ownerId: formal.id })) } }
    await page.route('**/api/read/receipts**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/read/receipts') {
        const response = await route.fetch()
        const pageData = await response.json()
        await route.fulfill({ response, json: { ...pageData, items: pageData.items.map((row: { record: { dataOrigin: string } }) => row.record.dataOrigin === 'demo' ? sameIdDemo : row) } })
      }
      else if (url.pathname === `/api/read/receipts/${formal.id}/record` && url.searchParams.get('origin') === 'demo') {
        await route.fulfill({ json: sameIdDemo })
      }
      else {
        await route.continue()
      }
    })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.goto('/finance/receipt')
    await openFromList(page, 'SK-CACHE-REAL-436')
    await expect(page.getByRole('link', { name: '编辑收款' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    await openFromList(page, 'SK-2026-001')
    await expect(page).toHaveURL(/origin=demo/)
    await expect(page.getByRole('group', { name: '登记金额', exact: true })).toContainText('25,367,027.00')
    await expect(page.getByRole('link', { name: '编辑收款' })).toHaveCount(0)
    await page.getByRole('link', { name: '返回来源页面', exact: true }).click()
    const search = page.getByRole('searchbox', { name: '查找收款' })
    await search.fill('SOURCE-A')
    await expect(page).toHaveURL(/search=SOURCE-A/)
    await page.getByRole('link', { name: '新增收款' }).click()
    await expect(page.getByRole('heading', { name: '新建 · 收款登记' })).toBeVisible()
    await page.locator('[data-tab-key="/finance/receipt"] [data-tab-trigger]').click()
    await search.fill('SOURCE-B')
    await expect(page).toHaveURL(/search=SOURCE-B/)
    await page.getByRole('link', { name: '新增收款' }).click()
    await expect(page.getByRole('heading', { name: '新建 · 收款登记' })).toBeVisible()
    await page.getByRole('button', { name: '返回来源页面', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\/receipt\?[^#]*search=SOURCE-B/)
    await page.unrouteAll({ behavior: 'wait' })
  })
})
