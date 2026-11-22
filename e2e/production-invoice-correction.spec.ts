import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'
import { backup, DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { CONFIRM_ORIGINAL_VERIFICATION, RECORD_ORIGINAL_VERIFICATION } from '../app/lib/invoice/central-contract'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_CORRECTION_ACCEPTANCE !== '1', '只在明确指定的独立构建和合成数据库中运行')

test('归档 Excel 票原件差异走更正，核验原编号冷恢复后才开放打印', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定项目内独立构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
  const invoiceCommand = { ...identity, requiredCapability: 'finance-invoice:write' }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const buyerName = '合成核验购方有限公司'
  const sellerName = '合成核验销方有限公司'
  const buyerTaxNo = '91440000TEST00001X'
  const sellerTaxNo = '91440000TEST00002X'
  const number = '26000000000000000011'
  async function post<T>(path: string, data: object): Promise<T> {
    const result = await fixture.request(path, { method: 'POST', data })
    expect(result.ok(), await result.text()).toBe(true)
    return await result.json() as T
  }
  try {
    await fixture.start()
    await fixture.login()
    const project = await post<{ id: string }>('/api/commands/projects', { ...identity, requiredCapability: 'project:write', commandId: 'verify-e2e-project', baseVersion: null, action: 'draft', draft: { name: '合成核验项目', manager: '合成经办人', status: '筹备中' }, attachments: {} })
    const supplier = await post<{ id: string, version: string }>('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'verify-e2e-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: sellerName, taxNo: sellerTaxNo, supplierCategory: '其他', contact: '合成联系人' } })
    const buyer = await post<{ id: string, version: string }>('/api/commands/our-signatories', { ...identity, requiredCapability: 'our-signatory:write', commandId: 'verify-e2e-buyer', baseVersion: null, draft: { name: buyerName, taxNo: buyerTaxNo, registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } })
    const fields = { invoiceNumber: number, invoiceDate: '2026-10-07', invoiceType: '电子发票（普通发票）', buyer: buyerName, buyerTaxNo, seller: sellerName, sellerTaxNo, amount: 100, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const invoice = await post<{ invoiceId: string, version: string }>('/api/commands/invoices', {
      ...invoiceCommand,
      action: 'import',
      commandId: 'verify-e2e-import',
      baseVersion: null,
      fields,
      items: [],
      ownerKind: 'project',
      projectId: project.id,
      supplierId: supplier.id,
      source: { fileName: '合成核验.xlsx', fileDigest: '2'.repeat(64), sheetName: '发票', rowNumber: 3, rawSnapshot: { 票号: number, 税额: 0 } },
      confirmed: true,
      taxNumbersConfirmed: true,
      taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version },
    })
    const attached = await post<{ originalId: string, version: string }>('/api/commands/invoices', { ...invoiceCommand, invoiceId: invoice.invoiceId, action: 'attach-original', commandId: 'verify-e2e-attach', baseVersion: invoice.version, confirmed: true, original: { fileName: '合成核验.png', fileSize: png.length, mimeType: 'image/png', contentBase64: png.toString('base64') } })
    const readPath = `/api/read/invoices/${invoice.invoiceId}`
    const ledgerUrl = `${fixture.origin}/invoice-ledger-acceptance`
    const selectInvoice = () => page.getByRole('checkbox', { name: `选择发票 ${number}` }).check()
    await page.goto(ledgerUrl)
    await selectInvoice()
    await page.getByRole('button', { name: '打印所选' }).click()
    await expect(page.getByRole('region', { name: '不能打印的发票' })).toContainText('Excel 发票须先确认原件核验')
    await expect(page.getByRole('button', { name: /打印选中/ })).toBeDisabled()
    await page.getByRole('button', { name: '返回台账' }).click()
    await post('/api/commands/invoices', {
      ...invoiceCommand,
      action: RECORD_ORIGINAL_VERIFICATION,
      commandId: 'verify-e2e-candidate',
      invoiceId: invoice.invoiceId,
      baseVersion: attached.version,
      originalId: attached.originalId,
      originalSha256: createHash('sha256').update(png).digest('hex'),
      source: 'local',
      textPages: [`电子发票（普通发票）\n发票号码：${number}\n开票日期：2026年10月7日\n购买方名称：${buyerName}\n统一社会信用代码：${buyerTaxNo}\n销售方名称：${sellerName}\n统一社会信用代码：${sellerTaxNo}\n合计 ￥100.00 ￥3.00\n价税合计（小写）：￥103.00`],
      unrecognizedPageIndexes: [],
    })
    await page.getByRole('link', { name: `核验原件 ${number}` }).click()
    const verification = page.getByRole('region', { name: '已归档发票原件核验' })
    await expect(verification).toContainText('原件识别与归档值有差异')
    await expect(verification.getByRole('button', { name: '确认原件核验' })).toHaveCount(0)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await verification.getByRole('link', { name: '前往更正单' }).click()
    await expect(page.getByRole('heading', { name: '发票更正单' })).toBeVisible()
    await page.getByLabel('税额', { exact: true }).fill('3')
    await page.getByLabel('价税合计', { exact: true }).fill('103')
    await page.getByRole('button', { name: '应用票面修改' }).click()
    await page.getByLabel('更正原因').fill('合成原件明确税额与价税合计')
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.getByRole('status').filter({ hasText: '更正草稿已保存' })).toBeVisible()
    await page.getByRole('button', { name: '确认提交更正' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(page.getByLabel('更正历史')).toContainText('提交生效')
    await page.getByRole('link', { name: '返回发票工作区' }).click()
    await expect(verification).toContainText('请对照原件逐项核对')
    let originalCommandId = ''
    let writeCalls = 0
    await page.route('**/api/commands/invoices', async (route) => {
      const command = route.request().postDataJSON() as { action: string, commandId: string }
      expect(command.action).toBe(CONFIRM_ORIGINAL_VERIFICATION)
      originalCommandId = command.commandId
      writeCalls++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成响应丢失' }) })
    }, { times: 1 })
    const confirm = verification.getByRole('button', { name: '确认原件核验' })
    await confirm.focus()
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').getByRole('button', { name: '确认原件核验' }).click()
    await expect.poll(() => originalCommandId).toBeTruthy()
    await expect(page.getByRole('button', { name: '核对上次提交' })).toBeVisible()
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/finance/invoice/manual-new?invoice=${invoice.invoiceId}`)
    let resolvedId = ''
    await page.route('**/api/commands/invoices/resolve', (route) => {
      resolvedId = (route.request().postDataJSON() as { commandId: string }).commandId
      return route.continue()
    }, { times: 1 })
    await page.getByRole('button', { name: '核对上次提交' }).click()
    await expect(verification).toContainText('原件已核验')
    expect(resolvedId).toBe(originalCommandId)
    expect(writeCalls).toBe(1)
    await page.addInitScript(() => {
      window.print = () => window.dispatchEvent(new Event('afterprint'))
    })
    await page.goto(ledgerUrl)
    await selectInvoice()
    await expect(page.getByRole('button', { name: '打印所选' })).toBeEnabled()
    await page.getByRole('button', { name: '打印所选' }).click()
    await page.getByRole('button', { name: /打印选中/ }).click()
    await page.getByRole('button', { name: '已打印', exact: true }).click()
    await expect.poll(async () => (await (await fixture.request(readPath)).json()).record.printCount).toBe(1)
    const response = await fixture.request(readPath)
    expect(await response.json()).toMatchObject({ record: { originalVerificationId: originalCommandId, ocrStatus: 'pending', fields: { taxAmount: 3, totalAmount: 103 }, original: { id: attached.originalId } }, verification: { state: 'confirmed' } })
    await fixture.stop()
    const db = new DatabaseSync(join(fixture.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      const [proof] = db.prepare('SELECT evidence_json FROM invoice_original_verifications WHERE command_id=?').all(originalCommandId)
      const [correction] = db.prepare('SELECT id,result_invoice_version FROM invoice_corrections WHERE invoice_id=? AND state=?').all(invoice.invoiceId, 'submitted')
      expect(correction).toBeDefined()
      expect(JSON.parse(String(proof?.evidence_json))).toMatchObject({ correction: { id: correction!.id, invoiceVersion: String(correction!.result_invoice_version) }, request: { candidateId: 'verify-e2e-candidate', originalId: attached.originalId } })
      expect(db.prepare('SELECT verification_id FROM invoice_print_lines WHERE invoice_id=?').all(invoice.invoiceId)).toEqual([{ verification_id: originalCommandId }])
      const snapshot = join(fixture.directory, 'q-ocr-02-audit.sqlite')
      await backup(db, snapshot)
      await info.attach('q-ocr-02-audit-path', { body: snapshot, contentType: 'text/plain' })
    }
    finally { db.close() }
  }
  finally { await fixture.cleanup() }
})

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
