import { Buffer } from 'node:buffer'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_CORRECTION_ACCEPTANCE !== '1', '只在明确指定的独立构建和合成数据库中运行')

test('归档票更正先保存草稿，提交响应丢失后重启并用原编号恢复；打印历史阻断', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定项目内独立构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  async function post<T>(path: string, data: object): Promise<T> {
    const response = await fixture.request(path, { method: 'POST', data })
    expect(response.ok(), await response.text()).toBe(true)
    return await response.json() as T
  }
  async function readInvoice(id: string) {
    const response = await fixture.request(`/api/read/invoices/${encodeURIComponent(id)}`)
    expect(response.ok(), await response.text()).toBe(true)
    return await response.json() as { record: { id: string, version: string, printCount: number, fields: { taxAmount: number | null } } }
  }
  try {
    await fixture.start()
    await fixture.login()
    const browser = page.context().browser()
    if (!browser)
      throw new Error('浏览器上下文不可用，无法核对未登录访问。')
    const anonymous = await browser.newContext()
    try {
      const denied = await anonymous.request.post(`${fixture.origin}/api/read/invoice-corrections/list`, { data: { invoiceId: 'synthetic-not-authorized' }, headers: { Origin: fixture.origin } })
      expect([401, 403]).toContain(denied.status())
    }
    finally { await anonymous.close() }
    const project = await post<{ id: string }>('/api/commands/projects', { ...identity, requiredCapability: 'project:write', commandId: 'correction-e2e-project', baseVersion: null, action: 'draft', draft: { name: '合成更正项目', manager: '合成经办人', status: '筹备中' }, attachments: {} })
    const supplier = await post<{ id: string, version: string }>('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'correction-e2e-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成更正分供方', taxNo: 'SYNTHETIC-SELLER', supplierCategory: '其他', contact: '合成联系人' } })
    const buyer = await post<{ id: string, version: string }>('/api/commands/our-signatories', { ...identity, requiredCapability: 'our-signatory:write', commandId: 'correction-e2e-buyer', baseVersion: null, draft: { name: '合成更正购方', taxNo: 'SYNTHETIC-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } })
    const invoiceCommand = { ...identity, requiredCapability: 'finance-invoice:write' }
    async function archiveInvoice(suffix: string, scan = false) {
      const fields = { invoiceNumber: `SYN-CORRECT-${suffix}`, invoiceDate: '2026-10-07', invoiceType: '', buyer: '合成更正购方', buyerTaxNo: 'SYNTHETIC-BUYER', seller: '合成更正分供方', sellerTaxNo: 'SYNTHETIC-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
      const created = await post<{ invoiceId: string, version: string }>('/api/commands/invoices', scan
        ? { ...invoiceCommand, action: 'upload', commandId: `correction-e2e-create-${suffix}`, baseVersion: null, projectId: project.id, original: { fileName: '合成发票.png', fileSize: png.length, mimeType: 'image/png', contentBase64: png.toString('base64') } }
        : { ...invoiceCommand, action: 'manual', commandId: `correction-e2e-create-${suffix}`, baseVersion: null, fields, items: [] })
      const ready = scan
        ? await post<{ invoiceId: string, version: string }>('/api/commands/invoices', { ...invoiceCommand, action: 'recognize', commandId: `correction-e2e-recognize-${suffix}`, invoiceId: created.invoiceId, baseVersion: created.version, fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] })
        : created
      const reviewed = await post<{ invoiceId: string, version: string }>('/api/commands/invoices', { ...invoiceCommand, action: 'review', commandId: `correction-e2e-review-${suffix}`, invoiceId: created.invoiceId, baseVersion: ready.version, manualCompletion: !scan })
      return post<{ invoiceId: string, version: string }>('/api/commands/invoices', { ...invoiceCommand, action: 'archive', commandId: `correction-e2e-archive-${suffix}`, invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: project.id, supplierId: supplier.id, taxNumbersConfirmed: true, taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version } })
    }
    const invoice = await archiveInvoice('one')
    const printedInvoice = await archiveInvoice('printed', true)
    await page.goto(`${fixture.origin}/finance/invoice/correction/${encodeURIComponent(invoice.invoiceId)}`)
    await expect(page.getByRole('heading', { name: '发票更正单' })).toBeVisible()
    const tax = page.getByLabel('税额', { exact: true })
    await expect(tax).toHaveValue('0')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    }
    await tax.fill('3')
    const apply = page.getByRole('button', { name: '应用票面修改' })
    await apply.focus()
    await expect(apply).toBeFocused()
    await page.keyboard.press('Enter')
    await page.getByLabel('更正原因').fill('合成票面税额核对')
    await expect(page.getByLabel('更正前后差异')).toContainText('税额：0 → 3')
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.getByRole('status').filter({ hasText: '更正草稿已保存' })).toBeVisible()
    expect((await readInvoice(invoice.invoiceId)).record).toMatchObject({ version: invoice.version, fields: { taxAmount: 0 } })
    let commandId = ''
    let submitCalls = 0
    await page.route('**/api/commands/invoice-corrections/submit', async (route) => {
      submitCalls++
      const body = route.request().postDataJSON() as { commandId: string }
      commandId = body.commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成响应丢失' }) })
    }, { times: 1 })
    await page.getByRole('button', { name: '确认提交更正' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(page.getByText('原提交结果尚待核对。')).toBeVisible()
    expect(commandId).toBeTruthy()
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/finance/invoice/correction/${encodeURIComponent(invoice.invoiceId)}`)
    await expect(page.getByText('原提交结果尚待核对。')).toBeVisible()
    let recoveredCommand = ''
    await page.route('**/api/commands/invoice-corrections/resolve', async (route) => {
      recoveredCommand = (route.request().postDataJSON() as { commandId: string }).commandId
      await route.continue()
    }, { times: 1 })
    await page.getByRole('button', { name: '核对原提交' }).click()
    await expect(page.getByText('已核对原提交并重新读取。')).toBeVisible()
    expect(recoveredCommand).toBe(commandId)
    expect(submitCalls).toBe(1)
    const corrected = (await readInvoice(invoice.invoiceId)).record
    expect(corrected).toMatchObject({ id: invoice.invoiceId, fields: { taxAmount: 3 }, printCount: 0 })
    expect(corrected.version).not.toBe(invoice.version)
    await expect(page.getByLabel('更正历史')).toContainText('提交生效')
    await post('/api/commands/invoices/print', { ...invoiceCommand, action: 'record-printed', commandId: 'correction-e2e-print', targets: [{ invoiceId: printedInvoice.invoiceId, baseVersion: printedInvoice.version, rotation: 0 }] })
    await page.goto(`${fixture.origin}/finance/invoice/correction/${encodeURIComponent(printedInvoice.invoiceId)}`)
    await expect(page.getByRole('alert')).toContainText('打印历史')
    await expect(page.getByRole('button', { name: '确认提交更正' })).toHaveCount(0)
    const original = page.getByRole('link', { name: '合成发票.png' })
    await expect(original).toBeVisible()
    const originalPath = await original.getAttribute('href')
    expect(originalPath).toBeTruthy()
    const originalResponse = await fixture.request(originalPath!)
    expect(originalResponse.ok(), await originalResponse.text()).toBe(true)
    expect(await originalResponse.body()).toEqual(png)
    expect((await readInvoice(printedInvoice.invoiceId)).record).toMatchObject({ printCount: 1, fields: { taxAmount: 0 } })
  }
  finally { await fixture.cleanup() }
})
