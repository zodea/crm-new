import type { SQLInputValue } from 'node:sqlite'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { createInvoiceWorkspaceFromSession } from '../../app/lib/invoice/central-bootstrap'
import { CentralInvoiceProblem, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from '../../app/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '../../app/lib/invoice/central-http'
import { invoiceCandidateForCommand } from '../../app/lib/invoice/central-recognition'
import { createCentralInvoicePrintSession, createCentralInvoiceSession } from '../../app/lib/invoice/central-session'
import { prepareInvoiceOriginal } from '../../app/lib/invoice/central-upload'
import { createCentralInvoiceWorkspace } from '../../app/lib/invoice/central-workspace'
import { OUR_SIGNATORY_SCHEMA } from '../../app/lib/our-signatory/schema'
import { verifyBackupOriginalOwner, verifyInvoiceOriginalReferences } from '../../server/utils/production-backup-manifest'
import { financeCommandFingerprint } from '../../server/utils/production-finance-request'
import { PRODUCTION_INVOICE_COMPANY_UPGRADE } from '../../server/utils/production-invoice-company-upgrade'
import { PRODUCTION_INVOICE_SCHEMA } from '../../server/utils/production-invoice-schema'
import { createProductionInvoiceService, listProductionInvoiceReferences, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { testTempRoot } from '../helpers/test-temp-root'

const databases: ProductionStorage[] = []
afterEach(async () => {
  for (const storage of databases.splice(0)) await storage.close()
})

function syntheticPdf(pageCount: number) {
  const pages = Array.from({ length: pageCount }).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_, index) => `${index + 3} 0 R`).join(' ')}] >>`, ...pages]
  let text = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}

function fixture(path = ':memory:', existing = false, pageCount = 1) {
  const sql = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  if (!existing) {
    sql.exec(`CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
    CREATE TABLE projects(id TEXT PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE suppliers(id TEXT PRIMARY KEY,draft_json TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE payment_application_invoice_allocations(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,file_name TEXT NOT NULL,file_size INTEGER NOT NULL,mime_type TEXT NOT NULL,category TEXT NOT NULL,uploader TEXT NOT NULL,uploaded_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),content BLOB NOT NULL,sha256 TEXT NOT NULL);`)
    sql.exec(PRODUCTION_INVOICE_SCHEMA)
    sql.exec(OUR_SIGNATORY_SCHEMA)
    sql.exec('INSERT INTO production_participants VALUES(\'our-signatories\',1),(\'supplier\',1)')
    const signatory = JSON.stringify({ name: '合成购方', taxNo: 'BUYER-TAX', registeredAddress: null, legalRepresentative: null, verificationNote: '', status: 'active' })
    const at = '2026-01-01T00:00:00.000Z'
    sql.prepare('INSERT INTO our_signatories VALUES(?,?,?,?,?)').run('fixture-buyer', signatory, 1, at, at)
    sql.prepare('INSERT INTO our_signatory_history VALUES(?,?,?,?,?,?,?)').run('fixture-buyer-v1', 'fixture-buyer', 1, signatory, null, null, at)
    sql.prepare('INSERT INTO projects(id,deleted_at) VALUES(?,NULL)').run('fixture-project')
    sql.prepare('INSERT INTO suppliers(id,draft_json,version,updated_at) VALUES(?,?,?,?)').run('fixture-supplier', JSON.stringify({ id: 'fixture-supplier', name: '合成分供方', taxNo: 'SELLER-TAX' }), 1, '2026-01-01T00:00:00.000Z')
  }
  const coordinator = createDbCoordinator(async () => ({
    async execute(statement, params) {
      if (params)
        sql.prepare(statement).run(...params as SQLInputValue[])
      else
        sql.exec(statement)
    },
    async select<T>(statement: string, params: unknown[] = []) {
      return sql.prepare(statement).all(...params as SQLInputValue[]) as T[]
    },
    async close() { sql.close() },
  }))
  const storage = { ...coordinator, identity: { workspaceId: 'isolated-workspace', actorId: 'isolated-owner' }, assertBusinessWrite() {} } as ProductionStorage
  databases.push(storage)
  const actor = { ...storage.identity, capabilities: [INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, 'project:list:read', 'supplier:list:read', 'our-signatory:read'] }
  const bytes = syntheticPdf(pageCount)
  const upload = { action: 'upload' as const, commandId: 'synthetic-upload', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, baseVersion: null, projectId: 'fixture-project', original: { fileName: '合成发票.pdf', fileSize: bytes.length, mimeType: 'application/pdf', contentBase64: bytes.toString('base64') } }
  const service = createProductionInvoiceService(storage, {
    verifyContract: async (_tx, session, reference, projectId, supplierId) => {
      if (!session.capabilities.includes('material-contract:read'))
        throw new CentralInvoiceProblem('forbidden', '无合成合同读取权限。')
      if (reference.domain !== 'material' || reference.id !== 'contract-one' || reference.version !== '2' || projectId !== null || supplierId !== 'fixture-supplier')
        throw new CentralInvoiceProblem('conflict', '合成合同身份、版本或归属不一致。')
      return { id: reference.id, version: reference.version, projectId, supplierId }
    },
  })
  return { storage, service, actor, bytes, upload, sql, session: () => actor }
}

describe('发票中央原件 owner（隔离内存）', () => {
  it('上传必须采用真实项目，缺失或权限撤回不写入；旧无项目命令仅能重放已有回执', async () => {
    const f = fixture()
    const { projectId: _projectId, ...oldUpload } = f.upload
    await expect(f.service.execute(oldUpload, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...f.upload, projectId: 'missing-project' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute(f.upload, () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'project:list:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM file_refs')).toEqual([])
    const saved = await f.service.execute(f.upload, f.session)
    expect(await f.service.get(saved.invoiceId, f.session)).toMatchObject({ ownerKind: 'project', projectId: 'fixture-project' })
    expect(await f.service.execute(f.upload, f.session)).toEqual(saved)
    await f.storage.execute('UPDATE invoice_command_receipts SET fingerprint=? WHERE command_id=?', [financeCommandFingerprint(oldUpload), oldUpload.commandId])
    expect(await f.service.execute(oldUpload, f.session)).toEqual(saved)
    await expect(f.service.execute({ ...oldUpload, commandId: 'new-old-upload' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    f.sql.exec('BEGIN IMMEDIATE')
    try {
      f.sql.exec(PRODUCTION_INVOICE_COMPANY_UPGRADE)
      f.sql.exec('COMMIT')
    }
    catch (error) {
      f.sql.exec('ROLLBACK')
      throw error
    }
    expect(await f.storage.select('SELECT schema_version FROM production_participants WHERE domain=?', ['invoices'])).toEqual([{ schema_version: 2 }])
    expect(await f.service.execute(oldUpload, f.session)).toEqual(saved)
    expect(await f.service.get(saved.invoiceId, f.session)).toMatchObject({ id: saved.invoiceId, projectId: 'fixture-project' })
    expect(await listProductionInvoiceReferences(f.storage, f.actor)).toEqual([])
    await f.storage.execute('UPDATE production_participants SET schema_version=3 WHERE domain=?', ['invoices'])
    expect(await listProductionInvoiceReferences(f.storage, f.actor)).toEqual([])
    await f.storage.execute('UPDATE production_participants SET schema_version=4 WHERE domain=?', ['invoices'])
    await expect(listProductionInvoiceReferences(f.storage, f.actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('导入直接归档须人工确认、选择真实分供方并保留购销双方税号', async () => {
    const f = fixture()
    const fields = { invoiceNumber: 'guard-invoice', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER-TAX', seller: '合成销方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }
    const request = { ...f.actor, capabilities: undefined, action: 'import', commandId: 'guard-import', requiredCapability: INVOICE_WRITE_CAPABILITY, baseVersion: null, fields, items: [], ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '发票', rowNumber: 1, rawSnapshot: {} }, confirmed: true, taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }
    const { capabilities: _capabilities, ...command } = request
    await expect(f.service.execute({ ...command, taxNumbersConfirmed: undefined }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...command, supplierId: null }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...command, fields: { ...fields, buyerTaxNo: '' } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...command, fields: { ...fields, sellerTaxNo: '' } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...command, fields: { ...fields, sellerTaxNo: 'WRONG' } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...command, taxVerification: { ...command.taxVerification, buyerVersion: '2' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute({ ...command, taxVerification: { ...command.taxVerification, supplierVersion: '2' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute(command, () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'our-signatory:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toEqual([])
    const saved = await f.service.execute(command, f.session)
    expect(await f.service.execute(command, f.session)).toEqual(saved)
    const [evidence] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_archive_evidence WHERE invoice_id=?', [saved.invoiceId])
    expect(JSON.parse(evidence!.evidence_json)).toMatchObject({ taxNumbersConfirmed: true, supplierId: 'fixture-supplier', taxVerification: { buyer: { id: 'fixture-buyer', version: '1', verificationNote: '' }, supplier: { id: 'fixture-supplier', version: '1', taxNo: 'SELLER-TAX' } } })
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
  })

  it('正式工作台适配使用可信会话和本机识别，云识别保持关闭', async () => {
    const f = fixture()
    let sessions = 0
    let localCalls = 0
    let permitted = true
    const saved = new Map<string, string>()
    const parsed = { invoiceNumber: '99887766', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '', projectHint: '', balanced: false, items: [] }
    let command = 0
    const workspace = await createInvoiceWorkspaceFromSession({
      basePath: '/crm/',
      commandId: () => `bootstrap-${++command}`,
      storage: () => ({
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => { saved.set(key, value) },
        removeItem: (key) => { saved.delete(key) },
      }),
      fetcher: async (url, options) => {
        if (url === '/api/read/business-session') {
          sessions++
          return permitted ? f.actor : { ...f.actor, capabilities: [] }
        }
        if (url === '/api/commands/invoices')
          return f.service.execute(options?.body, f.session)
        if (url === '/api/read/invoices')
          return f.service.listRead(options?.query ?? {}, f.session)
        return f.service.getRead(url.split('/').at(-1)!, f.session)
      },
      binaryFetch: async () => new Response(new Uint8Array(f.bytes), { headers: { 'X-Content-SHA256': createHash('sha256').update(f.bytes).digest('hex') } }),
      localRecognition: async (file, basePath) => {
        expect(basePath).toBe('/crm/')
        expect(file.name).toBe('合成.pdf')
        localCalls++
        return { source: 'local', fields: parsed, textPages: ['合成票面'], unrecognizedPageIndexes: [], requiresReview: true }
      },
    })
    await workspace.load()
    const created = await workspace.upload(new File([Uint8Array.from(f.bytes)], '合成.pdf', { type: 'application/pdf' }), 'fixture-project')
    await expect(workspace.recognize(created, 'cloud', true)).rejects.toThrow('云识别尚未启用')
    expect((await workspace.recognize(created)).fields).toMatchObject({ amount: null, taxAmount: 0 })
    expect(localCalls).toBe(1)
    expect(sessions).toBeGreaterThan(1)
    permitted = false
    await expect(workspace.load()).rejects.toThrow('权限已变化')
    expect(workspace.readState.value).toBe('unavailable')
    await expect(createInvoiceWorkspaceFromSession({ fetcher: async () => ({ workspaceId: 'workspace', actorId: 'actor', capabilities: [] }), basePath: '/' })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('中央工作区默认本机识别、保留未知金额，并在身份权限失效时撤下读取结果', async () => {
    const f = fixture()
    const saved = new Map<string, string>()
    const local = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    }
    let binaryDenied = false
    const client = createCentralInvoiceHttp(async (url, options) => {
      if (url === '/api/commands/invoices')
        return f.service.execute(options?.body, f.session)
      if (url === '/api/commands/invoices/resolve')
        return f.service.resolve((options?.body as { commandId: string }).commandId, f.session)
      if (url === '/api/read/invoices')
        return f.service.listRead(options?.query ?? {}, f.session)
      return f.service.getRead(url.split('/').at(-1)!, f.session, options?.query?.deleted === 'true')
    }, f.actor, async () => binaryDenied ? new Response(null, { status: 403 }) : new Response(new Uint8Array(f.bytes), { headers: { 'X-Content-SHA256': createHash('sha256').update(f.bytes).digest('hex') } }))
    let count = 0
    let permitted = true
    let localCalls = 0
    let cloudCalls = 0
    const parsed = { invoiceNumber: '99887766', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '', projectHint: '', balanced: false, items: [] }
    const workspace = createCentralInvoiceWorkspace({
      identity: f.actor,
      client,
      storage: () => local,
      commandId: () => `workspace-${++count}`,
      context: async () => permitted ? f.actor : { ...f.actor, capabilities: [] },
      recognizeLocal: async () => {
        localCalls++
        return { source: 'local', fields: parsed, textPages: ['合成票面'], unrecognizedPageIndexes: [], requiresReview: true }
      },
      recognizeCloud: async () => {
        cloudCalls++
        return { source: 'cloud', fields: parsed, textPages: ['合成票面'], unrecognizedPageIndexes: [], requiresReview: true }
      },
    })
    await workspace.load()
    const created = await workspace.upload(new File([Uint8Array.from(f.bytes)], '合成.pdf', { type: 'application/pdf' }), 'fixture-project')
    expect(workspace.records.value).toMatchObject([{ id: created.id, fields: { amount: null } }])
    await expect(workspace.recognize(created, 'cloud')).rejects.toThrow('尚未明确确认')
    expect(cloudCalls).toBe(0)
    const recognized = await workspace.recognize(created)
    expect(localCalls).toBe(1)
    expect(recognized).toMatchObject({ ocrStatus: 'done', reviewStatus: 'unreviewed', fields: { amount: null, taxAmount: 0, totalAmount: null } })
    expect(workspace.records.value[0]).toMatchObject({ id: created.id, version: recognized.version })
    binaryDenied = true
    await expect(workspace.original(created.id)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(workspace.readState.value).toBe('unavailable')
    expect(workspace.records.value).toEqual([])
    binaryDenied = false
    await workspace.load()
    permitted = false
    await expect(workspace.load()).rejects.toThrow('权限已变化')
    expect(workspace.readState.value).toBe('unavailable')
    expect(workspace.records.value).toEqual([])
  })

  it('分页读取中来源变化时拒绝混合快照，不显示不完整列表', async () => {
    const f = fixture()
    for (let index = 0; index < 101; index++)
      await f.service.execute({ ...f.upload, commandId: `page-upload-${index}` }, f.session)
    let firstPage = true
    const client = createCentralInvoiceHttp(async (_url, options) => {
      const page = await f.service.listRead(options?.query ?? {}, f.session)
      if (firstPage) {
        firstPage = false
        await f.service.execute({ ...f.upload, commandId: 'page-concurrent-create' }, f.session)
      }
      return page
    }, f.actor)
    const workspace = createCentralInvoiceWorkspace({
      identity: f.actor,
      client,
      context: async () => f.actor,
      recognizeLocal: async () => { throw new Error('不应触发识别') },
    })
    await expect(workspace.load()).rejects.toThrow('读取期间发生变化')
    expect(workspace.readState.value).toBe('unavailable')
    expect(workspace.records.value).toEqual([])
  })

  it('上传准备逐字节保留原件，并拒绝大小和实际格式不符的文件', async () => {
    const bytes = Buffer.concat([syntheticPdf(1), Buffer.alloc(100_000, 0xF1)])
    const original = await prepareInvoiceOriginal(new File([Uint8Array.from(bytes)], '合成.pdf', { type: 'application/pdf' }))
    expect(Buffer.from(original.contentBase64, 'base64')).toEqual(bytes)
    expect(original.fileSize).toBe(bytes.length)
    await expect(prepareInvoiceOriginal(new File([Uint8Array.from(bytes)], '伪造.jpg', { type: 'image/jpeg' }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(prepareInvoiceOriginal(new File([new Uint8Array(10 * 1024 * 1024 + 1)], '过大.pdf'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('识别候选只保存票面事实，未知数值不补零且不把项目提示当归属', () => {
    const candidate = invoiceCandidateForCommand({
      source: 'local',
      textPages: ['合成票面'],
      unrecognizedPageIndexes: [],
      requiresReview: true,
      fields: { invoiceNumber: '12345678', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '', projectHint: '合成项目提示', balanced: false, items: [{ name: '合成材料', spec: '', unit: '', quantity: null, unitPrice: null, amount: null, taxRate: '', taxAmount: 0 }] },
    })
    expect(candidate).toMatchObject({ source: 'local', fields: { amount: null, taxAmount: 0, totalAmount: null }, items: [{ quantity: null, unitPrice: null, amount: null, taxAmount: 0 }] })
    expect(candidate.fields).not.toHaveProperty('projectHint')
    expect(candidate.fields).not.toHaveProperty('balanced')
  })

  it('打印确认整批原子提交，重复请求只计一次，版本冲突不留下部分计数', async () => {
    const f = fixture()
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const targets: Array<{ invoiceId: string, baseVersion: string, rotation: 0 | 90 }> = []
    for (let index = 0; index < 2; index++) {
      const created = await f.service.execute({ ...f.upload, commandId: `print-upload-${index}` }, f.session)
      const fields = { invoiceNumber: `1234567${index}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
      const recognized = await f.service.execute({ ...base, action: 'recognize', invoiceId: created.invoiceId, baseVersion: created.version, commandId: `print-ocr-${index}`, fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, f.session)
      const reviewed = await f.service.execute({ ...base, action: 'review', invoiceId: created.invoiceId, baseVersion: recognized.version, commandId: `print-review-${index}`, manualCompletion: false }, f.session)
      targets.push({ invoiceId: created.invoiceId, baseVersion: reviewed.version, rotation: index ? 90 : 0 })
    }
    const request = { ...base, action: 'record-printed', commandId: 'batch-printed', targets }
    await expect(f.service.recordPrinted({ ...request, targets: [targets[0], { ...targets[1], baseVersion: '1' }] }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.service.list(f.session)).map(invoice => invoice.printCount)).toEqual([0, 0])
    const result = await f.service.recordPrinted(request, f.session)
    expect(await f.service.recordPrinted(request, f.session)).toEqual(result)
    expect(await f.service.resolvePrinted(request.commandId, f.session)).toEqual({ outcome: 'applied', result })
    expect(result.records.map(row => [row.printCount, row.printRotation])).toEqual([[1, 0], [1, 90]])
    expect((await f.service.list(f.session)).map(invoice => invoice.printCount)).toEqual([1, 1])
    await expect(f.service.recordPrinted({ ...request, targets: [...targets].reverse() }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.service.resolvePrinted('never-printed', f.session)).toEqual({ outcome: 'not-applied', commandId: 'never-printed' })
    await expect(f.service.recordPrinted({ ...request, commandId: 'never-printed' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const saved = new Map<string, string>()
    const local = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    }
    let failSecondRead = true
    const client = createCentralInvoiceHttp(async (url, options) => {
      if (url.endsWith('/print'))
        return f.service.recordPrinted(options?.body, f.session)
      if (url.endsWith('/print-resolve'))
        return f.service.resolvePrinted((options?.body as { commandId: string }).commandId, f.session)
      const invoiceId = url.split('/').at(-1)!
      if (failSecondRead && invoiceId === targets[1]!.invoiceId)
        throw new Error('第二张回读失败')
      return f.service.getRead(invoiceId, f.session, true)
    }, f.actor)
    const session = createCentralInvoicePrintSession({ identity: f.actor, repository: client, context: async () => f.actor, storage: () => local })
    const next = { ...request, action: 'record-printed' as const, commandId: 'batch-second', targets: result.records.map(row => ({ invoiceId: row.invoiceId, baseVersion: row.version, rotation: row.printRotation })) }
    await expect(session.submit(next)).rejects.toThrow('第二张回读失败')
    expect(session.pending()?.commandId).toBe(next.commandId)
    failSecondRead = false
    expect(await session.recover()).toMatchObject({ outcome: 'applied', result: { commandId: next.commandId } })
    expect(session.pending()).toBeNull()
    expect((await f.service.list(f.session)).map(invoice => invoice.printCount)).toEqual([2, 2])
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
    await f.storage.execute('DROP TRIGGER invoice_print_lines_no_update')
    await f.storage.execute('UPDATE invoice_print_lines SET after_json=? WHERE command_id=? AND invoice_id=?', ['{}', request.commandId, targets[0]!.invoiceId])
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('保存后回读失败保留原命令，权限恢复后才能核对并解除阻塞', async () => {
    const f = fixture()
    const saved = new Map<string, string>()
    const local = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    }
    let failRead = true
    let canWrite = true
    const repo = createCentralInvoiceHttp(async (url, options) => {
      if (url === '/api/commands/invoices')
        return f.service.execute(options?.body, f.session)
      if (url === '/api/commands/invoices/resolve')
        return f.service.resolve((options?.body as { commandId: string }).commandId, f.session)
      if (failRead)
        throw new Error('合成读取故障')
      return f.service.getRead(url.split('/').at(-1)!, f.session, true)
    }, f.actor)
    const session = createCentralInvoiceSession({ identity: f.actor, targetId: null, repository: repo, context: async () => canWrite ? f.actor : { ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] }, storage: () => local })
    await expect(session.submit(f.upload)).rejects.toThrow('合成读取故障')
    expect(session.pending()).toMatchObject({ commandId: f.upload.commandId, targetId: null })
    expect(JSON.stringify([...saved.values()])).not.toContain(f.upload.original.contentBase64)
    await expect(session.submit({ ...f.upload, commandId: 'new-command' })).rejects.toThrow('请先核对原提交')
    canWrite = false
    await expect(session.recover()).rejects.toThrow('权限已变化')
    expect(session.pending()?.commandId).toBe(f.upload.commandId)
    canWrite = true
    failRead = false
    expect(await session.recover()).toMatchObject({ outcome: 'applied', read: { record: { fields: { amount: null } } } })
    expect(session.pending()).toBeNull()
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(1)
  })

  it('提交未抵达时先封存原编号，才能新建下一次发票', async () => {
    const f = fixture()
    const saved = new Map<string, string>()
    const local = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    }
    const repo = createCentralInvoiceHttp(async (url, options) => {
      if (url === '/api/commands/invoices')
        throw new Error('合成请求未送达')
      if (url === '/api/commands/invoices/resolve')
        return f.service.resolve((options?.body as { commandId: string }).commandId, f.session)
      throw new Error('不应读取尚未创建的发票')
    }, f.actor)
    const session = createCentralInvoiceSession({ identity: f.actor, targetId: null, repository: repo, context: async () => f.actor, storage: () => local })
    await expect(session.submit(f.upload)).rejects.toThrow('合成请求未送达')
    expect(await session.recover()).toEqual({ outcome: 'not-applied' })
    expect(session.pending()).toBeNull()
    await expect(f.service.execute(f.upload, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(0)
  })

  it('客户端核对来源与身份，回复丢失时按原编号查询而不是重复创建', async () => {
    const f = fixture()
    let lost = true
    const client = createCentralInvoiceHttp(async (url, options) => {
      if (url === '/api/commands/invoices') {
        const result = await f.service.execute(options?.body, f.session)
        if (lost) {
          lost = false
          throw new Error('合成断线')
        }
        return result
      }
      if (url === '/api/commands/invoices/resolve')
        return f.service.resolve((options?.body as { commandId: string }).commandId, f.session)
      if (url === '/api/read/invoices')
        return f.service.listRead(options?.query ?? {}, f.session)
      return f.service.getRead(url.split('/').at(-1)!, f.session)
    }, f.actor, async () => new Response(new Uint8Array(f.bytes), { headers: { 'X-Content-SHA256': createHash('sha256').update(f.bytes).digest('hex'), 'Content-Length': String(f.bytes.length) } }))
    await expect(client.execute(f.upload)).rejects.toThrow('合成断线')
    const resolved = await client.resolve(f.upload.commandId)
    expect(resolved.outcome).toBe('applied')
    if (resolved.outcome !== 'applied')
      throw new Error('回执缺失')
    expect(await client.execute(f.upload)).toEqual(resolved.result)
    const list = await client.list({ page: 1, pageSize: 20 })
    expect(list.items).toMatchObject([{ id: resolved.result.invoiceId, fields: { amount: null, taxAmount: null } }])
    expect((await client.get(resolved.result.invoiceId)).record.id).toBe(resolved.result.invoiceId)
    expect(Buffer.from(await (await client.original(resolved.result.invoiceId)).arrayBuffer())).toEqual(f.bytes)
    const detail = (await client.get(resolved.result.invoiceId)).record
    expect(detail.original).not.toBeNull()
    expect(Buffer.from(await (await client.original(detail.id, { version: detail.version, original: detail.original })).arrayBuffer())).toEqual(f.bytes)
    await expect(client.original(detail.id, { version: detail.version, original: { ...detail.original!, id: 'other-original' } })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(client.original(detail.id, { version: '999', original: detail.original })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const altered = new Uint8Array(f.bytes)
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1
    const corruptedFile = createCentralInvoiceHttp(async () => f.service.getRead(resolved.result.invoiceId, f.session), f.actor, async () => new Response(altered, { headers: { 'X-Content-SHA256': createHash('sha256').update(f.bytes).digest('hex'), 'Content-Length': String(altered.length) } }))
    await expect(corruptedFile.original(resolved.result.invoiceId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    let reads = 0
    const changedPermission = createCentralInvoiceHttp(async () => f.service.getRead(resolved.result.invoiceId, () => ++reads <= 2 ? f.actor : { ...f.actor, capabilities: [] }), f.actor, async () => new Response(new Uint8Array(f.bytes), { headers: { 'X-Content-SHA256': createHash('sha256').update(f.bytes).digest('hex') } }))
    await expect(changedPermission.original(resolved.result.invoiceId)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const wrongActor = createCentralInvoiceHttp(async () => list, { ...f.actor, actorId: 'other-actor' })
    await expect(wrongActor.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const malformed = structuredClone(list)
    malformed.items[0]!.fields.amount = Number.NaN
    const invalidData = createCentralInvoiceHttp(async () => malformed, f.actor)
    await expect(invalidData.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const invalidReceipt = createCentralInvoiceHttp(async () => ({ outcome: 'applied', result: { ...resolved.result, commandId: 'other-command' } }), f.actor)
    await expect(invalidReceipt.resolve(f.upload.commandId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(1)
  })

  it('手工录入不伪造原件或识别成功，明确核对后可归档并验证历史', async () => {
    const f = fixture()
    const fields = { invoiceNumber: '98765432', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销售方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const created = await f.service.execute({ ...base, action: 'manual', commandId: 'manual-create', baseVersion: null, fields, items: [] }, f.session)
    expect(created.originalId).toBeNull()
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', original: null, ocrStatus: 'pending', reviewStatus: 'unreviewed', fields: { amount: null, taxAmount: 0 } })
    expect(await listProductionInvoiceReferences(f.storage, f.actor)).toEqual([])
    await expect(f.service.execute({ ...base, action: 'review', invoiceId: created.invoiceId, commandId: 'manual-no-confirm', baseVersion: created.version, manualCompletion: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const reviewed = await f.service.execute({ ...base, action: 'review', invoiceId: created.invoiceId, commandId: 'manual-confirm', baseVersion: created.version, manualCompletion: true }, f.session)
    const archive = { ...base, action: 'archive', invoiceId: created.invoiceId, commandId: 'manual-archive', baseVersion: reviewed.version, ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }
    await expect(f.service.execute({ ...archive, commandId: 'manual-personal-rejected', ownerKind: 'personal', projectId: null }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('项目') } })
    const archived = await f.service.execute(archive, f.session)
    expect(await f.service.execute(archive, f.session)).toEqual(archived)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', original: null, ocrStatus: 'pending', completionMethod: 'manual', accountStatus: 'archived' })
    expect(await listProductionInvoiceReferences(f.storage, f.actor)).toEqual([{ id: created.invoiceId, invoice_number: '98765432', total_amount: 100, project_id: 'fixture-project', supplier_id: 'fixture-supplier', owner_kind: 'project', contract_id: null, deleted_at: null }])
    await expect(listProductionInvoiceReferences(f.storage, { ...f.actor, capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await f.storage.execute('DELETE FROM production_participants WHERE domain=?', ['invoices'])
    await expect(listProductionInvoiceReferences(f.storage, f.actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.storage.execute('INSERT INTO production_participants VALUES(?,?)', ['invoices', 1])
    const attach = { ...base, action: 'attach-original', invoiceId: created.invoiceId, commandId: 'manual-attach', baseVersion: archived.version, original: f.upload.original, confirmed: true }
    await expect(f.service.execute({ ...attach, confirmed: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const attached = await f.service.execute(attach, f.session)
    expect(await f.service.execute(attach, f.session)).toEqual(attached)
    expect(Buffer.from((await f.service.original(created.invoiceId, attached.originalId!, f.session)).bytes)).toEqual(f.bytes)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', original: { id: attached.originalId }, accountStatus: 'archived', fields })
    await expect(f.service.execute({ ...attach, commandId: 'manual-attach-again', baseVersion: attached.version }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
  })

  it('新增付款候选必须核实发票所属项目和分供方仍存在', async () => {
    const f = fixture()
    await f.storage.execute('INSERT INTO projects VALUES(?,NULL)', ['project-one'])
    await f.storage.execute('INSERT INTO suppliers VALUES(?,?,?,?)', ['supplier-one', JSON.stringify({ id: 'supplier-one', name: '合成分供方', taxNo: 'SELLER-TAX' }), 1, '2026-01-01T00:00:00.000Z'])
    const actor = f.actor
    const session = () => actor
    const common = { ...f.storage.identity, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const fields = { invoiceNumber: '78888999', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const created = await f.service.execute({ ...common, action: 'manual', commandId: 'reference-create', baseVersion: null, fields, items: [] }, session)
    const reviewed = await f.service.execute({ ...common, action: 'review', commandId: 'reference-review', invoiceId: created.invoiceId, baseVersion: created.version, manualCompletion: true }, session)
    await f.service.execute({ ...common, action: 'archive', commandId: 'reference-archive', invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: 'project-one', supplierId: 'supplier-one', taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }, session)
    expect(await listProductionInvoiceReferences(f.storage, actor, created.invoiceId)).toMatchObject([{ id: created.invoiceId, owner_kind: 'project', project_id: 'project-one' }])
    await f.storage.execute('UPDATE projects SET deleted_at=? WHERE id=?', ['2026-01-01T00:00:00.000Z', 'project-one'])
    await expect(listProductionInvoiceReferences(f.storage, actor, created.invoiceId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.storage.execute('UPDATE projects SET deleted_at=NULL WHERE id=?', ['project-one'])
    await f.storage.execute('UPDATE suppliers SET draft_json=? WHERE id=?', [JSON.stringify({ id: 'supplier-one', name: '合成分供方', deletedAt: '2026-01-01T00:00:00.000Z' }), 'supplier-one'])
    await expect(listProductionInvoiceReferences(f.storage, actor, created.invoiceId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('历史合同关联及回执保留、验证真实来源；新的关联变更须通过更正流程', async () => {
    const f = fixture()
    const fields = { invoiceNumber: '22334455', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销售方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const created = await f.service.execute({ ...base, action: 'manual', commandId: 'contract-create', baseVersion: null, fields, items: [] }, f.session)
    const reviewed = await f.service.execute({ ...base, action: 'review', invoiceId: created.invoiceId, commandId: 'contract-review', baseVersion: created.version, manualCompletion: true }, f.session)
    const archived = await f.service.execute({ ...base, action: 'archive', invoiceId: created.invoiceId, commandId: 'contract-archive', baseVersion: reviewed.version, ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }, f.session)
    const link = { ...base, action: 'link-contract', invoiceId: created.invoiceId, commandId: 'contract-link', baseVersion: archived.version, contract: { domain: 'material', id: 'contract-one', version: '2' }, confirmed: true }
    const permitted = () => ({ ...f.actor, capabilities: [...f.actor.capabilities, 'material-contract:read'] })
    await expect(f.service.execute({ ...link, confirmed: false }, permitted)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute(link, permitted)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const before = await f.service.get(created.invoiceId, f.session)
    const updatedAt = new Date().toISOString()
    const linked = { ...archived, commandId: link.commandId, version: String(Number(archived.version) + 1), updatedAt }
    await f.storage.execute('UPDATE invoices SET contract_domain=?,contract_id=?,contract_version=?,version=?,updated_at=? WHERE id=?', [link.contract.domain, link.contract.id, link.contract.version, Number(linked.version), updatedAt, created.invoiceId])
    const after = await f.service.get(created.invoiceId, permitted)
    await f.storage.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', [link.commandId, base.workspaceId, base.actorId, created.invoiceId, link.action, financeCommandFingerprint(link), JSON.stringify(linked), updatedAt])
    await f.storage.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', ['legacy-contract-audit', created.invoiceId, link.commandId, base.actorId, link.action, JSON.stringify(before), JSON.stringify(after), updatedAt])
    await f.storage.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
    expect(await f.service.execute(link, permitted)).toEqual(linked)
    expect(await f.service.get(created.invoiceId, permitted)).toMatchObject({ contract: link.contract, version: linked.version })
    await expect(f.service.get(created.invoiceId, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    let liveVersion = '2'
    const verify = async (_tx: unknown, _actor: unknown, reference: typeof link.contract, projectId: string | null, supplierId: string | null) => {
      if (reference.version !== liveVersion)
        throw new CentralInvoiceProblem('conflict', '合同来源已变化。')
      return { id: reference.id, version: reference.version, projectId, supplierId }
    }
    expect(await listProductionInvoiceReferences(f.storage, permitted(), created.invoiceId, verify)).toMatchObject([{ id: created.invoiceId, contract_id: 'contract-one' }])
    await expect(listProductionInvoiceReferences(f.storage, f.actor, created.invoiceId, verify)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    liveVersion = '3'
    await expect(listProductionInvoiceReferences(f.storage, permitted(), created.invoiceId, verify)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await f.storage.execute('INSERT INTO payment_application_invoice_allocations(id,invoice_id,deleted_at) VALUES(?,?,?)', ['contract-allocation', created.invoiceId, '2026-01-02T00:00:00.000Z'])
    await expect(f.service.execute({ ...link, commandId: 'contract-unlink', baseVersion: linked.version, contract: null }, permitted)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
  })

  it('历史 Excel 行须确认归属，保留原行证据并阻止重复导入或重复票号', async () => {
    const f = fixture()
    const fields = { invoiceNumber: '90876543', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销售方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, action: 'import', commandId: 'excel-import', baseVersion: null, fields, items: [], ownerKind: 'personal', projectId: null, supplierId: 'fixture-supplier', source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '发票', rowNumber: 4, rawSnapshot: { 票号: '90876543', 零税额: 0, 备注: null } }, confirmed: true, taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }
    await expect(f.service.execute({ ...request, confirmed: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...request, source: { ...request.source, rawSnapshot: { 票号: Number.MAX_SAFE_INTEGER + 1 } } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const imported = await f.service.execute(request, f.session)
    expect(await f.service.execute(request, f.session)).toEqual(imported)
    expect(await f.service.get(imported.invoiceId, f.session)).toMatchObject({ sourceKind: 'excel', original: null, ocrStatus: 'pending', completionMethod: 'manual', accountStatus: 'archived', fields: { amount: null, taxAmount: 0 } })
    await expect(f.service.execute({ ...request, commandId: 'same-source' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute({ ...request, commandId: 'same-invoice', source: { ...request.source, rowNumber: 5 } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const changedFields = { ...fields, totalAmount: 110 }
    const source = { ...request.source, rowNumber: 5 }
    const preview = await f.service.previewImport({ fields: changedFields, items: [], source }, f.session)
    expect(preview.candidates).toMatchObject([{ record: { id: imported.invoiceId, version: imported.version }, matchedBy: ['invoice-number'], differences: ['totalAmount'] }])
    const previewClient = createCentralInvoiceHttp(async () => preview, f.actor)
    expect((await previewClient.previewImport({ fields: changedFields, items: [], source })).candidates[0]?.record.id).toBe(imported.invoiceId)
    const incorrectPreview = structuredClone(preview)
    incorrectPreview.candidates[0]!.differences = []
    await expect(createCentralInvoiceHttp(async () => incorrectPreview, f.actor).previewImport({ fields: changedFields, items: [], source })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const replace = { ...request, action: 'import-replace', invoiceId: imported.invoiceId, baseVersion: imported.version, commandId: 'replace-existing', fields: changedFields, source }
    await expect(f.service.execute({ ...replace, confirmed: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...replace, baseVersion: '2' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute(replace, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.service.get(imported.invoiceId, f.session)).toMatchObject({ id: imported.invoiceId, version: imported.version, fields })
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(1)
    await f.storage.execute('INSERT INTO payment_application_invoice_allocations(id,invoice_id,deleted_at) VALUES(?,?,?)', ['import-allocation', imported.invoiceId, '2026-01-02T00:00:00.000Z'])
    await expect(f.service.execute({ ...replace, commandId: 'replace-linked', baseVersion: imported.version, source: { ...source, rowNumber: 6 } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const [sourceRow] = await f.storage.select<{ source_json: string }>('SELECT source_json FROM invoice_import_sources WHERE invoice_id=? ORDER BY rowid', [imported.invoiceId])
    expect(JSON.parse(sourceRow!.source_json)).toEqual(request.source)
    await expect(f.storage.execute('DELETE FROM invoice_import_sources')).rejects.toThrow('invoice import source is immutable')
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
  })

  it('上传原件与草稿同事务保存，未知金额保持 null，同键重试不重复', async () => {
    const f = fixture()
    const result = await f.service.execute(f.upload, f.session)
    expect(await f.service.execute(f.upload, f.session)).toEqual(result)
    expect(await f.service.list(f.session)).toMatchObject([{ id: result.invoiceId, version: '1', ocrStatus: 'pending', fields: { amount: null, taxAmount: null, totalAmount: null }, original: { id: result.originalId, fileName: '合成发票.pdf' } }])
    expect(Buffer.from((await f.service.original(result.invoiceId, result.originalId!, f.session)).bytes)).toEqual(f.bytes)
    await expect(f.service.execute({ ...f.upload, original: { ...f.upload.original, fileName: '另一个.pdf' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(1)
    const logs = await f.storage.select<{ after_json: string }>('SELECT after_json FROM invoice_audits')
    expect(logs).toHaveLength(1)
    expect(logs[0]!.after_json).not.toContain(f.upload.original.contentBase64)
  })

  it('旧直接更正及旧导入替换的原回执只能按原编号与原内容重放', async () => {
    const f = fixture()
    const saved = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '90876543', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, invoiceId: saved.invoiceId, baseVersion: '1', fields, items: [], ownerKind: 'personal', projectId: null, supplierId: null, confirmed: true }
    const commands = [
      { ...base, action: 'edit-archived', commandId: 'old-edit' },
      { ...base, action: 'import-replace', commandId: 'old-replace', source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '发票', rowNumber: 1, rawSnapshot: {} } },
    ]
    for (const request of commands) {
      // 模拟已存在的旧回执，不制造新的更正事实或修改原票。
      const result = { ...saved, commandId: request.commandId, version: '2' }
      await f.storage.execute('INSERT INTO invoice_command_receipts(command_id,workspace_id,actor_id,invoice_id,action,fingerprint,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)', [request.commandId, f.actor.workspaceId, f.actor.actorId, saved.invoiceId, request.action, financeCommandFingerprint(request), JSON.stringify(result), saved.updatedAt])
      expect(await f.service.execute(request, f.session)).toEqual(result)
      await expect(f.service.execute({ ...request, fields: { ...fields, remark: '不同内容' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      await expect(f.service.execute({ ...request, commandId: `${request.commandId}-new` }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    }
    expect(await f.service.get(saved.invoiceId, f.session)).toMatchObject({ version: saved.version, accountStatus: 'none' })
    expect(await f.storage.select('SELECT id FROM invoices')).toHaveLength(1)
  })

  it('删除和恢复按版本与原键控制，原件不丢且不可从另一发票读取', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const action = { commandId: 'synthetic-discard', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, action: 'discard' as const, invoiceId: created.invoiceId, baseVersion: created.version }
    const deleted = await f.service.execute(action, f.session)
    expect(await f.service.execute(action, f.session)).toEqual(deleted)
    expect(await f.service.list(f.session)).toEqual([])
    expect(await f.service.list(f.session, true)).toMatchObject([{ id: created.invoiceId, version: '2' }])
    await expect(f.service.original(created.invoiceId, created.originalId!, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(f.service.execute({ ...action, commandId: 'wrong-version', action: 'restore', baseVersion: '1' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const restored = await f.service.execute({ ...action, commandId: 'synthetic-restore', action: 'restore', baseVersion: deleted.version }, f.session)
    expect(restored.version).toBe('3')
    expect(Buffer.from((await f.service.original(created.invoiceId, created.originalId!, f.session)).bytes)).toEqual(f.bytes)
    await expect(f.service.original(created.invoiceId, 'different-original', f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
  })

  it('损坏文件或权限变化整批回滚，未知命令封存后迟到请求不能写入', async () => {
    const f = fixture()
    await expect(f.service.execute({ ...f.upload, original: { ...f.upload.original, contentBase64: 'not-base64' } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const readOnly = () => ({ ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] })
    await expect(f.service.execute(f.upload, readOnly)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    let calls = 0
    await expect(f.service.execute(f.upload, () => ++calls === 1 ? f.actor : { ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toEqual([])
    expect(await f.storage.select('SELECT id FROM file_refs')).toEqual([])
    expect(await f.service.resolve(f.upload.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: f.upload.commandId })
    await expect(f.service.execute(f.upload, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT id FROM invoices')).toEqual([])
  })

  it('原件正文、归属或摘要被破坏时拒绝读取，不能当作空文件', async () => {
    const f = fixture()
    const result = await f.service.execute(f.upload, f.session)
    const originalId = result.originalId!
    await f.storage.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=?', [Buffer.from('%PDF-changed'), originalId])
    await expect(f.service.original(result.invoiceId, originalId, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.storage.execute('UPDATE file_refs SET owner_id=? WHERE id=?', ['wrong-invoice-owner', originalId])
    await expect(f.service.get(result.invoiceId, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.service.list(f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('无法解析的 PDF 保留原件和草稿，但拒绝声称识别完成', async () => {
    const f = fixture()
    const bytes = Buffer.from('%PDF-1.7\n%broken\n')
    const created = await f.service.execute({ ...f.upload, original: { ...f.upload.original, fileSize: bytes.length, contentBase64: bytes.toString('base64') } }, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
    await expect(f.service.execute({ action: 'recognize', invoiceId: created.invoiceId, baseVersion: created.version, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'broken-pdf-recognition', fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ version: '1', ocrStatus: 'pending' })
    expect(await f.storage.select('SELECT id FROM invoice_recognitions')).toEqual([])
  })

  it('备份双向核验发票和原件归属，缺少正文或归属不一致均拒绝', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const row = f.sql.prepare('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?').get(created.originalId!)!
    expect(() => verifyInvoiceOriginalReferences(f.sql)).not.toThrow()
    expect(() => verifyBackupOriginalOwner(f.sql, row, new Set())).not.toThrow()
    expect(() => verifyBackupOriginalOwner(f.sql, { ...row, owner_id: 'wrong-owner' }, new Set())).toThrow('发票原件与发票、稳定文件身份或正文归属不一致。')
    expect(() => verifyBackupOriginalOwner(f.sql, { ...row, category: 'other' }, new Set())).toThrow('发票原件与发票、稳定文件身份或正文归属不一致。')
    expect(() => verifyBackupOriginalOwner(f.sql, row, new Set([created.originalId!]))).toThrow('发票原件与发票、稳定文件身份或正文归属不一致。')
    await f.storage.execute('DELETE FROM file_payloads WHERE file_ref_id=?', [created.originalId!])
    expect(() => verifyInvoiceOriginalReferences(f.sql)).toThrow('发票备份缺少对应的原件或正文。')
  })

  it('中央分页读取给出完整计数与一致来源版本，不截断数据或暴露正文', async () => {
    const f = fixture()
    for (let index = 0; index < 21; index++)
      await f.service.execute({ ...f.upload, commandId: `invoice-page-${index}` }, f.session)
    const first = await f.service.listRead({ page: '1', pageSize: '10' }, f.session)
    const last = await f.service.listRead({ page: '99', pageSize: '10' }, f.session)
    expect(first.pagination).toMatchObject({ requestedPage: 1, page: 1, pageSize: 10, total: 21 })
    expect(last.pagination).toMatchObject({ requestedPage: 99, page: 3, pageSize: 10, total: 21 })
    expect(first.items).toHaveLength(10)
    expect(last.items).toHaveLength(1)
    expect(first.meta).toMatchObject({ schemaVersion: 'invoice-read-v1', dataOrigin: 'real', sources: [{ key: 'invoices', state: 'readable', sourceVersion: 'invoices:21' }] })
    expect(JSON.stringify(first)).not.toContain(f.upload.original.contentBase64)
    await expect(f.service.listRead({ page: '1', pageSize: '999' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('识别结果保留未知和真实零，缺页明确失败，重试保留原识别事实并阻止重复票', async () => {
    const f = fixture(':memory:', false, 2)
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '', invoiceType: '', buyer: '合成购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }
    const items = [{ name: '合成材料', spec: '', unit: '', quantity: null, unitPrice: null, amount: null, taxRate: '', taxAmount: 0 }]
    const request = { action: 'recognize' as const, invoiceId: created.invoiceId, baseVersion: created.version, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'recognize-partial', fields, items, source: 'local', textPages: ['第一页合成文本', ''], unrecognizedPageIndexes: [1] }
    for (const invalid of [
      { textPages: ['第一页合成文本'], unrecognizedPageIndexes: [1] },
      { textPages: ['第一页合成文本', ''], unrecognizedPageIndexes: [] },
      { textPages: ['第一页合成文本', ''], unrecognizedPageIndexes: [1, 1] },
      { textPages: ['x'.repeat(250_001)], unrecognizedPageIndexes: [] },
      { source: ['local'] },
      { textPages: ['第一页合成文本'], unrecognizedPageIndexes: [] },
    ]) {
      await expect(f.service.execute({ ...request, ...invalid }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
    const partial = await f.service.execute(request, f.session)
    const [raw] = await f.storage.select<{ result_json: string }>('SELECT result_json FROM invoice_recognitions WHERE invoice_id=?', [created.invoiceId])
    expect(JSON.parse(raw!.result_json)).toMatchObject({ source: 'local', textPages: ['第一页合成文本', ''], unrecognizedPageIndexes: [1] })
    const audits = await f.storage.select<{ before_json: string | null, after_json: string }>('SELECT before_json,after_json FROM invoice_audits WHERE invoice_id=?', [created.invoiceId])
    expect(JSON.stringify(audits)).not.toContain('第一页合成文本')
    const read = await f.service.get(created.invoiceId, f.session)
    expect(read).toMatchObject({ ocrStatus: 'failed', reviewStatus: 'unreviewed', fields: { amount: null, taxAmount: 0, totalAmount: null }, items, unrecognizedPageIndexes: [1] })
    expect(await f.service.execute(request, f.session)).toEqual(partial)
    const completed = await f.service.execute({ ...request, commandId: 'recognize-complete', baseVersion: partial.version, textPages: ['第一页合成文本', '第二页合成文本'], unrecognizedPageIndexes: [] }, f.session)
    expect((await f.service.get(created.invoiceId, f.session)).ocrStatus).toBe('done')
    expect(await f.storage.select('SELECT id FROM invoice_recognitions WHERE invoice_id=?', [created.invoiceId])).toHaveLength(2)
    await expect(f.service.execute({ ...request, commandId: 'recognize-overwrite', baseVersion: completed.version }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const second = await f.service.execute({ ...f.upload, commandId: 'second-invoice' }, f.session)
    await f.service.execute({ ...request, commandId: 'recognize-duplicate', invoiceId: second.invoiceId, baseVersion: second.version, textPages: ['第一页合成文本', '第二页合成文本'], unrecognizedPageIndexes: [] }, f.session)
    expect((await f.service.get(second.invoiceId, f.session)).duplicateStatus).toBe('duplicate')
    await expect(f.storage.execute('UPDATE invoice_recognitions SET result_json=\'{}\'')).rejects.toThrow('invoice recognition is immutable')
  })

  it('人工修改保留原识别记录，校对后再次修改须重新确认，过期版本不能覆盖', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }
    const base = { invoiceId: created.invoiceId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const recognized = await f.service.execute({ ...base, action: 'recognize', commandId: 'recognize-for-edit', baseVersion: created.version, fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, f.session)
    const editedFields = { ...fields, totalAmount: 100 }
    const edited = await f.service.execute({ ...base, action: 'edit', commandId: 'manual-edit', baseVersion: recognized.version, fields: editedFields, items: [] }, f.session)
    await expect(f.service.execute({ ...base, action: 'edit', commandId: 'stale-manual-edit', baseVersion: recognized.version, fields, items: [] }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const reviewed = await f.service.execute({ ...base, action: 'review', commandId: 'manual-review', baseVersion: edited.version, manualCompletion: false }, f.session)
    expect((await f.service.get(created.invoiceId, f.session)).reviewStatus).toBe('reviewed')
    const after = await f.service.execute({ ...base, action: 'edit', commandId: 'manual-revision', baseVersion: reviewed.version, fields: { ...editedFields, remark: '更正备注' }, items: [] }, f.session)
    expect((await f.service.get(created.invoiceId, f.session))).toMatchObject({ version: after.version, reviewStatus: 'unreviewed', fields: { amount: null, taxAmount: 0, totalAmount: 100, remark: '更正备注' } })
    const [original] = await f.storage.select<{ result_json: string }>('SELECT result_json FROM invoice_recognitions WHERE invoice_id=?', [created.invoiceId])
    expect(JSON.parse(original!.result_json)).toMatchObject({ fields: { totalAmount: null, taxAmount: 0 } })
    const audit = await f.storage.select<{ action: string }>('SELECT action FROM invoice_audits WHERE invoice_id=? ORDER BY rowid', [created.invoiceId])
    expect(audit.map(row => row.action)).toEqual(['upload', 'recognize', 'edit', 'review', 'edit'])
  })

  it('重新识别必须明确确认，失败不覆盖，人工修改按识别后顺序留痕', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { invoiceId: created.invoiceId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const recognized = await f.service.execute({ ...base, action: 'recognize', commandId: 'first-ocr', baseVersion: created.version, fields, items: [], source: 'local', textPages: ['首次原文'], unrecognizedPageIndexes: [] }, f.session)
    const candidate = { ...fields, totalAmount: 110 }
    const current = { ...candidate, totalAmount: 111, remark: '人工修改' }
    const request = { ...base, action: 'rerecognize', commandId: 'second-ocr', baseVersion: recognized.version, fields: candidate, items: [], currentFields: current, currentItems: [], source: 'local', textPages: ['第二次原文'], unrecognizedPageIndexes: [], confirmed: true }
    await expect(f.service.execute({ ...request, confirmed: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.service.execute({ ...request, textPages: [''], unrecognizedPageIndexes: [0] }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ version: recognized.version, fields })
    const result = await f.service.execute(request, f.session)
    expect(await f.service.execute(request, f.session)).toEqual(result)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ version: result.version, fields: current, reviewStatus: 'unreviewed' })
    const audits = await f.storage.select<{ action: string, before_json: string, after_json: string }>('SELECT action,before_json,after_json FROM invoice_audits WHERE command_id=? ORDER BY rowid', [request.commandId])
    expect(audits.map(row => row.action)).toEqual(['rerecognize', 'edit'])
    expect(JSON.parse(audits[0]!.after_json)).toMatchObject({ fields: candidate })
    expect(JSON.parse(audits[1]!.after_json)).toMatchObject({ fields: current })
    expect(JSON.stringify(audits)).not.toContain('第二次原文')
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
    await f.storage.execute('DROP TRIGGER invoice_audits_no_update')
    await f.storage.execute('UPDATE invoice_audits SET after_json=? WHERE command_id=? AND action=?', ['{}', request.commandId, 'edit'])
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('识别缺页时须明确人工补全和核对，原识别失败与缺页证据保留', async () => {
    const f = fixture(':memory:', false, 2)
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { invoiceId: created.invoiceId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const partial = await f.service.execute({ ...base, action: 'recognize', commandId: 'manual-partial', baseVersion: created.version, fields, items: [], source: 'local', textPages: ['合成文本', ''], unrecognizedPageIndexes: [1] }, f.session)
    await expect(f.service.execute({ ...base, action: 'review', commandId: 'manual-not-confirmed', baseVersion: partial.version, manualCompletion: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const reviewed = await f.service.execute({ ...base, action: 'review', commandId: 'manual-explicit', baseVersion: partial.version, manualCompletion: true }, f.session)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ ocrStatus: 'failed', reviewStatus: 'reviewed', completionMethod: 'manual', unrecognizedPageIndexes: [1] })
    await f.service.execute({ ...base, action: 'edit', commandId: 'manual-edit-again', baseVersion: reviewed.version, fields: { ...fields, remark: '更正' }, items: [] }, f.session)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ ocrStatus: 'failed', reviewStatus: 'unreviewed', completionMethod: null, unrecognizedPageIndexes: [1] })
  })

  it('归档只使用已核对票面与明确归属，关联、重复与审计在同一事务核验', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '12345678', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销售方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { invoiceId: created.invoiceId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const recognized = await f.service.execute({ ...base, action: 'recognize', commandId: 'archive-recognize', baseVersion: created.version, fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, f.session)
    const archive = { ...base, action: 'archive' as const, commandId: 'archive-invoice', baseVersion: recognized.version, ownerKind: 'project' as const, projectId: 'synthetic-project', supplierId: 'fixture-supplier', taxNumbersConfirmed: true as const, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }
    await expect(f.service.execute(archive, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const reviewed = await f.service.execute({ ...base, action: 'review', commandId: 'archive-review', baseVersion: recognized.version, manualCompletion: false }, f.session)
    await expect(f.service.execute({ ...archive, baseVersion: reviewed.version, ownerKind: 'personal', projectId: null }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const withoutProjectRead = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'project:list:read') })
    await expect(f.service.execute({ ...archive, baseVersion: reviewed.version }, withoutProjectRead)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await f.storage.execute('INSERT INTO projects(id,deleted_at) VALUES(?,NULL)', ['synthetic-project'])
    const withProjectRead = f.session
    const archived = await f.service.execute({ ...archive, baseVersion: reviewed.version }, withProjectRead)
    expect(await f.service.execute({ ...archive, baseVersion: reviewed.version }, withProjectRead)).toEqual(archived)
    expect(await f.service.get(created.invoiceId, withProjectRead)).toMatchObject({ accountStatus: 'archived', reviewStatus: 'reviewed', ownerKind: 'project', projectId: 'synthetic-project', fields: { totalAmount: 100, amount: null } })
    await expect(f.service.get(created.invoiceId, withoutProjectRead)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const [evidence] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_archive_evidence WHERE invoice_id=?', [created.invoiceId])
    expect(JSON.parse(evidence!.evidence_json)).toMatchObject({ source: { fields }, ownerKind: 'project', projectId: 'synthetic-project', originalRecognition: [{ fields }] })
    await expect(f.storage.execute('DELETE FROM invoice_archive_evidence')).rejects.toThrow('invoice archive evidence is immutable')
    await f.storage.execute('INSERT INTO payment_application_invoice_allocations(id,invoice_id,deleted_at) VALUES(?,?,?)', ['synthetic-allocation', created.invoiceId, '2026-01-02T00:00:00.000Z'])
    await expect(f.service.execute({ ...base, action: 'discard', commandId: 'discard-archived', baseVersion: archived.version }, withProjectRead)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute({ ...base, action: 'edit-archived', commandId: 'edit-referenced', baseVersion: archived.version, fields, items: [], ownerKind: 'project', projectId: 'synthetic-project', supplierId: null, confirmed: true }, withProjectRead)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })

  it('项目发票可在归档时选择真实合同，失权或合同版本冲突不写入', async () => {
    const f = fixture()
    const actor = { ...f.actor, capabilities: [...f.actor.capabilities, 'material-contract:read'] }
    const session = () => actor
    let contractBuyer: string | null = 'fixture-buyer'
    const service = createProductionInvoiceService(f.storage, { verifyContract: async (_tx, current, reference, projectId, supplierId) => {
      if (!current.capabilities.includes('material-contract:read'))
        throw new CentralInvoiceProblem('forbidden', '无合同读取权限')
      if (reference.version !== '2')
        throw new CentralInvoiceProblem('conflict', '合同版本已变化')
      if (projectId !== 'fixture-project' || supplierId !== 'fixture-supplier')
        throw new CentralInvoiceProblem('validation-failed', '合同归属不一致')
      return { id: reference.id, version: reference.version, projectId, supplierId, ourSignatoryId: contractBuyer }
    } })
    const created = await service.execute(f.upload, session)
    const fields = { invoiceNumber: '56781234', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }
    const base = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, invoiceId: created.invoiceId }
    const edited = await service.execute({ ...base, action: 'edit', commandId: 'project-contract-edit', baseVersion: created.version, fields, items: [] }, session)
    const reviewed = await service.execute({ ...base, action: 'review', commandId: 'project-contract-review', baseVersion: edited.version, manualCompletion: true }, session)
    const archive = { ...base, action: 'archive', commandId: 'project-contract-archive', baseVersion: reviewed.version, ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' }, contract: { domain: 'material', id: 'contract-one', version: '2' } }
    await expect(service.execute({ ...archive, contract: { ...archive.contract, version: '1' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.execute(archive, () => f.actor)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    contractBuyer = 'different-buyer'
    await expect(service.execute(archive, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    contractBuyer = null
    await expect(service.execute(archive, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await service.get(created.invoiceId, session)).toMatchObject({ version: reviewed.version, accountStatus: 'none' })
    contractBuyer = 'fixture-buyer'
    const result = await service.execute(archive, session)
    expect(await service.execute(archive, session)).toEqual(result)
    expect(await service.get(created.invoiceId, session)).toMatchObject({ version: result.version, ownerKind: 'project', contract: archive.contract })
    await expect(validateProductionInvoiceJournal(f.storage, actor)).resolves.toBeUndefined()
  })

  it('归档票禁止直接更正，打印后仍受保护，删除和恢复保留原件及归档证据', async () => {
    const f = fixture()
    const created = await f.service.execute(f.upload, f.session)
    const fields = { invoiceNumber: '22345678', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'BUYER-TAX', seller: '合成销售方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const base = { invoiceId: created.invoiceId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const recognized = await f.service.execute({ ...base, action: 'recognize', commandId: 'personal-recognize', baseVersion: created.version, fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, f.session)
    const reviewed = await f.service.execute({ ...base, action: 'review', commandId: 'personal-review', baseVersion: recognized.version, manualCompletion: false }, f.session)
    const archived = await f.service.execute({ ...base, action: 'archive', commandId: 'personal-archive', baseVersion: reviewed.version, ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }, f.session)
    const changedFields = { ...fields, totalAmount: 105, remark: '人工更正' }
    await expect(f.service.execute({ ...base, action: 'edit-archived', commandId: 'personal-edit-unconfirmed', baseVersion: archived.version, fields: changedFields, items: [], ownerKind: 'personal', projectId: null, supplierId: null, confirmed: false }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ version: archived.version, fields })
    const edit = { ...base, action: 'edit-archived', commandId: 'personal-edit', baseVersion: archived.version, fields: changedFields, items: [], ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', confirmed: true }
    await expect(f.service.execute(edit, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ accountStatus: 'archived', reviewStatus: 'reviewed', version: archived.version, fields })
    const history = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_archive_evidence WHERE invoice_id=? ORDER BY rowid', [created.invoiceId])
    expect(history.map(row => JSON.parse(row.evidence_json))).toMatchObject([{ source: { fields } }])
    const printed = await f.service.recordPrinted({ workspaceId: base.workspaceId, actorId: base.actorId, requiredCapability: base.requiredCapability, action: 'record-printed', commandId: 'printed-before-correction', targets: [{ invoiceId: created.invoiceId, baseVersion: archived.version, rotation: 0 }] }, f.session)
    await expect(f.service.execute({ ...edit, commandId: 'printed-edit', baseVersion: printed.records[0]!.version }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ fields, printCount: 1 })
    const discarded = await f.service.execute({ ...base, action: 'discard', commandId: 'personal-discard', baseVersion: printed.records[0]!.version }, f.session)
    await expect(f.service.get(created.invoiceId, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    const restored = await f.service.execute({ ...base, action: 'restore', commandId: 'personal-restore', baseVersion: discarded.version }, f.session)
    expect(await f.service.get(created.invoiceId, f.session)).toMatchObject({ version: restored.version, accountStatus: 'archived', fields: { totalAmount: 100 }, printCount: 1 })
    expect(Buffer.from((await f.service.original(created.invoiceId, created.originalId!, f.session)).bytes)).toEqual(f.bytes)
    await expect(validateProductionInvoiceJournal(f.storage, f.actor)).resolves.toBeUndefined()
  })

  it('归档证据经 v30 候选升级后独立进程冷读，重新打开重放原编号不重复', { timeout: 120_000 }, async () => {
    const base = testTempRoot('invoice-tax-cold')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(join(base, 'synthetic-'))
    const path = join(directory, 'invoice.sqlite')
    const first = fixture(path)
    const fields = { invoiceNumber: '19876543', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER-TAX', seller: '合成销方', sellerTaxNo: 'SELLER-TAX', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }
    const request = { workspaceId: first.actor.workspaceId, actorId: first.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, action: 'import', commandId: 'cold-tax-import', baseVersion: null, fields, items: [], ownerKind: 'project', projectId: 'fixture-project', supplierId: 'fixture-supplier', source: { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '发票', rowNumber: 1, rawSnapshot: {} }, confirmed: true, taxNumbersConfirmed: true, taxVerification: { buyerId: 'fixture-buyer', buyerVersion: '1', supplierVersion: '1' } }
    const result = await first.service.execute(request, first.session)
    first.sql.exec('BEGIN IMMEDIATE')
    try {
      first.sql.exec(PRODUCTION_INVOICE_COMPANY_UPGRADE)
      first.sql.exec('COMMIT')
    }
    catch (error) {
      first.sql.exec('ROLLBACK')
      throw error
    }
    await first.storage.close()
    databases.splice(databases.indexOf(first.storage), 1)
    const script = `const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      try { const row = db.prepare('SELECT evidence_json FROM invoice_archive_evidence WHERE invoice_id=?').get(process.argv[2]);
        process.stdout.write(JSON.stringify({ integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, evidence: JSON.parse(row.evidence_json) }));
      } finally { db.close(); }`
    const output = JSON.parse(execFileSync(process.execPath, ['-e', script, path, result.invoiceId], { encoding: 'utf8', windowsHide: true }))
    expect(output).toMatchObject({ integrity: 'ok', evidence: { taxNumbersConfirmed: true, taxVerification: { buyer: { id: 'fixture-buyer', version: '1', taxNo: 'BUYER-TAX' }, supplier: { id: 'fixture-supplier', version: '1', taxNo: 'SELLER-TAX' } } } })
    const reopened = fixture(path, true)
    expect(await reopened.service.execute(request, reopened.session)).toEqual(result)
    expect(await reopened.storage.select('SELECT id FROM invoices')).toHaveLength(1)
    await expect(validateProductionInvoiceJournal(reopened.storage, reopened.actor)).resolves.toBeUndefined()
  })

  it('关闭后独立进程冷读原件、摘要和原回执，再打开时同键不重复', { timeout: 120_000 }, async () => {
    // 合成数据库仅写入项目内专属临时目录；依据用户的数据库保全要求不自动删除。
    const base = testTempRoot('invoice-owner-cold')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(join(base, 'synthetic-'))
    const path = join(directory, 'invoice.sqlite')
    const first = fixture(path)
    const created = await first.service.execute(first.upload, first.session)
    const fields = { invoiceNumber: '87654321', invoiceDate: '', invoiceType: '', buyer: '合成购方', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }
    const recognized = await first.service.execute({ action: 'recognize', invoiceId: created.invoiceId, baseVersion: created.version, workspaceId: first.actor.workspaceId, actorId: first.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'cold-recognition', fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] }, first.session)
    await first.storage.close()
    databases.splice(databases.indexOf(first.storage), 1)
    const script = `const { DatabaseSync } = require('node:sqlite'); const { createHash } = require('node:crypto');
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
        const row = db.prepare('SELECT i.id,i.version,i.amount,i.tax_amount,i.ocr_status,i.original_file_id,p.content,p.sha256,r.result_json FROM invoices i JOIN file_payloads p ON p.file_ref_id=i.original_file_id JOIN invoice_command_receipts r ON r.invoice_id=i.id WHERE i.id=? AND r.command_id=?').get(process.argv[2],process.argv[3]);
        const recognition = db.prepare('SELECT result_json FROM invoice_recognitions WHERE invoice_id=?').get(process.argv[2]);
        process.stdout.write(JSON.stringify({ integrity,id:row.id,version:row.version,amount:row.amount,taxAmount:row.tax_amount,ocrStatus:row.ocr_status,originalId:row.original_file_id,sha256:row.sha256,actualSha256:createHash('sha256').update(row.content).digest('hex'),receipt:JSON.parse(row.result_json),recognition:JSON.parse(recognition.result_json) }));
      } finally { db.close(); }`
    const output = JSON.parse(execFileSync(process.execPath, ['-e', script, path, created.invoiceId, created.commandId], { encoding: 'utf8', windowsHide: true }))
    expect(output).toMatchObject({ integrity: 'ok', id: created.invoiceId, version: Number(recognized.version), amount: null, taxAmount: 0, ocrStatus: 'done', originalId: created.originalId, sha256: createHash('sha256').update(first.bytes).digest('hex'), receipt: created, recognition: { fields, items: [], source: 'local', textPages: ['合成文本'], unrecognizedPageIndexes: [] } })
    expect(output.actualSha256).toBe(output.sha256)
    const reopened = fixture(path, true)
    expect(await reopened.service.execute(reopened.upload, reopened.session)).toEqual(created)
    expect(Buffer.from((await reopened.service.original(created.invoiceId, created.originalId!, reopened.session)).bytes)).toEqual(first.bytes)
    expect(await reopened.storage.select('SELECT id FROM invoices')).toHaveLength(1)
  })
})
