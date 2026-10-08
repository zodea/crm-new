import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { OTHER_SETTLEMENT_SCHEMA } from '~/lib/other-settlement/schema'
import { otherSettlementFingerprint, otherSettlementKey } from '~/lib/other-settlement/storage'
import { decodeOtherSettlementCommand } from '~/lib/other-settlement/validation'
import { createOtherSettlementInstance } from '../../server/utils/other-settlement-instance'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { readOriginalExpenseReference } from '../../server/utils/production-finance-expense-references'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementMigration, validateOtherSettlementImportEvidence } from '../../server/utils/production-other-settlement-migration'
import { createProductionOtherSettlementService, listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { adoptHistoricalExpenseFixture } from '../helpers/other-settlement-pay08-source'

async function fixture() {
  const root = resolve('.tmp/a02-material-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'other-native-import-'))
  const sourcePath = join(directory, 'synthetic-source.sqlite')
  const raw = new DatabaseSync(sourcePath)
  const actor = { workspaceId: 'other-import-workspace', actorId: 'other-import-owner', capabilities: ['other-settlement:read', 'other-settlement:write', 'core:migration:write', 'project:list:read', 'supplier:list:read', 'supplier:write'] }
  raw.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(60);
CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT);INSERT INTO suppliers VALUES('native-service','原服务交易方');
CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);
CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),encoding TEXT,content TEXT);
CREATE TABLE operation_logs(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operator TEXT,detail TEXT);
${OTHER_SETTLEMENT_SCHEMA}`)
  raw.exec('INSERT INTO expenditure_settlements(id,name,supplier_id,total_amount,tax_rate,status,created_by,updated_by) VALUES(\'native-zero\',\'原真实零结算\',\'native-service\',0,NULL,\'confirmed\',\'原操作者\',\'原更新人\'); INSERT INTO expenditure_settlements(id,name,total_amount,status) VALUES(\'native-unknown\',\'原未知结算\',NULL,\'draft\'); INSERT INTO operation_logs VALUES(\'raw-audit\',\'expenditure_settlements\',\'native-zero\',\'原操作者\',\'原审计原文\');')
  raw.prepare('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run('raw-file', 'expenditure_settlement', 'native-zero', '原历史.bin', 'D:/original/raw-history.bin', 4, 'application/octet-stream', '原类别', '原上传者', '2026-10-01T01:00:00.000Z')
  const originalBytes = Buffer.from([0, 10, 128, 255])
  const digest = createHash('sha256').update(originalBytes).digest('hex')
  raw.prepare('INSERT INTO file_payloads VALUES(?,?,?)').run('raw-file', 'base64', originalBytes.toString('base64'))
  raw.prepare('INSERT INTO other_settlement_files VALUES(?,?,?)').run('raw-file', 'native-zero', digest)
  raw.prepare('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run('raw-metadata', 'expenditure_settlement', 'native-zero', '仅有历史登记.bin', '', 7, 'application/octet-stream', '旧登记', '原上传者', '2026-10-01T01:00:00.000Z')
  raw.prepare('INSERT INTO other_settlement_resolutions VALUES(?,?,?,?,?)').run(otherSettlementKey('source-business-key', actor), 'source-business-key', actor.workspaceId, actor.actorId, '2026-10-01T00:00:00.000Z')
  raw.prepare('INSERT INTO other_settlement_imports VALUES(?,?,?,?,NULL,NULL,NULL,NULL,NULL,?)').run(JSON.stringify([actor.workspaceId, actor.actorId, 'other-settlement-import', 'source-import-key']), 'source-import-key', actor.workspaceId, actor.actorId, '2026-10-01T00:00:00.000Z')
  raw.close()
  const bytes = await readFile(sourcePath)
  const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
  const targetPath = join(directory, 'target')
  await mkdir(targetPath)
  const storage = createProductionStorage({ directory: targetPath, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  const session = () => structuredClone(actor)
  const supplier = await createProductionSupplierService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'actual-service', action: 'save', baseVersion: null, draft: { name: '实际服务主档', supplierCategory: '其他', contact: '合成人' }, attachments: {} }, session)
  const migration = createProductionOtherSettlementMigration(storage)
  const preview = await migration.previewSnapshot(source, session)
  const candidate = preview.candidates.find(row => row.serverId === supplier.id)!
  const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'actual-import-key', source, mappings: [{ entityType: 'suppliers' as const, legacyId: 'native-service', targetId: supplier.id, version: candidate.version, sourceVersion: candidate.sourceVersion, reason: '实际原件逐条核对' }] }
  return { directory, sourcePath, storage, actor, session, supplier, migration, request, preview, originalBytes }
}
it('完整 Native 结算原图实际跨ID迁入、原审计/0/NULL/原件不改写，原键及冷备份独立核验', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const result = await f.migration.importSnapshot(f.request, f.session)
    expect(result.ids).toEqual(['native-zero', 'native-unknown'])
    expect(await f.migration.importSnapshot(f.request, f.session)).toEqual(result)
    await f.storage.close()
    expect(await f.migration.resolveImport(f.request.commandId, f.session)).toEqual({ outcome: 'applied', result })
    const owner = createProductionOtherSettlementService(f.storage)
    const detail = await owner.detail('native-zero', { origin: 'real' }, f.session)
    expect(detail.settlement.draft).toMatchObject({ supplierId: f.supplier.id, totalAmount: 0, taxRate: null })
    expect(detail.settlement.amounts).toMatchObject({ total: '0.00', net: null, paid: null })
    expect(detail.sourceHistory?.[0]?.rawHead).toMatchObject({ supplier_id: 'native-service', created_by: '原操作者', updated_by: '原更新人', total_amount: 0 })
    expect(detail.sourceHistory?.[0]?.audit).toEqual([expect.objectContaining({ operator: '原操作者', detail: '原审计原文' })])
    expect((await owner.detail('native-unknown', { origin: 'real' }, f.session)).settlement.amounts.total).toBeNull()
    expect(Buffer.from((await owner.original('native-zero', 'raw-file', null, f.session)).payloadBase64, 'base64')).toEqual(f.originalBytes)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM other_settlement_commands')).toEqual([{ n: 0 }])
    const backup = join(f.directory, 'cold-backup.sqlite')
    await f.storage.backupTo(backup)
    expect((await inspectProductionBackup(backup)).participants['other-settlements']?.tables).toContain('other_settlement_imports')
    await f.storage.withTransaction(tx => validateOtherSettlementImportEvidence(tx, f.storage.identity))
    const raw = new DatabaseSync(f.sourcePath, { readOnly: true })
    try {
      expect(raw.prepare('SELECT total_amount,supplier_id,created_by FROM expenditure_settlements WHERE id=?').get('native-zero')).toEqual({ total_amount: 0, supplier_id: 'native-service', created_by: '原操作者' })
    }
    finally {
      raw.close()
    }
  }
  finally {
    await f.storage.close()
  }
})
it('坏摘要、遗漏映射、来源与目标版本变化均原子拒绝，未知原键封存挡迟到写', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    await expect(f.migration.importSnapshot({ ...f.request, source: { ...f.request.source, sha256: 'f'.repeat(64) } }, f.session)).rejects.toThrow('摘要')
    await expect(f.migration.importSnapshot({ ...f.request, mappings: [] }, f.session)).rejects.toThrow('每条实际主档')
    await expect(f.migration.importSnapshot({ ...f.request, mappings: f.request.mappings.map(row => ({ ...row, version: '999' })) }, f.session)).rejects.toThrow('版本变化')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM expenditure_settlements')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM file_refs')).toEqual([{ n: 0 }])
    expect(await f.migration.resolveImport(f.request.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: f.request.commandId })
    await expect(f.migration.importSnapshot(f.request, f.session)).rejects.toThrow('迟到请求')
  }
  finally {
    await f.storage.close()
  }
})
it('原 Native 同名作用域回执只读封存，不授权中央新提交、恢复或历史再迁入', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    await f.migration.importSnapshot(f.request, f.session)
    const owner = createProductionOtherSettlementService(f.storage)
    await expect(owner.resolve('source-business-key', f.session)).rejects.toThrow('来源的历史命令')
    await expect(f.migration.resolveImport('source-import-key', f.session)).rejects.toThrow('来源的历史命令')
    await expect(f.migration.importSnapshot({ ...f.request, commandId: 'source-import-key' }, f.session)).rejects.toThrow('来源的历史命令')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM other_settlement_resolutions')).toEqual([{ n: 0 }])
    expect((await f.migration.imports(f.session)).records).toHaveLength(1)
  }
  finally {
    await f.storage.close()
  }
})
it.each([{ existingAmount: 0, deleted: false, retained: false, alias: false }, { existingAmount: 40, deleted: false, retained: false, alias: false }, { existingAmount: 40, deleted: true, retained: false, alias: false }, { existingAmount: 0, deleted: false, retained: true, alias: false }, { existingAmount: 40, deleted: false, retained: false, alias: true }])('现代 Native60 原采用行保ID和历史；实际采用/删除/别名/未接来源%j同事务核验新申请资格', { timeout: 15000 }, async ({ existingAmount, deleted, retained, alias }) => {
  const f = await fixture()
  try {
    f.actor.capabilities.push('finance-reimbursement:read', 'finance-reimbursement:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write')
    const finance = createProductionFinanceService(f.storage, { references: (tx, actor) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, actor, id), settlementCandidates: () => listProductionOtherSettlementReferences(tx, actor) }) })
    const expense = await adoptHistoricalExpenseFixture(f.storage, f.actor, { directory: f.directory, serviceId: f.supplier.id, payeeId: f.supplier.id, serviceName: '实际服务主档', payeeName: '实际服务主档', prefix: 'modern-native-original' })
    const expenseForm = await finance.form('reimbursement', expense.id, f.session)
    const current = await f.storage.withTransaction(tx => readOriginalExpenseReference(tx, f.actor, expenseForm.draft.lines[0]!.id))
    const owner = createProductionOtherSettlementService(f.storage)
    let existingSettlementId: string | null = null
    if (existingAmount) {
      const existingRequest = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'existing-actual-adoption', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '中央已确认采用', projectId: null, contractId: null, totalAmount: existingAmount, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: current!.id, sourceVersion: current!.version, sourceRevision: current!.sourceRevision, amount: existingAmount }] } }
      const existing = await owner.execute(existingRequest, f.session)
      existingSettlementId = existing.id
      await owner.execute({ ...existingRequest, id: existing.id, baseVersion: existing.version, action: 'confirm', commandId: 'existing-actual-confirm' }, f.session)
      const application = await finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-application:write', commandId: 'existing-actual-application', kind: 'payment_application', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '实际既有申请', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: existingAmount, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票', settlementAllocations: [{ settlementId: existing.id, allocatedAmount: existingAmount }] } }, f.session)
      await finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-record:write', commandId: 'existing-actual-cash', kind: 'payment_record', baseVersion: null, action: 'confirm', attachments: {}, draft: { supplierId: f.supplier.id, payeeName: '实际服务主档', amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-EXISTING-VOUCHER', bankSerialNo: 'SYNTHETIC-EXISTING-BANK', confirmedBy: '合成财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] } }, f.session)
    }
    const original = { ...current!, serviceSupplierId: 'native-service', applicantSupplierId: 'native-service' }
    const sourceActor = { workspaceId: 'original-native-workspace', actorId: 'original-native-actor', capabilities: ['other-settlement:read', 'other-settlement:write'] }
    const domain = createOtherSettlementInstance({ identities: () => ({ projects: [], suppliers: [{ id: 'native-service', label: '实际服务主档' }], workers: [], contracts: [] }), originalExpenses: () => [original] })
    const request = { workspaceId: sourceActor.workspaceId, actorId: sourceActor.actorId, requiredCapability: 'other-settlement:write', commandId: 'native-adoption-submit', baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '现代原费用采用', projectId: null, contractId: null, totalAmount: 70, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: original.id, sourceVersion: original.version, sourceRevision: original.sourceRevision, amount: 70 }] } }
    const saved = await domain.execute(request, sourceActor)
    const first = structuredClone(domain.snapshot()[0]!)
    const confirmRequest = { ...request, id: saved.id, baseVersion: '1', commandId: 'native-adoption-confirm', action: 'confirm' as const }
    const confirmed = await domain.execute(confirmRequest, sourceActor)
    const final = domain.snapshot()[0]!
    const raw = new DatabaseSync(f.sourcePath)
    try {
      raw.prepare('INSERT INTO expenditure_settlements(id) VALUES(?)').run(saved.id)
      const d = final.draft
      const a = final.audit
      raw.prepare('UPDATE expenditure_settlements SET no=?,name=?,project_id=?,supplier_id=?,contract_id=?,settlement_type=?,total_amount=?,tax_rate=?,settlement_date=?,settlement_period=?,deduction_note=?,status=?,note=?,created_by=?,updated_by=?,created_at=?,updated_at=?,responsible=?,department=?,payee_supplier_id=?,payee_worker_id=?,payee_name_snapshot=?,version=?,record_json=? WHERE id=?').run(d.no ?? '', d.name ?? '', d.projectId ?? null, d.supplierId ?? null, d.contractId ?? null, d.settlementType ?? '', d.totalAmount ?? null, d.taxRate ?? null, d.settlementDate ?? '', d.period ?? '', d.deductionNote ?? '', 'pending', d.note ?? '', a.createdBy, a.updatedBy, a.createdAt, a.updatedAt, a.responsible, a.department, d.payeeSupplierId ?? null, d.payeeWorkerId ?? null, d.payeeNameSnapshot ?? null, alias ? 0 : final.version, alias ? null : JSON.stringify(final), saved.id)
      raw.prepare('INSERT INTO expenditure_settlement_expense_allocations VALUES(?,?,?,?,?,?,?,?,?,NULL)').run('native-adoption-line', saved.id, original.id, original.version, original.sourceRevision, 70, JSON.stringify(original), confirmed.updatedAt, sourceActor.actorId)
      if (deleted)
        raw.prepare('UPDATE expenditure_settlements SET deleted_at=? WHERE id=?').run('2026-10-05T03:00:00.000Z', saved.id)
      if (retained) {
        raw.exec(`CREATE TABLE payment_applications(id TEXT PRIMARY KEY);
CREATE TABLE payment_application_settlement_allocations(id TEXT PRIMARY KEY,payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id),allocated_amount REAL NOT NULL CHECK(allocated_amount>0),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),deleted_at TEXT);
CREATE TABLE penalty_records(id TEXT PRIMARY KEY,status TEXT);
CREATE TABLE penalty_settlement_deductions(id TEXT PRIMARY KEY,penalty_id TEXT NOT NULL REFERENCES penalty_records(id),settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id),amount REAL NOT NULL CHECK(amount>0),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT(datetime('now')),updated_at TEXT NOT NULL DEFAULT(datetime('now')),deleted_at TEXT);
INSERT INTO payment_applications VALUES('native-source-application');
INSERT INTO penalty_records VALUES('native-source-penalty','executed');`)
        raw.prepare('INSERT INTO payment_application_settlement_allocations(id,payment_application_id,settlement_id,allocated_amount) VALUES(?,?,?,?)').run('native-source-application-line', 'native-source-application', saved.id, 70)
        raw.prepare('INSERT INTO penalty_settlement_deductions(id,penalty_id,settlement_id,amount) VALUES(?,?,?,?)').run('native-source-penalty-line', 'native-source-penalty', saved.id, 5)
      }
      for (const [snapshot, command, result] of alias ? [] : [[first, request, saved], [final, confirmRequest, confirmed]] as const) {
        const persisted = decodeOtherSettlementCommand(command)
        raw.prepare('INSERT INTO other_settlement_history VALUES(?,?,?,?,?,?)').run(saved.id, snapshot.version, JSON.stringify(snapshot), sourceActor.actorId, command.commandId, result.updatedAt)
        raw.prepare('INSERT INTO other_settlement_commands VALUES(?,?,?,?,?,?,?,?)').run(otherSettlementKey(command.commandId, sourceActor), command.commandId, sourceActor.workspaceId, sourceActor.actorId, otherSettlementFingerprint(persisted), JSON.stringify(persisted), JSON.stringify(result), saved.id)
      }
      raw.prepare('UPDATE expenditure_settlements SET status=? WHERE id=?').run(alias ? '已确认' : 'confirmed', saved.id)
    }
    finally {
      raw.close()
    }
    const bytes = await readFile(f.sourcePath)
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
    await f.migration.importSnapshot({ ...f.request, source }, f.session)
    const detail = await owner.detail(saved.id, { origin: 'real' }, f.session)
    expect(detail.settlement.draft.originalExpenses).toEqual(request.draft.originalExpenses)
    expect(detail.settlement.draft).toMatchObject({ supplierId: f.supplier.id, payeeSupplierId: f.supplier.id, payeeNameSnapshot: '实际服务主档' })
    expect(detail.settlement.amounts.net).toBe(existingAmount || retained ? null : '70.00')
    expect(detail.sourceHistory?.[0]?.history).toHaveLength(alias ? 0 : 2)
    expect(detail.sourceHistory?.[0]?.commands).toHaveLength(alias ? 0 : 2)
    expect(detail.sourceHistory?.[0]?.rawHead.status).toBe(alias ? '已确认' : 'confirmed')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM other_settlement_commands WHERE settlement_id=?', [saved.id])).toEqual([{ n: 0 }])
    const applicationRequest = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-application:write', commandId: 'imported-current-application', kind: 'payment_application' as const, baseVersion: null, action: 'submit' as const, attachments: {}, draft: { name: '采用迁入原费用结算', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 70, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票' as const, settlementAllocations: [{ settlementId: saved.id, allocatedAmount: 70 }] } }
    if (deleted || retained) {
      const reason = deleted ? '原结算已删除' : '原申请采用关系'
      expect(detail.settlement.qualificationUnavailableReason).toContain(reason)
      const references = await f.storage.withTransaction(tx => listProductionOtherSettlementReferences(tx, f.actor))
      expect(references.find(row => row.id === saved.id)).toMatchObject({ total_amount: null, deleted_at: deleted ? '2026-10-05T03:00:00.000Z' : null, unavailable_reason: expect.stringContaining(reason) })
      await expect(finance.execute(applicationRequest, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining(reason) } })
      await f.storage.close()
      const reopened = await owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(reopened.settlement.amounts).toMatchObject({ total: '70.00', net: null, paid: retained ? null : '0.00', deductions: retained ? null : '0.00', applied: retained ? null : '0.00' })
      expect(reopened.sourceHistory?.[0]?.rawHead.deleted_at).toBe(deleted ? '2026-10-05T03:00:00.000Z' : null)
      expect(reopened.sourceHistory?.[0]?.history).toHaveLength(2)
      if (retained) {
        expect(reopened.sourceHistory?.[0]?.retained).toMatchObject({ penalty_settlement_deductions: [expect.objectContaining({ id: 'native-source-penalty-line', amount: 5 })], payment_application_settlement_allocations: [expect.objectContaining({ id: 'native-source-application-line', allocated_amount: 70 })] })
      }
      else {
        expect((await owner.detail(existingSettlementId!, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ total: '40.00', net: null, paid: '30.00', unpaid: null })
      }
    }
    else if (existingSettlementId) {
      expect(detail.settlement).toMatchObject({ qualificationUnavailableReason: expect.stringContaining('超过真实原费用上限'), amounts: { total: '70.00', net: null, applicable: null, unpaid: null } })
      const before = await f.storage.select('SELECT * FROM finance_commands ORDER BY command_id')
      for (const settlementId of [saved.id, existingSettlementId]) {
        for (const amount of [10, 70])
          await expect(finance.execute({ ...applicationRequest, commandId: `overlapping-import-${settlementId}-${amount}`, draft: { ...applicationRequest.draft, applyAmount: amount, settlementAllocations: [{ settlementId, allocatedAmount: amount }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('超过真实原费用上限') } })
      }
      expect(await f.storage.select('SELECT * FROM finance_commands ORDER BY command_id')).toEqual(before)
      await f.storage.close()
      expect((await owner.detail(existingSettlementId, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ total: '40.00', net: null, applied: '40.00', paid: '30.00', unpaid: null })
      expect((await owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ total: '70.00', net: null, paid: '0.00' })
      expect(await f.storage.select('SELECT allocated_amount FROM expenditure_settlement_expense_allocations ORDER BY allocated_amount')).toEqual([{ allocated_amount: 40 }, { allocated_amount: 70 }])
    }
    else {
      const application = await finance.execute(applicationRequest, f.session)
      await finance.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'finance-payment-record:write', commandId: 'imported-current-cash', kind: 'payment_record', baseVersion: null, action: 'confirm', attachments: {}, draft: { supplierId: f.supplier.id, payeeName: '实际服务主档', amount: 30, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-IMPORT-VOUCHER', bankSerialNo: 'SYNTHETIC-IMPORT-BANK', confirmedBy: '合成财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] } }, f.session)
      await f.storage.close()
      expect((await owner.detail(saved.id, { origin: 'real' }, f.session)).settlement.amounts).toMatchObject({ net: '70.00', applied: '70.00', paid: '30.00', unpaid: '40.00' })
    }
    if (existingSettlementId) {
      const source = (await owner.expenses(f.session)).items.find(row => row.id === current!.id)!
      const before = await f.storage.select('SELECT * FROM other_settlement_commands ORDER BY scoped_id')
      await expect(owner.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'other-settlement:write', commandId: 'new-adoption-must-count-frozen-native', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '不能重新释放原费用占用', projectId: null, contractId: null, totalAmount: 10, taxRate: null, settlementDate: '2026-10-05', originalExpenses: [{ originalExpenseLineId: source.id, sourceVersion: source.version, sourceRevision: source.sourceRevision, amount: 10 }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('累计已确认') } })
      expect(await f.storage.select('SELECT * FROM other_settlement_commands ORDER BY scoped_id')).toEqual(before)
    }
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, amount: 100 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual(retained ? [{ n: 0, amount: null }] : [{ n: 1, amount: 30 }])
    const backup = join(f.directory, 'modern-damage.sqlite')
    await f.storage.backupTo(backup)
    const damaged = new DatabaseSync(backup)
    try {
      const guard = damaged.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get('other_settlement_confirmed_expense_lock')!.sql as string
      expect(() => damaged.prepare('UPDATE expenditure_settlement_expense_allocations SET allocated_amount=69 WHERE id=?').run('native-adoption-line')).toThrow('immutable')
      damaged.exec('DROP TRIGGER other_settlement_confirmed_expense_lock')
      damaged.prepare('UPDATE expenditure_settlement_expense_allocations SET allocated_amount=69 WHERE id=?').run('native-adoption-line')
      damaged.exec(guard)
      const readOnly = { select: async <T>(sql: string, params: unknown[] = []) => damaged.prepare(sql).all(...params as never[]) as T[], execute: async () => {
        throw new Error('read-only damage verification')
      } }
      await expect(validateOtherSettlementImportEvidence(readOnly, f.storage.identity)).rejects.toThrow('采用行')
    }
    finally {
      damaged.close()
    }
    await expect(inspectProductionBackup(backup)).rejects.toThrow('其他支出结算')
  }
  finally {
    await f.storage.close()
  }
})
it('仅无路径历史元数据可由完整原图证明缺件；原件原存在后被删或外部路径缺字节均拒绝', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    await f.migration.importSnapshot(f.request, f.session)
    expect(await f.storage.withTransaction(tx => validateOtherSettlementImportEvidence(tx, f.storage.identity))).toEqual(new Set(['raw-metadata']))
    const backup = join(f.directory, 'missing-body-damage.sqlite')
    await f.storage.backupTo(backup)
    const raw = new DatabaseSync(backup)
    try {
      const guard = raw.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get('other_settlement_original_bytes_delete')!.sql as string
      raw.exec('DROP TRIGGER other_settlement_original_bytes_delete')
      raw.prepare('DELETE FROM file_payloads WHERE file_ref_id=?').run('raw-file')
      raw.exec(guard)
      const readOnly = { select: async <T>(sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params as never[]) as T[], execute: async () => {
        throw new Error('read-only damage verification')
      } }
      await expect(validateOtherSettlementImportEvidence(readOnly, f.storage.identity)).rejects.toThrow('正文')
    }
    finally {
      raw.close()
    }
    await expect(inspectProductionBackup(backup)).rejects.toThrow('其他支出结算')
    const source = new DatabaseSync(f.sourcePath)
    try {
      const guard = source.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get('other_settlement_original_metadata')!.sql as string
      expect(() => source.prepare('UPDATE file_refs SET file_path=? WHERE id=?').run('D:/external-required.bin', 'raw-metadata')).toThrow('immutable')
      source.exec('DROP TRIGGER other_settlement_original_metadata')
      source.prepare('UPDATE file_refs SET file_path=? WHERE id=?').run('D:/external-required.bin', 'raw-metadata')
      source.exec(guard)
    }
    finally {
      source.close()
    }
    const bytes = await readFile(f.sourcePath)
    await expect(f.migration.previewSnapshot({ sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }, f.session)).rejects.toThrow('外部原件')
  }
  finally {
    await f.storage.close()
  }
})
