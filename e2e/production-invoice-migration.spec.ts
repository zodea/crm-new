import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { migrations, runMigrations } from '../app/lib/db/migrations'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '只在明确指定的独立构建和合成数据库中运行')

test('旧发票使用真实项目目录迁入，断线后经独立进程恢复原编号和原件', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定项目内独立构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const old = await createMemoryDb()
  let snapshot: Buffer
  let invalidSnapshot: Buffer
  const original = Buffer.from('iVBORw0KGgo=', 'base64')
  try {
    await runMigrations(old, migrations.filter(row => row.version <= 60))
    await old.execute('INSERT INTO projects(id,name) VALUES(\'old-project-one\',\'合成旧项目\')')
    await old.execute(`INSERT INTO invoices(id,file_name,file_path,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,project_id,owner_kind,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items)
      VALUES('old-invoice-one','synthetic.png','','scan','SYN-001','2026-01-01','合成销方',0,0,100,'old-project-one','project','pending','unreviewed','none','normal',0,0,'[]')`)
    await old.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES(\'old-original-one\',\'invoice\',\'old-invoice-one\',\'synthetic.png\',\'\',8,\'image/png\')')
    await old.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'old-original-one\',\'base64\',\'iVBORw0KGgo=\')')
    snapshot = Buffer.from(old.raw.export())
    await old.execute('UPDATE invoices SET owner_kind=NULL')
    invalidSnapshot = Buffer.from(old.raw.export())
  }
  finally {
    old.close()
  }
  try {
    await fixture.start()
    await fixture.login()
    const projectResponse = await fixture.request('/api/commands/projects', { method: 'POST', data: { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', requiredCapability: 'project:write', commandId: 'invoice-project-create', baseVersion: null, action: 'draft', draft: { name: '合成目标项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
    expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
    const project = await projectResponse.json() as { id: string }
    await page.goto(`${fixture.origin}/settings/data-migration`)
    const panel = page.getByRole('region', { name: '旧发票迁入' })
    await expect(panel.getByLabel('选择完整 SQLite 快照')).toBeEnabled()
    await panel.getByLabel('选择完整 SQLite 快照').setInputFiles({ name: 'synthetic-invalid.sqlite', mimeType: 'application/octet-stream', buffer: invalidSnapshot })
    await expect(panel.getByLabel(/项目：合成旧项目/)).toBeEnabled()
    await panel.getByLabel(/项目：合成旧项目/).selectOption(project.id)
    await panel.getByRole('button', { name: '核对映射与历史付款' }).click()
    await expect(panel.getByRole('alert')).toContainText('旧归属与项目关系不一致')
    await expect(panel.getByRole('button', { name: '确认迁入', exact: true })).toBeDisabled()
    await panel.getByLabel('选择完整 SQLite 快照').setInputFiles({ name: 'synthetic.sqlite', mimeType: 'application/octet-stream', buffer: snapshot })
    const mapping = panel.getByLabel(/项目：合成旧项目/)
    await expect(mapping).toBeEnabled()
    await mapping.selectOption(project.id)
    await panel.getByRole('button', { name: '核对映射与历史付款' }).click()
    await expect(panel.getByText('映射预检通过；提交时会再次核对。')).toBeVisible()
    let publishCalls = 0
    await page.route('**/api/commands/invoices/migration-publish', async (route) => {
      publishCalls++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成响应丢失' }) })
    }, { times: 1 })
    await panel.getByRole('button', { name: '确认迁入', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认迁入', exact: true }).click()
    await expect(panel.getByText(/原提交 .* 尚未核对/)).toBeVisible()
    const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage }))
    expect(storage).not.toContain(snapshot.toString('base64'))
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/settings/data-migration`)
    await expect(panel.getByText(/原提交 .* 尚未核对/)).toBeVisible()
    await panel.getByRole('button', { name: '核对原提交' }).click()
    await expect(panel.getByText(/原提交已核对，批次/)).toBeVisible()
    expect(publishCalls).toBe(1)
    const source = await fixture.request('/api/read/invoices/old-invoice-one')
    expect(source.ok(), await source.text()).toBe(true)
    expect(await source.json()).toMatchObject({ record: { id: 'old-invoice-one', projectId: project.id, fields: { amount: null, taxAmount: null, totalAmount: 100 } } })
    const file = await fixture.request('/api/read/invoices/old-invoice-one/originals/old-original-one')
    expect(file.ok(), await file.text()).toBe(true)
    expect(await file.body()).toEqual(original)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    }
  }
  finally {
    await fixture.cleanup()
  }
})

test('旧公司票逐项核对同源合同与主体，断线重启后恢复原提交', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定项目内独立构建入口。')
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const old = await createMemoryDb()
  let snapshot: Buffer
  try {
    await runMigrations(old, migrations.filter(row => row.version <= 60))
    await old.execute('INSERT INTO company_expense_contracts(id,no,name,category,counterparty) VALUES(\'old-company\',\'SYN-COMPANY\',\'合成旧公司合同\',\'房租\',\'旧对方文字\')')
    await old.execute('INSERT INTO invoices(id,company_expense_contract_id,owner_kind,source,items) VALUES(\'old-company-invoice\',\'old-company\',\'personal\',\'scan\',\'[]\')')
    await old.execute('INSERT INTO projects(id,name) VALUES(\'old-mixed-project\',\'合成混批项目\')')
    await old.execute('INSERT INTO invoices(id,project_id,owner_kind,source,items) VALUES(\'old-mixed-invoice\',\'old-mixed-project\',\'project\',\'scan\',\'[]\')')
    snapshot = Buffer.from(old.raw.export())
  }
  finally { old.close() }
  try {
    await fixture.start()
    await fixture.login()
    const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
    const projectResponse = await fixture.request('/api/commands/projects', { method: 'POST', data: { ...identity, requiredCapability: 'project:write', commandId: 'company-e2e-project', baseVersion: null, action: 'draft', draft: { name: '合成混批目标项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
    expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
    const project = await projectResponse.json() as { id: string }
    const supplierResponse = await fixture.request('/api/commands/suppliers', { method: 'POST', data: { ...identity, requiredCapability: 'supplier:write', commandId: 'company-e2e-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成公司分供方', supplierCategory: '其他', contact: '合成联系人' } } })
    expect(supplierResponse.ok(), await supplierResponse.text()).toBe(true)
    const supplier = await supplierResponse.json() as { id: string, version: string }
    const buyerResponse = await fixture.request('/api/commands/our-signatories', { method: 'POST', data: { ...identity, requiredCapability: 'our-signatory:write', commandId: 'company-e2e-buyer', baseVersion: null, draft: { name: '合成我方公司', taxNo: 'SYNTHETIC-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } } })
    expect(buyerResponse.ok(), await buyerResponse.text()).toBe(true)
    const buyer = await buyerResponse.json() as { id: string, version: string }
    const otherBuyerResponse = await fixture.request('/api/commands/our-signatories', { method: 'POST', data: { ...identity, requiredCapability: 'our-signatory:write', commandId: 'company-e2e-other-buyer', baseVersion: null, draft: { name: '合成另一我方公司', taxNo: 'SYNTHETIC-OTHER', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' } } })
    expect(otherBuyerResponse.ok(), await otherBuyerResponse.text()).toBe(true)
    const otherBuyer = await otherBuyerResponse.json() as { id: string }
    const source = { sha256: createHash('sha256').update(snapshot).digest('hex'), payloadBase64: snapshot.toString('base64') }
    const adoptResponse = await fixture.request('/api/commands/auxiliary-contracts/import', { method: 'POST', data: { mode: 'adopt', request: { ...identity, commandId: 'company-e2e-adopt', source, projects: [], suppliers: [], signatories: [], originals: [] } } })
    expect(adoptResponse.ok(), await adoptResponse.text()).toBe(true)
    const adopted = await adoptResponse.json() as { ids: string[] }
    const contractId = adopted.ids[0]!
    const detailResponse = await fixture.request(`/api/read/auxiliary-contracts/${encodeURIComponent(contractId)}?kind=company_expense`)
    expect(detailResponse.ok(), await detailResponse.text()).toBe(true)
    const detail = await detailResponse.json() as { contract: { version: string, draft: Record<string, unknown> } }
    const updateResponse = await fixture.request('/api/commands/auxiliary-contracts', { method: 'POST', data: { ...identity, requiredCapability: 'auxiliary-contract:write', commandId: 'company-e2e-identities', id: contractId, baseVersion: String(detail.contract.version), action: 'draft', draft: { ...detail.contract.draft, supplierId: supplier.id, supplierVersion: supplier.version, ourSignatoryId: buyer.id, ourSignatoryVersion: buyer.version }, attachments: {} } })
    expect(updateResponse.ok(), await updateResponse.text()).toBe(true)
    await page.goto(`${fixture.origin}/settings/data-migration`)
    const panel = page.getByRole('region', { name: '旧发票迁入' })
    await expect(panel.getByLabel('选择完整 SQLite 快照')).toBeEnabled()
    await panel.getByLabel('选择完整 SQLite 快照').setInputFiles({ name: 'synthetic-company.sqlite', mimeType: 'application/octet-stream', buffer: snapshot })
    const contract = panel.getByLabel(/公司支出合同：合成旧公司合同/)
    await expect(contract).toBeEnabled()
    await contract.selectOption(`company:${contractId}`)
    await panel.getByLabel(/项目：合成混批项目/).selectOption(project.id)
    await panel.getByLabel('选择已有分供方').selectOption(supplier.id)
    await panel.getByLabel('选择已有我方主体').selectOption(otherBuyer.id)
    await panel.getByRole('button', { name: '核对映射与历史付款' }).click()
    await expect(panel.getByRole('alert')).toContainText('合同我方签约主体与发票所选主体不一致')
    await expect(panel.getByRole('button', { name: '确认迁入', exact: true })).toBeDisabled()
    await panel.getByLabel('选择已有我方主体').selectOption(buyer.id)
    await panel.getByRole('button', { name: '核对映射与历史付款' }).click()
    await expect(panel.getByText('映射预检通过；提交时会再次核对。')).toBeVisible()
    await expect(panel.getByRole('button', { name: '确认迁入', exact: true })).toBeEnabled()
    await page.route('**/api/commands/invoices/migration-publish', async (route) => {
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成响应丢失' }) })
    }, { times: 1 })
    await panel.getByRole('button', { name: '确认迁入', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认迁入', exact: true }).click()
    await expect(panel.getByText(/原提交 .* 尚未核对/)).toBeVisible()
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/settings/data-migration`)
    await expect(panel.getByText(/原提交 .* 尚未核对/)).toBeVisible()
    await panel.getByRole('button', { name: '核对原提交' }).click()
    await expect(panel.getByText(/原提交已核对，批次/)).toBeVisible()
    const read = await fixture.request('/api/read/invoices/old-company-invoice')
    expect(read.ok(), await read.text()).toBe(true)
    expect(await read.json()).toMatchObject({ record: { ownerKind: 'company', projectId: null, supplierId: supplier.id, contract: { domain: 'company', id: contractId } } })
    await fixture.stop()
    const db = new DatabaseSync(join(fixture.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      const member = db.prepare('SELECT evidence_json FROM invoice_legacy_members WHERE invoice_id=?').get('old-company-invoice') as { evidence_json: string }
      expect(JSON.parse(member.evidence_json)).toMatchObject({ entry: { sourceHead: { owner_kind: 'personal', company_expense_contract_id: 'old-company' } } })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    }
    finally { db.close() }
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    }
  }
  finally { await fixture.cleanup() }
})
