import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { withVerifiedMigrationSnapshot } from '../../server/utils/migration-snapshot'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createLocalBackup, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { readInvoiceWorkspaceCatalog } from '../../server/utils/production-invoice-migration-catalog'
import { previewLegacyInvoiceMappings, validateLegacyInvoiceMappings } from '../../server/utils/production-invoice-migration-mapping'
import { prepareLegacyInvoicePlan, validateLegacyInvoiceEntry } from '../../server/utils/production-invoice-migration-plan'
import { readLegacyInvoiceSource } from '../../server/utils/production-invoice-migration-source'
import { createProductionInvoiceService, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('真实公司合同 owner 的同源采用证据与旧发票逐项映射一致', async () => {
  const f = await createSubcontractFixture()
  const native = await createMigratedMemoryDb()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import', 'auxiliary-contract:read', 'auxiliary-contract:write', 'auxiliary-contract:import', 'other-settlement:read'] })
    await native.execute('INSERT INTO company_expense_contracts(id,no,name,category,counterparty) VALUES(\'legacy-company\',\'OLD-COMPANY\',\'合成公司合同\',\'房租\',\'旧对方文字\')')
    await native.execute('INSERT INTO invoices(id,company_expense_contract_id,owner_kind,source,items) VALUES(\'legacy-company-invoice\',\'legacy-company\',\'personal\',\'scan\',\'[]\')')
    await native.execute('INSERT INTO projects(id,name) VALUES(\'legacy-project\',\'合成旧项目\')')
    await native.execute('INSERT INTO invoices(id,project_id,owner_kind,source,items) VALUES(\'legacy-project-invoice\',\'legacy-project\',\'project\',\'scan\',\'[]\')')
    const bytes = native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const adopted = await auxiliary.adopt({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'company-legacy-adopt', source, projects: [], suppliers: [], signatories: [], originals: [] }, f.session)
    const id = adopted.ids[0]!
    const detail = await auxiliary.detail(id, { kind: 'company_expense' }, f.session)
    const updated = await auxiliary.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'company-legacy-identities', id, baseVersion: String(detail.contract.version), action: 'draft', constructionMain: undefined, draft: { ...detail.contract.draft, supplierId: f.supplier.id, supplierVersion: f.supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: {} }, f.session)
    const catalog = await readInvoiceWorkspaceCatalog(f.storage, f.session, ['projects', 'suppliers'])
    const supplier = catalog.suppliers.find(row => row.id === f.supplier.id)!
    const project = catalog.projects.find(item => item.id === f.project.id)!
    const row = { invoiceId: 'legacy-company-invoice', legacyContractId: 'legacy-company', target: { domain: 'company' as const, id, version: updated.version }, supplierId: supplier.id, supplierVersion: supplier.version, supplierSourceVersion: supplier.sourceVersion, buyerId: f.signatory.id, buyerVersion: f.signatory.version }
    const mappings = { projects: [{ legacyId: 'legacy-project', targetId: project.id, version: project.version, sourceVersion: project.sourceVersion }], suppliers: [], contracts: [], companyInvoices: [row] }
    await withVerifiedMigrationSnapshot(source, async (tx, evidence) => {
      const legacy = await readLegacyInvoiceSource(tx, evidence, { inspectCompany: true })
      const mapping = await f.storage.withTransaction(central => validateLegacyInvoiceMappings(central, f.session(), legacy, mappings))
      const plan = prepareLegacyInvoicePlan(legacy, mapping)
      expect(plan.entries[0]).toMatchObject({ supplierId: f.supplier.id, contract: row.target, companyAdoption: row, sourceHead: { owner_kind: 'personal', company_expense_contract_id: 'legacy-company' } })
      expect(validateLegacyInvoiceEntry(plan.entries[0]!).ownerKind).toBe('company')
      await expect(f.storage.withTransaction(central => validateLegacyInvoiceMappings(central, f.session(), { ...legacy, sha256: 'b'.repeat(64) }, mappings))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    })
    await expect(previewLegacyInvoiceMappings(f.storage, { source, mappings }, f.session)).resolves.toMatchObject({ sourceSha256: source.sha256, invoiceCount: 2, missingAllocationIds: [] })
    const candidate = createProductionInvoiceMigration(f.storage)
    const request = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'company-candidate-publish', source, mappings, confirmed: true }
    await expect(candidate.publish({ ...request, commandId: 'company-missing-mapping', mappings: { ...mappings, companyInvoices: [] } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(candidate.publish({ ...request, commandId: 'company-old-wrong-id', mappings: { ...mappings, companyInvoices: [{ ...row, legacyContractId: 'different-company' }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(candidate.publish({ ...request, commandId: 'company-stale-supplier', mappings: { ...mappings, companyInvoices: [{ ...row, supplierVersion: '999' }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(candidate.publish({ ...request, commandId: 'company-stale-buyer', mappings: { ...mappings, companyInvoices: [{ ...row, buyerVersion: '999' }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    let authorityReads = 0
    const changingSession = () => {
      const actor = f.session()
      return ++authorityReads < 3 ? actor : { ...actor, capabilities: actor.capabilities.filter(capability => capability !== 'auxiliary-contract:read') }
    }
    await expect(candidate.publish({ ...request, commandId: 'company-authority-change' }, changingSession)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM invoices WHERE id IN (?,?)', ['legacy-company-invoice', 'legacy-project-invoice'])).toEqual([])
    expect(await f.storage.select('SELECT id FROM invoice_legacy_batches')).toEqual([])
    const published = await candidate.publish(request, f.session)
    expect(await candidate.publish(request, f.session)).toEqual(published)
    expect(await createProductionInvoiceService(f.storage).get('legacy-company-invoice', f.session)).toMatchObject({ ownerKind: 'company', projectId: null, supplierId: f.supplier.id, contract: row.target, sourceKind: 'legacy' })
    await expect(validateProductionInvoiceJournal(f.storage, f.session())).resolves.toBeUndefined()
    const [member] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_legacy_members WHERE invoice_id=?', ['legacy-company-invoice'])
    expect(JSON.parse(member!.evidence_json)).toMatchObject({ entry: { sourceHead: { owner_kind: 'personal', company_expense_contract_id: 'legacy-company' }, companyAdoption: row } })
    const backupDirectory = join(f.options.directory, 'company-migration-backup')
    const restoreDirectory = join(f.options.directory, 'company-migration-restore')
    await Promise.all([mkdir(backupDirectory), mkdir(restoreDirectory)])
    const backup = await createLocalBackup(f.storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'company-migration-restore')
    const restoredStorage = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      const restoredMigration = createProductionInvoiceMigration(restoredStorage)
      const restoredInvoice = createProductionInvoiceService(restoredStorage)
      expect(await restoredMigration.publish(request, f.session)).toEqual(published)
      expect(await restoredInvoice.get('legacy-company-invoice', f.session)).toMatchObject({ ownerKind: 'company', contract: row.target })
      const projectInvoice = await restoredInvoice.get('legacy-project-invoice', f.session)
      await restoredInvoice.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'finance-invoice:write', action: 'edit', commandId: 'company-mixed-later-edit', invoiceId: projectInvoice.id, baseVersion: projectInvoice.version, fields: { ...projectInvoice.fields, remark: '合成后续变更' }, items: projectInvoice.items }, f.session)
      await expect(restoredMigration.retire({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'company-mixed-danger-retire', batchId: published.batchId, confirmed: true }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await restoredStorage.select('SELECT invoice_id FROM invoice_legacy_members WHERE batch_id=?', [published.batchId])).toHaveLength(2)
      await expect(validateProductionInvoiceJournal(restoredStorage, f.session())).resolves.toBeUndefined()
    }
    finally { await restoredStorage.close() }
    const coldScript = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});
      try { const row=db.prepare('SELECT owner_kind,contract_domain,contract_id FROM invoices WHERE id=?').get('legacy-company-invoice');
        const member=db.prepare('SELECT evidence_json FROM invoice_legacy_members WHERE invoice_id=?').get('legacy-company-invoice');
        process.stdout.write(JSON.stringify({integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,row,source:JSON.parse(member.evidence_json).entry.sourceHead}));
      } finally {db.close()}`
    const cold = JSON.parse(execFileSync(process.execPath, ['-e', coldScript, join(restored.directory, 'ruihang.sqlite')], { encoding: 'utf8', windowsHide: true }))
    expect(cold).toMatchObject({ integrity: 'ok', row: { owner_kind: 'company', contract_domain: 'company', contract_id: id }, source: { owner_kind: 'personal', company_expense_contract_id: 'legacy-company' } })
    const retired = await candidate.retire({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'company-candidate-retire', batchId: published.batchId, confirmed: true }, f.session)
    expect(retired).toMatchObject({ batchId: published.batchId, retired: true })
    await expect(validateProductionInvoiceJournal(f.storage, f.session())).resolves.toBeUndefined()
  }
  finally {
    native.close()
    await f.storage.close()
  }
})
