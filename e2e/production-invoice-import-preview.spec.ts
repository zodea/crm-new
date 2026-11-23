import type { Page, Route, TestInfo } from '@playwright/test'
import type { CentralInvoiceFields } from '../app/lib/invoice/central-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的隔离测试层构建与合成数据库中运行')

const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
const fields: CentralInvoiceFields = {
  invoiceNumber: '00000001',
  invoiceDate: '2026-11-01',
  invoiceType: '',
  buyer: '',
  buyerTaxNo: '',
  seller: '合成销售方',
  sellerTaxNo: '',
  amount: null,
  taxAmount: 0,
  totalAmount: 8,
  taxRate: '',
  remark: '',
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function workbook() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['发票号码', '发票日期', '销售方', '金额', '税额', '价税合计'],
    ['00000001', '2026-11-01', '合成销售方', null, 0, 10],
    [],
    ['00000002', '2026-11-02', '合成销售方', 9, null, 9],
  ]), '合成票据')
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
}

function sourceWorkbook() {
  const columns = ['发票号码', '备用票号', '核对票号', '发票日期', '购买方', '购买方税号', '销售方', '销售方税号', '金额', '税额', '价税合计']
  const first = ['00000003', '00000009', '00000003', '2026-11-01', '合成购买方', 'SYNTHETIC-BUYER', '合成销售方', 'SYNTHETIC-SELLER', null, 0, 10]
  const missingNumber = ['', '', '00000004', '2026-11-02', '合成购买方', 'SYNTHETIC-BUYER', '合成销售方', 'SYNTHETIC-SELLER', 9, null, 9]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, first, [], missingNumber]), '合成票据')
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  const source = (rowNumber: number, values: Array<string | number | null>) => ({
    fileName: '合成发票.xlsx',
    fileDigest: createHash('sha256').update(bytes).digest('hex'),
    sheetName: '合成票据',
    rowNumber,
    rawSnapshot: Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])),
  })
  return { bytes, first: source(2, first), missingNumber: source(4, missingNumber) }
}

async function setup(page: Page, info: TestInfo) {
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定包含预览验收页的项目内独立构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  try {
    await fixture.start()
    await fixture.login()
    const created = await fixture.request('/api/commands/invoices', { method: 'POST', data: {
      ...identity,
      requiredCapability: 'finance-invoice:write',
      commandId: 'preview-synthetic-invoice',
      action: 'manual',
      baseVersion: null,
      fields,
      items: [],
    } })
    expect(created.ok(), await created.text()).toBe(true)
    const invoice = await created.json() as { invoiceId: string, version: string }
    const db = new DatabaseSync(join(fixture.directory, 'ruihang.sqlite'), { readOnly: true })
    return { fixture, invoice, db }
  }
  catch (error) {
    await fixture.cleanup()
    throw error
  }
}

function databaseVersion(db: DatabaseSync) {
  return Number(db.prepare('PRAGMA data_version').get()!.data_version)
}

async function openPreview(page: Page, origin: string, bytes: Buffer, invoiceColumn = '发票号码') {
  await page.goto(`${origin}/invoice-import-preview-acceptance`)
  await page.getByLabel('选择 Excel 文件').setInputFiles({ name: '合成发票.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes })
  for (const [field, column] of [
    ['发票号码', invoiceColumn],
    ['发票日期', '发票日期'],
    ['销售方', '销售方'],
    ['金额', '金额'],
    ['税额', '税额'],
    ['价税合计', '价税合计'],
  ] as const) {
    await page.getByLabel(`${field}的源列`, { exact: true }).selectOption(column)
  }
}

function previewRow(page: Page, row: number) {
  return page.locator('article').filter({ has: page.getByRole('heading', { name: `合成票据 · 第 ${row} 行`, exact: true }) })
}

function rowValue(row: ReturnType<typeof previewRow>, label: string) {
  return row.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
}

test('真实只读服务识别候选、原行和零值，预览不写数据库', async ({ page }, info) => {
  test.setTimeout(240_000)
  const { fixture, invoice, db } = await setup(page, info)
  const bytes = workbook()
  const requests: Array<{ url: string, method: string, data: unknown }> = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/'))
      requests.push({ url: path, method: request.method(), data: request.method() === 'POST' ? request.postDataJSON() : null })
  })
  try {
    const before = databaseVersion(db)
    await openPreview(page, fixture.origin, bytes)
    const firstReply = page.waitForResponse(response => response.url().endsWith('/api/read/invoices/import-preview')
      && response.request().postDataJSON()?.source?.rowNumber === 2)
    await page.getByRole('button', { name: '读取只读预览' }).click()
    const first = previewRow(page, 2)
    const second = previewRow(page, 4)
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(rowValue(first, '发票号码')).toHaveText('00000001')
    await expect(rowValue(first, '金额')).toHaveText('未填写')
    await expect(rowValue(first, '税额')).toHaveText('0')
    await expect(first).toContainText(`00000001 · ${invoice.invoiceId} · 版本 ${invoice.version}`)
    await expect(first).toContainText('价税合计：已有 8 → 表格 10')
    await expect(second).toContainText('本次查询未发现重复候选')
    await expect(rowValue(second, '税额')).toHaveText('未填写')
    const actualReply = await firstReply
    expect(actualReply.ok()).toBe(true)
    expect(await actualReply.json()).toMatchObject({ candidates: [{ record: { id: invoice.invoiceId, version: invoice.version }, matchedBy: ['invoice-number'], differences: expect.arrayContaining(['totalAmount']) }] })
    const previews = requests.filter(request => request.url === '/api/read/invoices/import-preview')
    expect(previews).toHaveLength(3)
    expect(previews[0]!.data).toMatchObject({ source: { fileName: '合成发票.xlsx', fileDigest: createHash('sha256').update(bytes).digest('hex'), sheetName: '合成票据', rowNumber: 2 }, fields: { invoiceNumber: '00000001', amount: null, taxAmount: 0 } })
    expect(requests.some(request => request.url === '/api/read/business-session')).toBe(true)
    expect(requests.some(request => request.url === '/api/read/invoices/workspace-catalog' && request.method === 'POST')).toBe(true)
    expect(requests.filter(request => request.url.startsWith('/api/commands/') || request.url.startsWith('/api/migrations/'))).toEqual([])
    expect(databaseVersion(db)).toBe(before)
  }
  finally {
    db.close()
    await fixture.cleanup()
  }
})

test('真实来源行命中与空票号未查询均保留查重边界', async ({ page }, info) => {
  test.setTimeout(240_000)
  const { fixture, db } = await setup(page, info)
  const workbook = sourceWorkbook()
  async function post<T>(path: string, data: object): Promise<T> {
    const response = await fixture.request(path, { method: 'POST', data })
    expect(response.ok(), await response.text()).toBe(true)
    return await response.json() as T
  }
  try {
    const project = await post<{ id: string }>('/api/commands/projects', { ...identity, requiredCapability: 'project:write', commandId: 'preview-source-project', baseVersion: null, action: 'draft', draft: { name: '合成预览项目', manager: '合成经办人', status: '筹备中' }, attachments: {} })
    const supplier = await post<{ id: string, version: string }>('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'preview-source-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成销售方', taxNo: 'SYNTHETIC-SELLER', supplierCategory: '其他', contact: '合成联系人' } })
    const buyer = await post<{ id: string, version: string }>('/api/commands/our-signatories', { ...identity, requiredCapability: 'our-signatory:write', commandId: 'preview-source-buyer', baseVersion: null, draft: { name: '合成购买方', taxNo: 'SYNTHETIC-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } })
    const importedFields = { ...fields, buyer: '合成购买方', buyerTaxNo: 'SYNTHETIC-BUYER', sellerTaxNo: 'SYNTHETIC-SELLER' }
    const mapping = Object.fromEntries(Object.entries({ invoiceNumber: '核对票号', invoiceDate: '发票日期', buyer: '购买方', buyerTaxNo: '购买方税号', seller: '销售方', sellerTaxNo: '销售方税号', amount: '金额', taxAmount: '税额', totalAmount: '价税合计' }).map(([key, column]) => [key, { column, confidence: 'confirmed' }]))
    async function seedSource(source: typeof workbook.first, commandId: string, ticket: typeof fields) {
      return post<{ invoiceId: string, version: string }>('/api/commands/invoices/import-workbook', {
        command: { ...identity, requiredCapability: 'finance-invoice:write', commandId, action: 'import', baseVersion: null, fields: ticket, items: [], ownerKind: 'project', projectId: project.id, supplierId: supplier.id, source, confirmed: true, taxNumbersConfirmed: true, taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version } },
        mapping,
        workbook: { fileName: source.fileName, fileSize: workbook.bytes.length, payloadBase64: workbook.bytes.toString('base64') },
      })
    }
    const firstInvoice = await seedSource(workbook.first, 'preview-source-first', { ...importedFields, invoiceNumber: '00000003', totalAmount: 10 })
    // 初次导入使用已确认的核对票号，预览所选的两个普通票号列仍为空。
    const missingInvoice = await seedSource(workbook.missingNumber, 'preview-source-missing', { ...importedFields, invoiceNumber: '00000004', invoiceDate: '2026-11-02', amount: 9, taxAmount: null, totalAmount: 9 })
    const beforeVersion = databaseVersion(db)
    const tableCounts = () => db.prepare(`SELECT
      (SELECT count(*) FROM invoices) AS invoices,
      (SELECT count(*) FROM invoice_import_sources) AS sources,
      (SELECT count(*) FROM invoice_import_workbook_rows) AS workbook_rows,
      (SELECT count(*) FROM invoice_command_receipts) AS receipts,
      (SELECT count(*) FROM file_refs) AS files,
      (SELECT count(*) FROM file_payloads) AS payloads`).get()
    const beforeCounts = tableCounts()

    const direct = await post<{ candidates: Array<{ record: { id: string, version: string }, matchedBy: string[] }> }>('/api/read/invoices/import-preview', {
      fields: { ...fields, invoiceNumber: '', invoiceDate: '2026-11-02', amount: 9, taxAmount: null, totalAmount: 9 },
      items: [],
      source: workbook.missingNumber,
    })
    expect(direct.candidates).toMatchObject([{ record: { id: missingInvoice.invoiceId, version: missingInvoice.version }, matchedBy: ['source-row'] }])

    const requests: Array<{ url: string, method: string, data: unknown }> = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/'))
        requests.push({ url: path, method: request.method(), data: request.method() === 'POST' ? request.postDataJSON() : null })
    })
    await openPreview(page, fixture.origin, workbook.bytes, '备用票号')
    const firstReply = page.waitForResponse(response => response.url().endsWith('/api/read/invoices/import-preview')
      && response.request().postDataJSON()?.source?.rowNumber === 2)
    await page.getByRole('button', { name: '读取只读预览' }).click()
    const firstRow = previewRow(page, 2)
    const missingRow = previewRow(page, 4)
    await expect(firstRow).toContainText('发票号码：已有 00000003 → 表格 00000009')
    await expect(firstRow).toContainText(`00000003 · ${firstInvoice.invoiceId} · 版本 ${firstInvoice.version}`)
    await expect(missingRow).toContainText('缺少发票号码')
    await expect(missingRow).toContainText('未查询重复项')
    await expect(missingRow).not.toContainText('本次查询未发现重复候选')
    expect(await (await firstReply).json()).toMatchObject({ candidates: [{ record: { id: firstInvoice.invoiceId, version: firstInvoice.version }, matchedBy: ['source-row'], differences: expect.arrayContaining(['invoiceNumber']) }] })
    const previews = requests.filter(request => request.url === '/api/read/invoices/import-preview')
    expect(previews).toHaveLength(2)
    expect(previews.every(request => (request.data as { source: { rowNumber: number, fileDigest: string } }).source.rowNumber === 2)).toBe(true)
    expect((previews[0]!.data as { source: { fileDigest: string } }).source.fileDigest).toBe(workbook.first.fileDigest)

    await page.getByLabel('发票号码的源列', { exact: true }).selectOption('发票号码')
    const bothReply = page.waitForResponse(response => response.url().endsWith('/api/read/invoices/import-preview')
      && response.request().postDataJSON()?.source?.rowNumber === 2)
    await page.getByRole('button', { name: '读取只读预览' }).click()
    await expect(firstRow).toContainText(`00000003 · ${firstInvoice.invoiceId} · 版本 ${firstInvoice.version}`)
    expect(await (await bothReply).json()).toMatchObject({ candidates: [{ record: { id: firstInvoice.invoiceId }, matchedBy: ['source-row', 'invoice-number'] }] })
    expect(requests.filter(request => request.url.startsWith('/api/commands/') || request.url.startsWith('/api/migrations/'))).toEqual([])
    expect(databaseVersion(db)).toBe(beforeVersion)
    expect(tableCounts()).toEqual(beforeCounts)
  }
  finally {
    db.close()
    await fixture.cleanup()
  }
})

test('真实查重期间发票版本变化，整次预览拒绝旧结果', async ({ page }, info) => {
  test.setTimeout(240_000)
  const { fixture, invoice, db } = await setup(page, info)
  const received = deferred()
  const release = deferred()
  let held = false
  try {
    await openPreview(page, fixture.origin, workbook())
    await page.route('**/api/read/invoices/import-preview', async (route) => {
      const response = await route.fetch()
      if (!held) {
        held = true
        received.resolve()
        await release.promise
      }
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '读取只读预览' }).click()
    await received.promise
    const changed = await fixture.request('/api/commands/invoices', { method: 'POST', data: {
      ...identity,
      requiredCapability: 'finance-invoice:write',
      commandId: 'preview-concurrent-edit',
      action: 'edit',
      invoiceId: invoice.invoiceId,
      baseVersion: invoice.version,
      fields: { ...fields, remark: '并发合成修订' },
      items: [],
    } })
    expect(changed.ok(), await changed.text()).toBe(true)
    const afterControlledEdit = databaseVersion(db)
    release.resolve()
    await expect(page.getByRole('alert')).toContainText('发票来源在预览期间变化')
    await expect(previewRow(page, 2)).toHaveCount(0)
    expect(databaseVersion(db)).toBe(afterControlledEdit)
  }
  finally {
    release.resolve()
    await page.unroute('**/api/read/invoices/import-preview')
    db.close()
    await fixture.cleanup()
  }
})

test('真实会话失效、重读失败和迟到查重不会泄漏旧结果或写入', async ({ page }, info) => {
  test.setTimeout(240_000)
  const { fixture, db } = await setup(page, info)
  const received = deferred()
  const release = deferred()
  const finished = deferred()
  let held = false
  try {
    const before = databaseVersion(db)
    await openPreview(page, fixture.origin, workbook())
    await page.route('**/api/read/invoices/import-preview', async (route: Route) => {
      const response = await route.fetch()
      if (!held) {
        held = true
        received.resolve()
        await release.promise
        try {
          await route.fulfill({ response })
        }
        finally {
          finished.resolve()
        }
        return
      }
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '读取只读预览' }).click()
    await received.promise
    await page.route('**/api/auth/status', route => route.abort('failed'), { times: 1 })
    await page.getByRole('button', { name: '验收：核对访问状态' }).click()
    await expect(page.getByRole('heading', { name: '连接暂不可用' })).toBeVisible()
    await page.getByRole('button', { name: '重新核对' }).click()
    await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible()
    await page.getByRole('button', { name: '重新读取' }).click()
    await expect(page.getByLabel('发票号码的源列')).toHaveValue('发票号码')
    await page.getByRole('button', { name: '读取只读预览' }).click()
    await expect(previewRow(page, 2)).toBeVisible()
    release.resolve()
    await finished.promise
    await expect(previewRow(page, 2)).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    const logout = await fixture.request('/api/auth/logout', { method: 'POST' })
    expect(logout.ok()).toBe(true)
    await page.getByRole('button', { name: '读取只读预览' }).click()
    const retry = page.getByRole('button', { name: '重新读取' })
    await expect(retry).toBeVisible()
    await expect(retry).toBeFocused()
    await retry.click()
    await expect(retry).toHaveAttribute('aria-disabled', 'false')
    await expect(retry).toBeFocused()
    await expect(previewRow(page, 2)).toHaveCount(0)
    const login = await fixture.request('/api/auth/login', { method: 'POST', data: { accessCode: 'crew-worker-synthetic-access-only' } })
    expect(login.ok()).toBe(true)
    await retry.click()
    await expect(page.getByLabel('发票号码的源列')).toHaveValue('发票号码')
    await expect(previewRow(page, 2)).toHaveCount(0)
    expect(databaseVersion(db)).toBe(before)
  }
  finally {
    release.resolve()
    await page.unroute('**/api/read/invoices/import-preview')
    db.close()
    await fixture.cleanup()
  }
})
