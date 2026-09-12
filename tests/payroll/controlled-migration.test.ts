import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { payrollOriginalSnapshot, seedPayrollMigrationSource, seedReleasedPayrollMigrationSource } from '../helpers/payroll-migration-source'
import { readQuantityCoreSource, seedQuantityMigrationSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
async function prepare(source: CoreMigrationSourceDTO) {
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('pay-preflight'), source, backup: null }), session)
  const hash = 'e'.repeat(64)
  return coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('pay-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 412, createdAt: new Date().toISOString(), immutable: true } }), session)
}
async function confirm(source: CoreMigrationSourceDTO) {
  const batch = await prepare(source)
  await coreMigrationTestInstance.importBatch({ ...envelope('pay-import'), batchId: batch.batchId }, session)
  await coreMigrationTestInstance.confirm({ ...envelope('pay-confirm'), batchId: batch.batchId }, session)
  return batch
}
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it.each(['foreign-table', 'foreign-project', 'foreign-current-row'] as const)('公开工资迁移复验审计归属，不能凭客户端项目图接管其他事实：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    const source = await seedPayrollMigrationSource(db)
    const entity = source.entities.payroll_projects!.find(row => row.legacyId === 'pay-project')!
    const graph = JSON.parse(String(entity.attributes!.payrollGraphJson))
    graph.logs.push({
      id: 'injected-audit',
      table_name: kind === 'foreign-table' ? 'target_costs' : kind === 'foreign-current-row' ? 'signed_daywork_records' : 'wage_statements',
      record_id: kind === 'foreign-current-row' ? 'pay-independent-day' : 'missing-foreign-record',
      action: 'update',
      before_data: null,
      after_data: JSON.stringify({ project_id: kind === 'foreign-project' ? 'pay-independent' : 'pay-project', actual_amount: 7 }),
      operator: null,
      created_at: '2026-09-13 00:00:00',
    })
    entity.attributes!.payrollGraphJson = JSON.stringify(graph)
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const batch = await prepare(source)
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'payroll_projects', metricKey: 'apply-failed' }))
    await expect(coreMigrationTestInstance.importBatch({ ...envelope('pay-invalid-audit-import'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    expect((await payrollService.list({ origin: 'real' })).rows).toEqual([])
  }
  finally { db.close() }
})

it.each(['missing', 'cross-project'] as const)('旧缺关系行与坏快照可诊断保原文，同月零成员冲突不能当作无锁：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    await seedPayrollMigrationSource(db)
    if (kind === 'cross-project')
      await seedQuantityMigrationSource(db)
    await db.execute('UPDATE wage_statements SET snapshot_json = ? WHERE id = ?', ['{坏快照', 'pay-c2'])
    const itemId = kind === 'cross-project' ? 'q-item' : '不能重接的旧分项'
    await db.execute('UPDATE wage_statement_lines SET item_id = ? WHERE id = ?', [itemId, 'pay-line-old'])
    await db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours) VALUES (\'conflict-zero\',\'pay-project\',\'pay-zero\',\'2026-08-04\',0)')
    const batch = await confirm(await readQuantityCoreSource(db))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'payroll_projects', metricKey: 'legacy-audit', reason: expect.stringContaining('source-conflict') }))
    const read = await quantityTestInstance.withWorkspaceTransaction(async tx => ({
      evidence: await tx.select<{ source_graph_json: string, diagnostics_json: string }>('SELECT * FROM payroll_migration_evidence'),
      lines: await tx.select<{ item_id: string | null }>('SELECT item_id FROM wage_statement_lines'),
      heads: await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements'),
    }))
    expect(read.lines[0]!.item_id).toBeNull()
    expect(read.heads[0]!.snapshot_json).toBe('{坏快照')
    const evidence = read.evidence.find(row => JSON.parse(row.source_graph_json).projectId === 'pay-project')!
    expect(JSON.parse(evidence.source_graph_json).lines[0].item_id).toBe(itemId)
    expect(JSON.parse(evidence.diagnostics_json)).toContainEqual(expect.objectContaining({ code: 'snapshot-invalid' }))
  }
  finally { db.close() }
})

it.each(['untouched', 'daily-change', 'deleted-independent', 'zero-member', 'unclaimed-daywork', 'independent-audit'] as const)('危险恢复在删除前保护工资完整关系并保持全域不变：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    const batch = await confirm(await seedPayrollMigrationSource(db))
    const ids = await quantityTestInstance.withWorkspaceTransaction(async tx => ({
      statement: (await tx.select<{ id: string, project_id: string, leader_worker_id: string }>('SELECT * FROM wage_statements'))[0]!,
      member: (await tx.select<{ worker_id: string }>('SELECT * FROM wage_statement_members WHERE is_leader = 0'))[0]!,
    }))
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      if (kind === 'daily-change')
        await tx.execute('UPDATE wage_statements SET actual_amount = 301 WHERE id = ?', [ids.statement.id])
      if (kind === 'deleted-independent')
        await tx.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours,deleted_at) VALUES (\'new-deleted\',?,?,\'2026-09-01\',0,\'2026-09-13\')', [ids.statement.project_id, ids.statement.leader_worker_id])
      if (kind === 'zero-member') {
        await tx.execute('INSERT INTO projects(id,name) VALUES (\'independent-project\',\'另一项目\')')
        await tx.execute('INSERT INTO workers(id,name) VALUES (\'independent-worker\',\'另一负责人\')')
        await tx.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,quantity_source) VALUES (\'independent-statement\',\'independent-project\',\'independent-worker\',\'2026-09\',\'field\')')
        await tx.execute('INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader,deleted_at) VALUES (\'new-zero\',\'independent-statement\',?,0,\'2026-09-13\')', [ids.member.worker_id])
      }
      if (kind === 'unclaimed-daywork')
        await tx.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units) VALUES (\'new-day\',?,?,\'2026-09-01\',1)', [ids.statement.project_id, ids.statement.leader_worker_id])
      if (kind === 'independent-audit')
        await tx.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data) VALUES (\'new-audit\',\'future_payroll_adjustments\',\'future-independent\',\'create\',NULL,?)', [JSON.stringify({ statement_id: ids.statement.id })])
    })
    const query = () => quantityTestInstance.withWorkspaceTransaction(async tx => ({
      statements: await tx.select('SELECT * FROM wage_statements'),
      members: await tx.select('SELECT * FROM wage_statement_members'),
      attendance: await tx.select('SELECT * FROM attendance_records'),
      daywork: await tx.select('SELECT * FROM signed_daywork_records'),
      evidence: await tx.select('SELECT * FROM payroll_migration_evidence'),
      logs: await tx.select('SELECT * FROM operation_logs'),
      revision: await tx.select('SELECT * FROM payroll_revision'),
    }))
    const before = await query()
    const authority = coreMigrationTestInstance.snapshot(session)
    if (kind === 'untouched') {
      await coreMigrationTestInstance.rollback({ ...envelope('pay-rollback'), batchId: batch.batchId }, session)
      expect((await query()).statements).toEqual([])
      expect((await query()).evidence).toEqual([])
      expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    }
    else {
      await expect(coreMigrationTestInstance.rollback({ ...envelope('pay-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await query()).toEqual(before)
      expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
    }
  }
  finally { db.close() }
})

it('公开迁入后同库冷读原八表与不可变证据，重复确认保留日常更正', async () => {
  const db = await createMemoryDb()
  try {
    const batch = await confirm(await seedPayrollMigrationSource(db))
    const read = () => quantityTestInstance.withWorkspaceTransaction(async tx => ({
      statements: await tx.select<{ id: string, project_id: string, snapshot_json: string, note: string }>('SELECT * FROM wage_statements'),
      configs: await tx.select('SELECT * FROM payroll_subject_configs'),
      attendance: await tx.select('SELECT * FROM attendance_records'),
      evidence: await tx.select<{ source_graph_json: string, mapping_json: string }>('SELECT * FROM payroll_migration_evidence ORDER BY project_id'),
    }))
    const first = await read()
    expect(first.statements).toHaveLength(1)
    expect(first.statements[0]!.snapshot_json).toBe(payrollOriginalSnapshot)
    expect(first.configs).toHaveLength(2)
    expect(first.attendance).toHaveLength(1)
    expect(first.evidence).toHaveLength(2)
    expect(first.statements[0]!.project_id).toBe(batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'pay-project')!.serverId)
    await quantityTestInstance.withWorkspaceTransaction(tx => tx.execute('UPDATE wage_statements SET note = ? WHERE id = ?', ['中央日常更正', first.statements[0]!.id]))
    const repeated = await quantityTestInstance.prepareMigrationSnapshot(coreMigrationTestInstance.snapshot(session))
    repeated.commit()
    expect((await read()).statements[0]!.note).toBe('中央日常更正')
    expect((await read()).evidence).toEqual(first.evidence)
  }
  finally { db.close() }
})

it('健康旧 C2 经公开迁入后由工资普通服务冷读完整冻结、原历史及未领用来源', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollMigrationSource(db)
    const seeded = await seedReleasedPayrollMigrationSource(db)
    const batch = await confirm(seeded.source)
    const listed = await payrollService.list({ origin: 'real' })
    const row = listed.rows.find(row => row.legacyId === seeded.statementId)!
    const detail = await payrollService.detail({ origin: 'real' }, row.id)
    expect(detail.statement.snapshot.state).toBe('complete')
    expect(detail.statement.snapshot.raw).toBe(seeded.snapshot)
    expect(detail.statement.snapshot.originalRaw).toBe(seeded.snapshot)
    expect(detail.statement.actualAmount).toBe(300)
    expect(detail.statement.stored.lines.filter(line => line.deletedAt)).toHaveLength(2)
    expect(detail.statement.stored.dayworkLinks.filter(link => link.deletedAt)).toHaveLength(2)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'pay-independent')!.serverId
    const sources = await payrollService.sources({ origin: 'real', projectId })
    expect(sources.configs).toHaveLength(1)
    expect(sources.attendance[0]!.hours).toBe(0)
    expect(sources.daywork[0]!.status).toBe('draft')
  }
  finally { db.close() }
})

it('缺失旧人员仅隔离无法映射的行，原图和对应旧ID不能丢失或按同名补造', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollMigrationSource(db)
    await db.execute('PRAGMA foreign_keys = OFF')
    await db.execute('DELETE FROM workers WHERE id = ?', ['pay-zero'])
    await db.execute('PRAGMA foreign_keys = ON')
    const batch = await confirm(await readQuantityCoreSource(db))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'payroll_projects', reason: expect.stringContaining('identity-unmapped') }))
    const rows = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ source_graph_json: string, mapping_json: string }>('SELECT * FROM payroll_migration_evidence'))
    const record = rows.find(row => JSON.parse(row.source_graph_json).projectId === 'pay-project')!
    expect(JSON.parse(record.source_graph_json).members).toContainEqual(expect.objectContaining({ worker_id: 'pay-zero' }))
    expect(JSON.parse(record.mapping_json)).toContainEqual({ tableName: 'wage_statement_members', legacyId: 'member-pay-zero', centralId: null })
  }
  finally { db.close() }
})

it('工资旧分项只经同一工程量图的稳定映射，数量图单独撤回也须保护工资引用', async () => {
  const db = await createMemoryDb()
  try {
    await seedQuantityMigrationSource(db)
    await db.execute('INSERT INTO workers(id,name,crew_id) VALUES (\'pay-q-worker\',\'同名工人\',\'q-crew\')')
    await db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source) VALUES (\'pay-q-a\',\'q-project\',\'q-crew\',\'pay-q-worker\',\'2026-08\',\'A\',\'provisional\')')
    await db.execute('INSERT INTO wage_statement_lines(id,statement_id,worker_id,item_id,item_name,quantity) VALUES (\'pay-q-line\',\'pay-q-a\',\'pay-q-worker\',\'q-item\',\'原分项名\',0)')
    await confirm(await readQuantityCoreSource(db))
    const data = await quantityTestInstance.withWorkspaceTransaction(async tx => ({
      line: (await tx.select<{ item_id: string }>('SELECT * FROM wage_statement_lines'))[0]!,
      item: (await tx.select<{ id: string }>('SELECT * FROM items'))[0]!,
    }))
    expect(data.line.item_id).toBe(data.item.id)
    const snapshot = coreMigrationTestInstance.snapshot(session)
    const repeat = await quantityTestInstance.prepareMigrationSnapshot(snapshot)
    repeat.commit()
    const withoutQuantity = { ...snapshot, entities: snapshot.entities.filter(row => row.entityType !== 'quantity_projects') }
    await expect(quantityTestInstance.prepareMigrationSnapshot(withoutQuantity)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT id FROM items')))).toHaveLength(1)
  }
  finally { db.close() }
})
