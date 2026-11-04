import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { createCentralInvoiceHttp } from '../../app/lib/invoice/central-http'
import { createCentralInvoiceSession } from '../../app/lib/invoice/central-session'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createLocalBackup, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { verifyInvoiceCompanyArchiveReference } from '../../server/utils/production-invoice-contracts'
import { readInvoiceWorkspaceCatalog } from '../../server/utils/production-invoice-migration-catalog'
import { createProductionInvoiceService, listProductionInvoiceReferences, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('公司发票目录和归档核验读取正式合同、分供方及我方主体身份', async () => {
  const f = await createSubcontractFixture()
  let closed = false
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write', 'auxiliary-contract:read', 'auxiliary-contract:write'] })
    const supplierService = createProductionSupplierService(f.storage)
    const supplierForm = await supplierService.form(f.supplier.id, f.session)
    const supplier = await supplierService.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, action: 'save', commandId: 'invoice-supplier-tax', id: f.supplier.id, requiredCapability: 'supplier:write', baseVersion: supplierForm.version, attachments: {}, draft: { ...supplierForm.draft, taxNo: 'SYNTHETIC-SELLER-TAX' } }, f.session, f.supplier.id)
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const saved = await auxiliary.execute({
      workspaceId: f.session().workspaceId,
      actorId: f.session().actorId,
      requiredCapability: 'auxiliary-contract:write',
      commandId: 'invoice-company-contract',
      baseVersion: null,
      action: 'draft',
      constructionMain: undefined,
      draft: { kind: 'company_expense', name: '合成公司支出合同', no: 'SYNTHETIC-COMPANY', category: '房租', supplierId: f.supplier.id, supplierVersion: supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version },
      attachments: {},
    }, f.session)
    const reference = { domain: 'company' as const, id: saved.id, version: saved.version }
    const catalog = await readInvoiceWorkspaceCatalog(f.storage, f.session, ['company'])
    expect(catalog.sources).toMatchObject([{ key: 'company', state: 'readable' }])
    expect(catalog.contracts).toMatchObject([{ ...reference, projectId: null, supplierId: f.supplier.id }])
    await expect(f.storage.withTransaction(tx => verifyInvoiceCompanyArchiveReference(tx, f.session(), reference, f.supplier.id, f.signatory.id))).resolves.toMatchObject({ id: saved.id, supplierId: f.supplier.id, ourSignatoryId: f.signatory.id })
    await expect(f.storage.withTransaction(tx => verifyInvoiceCompanyArchiveReference(tx, f.session(), reference, 'other-supplier', f.signatory.id))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.storage.withTransaction(tx => verifyInvoiceCompanyArchiveReference(tx, f.session(), { ...reference, version: String(Number(reference.version) + 1) }, f.supplier.id, f.signatory.id))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const withoutPermission = { ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'auxiliary-contract:read') }
    await expect(f.storage.withTransaction(tx => verifyInvoiceCompanyArchiveReference(tx, withoutPermission, reference, f.supplier.id, f.signatory.id))).rejects.toMatchObject({ problem: { code: 'forbidden' } })

    const invoice = createProductionInvoiceService(f.storage)
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
    const base = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'finance-invoice:write' as const }
    const created = await invoice.execute({ ...base, action: 'upload', commandId: 'company-invoice-upload', baseVersion: null, ownerKind: 'company', projectId: null, original: { fileName: '合成.png', fileSize: bytes.length, mimeType: 'image/png', contentBase64: bytes.toString('base64') } }, f.session)
    const fields = { invoiceNumber: '77881234', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'SUBCONTRACT-VERIFICATION', seller: '合成销方', sellerTaxNo: 'SYNTHETIC-SELLER-TAX', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }
    const edited = await invoice.execute({ ...base, action: 'edit', commandId: 'company-invoice-edit', invoiceId: created.invoiceId, baseVersion: created.version, fields, items: [] }, f.session)
    const reviewed = await invoice.execute({ ...base, action: 'review', commandId: 'company-invoice-review', invoiceId: created.invoiceId, baseVersion: edited.version, manualCompletion: true }, f.session)
    const archive = { ...base, action: 'archive' as const, commandId: 'company-invoice-archive', invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'company' as const, projectId: null, supplierId: f.supplier.id, taxNumbersConfirmed: true as const, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: supplier.version }, contract: reference }
    await expect(invoice.execute({ ...archive, contract: { ...reference, version: String(Number(reference.version) + 1) } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(invoice.execute(archive, () => withoutPermission)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const client = createCentralInvoiceHttp(async (url, options) => url.endsWith('/resolve') ? invoice.resolve(String((options?.body as { commandId: string }).commandId), f.session) : invoice.getRead(created.invoiceId, f.session), f.session())
    const remembered = new Map<string, string>()
    const storage = () => ({
      getItem: (key: string) => remembered.get(key) ?? null,
      setItem: (key: string, value: string) => { remembered.set(key, value) },
      removeItem: (key: string) => { remembered.delete(key) },
    })
    const uncertain = createCentralInvoiceSession({ identity: f.session(), targetId: created.invoiceId, repository: { ...client, execute: async (request) => {
      await invoice.execute(request, f.session)
      throw new Error('合成响应丢失')
    } }, context: async () => f.session(), storage })
    await expect(uncertain.submit(archive)).rejects.toThrow('合成响应丢失')
    expect(uncertain.pending()?.commandId).toBe(archive.commandId)
    const recovered = await createCentralInvoiceSession({ identity: f.session(), targetId: created.invoiceId, repository: client, context: async () => f.session(), storage }).recover()
    expect(recovered).toMatchObject({ outcome: 'applied', read: { record: { ownerKind: 'company', contract: reference } } })
    expect(remembered.size).toBe(0)
    const archived = recovered!.outcome === 'applied' ? recovered!.result : null
    expect(await invoice.execute(archive, f.session)).toEqual(archived)
    expect(await invoice.get(created.invoiceId, f.session)).toMatchObject({ ownerKind: 'company', projectId: null, supplierId: f.supplier.id, contract: reference, accountStatus: 'archived' })
    expect(await listProductionInvoiceReferences(f.storage, f.session(), created.invoiceId)).toMatchObject([{ id: created.invoiceId, owner_kind: 'company', project_id: null }])
    expect((await client.get(created.invoiceId)).record).toMatchObject({ ownerKind: 'company', projectId: null, contract: reference })
    const manualFields = { ...fields, invoiceNumber: 'MANUAL-COMPANY-001' }
    const manual = await invoice.execute({ ...base, action: 'manual', commandId: 'manual-company-create', baseVersion: null, fields: manualFields, items: [] }, f.session)
    const manualReviewed = await invoice.execute({ ...base, action: 'review', commandId: 'manual-company-review', invoiceId: manual.invoiceId, baseVersion: manual.version, manualCompletion: true }, f.session)
    const manualArchive = { ...archive, commandId: 'manual-company-archive', invoiceId: manual.invoiceId, baseVersion: manualReviewed.version }
    const { contract: _contract, ...withoutContract } = manualArchive
    await expect(invoice.execute(withoutContract, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('公司合同') } })
    await expect(invoice.execute({ ...manualArchive, contract: { ...reference, version: String(Number(reference.version) + 1) } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(invoice.execute(manualArchive, () => withoutPermission)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const manualArchived = await invoice.execute(manualArchive, f.session)
    expect(await invoice.execute(manualArchive, f.session)).toEqual(manualArchived)
    expect(await invoice.get(manual.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', ownerKind: 'company', projectId: null, supplierId: supplier.id, contract: reference, accountStatus: 'archived' })
    const projectUpload = await invoice.execute({ ...base, action: 'upload', commandId: 'project-to-company-upload', baseVersion: null, projectId: f.project.id, original: { fileName: '合成项目.png', fileSize: bytes.length, mimeType: 'image/png', contentBase64: bytes.toString('base64') } }, f.session)
    const projectEdit = await invoice.execute({ ...base, action: 'edit', commandId: 'project-to-company-edit', invoiceId: projectUpload.invoiceId, baseVersion: projectUpload.version, fields: { ...fields, invoiceNumber: 'PROJECT-COMPANY-001' }, items: [] }, f.session)
    const projectReview = await invoice.execute({ ...base, action: 'review', commandId: 'project-to-company-review', invoiceId: projectUpload.invoiceId, baseVersion: projectEdit.version, manualCompletion: true }, f.session)
    await expect(invoice.execute({ ...manualArchive, commandId: 'project-to-company-archive', invoiceId: projectUpload.invoiceId, baseVersion: projectReview.version }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '已选择项目的上传发票须按项目归档。' } })
    await expect(validateProductionInvoiceJournal(f.storage, f.session())).resolves.toBeUndefined()
    const backupDirectory = join(f.options.directory, 'synthetic-backup')
    const restoreDirectory = join(f.options.directory, 'synthetic-restore')
    await Promise.all([mkdir(backupDirectory), mkdir(restoreDirectory)])
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restore = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'company-invoice-restore')
    const restoredStorage = createProductionStorage({ ...f.options, directory: restore.directory })
    try {
      const restoredService = createProductionInvoiceService(restoredStorage)
      expect(await restoredService.execute(archive, f.session)).toEqual(archived)
      expect(await restoredService.get(created.invoiceId, f.session)).toMatchObject({ ownerKind: 'company', contract: reference, accountStatus: 'archived' })
      expect(await restoredService.execute(manualArchive, f.session)).toEqual(manualArchived)
      expect(await restoredService.get(manual.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', ownerKind: 'company', contract: reference, accountStatus: 'archived' })
      expect(Buffer.from((await restoredService.original(created.invoiceId, created.originalId!, f.session)).bytes)).toEqual(bytes)
      await expect(validateProductionInvoiceJournal(restoredStorage, f.session())).resolves.toBeUndefined()
    }
    finally { await restoredStorage.close() }
    await f.storage.close()
    closed = true
    const script = `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1], { readOnly: true });
      try { const head = db.prepare('SELECT owner_kind,project_id,supplier_id,contract_domain,contract_id,contract_version FROM invoices WHERE id=?').get(process.argv[2]);
        const receipt = db.prepare('SELECT result_json FROM invoice_command_receipts WHERE command_id=?').get(process.argv[3]);
        const manual = db.prepare('SELECT source_kind,owner_kind,project_id,contract_id FROM invoices WHERE id=?').get(process.argv[4]);
        const manualReceipt = db.prepare('SELECT result_json FROM invoice_command_receipts WHERE command_id=?').get(process.argv[5]);
        process.stdout.write(JSON.stringify({ integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, head, receipt: JSON.parse(receipt.result_json), manual, manualReceipt: JSON.parse(manualReceipt.result_json) }));
      } finally { db.close(); }`
    const coldOutput = JSON.parse(execFileSync(process.execPath, ['-e', script, join(f.options.directory, 'ruihang.sqlite'), created.invoiceId, archive.commandId, manual.invoiceId, manualArchive.commandId], { encoding: 'utf8', windowsHide: true }))
    expect(coldOutput).toMatchObject({ integrity: 'ok', head: { owner_kind: 'company', project_id: null, supplier_id: f.supplier.id, contract_domain: 'company', contract_id: reference.id, contract_version: reference.version }, receipt: archived, manual: { source_kind: 'manual', owner_kind: 'company', project_id: null, contract_id: reference.id }, manualReceipt: manualArchived })
    const reopened = createProductionStorage(f.options)
    try {
      const cold = createProductionInvoiceService(reopened)
      expect(await cold.execute(archive, f.session)).toEqual(archived)
      expect(await cold.get(created.invoiceId, f.session)).toMatchObject({ ownerKind: 'company', contract: reference, accountStatus: 'archived' })
      expect(await cold.execute(manualArchive, f.session)).toEqual(manualArchived)
      expect(await cold.get(manual.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', ownerKind: 'company', contract: reference, accountStatus: 'archived' })
      await expect(validateProductionInvoiceJournal(reopened, f.session())).resolves.toBeUndefined()
    }
    finally { await reopened.close() }
  }
  finally {
    if (!closed)
      await f.storage.close()
  }
})
