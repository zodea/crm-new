import type { CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import type { TestDb } from '../helpers/memory-db'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '../../app/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'
import { OTHER_SETTLEMENT_SOURCE_SQL, otherSettlementSourceEntity } from '../../app/lib/migration/other-settlement-source'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createOtherSettlementInstance } from '../../server/utils/other-settlement-instance'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

describe('aX05 结算迁移来源', () => {
  const databases: Array<TestDb> = []
  afterEach(() => databases.splice(0).forEach(db => db.close()))
  it('试跑即阻断错类型合同，不能留到确认阶段才报错', async () => {
    const unsigned = { contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: CORE_MIGRATION_SOURCE_VERSION, entities: { ...Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(key => [key, []])), projects: [{ legacyId: 'p', name: '项目' }], suppliers: [{ legacyId: 's', name: '单位' }], auxiliary_contracts: [{ legacyId: 'company:c', name: '公司合同', attributes: { kind: 'company_expense', status: '履约中' } }], other_settlements: [{ legacyId: 'js', name: '结算', amount: '100.00', references: { projectId: 'p', supplierId: 's', contractId: 'company:c' }, attributes: { status: 'confirmed' } }] } } as Omit<CoreMigrationSourceDTO, 'sourceHash'>
    const source = { ...unsigned, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(unsigned)).digest('hex') }
    const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: [CORE_MIGRATION_CAPABILITY] }
    const envelope = { ...session, requiredCapability: CORE_MIGRATION_CAPABILITY }
    const service = createCoreMigrationTestInstance()
    await service.preflight({ ...envelope, commandId: 'preflight-331', source, backup: null }, session)
    const batch = await service.dryRun({ ...envelope, commandId: 'dry-331', source, backup: { backupId: `core-migration-${source.sourceHash}-${'b'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: '2026-09-08T01:00:00.000Z', immutable: true } }, session)
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'other_settlements', metricKey: 'missing-relation' }))
    await expect(service.importBatch({ ...envelope, commandId: 'import-331', batchId: batch.batchId }, session)).rejects.toThrow()
  })
  it.each(['project', 'inspection', 'owner_notice', 'acceptance'])('%s 来源：完整迁移统一结算与真实罚扣、申请和支付源单', async (penaltyOrigin) => {
    const db = await createMigratedMemoryDb()
    databases.push(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p', '项目')`)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s', '检测单位')`)
    await db.execute(`INSERT INTO contracts (id, name, kind, project_id, supplier_id, status) VALUES ('c', '检测合同', '其他支出', 'p', 's', '已签订')`)
    await db.execute(`INSERT INTO expenditure_settlements (id, name, biz_type, project_id, supplier_id, contract_id, total_amount, settlement_date, status) VALUES ('js', '检测结算', '其他', 'p', 's', 'c', 1060, '2026-09-06', 'confirmed')`)
    const rows = await db.select<Record<string, unknown>>(OTHER_SETTLEMENT_SOURCE_SQL)
    expect(rows.map(otherSettlementSourceEntity)).toEqual([expect.objectContaining({ legacyId: 'js', amount: '1060.00', references: { projectId: 'p', supplierId: 's', contractId: 'other_expense:c' }, attributes: expect.objectContaining({ createdBy: null, factsJson: '[]' }) })])
    await db.execute(`INSERT INTO penalty_records (id, projectId, supplier_id, contract_id, reason, amount, status) VALUES ('penalty', 'p', 's', 'c', '质量抵扣', 60, 'deducted')`)
    await db.execute(`UPDATE penalty_records SET source = ? WHERE id = 'penalty'`, [penaltyOrigin])
    await db.execute(`INSERT INTO penalty_settlement_deductions (id, penalty_id, settlement_id, amount) VALUES ('deduction', 'penalty', 'js', 60)`)
    await db.execute(`INSERT INTO payment_applications (id, name, project_id, supplier_id, contract_id, apply_amount, approved_amount, status) VALUES ('application', '申请', 'p', 's', 'c', 1000, 800, 'approved')`)
    await db.execute(`INSERT INTO payment_application_settlement_allocations (id, payment_application_id, settlement_id, allocated_amount) VALUES ('app-allocation', 'application', 'js', 800)`)
    await db.execute(`INSERT INTO payment_records (id, amount, payment_date, payee_name, voucher_no, bank_serial_no, confirmed_by, confirmed_at) VALUES ('payment', 300, '2026-09-01', '合成单位', 'PZ-331', 'LS-331', 'actor', '2026-09-01T00:00:00Z')`)
    await db.execute(`INSERT INTO payment_record_application_allocations (id, payment_record_id, payment_application_id, allocated_amount) VALUES ('paid-allocation', 'payment', 'application', 300)`)
    await db.execute(`UPDATE payment_records SET confirmation_status = 'confirmed' WHERE id = 'payment'`)
    const imported = otherSettlementSourceEntity((await db.select<Record<string, unknown>>(OTHER_SETTLEMENT_SOURCE_SQL))[0]!)
    const facts = JSON.parse(String(imported.attributes!.factsJson))
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deduction', kind: 'penalty', amount: '60.00', effective: 1 }),
      expect.objectContaining({ id: 'app-allocation', kind: 'application', amount: '800.00' }),
      expect.objectContaining({ sourceId: 'payment', parentId: 'application', kind: 'payment', amount: '300.00', attribution: 'exact' }),
    ]))
    const source = await createCoreMigrationLocalSource({ isNative: () => false, isDemoActive: () => false, currentSchemaVersion: async () => 47, select: sql => db.select(sql) } as Parameters<typeof createCoreMigrationLocalSource>[0]).readSource()
    expect(source.entities.owner_documents).toContainEqual(expect.objectContaining({ legacyId: 'penalty' }))
    const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: [CORE_MIGRATION_CAPABILITY, 'auxiliary-contract:read', 'auxiliary-contract:write', 'other-settlement:read', 'other-settlement:write'] }
    const contracts = createAuxiliaryContractTestInstance()
    const ownerDocuments = createOwnerCommercialDocumentCommandTestInstance()
    const settlements = createOtherSettlementInstance({ identities: () => contracts.otherSettlementContext(session), penalties: () => ownerDocuments.rows() })
    const synchronize = (snapshot: Parameters<typeof settlements.prepareMigrationSnapshot>[0]) => {
      const commits = [contracts.prepareMigrationSnapshot(snapshot), settlements.prepareMigrationSnapshot(snapshot), ownerDocuments.prepareMigrationSnapshot(snapshot)]
      commits.forEach(commit => commit())
    }
    const migration = createCoreMigrationTestInstance({ afterConfirm: synchronize, afterRollback: synchronize })
    const envelope = { ...session, requiredCapability: CORE_MIGRATION_CAPABILITY }
    await migration.preflight({ ...envelope, commandId: 'preflight', source, backup: null }, session)
    const batch = await migration.dryRun({ ...envelope, commandId: 'dry-run', source, backup: { backupId: `core-migration-${source.sourceHash}-${'b'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: '2026-09-08T01:00:00.000Z', immutable: true } }, session)
    expect(batch.issues).toEqual([])
    await migration.importBatch({ ...envelope, commandId: 'import', batchId: batch.batchId }, session)
    expect(settlements.list({}, session).pagination.total).toBe(0)
    await migration.confirm({ ...envelope, commandId: 'confirm', batchId: batch.batchId }, session)
    const row = settlements.list({}, session).items[0]!
    expect(row.id).not.toBe('js')
    expect(row.contract.state).toBe('resolved')
    expect(row.amounts).toMatchObject({ total: '1060.00', deductions: '60.00', net: '1000.00', applied: '800.00', paid: '300.00', applicable: '200.00', unpaid: '700.00' })
    expect(settlements.detail(row.id, {}, session).facts!.every(f => f.settlementId === row.id && f.contractId === row.contract.id)).toBe(true)
    for (const fact of settlements.detail(row.id, {}, session).facts!) {
      expect(fact.sourceId).toMatch(/^core-/)
      const document = settlements.source(row.id, fact.id, session)
      expect(document.id).toBe(fact.sourceId)
      expect(document.kind).toBe(fact.kind)
      if (fact.kind === 'penalty')
        expect(document.fields.find(f => f.label === '罚扣来源')?.value).toBe(({ project: '项目罚扣', inspection: '巡检', owner_notice: '甲方通知', acceptance: '验收' } as Record<string, string>)[penaltyOrigin])
      expect(document.allocations.some(a => a.targetId === (fact.kind === 'payment' ? fact.parentId : row.id))).toBe(true)
    }
    expect(() => settlements.source(row.id, 'unrelated-source', session)).toThrow()
    ownerDocuments.reset()
    expect(settlements.detail(row.id, {}, session).settlement.amounts.deductions).toBeNull()
    await migration.rollback({ ...envelope, commandId: 'rollback', batchId: batch.batchId }, session)
    expect(settlements.list({}, session).pagination.total).toBe(0)
  })
  it('确认后才接管中央稳定身份，回滚撤销；错误类型关系拒绝接管', () => {
    const instance = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p', label: '项目' }], suppliers: [{ id: 's', label: '分供方' }], contracts: [{ id: 'c', kind: 'other_expense', name: '合同', projectId: 'p', supplierId: 's', status: '已签订', amount: '100.00', changedAmount: '100.00' }] }) })
    const entity = { id: 'central-js', entityType: 'other_settlements' as const, legacyId: 'js', name: '迁入结算', references: { projectId: 'p', supplierId: 's', contractId: 'c' }, amount: '0.00', quantity: null, deletedAt: null, attributes: { status: 'confirmed', factsJson: '[]' } }
    const contract = { ...entity, id: 'c', entityType: 'auxiliary_contracts' as const, attributes: { kind: 'other_expense', status: '已签订' } }
    const snapshot = { authority: 'central' as const, activeBatchId: 'batch', entities: [contract, entity] }
    const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['other-settlement:read'] }
    const commit = instance.prepareMigrationSnapshot(snapshot)
    expect(instance.list({}, session).pagination.total).toBe(0)
    commit()
    expect(instance.detail(entity.id, {}, session).settlement.amounts.total).toBe('0.00')
    expect(() => instance.prepareMigrationSnapshot({ ...snapshot, entities: [{ ...contract, attributes: { ...contract.attributes, kind: 'company_expense' } }, entity] })).toThrow()
    instance.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })()
    expect(instance.list({}, session).pagination.total).toBe(0)
  })
})
