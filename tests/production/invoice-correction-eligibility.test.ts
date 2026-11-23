import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, expect, it } from 'vitest'
import { INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from '../../app/lib/invoice/central-contract'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createLocalBackup, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { productionFinanceOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { requireInvoiceCorrectionEligibility } from '../../server/utils/production-invoice-correction-eligibility'
import { PRODUCTION_INVOICE_CORRECTION_SCHEMA } from '../../server/utils/production-invoice-correction-schema'
import { createProductionInvoiceCorrectionService } from '../../server/utils/production-invoice-correction-service'
import { correctionBaselineIdentity, readInvoiceCorrectionStart } from '../../server/utils/production-invoice-correction-start'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { createProductionInvoiceService, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { assertInvoiceWorkbookFill, assertInvoiceWorkbookImport, prepareInvoiceWorkbook, unsafeInvoiceFormulaColumns, validateInvoiceWorkbooks } from '../../server/utils/production-invoice-workbook'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { syntheticInvoiceWorkbook } from '../helpers/invoice-workbook-fixture'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']
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

async function fixture() {
  const f = await createSubcontractFixture()
  f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, 'finance-invoice:import', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'auxiliary-contract:read', 'auxiliary-contract:write'] })
  const supplierDraft = JSON.parse((await f.storage.select<{ draft_json: string }>('SELECT draft_json FROM suppliers WHERE id=?', [f.supplier.id]))[0]!.draft_json)
  const supplier = await createProductionSupplierService(f.storage).execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'supplier:write', commandId: 'correction-supplier-tax', id: f.supplier.id, baseVersion: f.supplier.version, action: 'save', attachments: {}, draft: { ...supplierDraft, taxNo: 'CORRECTION-SELLER' } }, f.session, f.supplier.id)
  const service = createProductionInvoiceService(f.storage)
  const actor = f.session()
  const common = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
  const bytes = pdf()
  const uploaded = await service.execute({ ...common, action: 'upload', commandId: 'correction-upload', baseVersion: null, projectId: f.project.id, original: { fileName: '合成原件.pdf', fileSize: bytes.length, mimeType: 'application/pdf', contentBase64: bytes.toString('base64') } }, f.session)
  const fields = { invoiceNumber: 'SYN-CORRECTION', invoiceDate: '2026-10-07', invoiceType: '', buyer: '合成主体', buyerTaxNo: 'SUBCONTRACT-VERIFICATION', seller: '合成分供方', sellerTaxNo: 'CORRECTION-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
  const recognized = await service.execute({ ...common, action: 'recognize', commandId: 'correction-recognize', invoiceId: uploaded.invoiceId, baseVersion: uploaded.version, fields, items: [], source: 'local', textPages: ['合成'], unrecognizedPageIndexes: [] }, f.session)
  const reviewed = await service.execute({ ...common, action: 'review', commandId: 'correction-review', invoiceId: uploaded.invoiceId, baseVersion: recognized.version, manualCompletion: false }, f.session)
  const archived = await service.execute({ ...common, action: 'archive', commandId: 'correction-archive', invoiceId: uploaded.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: f.project.id, supplierId: supplier.id, taxNumbersConfirmed: true, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: supplier.version } }, f.session)
  return { ...f, service, actor, common, archived, supplier }
}

it('归档基准、权限和已打印历史均在真实日志与同事务来源下核对', async () => {
  const f = await fixture()
  try {
    const check = (version: string, actor = f.actor) => f.storage.withTransaction(tx => requireInvoiceCorrectionEligibility(tx, actor, f.archived.invoiceId, version))
    expect(await check(f.archived.version)).toMatchObject({ id: f.archived.invoiceId, version: f.archived.version, accountStatus: 'archived' })
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, f.archived.version))
    expect(start.baseline).toMatchObject({ projectId: f.project.id, supplierId: f.supplier.id, supplierVersion: f.supplier.version, buyer: { id: f.signatory.id, version: f.signatory.version }, fields: { amount: null, taxAmount: 0 } })
    expect(correctionBaselineIdentity(start.invoice, [])).toEqual({ buyer: null, supplierVersion: null })
    const legacyContract = { domain: 'company' as const, id: 'legacy-company', version: '1' }
    const legacyInvoice = { ...start.invoice, ownerKind: 'company' as const, projectId: null, contract: legacyContract }
    const legacyRow = { after_json: JSON.stringify({ ...legacyInvoice, contract: { version: '1', id: 'legacy-company', domain: 'company' } }), evidence_json: JSON.stringify({ entry: { companyAdoption: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierId: f.supplier.id, supplierVersion: f.supplier.version, target: { id: 'legacy-company', version: '1', domain: 'company' } } } }) }
    expect(correctionBaselineIdentity(legacyInvoice, [], [legacyRow])).toEqual({ buyer: { id: f.signatory.id, version: f.signatory.version }, supplierVersion: f.supplier.version })
    expect(correctionBaselineIdentity({ ...start.invoice, fields: { ...start.invoice.fields, buyerTaxNo: 'CHANGED' } }, [{ after_json: JSON.stringify(start.invoice), evidence_json: JSON.stringify({ taxVerification: { buyer: { id: f.signatory.id, version: f.signatory.version, taxNo: 'SUBCONTRACT-VERIFICATION' }, supplier: { id: f.supplier.id, version: f.supplier.version, taxNo: 'CORRECTION-SELLER' } } }) }])).toEqual({ buyer: null, supplierVersion: null })
    await expect(check('1')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(check(f.archived.version, { ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'finance-payment-record:read') })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(check(f.archived.version, { ...f.actor, capabilities: f.actor.capabilities.filter(capability => capability !== 'supplier:list:read') })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const printed = await f.service.recordPrinted({ ...f.common, action: 'record-printed', commandId: 'correction-print', targets: [{ invoiceId: f.archived.invoiceId, baseVersion: f.archived.version, rotation: 0 }] }, f.session)
    await expect(check(printed.records[0]!.version)).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('打印历史') } })
    expect((await f.service.get(f.archived.invoiceId, f.session)).printCount).toBe(1)
  }
  finally { await f.storage.close() }
})

it('更正提交在事务中核对项目合同主体，缺证或错主体不改发票与更正单', async () => {
  const f = await fixture()
  try {
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, f.archived.version))
    const corrections = createProductionInvoiceCorrectionService(f.storage, { invoice: f.service.correctionPort })
    const saved = await corrections.saveDraft({ action: 'save-draft', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'subject-correction-save', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: null, baseCorrectionVersion: null, reason: '补充合同关联', proposed: { ...start.baseline, contract: { domain: 'construction', id: f.main.id, version: f.main.version } }, keepFileIds: [], addFiles: [] }, f.session)
    const submit = { action: 'submit' as const, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: 'subject-correction-submit', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: saved.correctionId, baseCorrectionVersion: saved.version, confirmed: true as const }
    for (const [ourSignatoryId, code] of [[null, 'unavailable'], ['different-subject', 'validation-failed']] as const) {
      const invoice = createProductionInvoiceService(f.storage, { verifyContract: async () => ({ id: f.main.id, version: f.main.version, projectId: f.project.id, supplierId: null, ourSignatoryId }) })
      const failing = createProductionInvoiceCorrectionService(f.storage, { invoice: invoice.correctionPort })
      await expect(failing.submit(submit, f.session)).rejects.toMatchObject({ problem: { code } })
      expect(await f.service.get(f.archived.invoiceId, f.session)).toMatchObject({ version: f.archived.version, contract: null })
      expect(await corrections.get(saved.correctionId, f.session)).toMatchObject({ version: saved.version, state: 'draft' })
    }
    const result = await corrections.submit(submit, f.session)
    expect(await f.service.get(f.archived.invoiceId, f.session)).toMatchObject({ version: result.invoiceVersion, contract: { domain: 'construction', id: f.main.id, version: f.main.version } })
    expect(await corrections.submit(submit, f.session)).toEqual(result)
  }
  finally { await f.storage.close() }
})

it('付款申请存在当前或软删关联时均阻止更正，不覆盖付款历史', async () => {
  const f = await fixture()
  try {
    const finance = createProductionFinanceService(f.storage, { references: productionFinanceOwners })
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-application:write', kind: 'payment_application' as const, action: 'save' as const, commandId: 'correction-payment-application', baseVersion: null, attachments: {}, draft: { name: '合成付款申请', bizType: '预付款', projectId: f.project.id, supplierId: f.supplier.id, applyAmount: 30, applyDate: '2026-10-07', applicant: '合成', invoiceState: '先款后票', invoiceAllocations: [{ invoiceId: f.archived.invoiceId, allocatedAmount: 30 }] } }
    const saved = await finance.execute(request, f.session)
    const check = () => f.storage.withTransaction(tx => requireInvoiceCorrectionEligibility(tx, f.actor, f.archived.invoiceId, f.archived.version))
    await expect(check()).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('付款关联') } })
    const form = await finance.form('payment_application', saved.id, f.session)
    await finance.execute({ ...request, id: saved.id, commandId: 'correction-payment-unlink', baseVersion: saved.version, draft: { ...form.draft, invoiceAllocations: [] } }, f.session)
    await expect(check()).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('付款关联') } })
    expect((await f.storage.select('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=?', [f.archived.invoiceId])).length).toBeGreaterThan(0)
  }
  finally { await f.storage.close() }
})

it('更正草稿及原附件同事务留痕，原号重放、竞争和撤权不改变发票', async () => {
  const f = await fixture()
  try {
    if (!(await f.storage.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'invoice_corrections\'')).length)
      await f.storage.execute(PRODUCTION_INVOICE_CORRECTION_SCHEMA)
    const service = createProductionInvoiceCorrectionService(f.storage)
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, f.archived.version))
    const command = { action: 'save-draft' as const, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'correction-draft-one', requiredCapability: INVOICE_WRITE_CAPABILITY, invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: null, baseCorrectionVersion: null, reason: '修正税额', proposed: { ...start.baseline, fields: { ...start.baseline.fields, taxAmount: 3 } }, keepFileIds: [], addFiles: [{ fileName: '更正依据.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }
    await f.storage.execute('INSERT INTO invoice_legacy_resolutions VALUES(?,?,?,?)', [command.commandId, f.actor.workspaceId, f.actor.actorId, '2026-10-07T00:00:00.000Z'])
    const first = await service.saveDraft(command, f.session)
    expect(await service.saveDraft(command, f.session)).toEqual(first)
    expect(await f.storage.select('SELECT revision FROM invoice_correction_revision')).toEqual([{ revision: 1 }])
    const lookup = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, action: 'save-draft' as const, invoiceId: f.archived.invoiceId, correctionId: null, commandId: command.commandId }
    expect(await service.resolve(lookup, f.session)).toEqual({ outcome: 'applied', result: first })
    await expect(f.service.resolve(command.commandId, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const sealed = { ...lookup, commandId: 'correction-never-applied' }
    expect(await service.resolve(sealed, f.session)).toEqual({ outcome: 'not-applied', commandId: sealed.commandId })
    expect(await service.resolve(sealed, f.session)).toEqual({ outcome: 'not-applied', commandId: sealed.commandId })
    expect(await f.storage.select('SELECT revision FROM invoice_correction_revision')).toEqual([{ revision: 2 }])
    await expect(service.saveDraft({ ...command, commandId: sealed.commandId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.resolve({ ...lookup, correctionId: first.correctionId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.saveDraft({ ...command, reason: '另一个更正' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const firstDraft = await service.get(first.correctionId, f.session)
    expect(firstDraft).toMatchObject({ invoiceId: f.archived.invoiceId, version: '1', reason: '修正税额', attachments: [{ fileName: '更正依据.txt', fileSize: 3 }] })
    const next = { ...command, commandId: 'correction-draft-two', correctionId: first.correctionId, baseCorrectionVersion: first.version, reason: '复核后修正', keepFileIds: [firstDraft.attachments[0]!.id], addFiles: [] }
    const second = await service.saveDraft(next, f.session)
    expect((await service.get(first.correctionId, f.session)).attachments).toEqual(firstDraft.attachments)
    await expect(service.saveDraft({ ...next, commandId: 'correction-stale' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const before = await f.storage.select('SELECT * FROM invoice_correction_receipts ORDER BY command_id')
    let calls = 0
    const changing = () => ++calls < 3 ? f.session() : { ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== INVOICE_WRITE_CAPABILITY) }
    await expect(service.saveDraft({ ...next, commandId: 'correction-revoked', baseCorrectionVersion: second.version, addFiles: [{ fileName: '撤权.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, changing)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT * FROM invoice_correction_receipts ORDER BY command_id')).toEqual(before)
    expect(await f.storage.select('SELECT file_ref_id FROM invoice_correction_files')).toHaveLength(1)
    expect((await f.service.get(f.archived.invoiceId, f.session)).version).toBe(f.archived.version)
    const printed = await f.service.recordPrinted({ ...f.common, action: 'record-printed', commandId: 'correction-later-print', targets: [{ invoiceId: f.archived.invoiceId, baseVersion: f.archived.version, rotation: 0 }] }, f.session)
    expect(printed.records[0]!.printCount).toBe(1)
    expect((await service.get(first.correctionId, f.session)).version).toBe(second.version)
    await expect(service.saveDraft({ ...next, commandId: 'correction-after-print', baseCorrectionVersion: second.version }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  }
  finally { await f.storage.close() }
})

it('明确提交更正单原子更新原票和双重回执，原件、历史及原号恢复保留', async () => {
  const f = await fixture()
  try {
    if (!(await f.storage.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'invoice_corrections\'')).length)
      await f.storage.execute(PRODUCTION_INVOICE_CORRECTION_SCHEMA)
    const corrections = createProductionInvoiceCorrectionService(f.storage, { invoice: f.service.correctionPort })
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, f.archived.version))
    const startRead = await corrections.startRead(f.archived.invoiceId, f.archived.version, f.session)
    expect(startRead).toMatchObject({ baseline: start.baseline, meta: { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, dataOrigin: 'real', authorizedScope: { coverage: 'complete' }, sources: [{ key: 'invoice-corrections', state: 'readable', sourceVersion: 'invoice-corrections:0' }, { key: 'invoices', state: 'readable' }] } })
    expect((await corrections.listRead(f.archived.invoiceId, f.session)).items).toEqual([])
    const save = { action: 'save-draft' as const, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'correction-submit-draft', requiredCapability: INVOICE_WRITE_CAPABILITY, invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: null, baseCorrectionVersion: null, reason: '票面税额核对', proposed: { ...start.baseline, fields: { ...start.baseline.fields, taxAmount: 3 } }, keepFileIds: [], addFiles: [{ fileName: '更正说明.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }
    const draft = await corrections.saveDraft(save, f.session)
    const submit = { action: 'submit' as const, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'correction-submit-confirmed', requiredCapability: INVOICE_WRITE_CAPABILITY, invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: draft.correctionId, baseCorrectionVersion: draft.version, confirmed: true as const }
    const result = await corrections.submit(submit, f.session)
    expect(await corrections.submit(submit, f.session)).toEqual(result)
    expect(await corrections.resolve({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: submit.commandId, action: 'submit', invoiceId: submit.invoiceId, correctionId: draft.correctionId }, f.session)).toEqual({ outcome: 'applied', result })
    const current = await f.service.get(f.archived.invoiceId, f.session)
    expect(current).toMatchObject({ id: f.archived.invoiceId, version: result.invoiceVersion, fields: { amount: null, taxAmount: 3 }, original: { id: f.archived.originalId } })
    const correction = await corrections.get(draft.correctionId, f.session)
    expect(correction).toMatchObject({ state: 'submitted', reason: '票面税额核对', baseInvoiceVersion: f.archived.version, resultInvoiceVersion: result.invoiceVersion, baseline: { fields: { taxAmount: 0 } }, proposed: { fields: { taxAmount: 3 } } })
    expect(correction.attachments).toHaveLength(1)
    expect((await corrections.getRead(draft.correctionId, f.session)).record).toEqual(correction)
    expect((await corrections.listRead(f.archived.invoiceId, f.session)).items).toEqual([correction])
    expect((await corrections.historyRead(draft.correctionId, f.session)).items.map(item => [item.record.state, item.actorId])).toEqual([['draft', f.actor.actorId], ['submitted', f.actor.actorId]])
    expect(await corrections.file(draft.correctionId, correction.attachments[0]!.id, f.session)).toMatchObject({ fileName: '更正说明.txt', bytes: Buffer.from('abc') })
    await expect(corrections.file(draft.correctionId, 'wrong-file', f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(corrections.historyRead(draft.correctionId, () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(item => item !== 'supplier:list:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT action FROM invoice_command_receipts WHERE command_id=?', [submit.commandId])).toEqual([{ action: 'correct' }])
    expect(await f.storage.select('SELECT action FROM invoice_audits WHERE command_id=?', [submit.commandId])).toEqual([{ action: 'correct' }])
    await expect(corrections.saveDraft({ ...save, commandId: 'correction-submitted-edit', correctionId: draft.correctionId, baseCorrectionVersion: result.version }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.service.get(f.archived.invoiceId, f.session)).fields.taxAmount).toBe(3)
    const base = testTempRoot('invoice-correction-backup')
    await mkdir(base, { recursive: true })
    const backupDirectory = await mkdtemp(`${base}/backup-`)
    const restoreDirectory = await mkdtemp(`${base}/restore-`)
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'correction-restore')
    const recovered = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      expect((await recovered.status()).schemaVersion).toBe(33)
      const recoveredInvoice = createProductionInvoiceService(recovered)
      const recoveredCorrections = createProductionInvoiceCorrectionService(recovered, { invoice: recoveredInvoice.correctionPort })
      expect(await recoveredCorrections.get(draft.correctionId, f.session)).toEqual(correction)
      expect(await recoveredCorrections.resolve({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: submit.commandId, action: 'submit', invoiceId: submit.invoiceId, correctionId: draft.correctionId }, f.session)).toEqual({ outcome: 'applied', result })
      expect((await recovered.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [correction.attachments[0]!.id]))[0]!.content).toEqual(new Uint8Array(Buffer.from('abc')))
    }
    finally { await recovered.close() }
    const script = `const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url'),path=require('node:path');registerHooks({resolve(s,c,n){if(s.startsWith('~/'))s=pathToFileURL(path.resolve('app',s.slice(2))).href;try{return n(s,c)}catch(e){if((s.startsWith('.')||s.startsWith('file:'))&&e.code==='ERR_MODULE_NOT_FOUND')return n(s+'.ts',c);throw e}}});(async()=>{const {createProductionStorage}=await import('./server/utils/production-storage.ts');const {createProductionInvoiceService}=await import('./server/utils/production-invoice-service.ts');const {createProductionInvoiceCorrectionService}=await import('./server/utils/production-invoice-correction-service.ts');const [directory,correctionId,actorJson]=process.argv.slice(1);const actor=JSON.parse(actorJson);const storage=createProductionStorage({directory,workspaceId:actor.workspaceId,ownerId:actor.actorId,purpose:'verification'});const invoices=createProductionInvoiceService(storage);const service=createProductionInvoiceCorrectionService(storage,{invoice:invoices.correctionPort});const correction=await service.get(correctionId,()=>actor);const invoice=await invoices.get(correction.invoiceId,()=>actor);process.stdout.write(JSON.stringify({correction,invoice}));await storage.close()})().catch(e=>{process.stderr.write(String(e));process.exitCode=1})`
    const cold = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '-e', script, restored.directory, draft.correctionId, JSON.stringify(f.actor)], { cwd: process.cwd(), encoding: 'utf8' }))
    expect(cold.correction).toEqual(correction)
    expect(cold.invoice).toEqual(current)
    expect(restored.directory.startsWith(join(base, 'restore-'))).toBe(true)
  }
  finally { await f.storage.close() }
})

it('项目和公司票可主动互转，历史个人票仅在用户明确提交更正后转换', { timeout: 120_000 }, async () => {
  const f = await fixture()
  try {
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const company = await auxiliary.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'correction-company-contract', baseVersion: null, action: 'submit', attachments: {}, draft: { kind: 'company_expense', no: 'CORRECT-COMPANY', name: '合成公司合同', category: '房租', signDate: '2026-10-07', amount: 100, supplierId: f.supplier.id, supplierVersion: f.supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const corrections = createProductionInvoiceCorrectionService(f.storage, { invoice: f.service.correctionPort })
    async function change(invoiceId: string, baseInvoiceVersion: string, suffix: string, update: (before: Awaited<ReturnType<typeof readInvoiceCorrectionStart>>['baseline']) => Awaited<ReturnType<typeof readInvoiceCorrectionStart>>['baseline']) {
      const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, invoiceId, baseInvoiceVersion))
      const saved = await corrections.saveDraft({ action: 'save-draft', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: `convert-draft-${suffix}`, invoiceId, baseInvoiceVersion, correctionId: null, baseCorrectionVersion: null, reason: '人工核对归属', proposed: update(start.baseline), keepFileIds: [], addFiles: [] }, f.session)
      return corrections.submit({ action: 'submit', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: `convert-submit-${suffix}`, invoiceId, baseInvoiceVersion, correctionId: saved.correctionId, baseCorrectionVersion: saved.version, confirmed: true }, f.session)
    }
    const companyResult = await change(f.archived.invoiceId, f.archived.version, 'to-company', before => ({ ...before, ownerKind: 'company', projectId: null, contract: { domain: 'company', id: company.id, version: company.version } }))
    expect(await f.service.get(f.archived.invoiceId, f.session)).toMatchObject({ ownerKind: 'company', projectId: null, contract: { domain: 'company', id: company.id } })
    const projectAgain = await change(f.archived.invoiceId, companyResult.invoiceVersion, 'to-project', before => ({ ...before, ownerKind: 'project', projectId: f.project.id, contract: null }))
    expect(await f.service.get(f.archived.invoiceId, f.session)).toMatchObject({ ownerKind: 'project', projectId: f.project.id, contract: null })
    const fields = { invoiceNumber: 'SYN-PERSONAL', invoiceDate: '2026-10-07', invoiceType: '', buyer: '合成主体', buyerTaxNo: 'SUBCONTRACT-VERIFICATION', seller: '合成分供方', sellerTaxNo: 'CORRECTION-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const workbook = await syntheticInvoiceWorkbook(fields.invoiceNumber, 12)
    const importMapping = { ...Object.fromEntries(Object.entries(workbook.mapping).filter(([key]) => key !== 'amount')), taxAmount: { column: '负零', confidence: 'confirmed' } }
    const parsed = await prepareInvoiceWorkbook(workbook.workbook, workbook.source)
    expect(parsed.columns).toContain('__importSource')
    expect(parsed.unsafeFormulaColumns).toContain('公式问题')
    expect(Object.hasOwn(workbook.source.rawSnapshot, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(workbook.source.rawSnapshot, '__proto__')?.value).toBe('真实特殊键')
    const ambiguous = await syntheticInvoiceWorkbook('SYN-AMBIGUOUS', null, true)
    await expect(prepareInvoiceWorkbook(ambiguous.workbook, ambiguous.source)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    for (const formulaStatus of ['invalid', 'missing-cache'] as const) {
      const unsafe = unsafeInvoiceFormulaColumns([{ columnName: '价税合计', formulaStatus }])
      expect(() => assertInvoiceWorkbookImport(fields, [], importMapping, parsed.row, parsed.columns, unsafe)).toThrow('来源行存在无法核验的公式缓存')
    }
    const command = { ...f.common, action: 'import', commandId: 'correction-personal-import', baseVersion: null, fields, items: [], ownerKind: 'personal', projectId: null, supplierId: f.supplier.id, source: workbook.source, confirmed: true, taxNumbersConfirmed: true, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: f.supplier.version } }
    await expect(f.service.execute(command, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM invoice_import_workbooks')).toEqual([])
    await expect(f.service.execute({ ...command, fields: { ...fields, totalAmount: 200 } }, f.session, workbook.workbook, importMapping)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    for (const column of ['__importSource', '公式问题', '不存在的列']) {
      const mapping = { ...importMapping, remark: { column, confidence: 'confirmed' } }
      await expect(f.service.execute(command, f.session, workbook.workbook, mapping)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
    expect(await f.storage.select('SELECT id FROM invoice_import_workbooks')).toEqual([])
    const personal = await f.service.execute(command, f.session, workbook.workbook, importMapping)
    expect(await f.service.execute(command, f.session, workbook.workbook, importMapping)).toEqual(personal)
    const links = await f.service.workbooksForInvoice(personal.invoiceId, () => ({ ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] }))
    expect(Buffer.from((await f.service.workbook(String(links[0]!.id), () => ({ ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] }))).bytes)).toEqual(workbook.bytes)
    expect((await f.service.get(personal.invoiceId, f.session)).ownerKind).toBe('personal')
    const personalStart = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, personal.invoiceId, personal.version))
    for (const formulaStatus of ['invalid', 'missing-cache'] as const) {
      const unsafe = unsafeInvoiceFormulaColumns([{ columnName: '金额', formulaStatus }])
      expect(() => assertInvoiceWorkbookFill(personalStart.baseline, { ...personalStart.baseline, fields: { ...personalStart.baseline.fields, amount: 12 } }, { amount: '金额' }, parsed.row, parsed.columns, unsafe)).toThrow('来源行存在无法核验的公式缓存')
    }
    const fillDraft = await corrections.saveDraft({ action: 'save-draft', ...f.common, commandId: 'same-source-fill-draft', invoiceId: personal.invoiceId, baseInvoiceVersion: personal.version, correctionId: null, baseCorrectionVersion: null, reason: '补充原表金额', proposed: { ...personalStart.baseline, fields: { ...personalStart.baseline.fields, amount: 12 } }, keepFileIds: [], addFiles: [] }, f.session)
    const fill = { action: 'submit' as const, ...f.common, commandId: 'same-source-fill-submit', invoiceId: personal.invoiceId, baseInvoiceVersion: personal.version, correctionId: fillDraft.correctionId, baseCorrectionVersion: fillDraft.version, confirmed: true as const, workbookSource: { source: workbook.source, mapping: { amount: '金额' } } }
    for (const column of ['__importSource', '公式问题', '不存在的列'])
      await expect(corrections.submit({ ...fill, workbookSource: { source: workbook.source, mapping: { amount: '金额', remark: column } } }, f.session, workbook.workbook)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const filled = await corrections.submit(fill, f.session, workbook.workbook)
    expect(await corrections.submit(fill, f.session, workbook.workbook)).toEqual(filled)
    expect(await f.storage.select('SELECT command_id FROM invoice_import_workbook_rows WHERE invoice_id=?', [personal.invoiceId])).toHaveLength(2)
    const otherStart = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, projectAgain.invoiceVersion))
    const otherDraft = await corrections.saveDraft({ action: 'save-draft', ...f.common, commandId: 'cross-source-fill-draft', invoiceId: f.archived.invoiceId, baseInvoiceVersion: projectAgain.invoiceVersion, correctionId: null, baseCorrectionVersion: null, reason: '检查跨票来源', proposed: { ...otherStart.baseline, fields: { ...otherStart.baseline.fields, amount: 12 } }, keepFileIds: [], addFiles: [] }, f.session)
    await expect(corrections.submit({ ...fill, commandId: 'cross-source-fill-submit', invoiceId: f.archived.invoiceId, baseInvoiceVersion: projectAgain.invoiceVersion, correctionId: otherDraft.correctionId, baseCorrectionVersion: otherDraft.version }, f.session, workbook.workbook)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.service.get(f.archived.invoiceId, f.session)).fields.amount).toBeNull()
    expect(await f.storage.select('SELECT command_id FROM invoice_import_workbook_rows')).toHaveLength(2)
    await change(personal.invoiceId, filled.invoiceVersion, 'personal-to-project', before => ({ ...before, ownerKind: 'project', projectId: f.project.id }))
    expect((await f.service.get(personal.invoiceId, f.session)).ownerKind).toBe('project')
    const base = testTempRoot('invoice-same-source-backup')
    await mkdir(base, { recursive: true })
    const backupDirectory = await mkdtemp(`${base}/backup-`)
    const restoreDirectory = await mkdtemp(`${base}/restore-`)
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'same-source-restore')
    const recovered = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      const books = await createProductionInvoiceService(recovered).workbooksForInvoice(personal.invoiceId, () => ({ ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] }))
      expect(books).toHaveLength(2)
      expect(books[0]!.id).toBe(books[1]!.id)
      await recovered.execute('PRAGMA recursive_triggers=OFF')
      expect(await recovered.select('PRAGMA recursive_triggers')).toEqual([{ recursive_triggers: 0 }])
      for (const [table, where, value] of [
        ['invoice_import_workbooks', 'id', books[0]!.id],
        ['invoice_import_workbook_rows', 'command_id', command.commandId],
        ['invoice_import_sources', 'command_id', command.commandId],
        ['file_refs', 'id', (await recovered.select<{ file_ref_id: string }>('SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?', [books[0]!.id]))[0]!.file_ref_id],
        ['file_payloads', 'file_ref_id', (await recovered.select<{ file_ref_id: string }>('SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?', [books[0]!.id]))[0]!.file_ref_id],
      ] as const) {
        await expect(recovered.execute(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} WHERE ${where}=?`, [value])).rejects.toThrow('immutable')
      }
      // 仅破坏隔离恢复副本，直接检验恢复使用的来源校验器。
      await recovered.execute('DROP TRIGGER invoice_import_workbook_rows_no_update')
      for (const column of ['__importSource', '公式问题', '不存在的列']) {
        const invalid = { ...importMapping, remark: { column, confidence: 'confirmed' } }
        await recovered.execute('UPDATE invoice_import_workbook_rows SET mapping_json=? WHERE command_id=?', [JSON.stringify(invalid), command.commandId])
        await expect(recovered.withTransaction(tx => validateInvoiceWorkbooks(tx))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      }
      await recovered.execute('UPDATE invoice_import_workbook_rows SET mapping_json=? WHERE command_id=?', [JSON.stringify(importMapping), command.commandId])
      await recovered.execute('DROP TRIGGER invoice_correction_receipts_no_update')
      for (const column of ['__importSource', '公式问题', '不存在的列']) {
        const mapping = { amount: '金额', remark: column }
        const proof = { ...fill, workbookSource: { source: workbook.source, mapping } }
        await recovered.execute('UPDATE invoice_import_workbook_rows SET mapping_json=? WHERE command_id=?', [JSON.stringify(mapping), fill.commandId])
        await recovered.execute('UPDATE invoice_correction_receipts SET request_json=? WHERE command_id=?', [JSON.stringify(proof), fill.commandId])
        await expect(recovered.withTransaction(tx => validateInvoiceWorkbooks(tx))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      }
    }
    finally { await recovered.close() }
  }
  finally { await f.storage.close() }
})

it('工作簿补空只在更正成功时原样保存，发票读取权限可下载并可从备份恢复', { timeout: 120_000 }, async () => {
  const f = await fixture()
  try {
    const workbook = await syntheticInvoiceWorkbook('SYN-CORRECTION', 12)
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, f.actor, f.archived.invoiceId, f.archived.version))
    const corrections = createProductionInvoiceCorrectionService(f.storage, { invoice: f.service.correctionPort })
    const rejected = await corrections.saveDraft({ action: 'save-draft', ...f.common, commandId: 'workbook-overwrite-draft', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: null, baseCorrectionVersion: null, reason: '错误覆盖', proposed: { ...start.baseline, fields: { ...start.baseline.fields, taxAmount: 1 } }, keepFileIds: [], addFiles: [] }, f.session)
    await expect(corrections.submit({ action: 'submit', ...f.common, commandId: 'workbook-overwrite-submit', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: rejected.correctionId, baseCorrectionVersion: rejected.version, confirmed: true, workbookSource: { source: workbook.source, mapping: { taxAmount: '税额' } } }, f.session, workbook.workbook)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const saved = await corrections.saveDraft({ action: 'save-draft', ...f.common, commandId: 'workbook-fill-draft', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: null, baseCorrectionVersion: null, reason: '补充金额', proposed: { ...start.baseline, fields: { ...start.baseline.fields, amount: 12 } }, keepFileIds: [], addFiles: [] }, f.session)
    const command = { action: 'submit' as const, ...f.common, commandId: 'workbook-fill-submit', invoiceId: f.archived.invoiceId, baseInvoiceVersion: f.archived.version, correctionId: saved.correctionId, baseCorrectionVersion: saved.version, confirmed: true as const, workbookSource: { source: workbook.source, mapping: { amount: '金额', taxAmount: '税额' } } }
    await expect(corrections.submit(command, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(corrections.submit(command, f.session, { ...workbook.workbook, payloadBase64: Buffer.from('wrong').toString('base64') })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT id FROM invoice_import_workbooks')).toEqual([])
    const result = await corrections.submit(command, f.session, workbook.workbook)
    expect(await corrections.submit(command, f.session, workbook.workbook)).toEqual(result)
    expect(await f.service.get(f.archived.invoiceId, f.session)).toMatchObject({ fields: { amount: 12, taxAmount: 0 } })
    const readOnly = () => ({ ...f.actor, capabilities: [INVOICE_READ_CAPABILITY] })
    const books = await f.service.workbooksForInvoice(f.archived.invoiceId, readOnly)
    expect(books).toHaveLength(1)
    const id = String(books[0]!.id)
    expect(Buffer.from((await f.service.workbook(id, readOnly)).bytes)).toEqual(workbook.bytes)
    await expect(f.service.workbook(id, () => ({ ...f.actor, capabilities: [] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const base = testTempRoot('invoice-workbook-backup')
    await mkdir(base, { recursive: true })
    const backupDirectory = await mkdtemp(`${base}/backup-`)
    const restoreDirectory = await mkdtemp(`${base}/restore-`)
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'workbook-restore')
    const recovered = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      expect(Buffer.from((await createProductionInvoiceService(recovered).workbook(id, readOnly)).bytes)).toEqual(workbook.bytes)
      await expect(recovered.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=(SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?)', [Buffer.from('damaged'), id])).rejects.toThrow('invoice workbook bytes are immutable')
      await expect(recovered.execute('DELETE FROM file_payloads WHERE file_ref_id=(SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?)', [id])).rejects.toThrow('invoice workbook bytes are immutable')
      await expect(recovered.execute('UPDATE file_refs SET file_name=? WHERE id=(SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?)', ['damaged.xlsx', id])).rejects.toThrow('invoice workbook metadata is immutable')
      await expect(recovered.execute('DELETE FROM file_refs WHERE id=(SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?)', [id])).rejects.toThrow('invoice workbook metadata is immutable')
      // 故意损坏合成恢复副本，验证缺少触发器后的纵深校验。
      await recovered.execute('DROP TRIGGER invoice_workbook_payload_no_update')
      await recovered.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=(SELECT file_ref_id FROM invoice_import_workbooks WHERE id=?)', [Buffer.from('damaged'), id])
      await expect(recovered.withTransaction(tx => validateProductionInvoiceJournal(tx, f.actor))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      await expect(createLocalBackup(recovered, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())).rejects.toThrow('发票备份的原回执、版本、识别记录或审计历史不完整。')
    }
    finally { await recovered.close() }
  }
  finally { await f.storage.close() }
})

it('真实旧库迁入的个人票明确更正为公司开销，缺关系、既有打印或付款关联均不能绕过', { timeout: 30000 }, async () => {
  const f = await createSubcontractFixture()
  const native = await createMigratedMemoryDb()
  try {
    const caps = ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import', 'core:migration:write', 'auxiliary-contract:read', 'auxiliary-contract:write', ...['current', 'reimbursement', 'invoice-application', 'payment-application', 'payment-record'].flatMap(family => [`finance-${family}:read`, `finance-${family}:write`])]
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, ...caps] })
    const actor = f.session()
    const common = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY }
    const supplierDraft = JSON.parse((await f.storage.select<{ draft_json: string }>('SELECT draft_json FROM suppliers WHERE id=?', [f.supplier.id]))[0]!.draft_json)
    const supplier = await createProductionSupplierService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'legacy-correction-supplier-tax', id: f.supplier.id, baseVersion: f.supplier.version, action: 'save', attachments: {}, draft: { ...supplierDraft, taxNo: 'CORRECTION-SELLER' } }, f.session, f.supplier.id)
    const company = await createProductionAuxiliaryContractService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'legacy-correction-company', baseVersion: null, action: 'submit', attachments: {}, draft: { kind: 'company_expense', no: 'LEGACY-COMPANY', name: '合成公司支出合同', category: '房租', signDate: '2026-10-07', amount: 100, supplierId: supplier.id, supplierVersion: supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    for (const [id, count] of [['legacy-personal-free', 0], ['legacy-personal-print', 1], ['legacy-personal-paid', 0]] as const) {
      await native.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,buyer,buyer_tax_no,seller,seller_tax_no,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,owner_kind,archived_at,print_count,print_rotation,items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, 'excel', id, '2026-10-07', '合成主体', 'SUBCONTRACT-VERIFICATION', '合成分供方', 'CORRECTION-SELLER', 90, 10, 100, 'done', 'reviewed', 'archived', 'normal', 'personal', '2026-10-07T00:00:00.000Z', count, 0, '[]'])
    }
    await native.execute(`INSERT INTO payment_applications(id,name,biz_type,apply_amount,invoice_state) VALUES('legacy-personal-application','旧付款申请','管理费',20,'先款后票')`)
    await native.execute(`INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount,note) VALUES('legacy-personal-allocation','legacy-personal-application','legacy-personal-paid',20,'旧关联')`)
    const bytes = native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const finance = createProductionFinanceService(f.storage, { references: productionFinanceOwners })
    await finance.importSnapshot({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'legacy-correction-finance-import', source, mappings: [] }, f.session)
    const migration = createProductionInvoiceMigration(f.storage)
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'legacy-correction-invoice-import', source, mappings: { projects: [], suppliers: [], contracts: [] }, confirmed: true }
    const imported = await migration.publish(request, f.session)
    expect(await migration.publish(request, f.session)).toEqual(imported)
    const invoices = createProductionInvoiceService(f.storage)
    const corrections = createProductionInvoiceCorrectionService(f.storage, { invoice: invoices.correctionPort })
    const original = await invoices.get('legacy-personal-free', f.session)
    expect(original).toMatchObject({ sourceKind: 'legacy', ownerKind: 'personal', projectId: null, supplierId: null, contract: null })
    for (const [id, text] of [['legacy-personal-print', '打印历史'], ['legacy-personal-paid', '付款关联']] as const)
      await expect(f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, actor, id, '1'))).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining(text) } })
    const start = await f.storage.withTransaction(tx => readInvoiceCorrectionStart(tx, actor, original.id, original.version))
    expect(start.baseline).toMatchObject({ ownerKind: 'personal', buyer: null, supplierId: null, supplierVersion: null })
    const proposed = { ...start.baseline, ownerKind: 'company' as const, projectId: null, supplierId: supplier.id, supplierVersion: supplier.version, buyer: { id: f.signatory.id, version: f.signatory.version }, contract: null }
    const save = { ...common, action: 'save-draft' as const, commandId: 'legacy-correction-draft', invoiceId: original.id, baseInvoiceVersion: original.version, correctionId: null, baseCorrectionVersion: null, reason: '人工核对真实公司归属', proposed, keepFileIds: [], addFiles: [] }
    const first = await corrections.saveDraft(save, f.session)
    expect(await invoices.get(original.id, f.session)).toEqual(original)
    const submit = { ...common, action: 'submit' as const, commandId: 'legacy-correction-submit-no-contract', invoiceId: original.id, baseInvoiceVersion: original.version, correctionId: first.correctionId, baseCorrectionVersion: first.version, confirmed: true as const }
    await expect(corrections.submit(submit, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await invoices.get(original.id, f.session)).toEqual(original)
    const completed = await corrections.saveDraft({ ...save, commandId: 'legacy-correction-draft-with-contract', correctionId: first.correctionId, baseCorrectionVersion: first.version, proposed: { ...proposed, contract: { domain: 'company', id: company.id, version: company.version } } }, f.session)
    expect(await invoices.get(original.id, f.session)).toEqual(original)
    const confirmed = { ...submit, commandId: 'legacy-correction-submit-valid', baseCorrectionVersion: completed.version }
    const result = await corrections.submit(confirmed, f.session)
    expect(await corrections.submit(confirmed, f.session)).toEqual(result)
    expect(await invoices.get(original.id, f.session)).toMatchObject({ id: original.id, sourceKind: 'legacy', ownerKind: 'company', projectId: null, supplierId: supplier.id, contract: { domain: 'company', id: company.id, version: company.version } })
    expect((await corrections.get(first.correctionId, f.session)).baseline).toMatchObject({ ownerKind: 'personal', supplierId: null, buyer: null })
    const [member] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_legacy_members WHERE invoice_id=?', [original.id])
    expect(JSON.parse(member!.evidence_json)).toMatchObject({ entry: { sourceHead: { owner_kind: 'personal', id: original.id } } })
  }
  finally {
    native.close()
    await f.storage.close()
  }
})
