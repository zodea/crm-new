import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { readInvoiceWorkspaceCatalog } from '../../server/utils/production-invoice-migration-catalog'
import { createProductionInvoiceService, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('旧项目票沿用合同归档时重新核验项目、分供方与购方，保留原迁入回执和事实', async () => {
  const f = await createSubcontractFixture()
  const native = await createMigratedMemoryDb()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] })
    const actor = f.session()
    const supplierDraft = JSON.parse((await f.storage.select<{ draft_json: string }>('SELECT draft_json FROM suppliers WHERE id=?', [f.supplier.id]))[0]!.draft_json)
    const supplier = await createProductionSupplierService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'legacy-archive-supplier-tax', id: f.supplier.id, baseVersion: f.supplier.version, action: 'save', attachments: {}, draft: { ...supplierDraft, taxNo: 'SELLER-TAX' } }, f.session, f.supplier.id)
    const subcontract = await f.service.execute(f.command(), f.session)
    const otherProject = await createProductionProjectService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'project:write', commandId: 'legacy-archive-other-project', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成其他项目', customerId: f.customer.id, manager: '合成负责人' } }, f.session)
    const otherSupplier = await createProductionSupplierService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'legacy-archive-other-supplier', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成其他分供方', supplierCategory: '其他', contact: '合成联系人', contactPhone: '13900000000', taxNo: 'OTHER-SELLER' } }, f.session)
    const otherBuyer = await createProductionOurSignatoryService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'legacy-archive-other-buyer', baseVersion: null, draft: { name: '合成其他我方', taxNo: 'OTHER-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '合成验证', status: 'active' } }, f.session)
    await native.execute('INSERT INTO projects(id,name) VALUES(\'legacy-project\',\'原项目\')')
    await native.execute('INSERT INTO suppliers(id,name) VALUES(\'legacy-supplier\',\'原分供方\')')
    await native.execute('INSERT INTO contracts(id,name,kind,project_id,supplier_id) VALUES(\'legacy-contract\',\'原合同\',\'分包\',\'legacy-project\',\'legacy-supplier\')')
    for (const suffix of ['project', 'supplier', 'buyer', 'valid']) {
      await native.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,buyer_tax_no,seller,seller_tax_no,total_amount,ocr_status,review_status,account_status,dup_status,owner_kind,project_id,supplier_id,contract_id,print_count,print_rotation,items) VALUES(?, 'excel', ?, '2026-01-01',?,'合成销方',?,100,'done','reviewed','none','normal','project','legacy-project','legacy-supplier','legacy-contract',0,0,'[]')`, [`legacy-invoice-${suffix}`, `INVOICE-${suffix}`, suffix === 'buyer' ? 'OTHER-BUYER' : 'SUBCONTRACT-VERIFICATION', suffix === 'supplier' ? 'OTHER-SELLER' : 'SELLER-TAX'])
    }
    const bytes = native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const catalog = await readInvoiceWorkspaceCatalog(f.storage, f.session, ['projects', 'suppliers'])
    const projectRef = catalog.projects.find(item => item.id === f.project.id)!
    const supplierRef = catalog.suppliers.find(item => item.id === supplier.id)!
    const contract = { domain: 'subcontract' as const, id: subcontract.id, version: subcontract.version }
    const mappings = { projects: [{ legacyId: 'legacy-project', targetId: projectRef.id, version: projectRef.version, sourceVersion: projectRef.sourceVersion }], suppliers: [{ legacyId: 'legacy-supplier', targetId: supplierRef.id, version: supplierRef.version, sourceVersion: supplierRef.sourceVersion }], contracts: [{ legacyId: 'legacy-contract', target: contract }] }
    const migration = createProductionInvoiceMigration(f.storage)
    const publish = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'legacy-archive-publish', source, mappings, confirmed: true }
    const published = await migration.publish(publish, f.session)
    const service = createProductionInvoiceService(f.storage)
    const archive = (suffix: string) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'finance-invoice:write', commandId: `legacy-archive-${suffix}`, action: 'archive', invoiceId: `legacy-invoice-${suffix}`, baseVersion: '1', ownerKind: 'project', projectId: f.project.id, supplierId: supplier.id, taxNumbersConfirmed: true, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: supplier.version } })
    const cases = [
      { ...archive('project'), projectId: otherProject.id },
      { ...archive('supplier'), supplierId: otherSupplier.id, taxVerification: { ...archive('supplier').taxVerification, supplierVersion: otherSupplier.version } },
      { ...archive('buyer'), taxVerification: { ...archive('buyer').taxVerification, buyerId: otherBuyer.id, buyerVersion: otherBuyer.version } },
    ]
    const outcomes = await Promise.all(cases.map(async (request) => {
      try {
        await service.execute(request, f.session)
        return { status: 'fulfilled' }
      }
      catch (error) { return { status: 'rejected', error } }
    }))
    expect(outcomes).toEqual(cases.map(() => ({ status: 'rejected', error: expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed', message: expect.stringContaining('不一致') }) }) })))
    for (const request of cases) {
      expect(await service.get(request.invoiceId, f.session)).toMatchObject({ accountStatus: 'none', version: '1', projectId: f.project.id, supplierId: supplier.id, contract })
      expect(await f.storage.select('SELECT command_id FROM invoice_command_receipts WHERE command_id=?', [request.commandId])).toEqual([])
    }
    const noContractRead = () => ({ ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'subcontract-contract:read') })
    await expect(service.execute({ ...archive('valid'), commandId: 'legacy-archive-forbidden' }, noContractRead)).rejects.toMatchObject({ problem: { code: 'forbidden', message: '当前身份无发票关联合同读取权限。' } })
    expect(await service.get('legacy-invoice-valid', f.session)).toMatchObject({ accountStatus: 'none', version: '1', contract })
    const saved = await service.execute(archive('valid'), f.session)
    expect(await service.execute(archive('valid'), f.session)).toEqual(saved)
    expect(await migration.publish(publish, f.session)).toEqual(published)
    expect(await service.get('legacy-invoice-valid', f.session)).toMatchObject({ accountStatus: 'archived', contract })
    const [member] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_legacy_members WHERE invoice_id=?', ['legacy-invoice-valid'])
    expect(JSON.parse(member!.evidence_json)).toMatchObject({ entry: { sourceHead: { contract_id: 'legacy-contract', account_status: 'none' } } })
    await expect(validateProductionInvoiceJournal(f.storage, actor)).resolves.toBeUndefined()
  }
  finally {
    native.close()
    await f.storage.close()
  }
})
