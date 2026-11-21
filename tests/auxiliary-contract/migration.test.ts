import type { CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../app/lib/db/migrations'
import { AUXILIARY_CONTRACT_SOURCE_SQL, auxiliaryContractSourceEntity, COMPANY_CONTRACT_SOURCE_SQL } from '../../app/lib/migration/auxiliary-contract-source'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_SOURCE_VERSION, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput } from '../../app/lib/migration/core-contract'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createMemoryDb, createMigratedMemoryDb } from '../helpers/memory-db'

const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
describe('aX04 受控迁移', () => {
  const databases: Array<Awaited<ReturnType<typeof createMemoryDb>>> = []
  afterEach(() => databases.splice(0).forEach(db => db.close()))
  it('迁移补齐公司税务审计与明确票款外键，不增加项目字段或推断关联', async () => {
    const db = await createMemoryDb()
    databases.push(db)
    await runMigrations(db)
    const columns = await db.select<{ name: string }>('PRAGMA table_info(company_expense_contracts)')
    expect(columns.map(row => row.name)).toEqual(expect.arrayContaining(['party_a', 'tax_rate', 'invoice_type', 'created_by', 'updated_by']))
    expect(columns.map(row => row.name)).not.toContain('project_id')
    expect(await db.select<{ name: string }>('PRAGMA table_info(invoices)')).toContainEqual(expect.objectContaining({ name: 'company_expense_contract_id' }))
    await db.execute('INSERT INTO company_expense_contracts (id, name) VALUES (\'company\', \'公司合同\')')
    await db.execute('INSERT INTO projects (id, name) VALUES (\'project\', \'真实项目\')')
    await db.execute('INSERT INTO invoices (id, company_expense_contract_id) VALUES (\'invoice\', \'company\')')
    await expect(db.execute('UPDATE invoices SET project_id = \'project\' WHERE id = \'invoice\'')).rejects.toThrow(/company contract/)
    await expect(db.execute('INSERT INTO payment_applications (id, company_expense_contract_id, project_id) VALUES (\'payment\', \'company\', \'project\')')).rejects.toThrow(/company contract/)
  })
  it('迁移准备失败不部分接管；确认接管保留稳定 ID、缺失审计，回滚撤销', () => {
    const instance = createAuxiliaryContractTestInstance()
    const entity = { id: 'central-company-330', entityType: 'auxiliary_contracts' as const, legacyId: 'company_expense:old', name: '旧公司合同', references: {}, amount: '100.00', quantity: null, deletedAt: null, attributes: { kind: 'company_expense', no: 'GS-OLD', category: '房租', counterparty: '出租单位', status: '履约中' } }
    const snapshot = { authority: 'central' as const, activeBatchId: 'batch-330', entities: [entity] }
    const commit = instance.prepareMigrationSnapshot(snapshot)
    expect(() => instance.detail(entity.id, { kind: 'company_expense' }, session)).toThrow(/不存在/)
    commit()
    expect(instance.detail(entity.id, { kind: 'company_expense' }, session).contract).toMatchObject({ id: entity.id, project: null, audit: { createdBy: null, createdAt: null } })
    expect(() => instance.prepareMigrationSnapshot({ ...snapshot, entities: [{ ...entity, attributes: { ...entity.attributes, kind: 'invalid' } }] })).toThrow()
    expect(instance.list({ kind: 'company_expense' }, session).pagination.total).toBe(1)
    instance.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })()
    expect(instance.list({ kind: 'company_expense' }, session).pagination.total).toBe(0)
  })
  it('迁入后的项目被中央身份源移除时不保留过期可用关系', () => {
    let projects = [{ id: 'migrated-project', name: '迁入项目' }]
    const instance = createAuxiliaryContractTestInstance({ identities: () => ({ projects, suppliers: [{ id: 'migrated-supplier', name: '迁入分供方' }] }) })
    const base = { name: '迁入对象', amount: null, quantity: null, deletedAt: null, attributes: {}, references: {} }
    instance.prepareMigrationSnapshot({ authority: 'central', activeBatchId: 'batch-rel', entities: [
      { ...base, id: 'migrated-project', legacyId: 'old-project', entityType: 'projects' },
      { ...base, id: 'migrated-supplier', legacyId: 'old-supplier', entityType: 'suppliers' },
      { ...base, id: 'migrated-contract', legacyId: 'other_expense:old', entityType: 'auxiliary_contracts', references: { projectId: 'migrated-project', supplierId: 'migrated-supplier' }, attributes: { kind: 'other_expense' } },
    ] })()
    expect(instance.detail('migrated-contract', { kind: 'other_expense' }, session).contract.project?.state).toBe('resolved')
    projects = []
    expect(instance.detail('migrated-contract', { kind: 'other_expense' }, session).contract.project?.state).toBe('missing')
    expect(instance.context(session).projects).toEqual([])
  })
  it('从真实 SQLite 表读取公司和项目合同及显式关联事实，旧 ID 按类型隔离', async () => {
    const db = await createMigratedMemoryDb()
    databases.push(db)
    await db.execute('INSERT INTO company_expense_contracts (id, name, category, counterparty) VALUES (\'same-id\', \'公司租赁\', \'房租\', \'出租方\')')
    await db.execute('INSERT INTO projects (id, name) VALUES (\'p-330\', \'迁移项目\')')
    await db.execute('INSERT INTO suppliers (id, name) VALUES (\'s-330\', \'检测分供方\')')
    await db.execute('INSERT INTO contracts (id, name, kind, project_id, supplier_id, other_expense_kind) VALUES (\'same-id\', \'检测合同\', \'其他支出\', \'p-330\', \'s-330\', \'检测服务\')')
    await db.execute(`INSERT INTO invoices (id, company_expense_contract_id, total_amount, account_status, invoice_number) VALUES ('company-invoice', 'same-id', 80, 'archived', 'FP-COMPANY')`)
    await db.execute(`INSERT INTO invoices (id, contract_id, total_amount, account_status) VALUES ('project-invoice', 'same-id', 25, 'archived')`)
    await db.execute(`INSERT INTO invoices (id, company_expense_contract_id, total_amount, account_status) VALUES ('unarchived-invoice', 'same-id', 99, 'none')`)
    await db.execute(`INSERT INTO payment_applications (id, company_expense_contract_id) VALUES ('company-application', 'same-id')`)
    await db.execute(`INSERT INTO payment_records (id, amount, payment_date, payee_name, voucher_no, bank_serial_no, confirmed_by, confirmed_at) VALUES ('company-payment', 30, '2026-09-01', '出租方', 'PZ-330', 'LS-330', 'actor-default', '2026-09-01T01:00:00.000Z')`)
    await db.execute(`INSERT INTO payment_record_application_allocations (id, payment_record_id, payment_application_id, allocated_amount) VALUES ('company-allocation', 'company-payment', 'company-application', 30)`)
    await db.execute(`UPDATE payment_records SET confirmation_status = 'confirmed' WHERE id = 'company-payment'`)
    await db.execute(`INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_path) VALUES ('company-file', 'company_expense_contract', 'same-id', '租赁附件.pdf', '/private/source.pdf')`)
    const companyRows = await db.select<Record<string, unknown>>(COMPANY_CONTRACT_SOURCE_SQL)
    const projectRows = await db.select<Record<string, unknown>>(AUXILIARY_CONTRACT_SOURCE_SQL)
    expect(companyRows.map(auxiliaryContractSourceEntity)[0]).toMatchObject({ legacyId: 'company_expense:same-id', references: {} })
    expect(projectRows.map(auxiliaryContractSourceEntity)[0]).toMatchObject({ legacyId: 'other_expense:same-id', references: { projectId: 'p-330', supplierId: 's-330' } })
    const unsigned = {
      contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
      mode: CORE_MIGRATION_SOURCE_MODE,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      entities: { ...Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(key => [key, []])), projects: [{ legacyId: 'p-330', name: '迁移项目' }], suppliers: [{ legacyId: 's-330', name: '检测分供方' }], auxiliary_contracts: [...projectRows, ...companyRows].map(auxiliaryContractSourceEntity) },
      expectations: { counts: { auxiliary_contracts: 2 }, totals: [] },
    } as Omit<CoreMigrationSourceDTO, 'sourceHash'>
    const source = { ...unsigned, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(unsigned)).digest('hex') }
    const contracts = createAuxiliaryContractTestInstance()
    const migration = createCoreMigrationTestInstance({ afterConfirm: snapshot => contracts.prepareMigrationSnapshot(snapshot)(), afterRollback: snapshot => contracts.prepareMigrationSnapshot(snapshot)() })
    const actor = { ...session, capabilities: [...session.capabilities, CORE_MIGRATION_CAPABILITY] }
    const envelope = { ...actor, requiredCapability: CORE_MIGRATION_CAPABILITY }
    await migration.preflight({ ...envelope, commandId: 'preflight', source, backup: null }, actor)
    const batch = await migration.dryRun({ ...envelope, commandId: 'dry-run', source, backup: { backupId: `core-migration-${source.sourceHash}-${'b'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: '2026-09-06T01:00:00.000Z', immutable: true } }, actor)
    expect(batch.issues.filter(issue => issue.severity === 'error')).toEqual([])
    await migration.importBatch({ ...envelope, commandId: 'import', batchId: batch.batchId }, actor)
    expect(contracts.list({ kind: 'company_expense' }, actor).pagination.total).toBe(0)
    await migration.confirm({ ...envelope, commandId: 'confirm', batchId: batch.batchId }, actor)
    const imported = contracts.list({ kind: 'other_expense' }, actor).items[0]!
    expect(imported.id).not.toBe('same-id')
    expect(imported.project).toMatchObject({ state: 'resolved', label: '迁移项目' })
    const company = contracts.list({ kind: 'company_expense' }, actor).items[0]!
    expect(company.project).toBeNull()
    expect(company.amounts).toMatchObject({ invoiced: '80.00', paid: '30.00', byInvoicePayable: '50.00' })
    expect(imported.amounts.invoiced).toBe('25.00')
    const detail = contracts.detail(company.id, { kind: 'company_expense' }, actor)
    expect(detail.facts.find(fact => fact.kind === 'payment')).toMatchObject({ id: 'company-allocation', date: '2026-09-01', amount: '30.00', contractId: company.id })
    expect(detail.attachments[0]).toMatchObject({ id: 'company-file', ownerId: company.id, fileName: '租赁附件.pdf', filePath: '' })
    await migration.rollback({ ...envelope, commandId: 'rollback', batchId: batch.batchId }, actor)
    expect(contracts.list({ kind: 'other_expense' }, actor).pagination.total).toBe(0)
  })
})
