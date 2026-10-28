import type { TestDb } from './memory-db'
import { createHash } from 'node:crypto'
import { runMigrations } from '../../app/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { readQuantityCoreSource } from './quantity-migration-source'
import { insertRows } from './sql-rows'

/** 已退役本地 Native 命令曾产出的 C2 配置与相邻半工（逐行固化）。 */
const c2SourceRows: Record<string, Record<string, string | number>[]> = {
  payroll_subject_configs: [
    { id: 'payroll_subject_config_mv52zf52_d', project_id: 'c2-project', crew_id: 'c2-crew', leader_worker_id: 'c2-leader', format_family: 'C2', unit_rate: 350.125, rule_text: '', enabled: 1, created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
  signed_daywork_records: [
    { id: 'signed_daywork_mv52zf53_e', project_id: 'c2-project', crew_id: 'c2-crew', worker_id: 'c2-worker', work_date: '2026-08-02', work_content: '原始半工内容', start_time: '08:00', end_time: '12:00', labor_units: 0.5, witness: '证明人', confirmed_on: '2026-08-05', status: 'confirmed', note: '原备注', created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
    { id: 'signed_daywork_mv52zf53_f', project_id: 'c2-project', crew_id: 'c2-crew', worker_id: 'c2-worker', work_date: '2026-08-02', work_content: '原始半工内容', start_time: '12:00', end_time: '16:00', labor_units: 0.5, witness: '', status: 'draft', note: '原备注', created_at: '2026-10-12 10:00:05', updated_at: '2026-10-12 10:00:05' },
  ],
}

/** 无工程量的真实签工源：一条已确认、一条草稿的相邻半工。 */
export async function seedPayrollC2MigrationSource(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c2-project', '零星签工工程'])
  for (const [id, name] of [['c2-crew', '原签工班组'], ['c2-current', '当前班组']])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', [id, name])
  for (const [id, name] of [['c2-leader', '原负责人'], ['c2-worker', '签工人员'], ['c2-zero', '无签工成员']])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,?,?)', [id, name, 'c2-crew', 'c2-project'])
  for (const [table, rows] of Object.entries(c2SourceRows))
    await insertRows(db, table, rows)
  const configId = String(c2SourceRows.payroll_subject_configs![0]!.id)
  const dayworkIds = c2SourceRows.signed_daywork_records!.map(row => String(row.id))
  return { configId, dayworkIds, source: await readQuantityCoreSource(db) }
}

export async function importPayrollC2MigrationSource(db: TestDb) {
  const source = await readQuantityCoreSource(db)
  const session = resolveBusinessSession()
  const bytes = db.raw.export()
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('c2-source-preflight'), source, backup: null }), session)
  const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('c2-source-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
  await coreMigrationTestInstance.importBatch({ ...envelope('c2-source-import'), batchId: batch.batchId }, session)
  await coreMigrationTestInstance.confirm({ ...envelope('c2-source-confirm'), batchId: batch.batchId }, session)
  return { batch, session, envelope, projectId: batch.mappings.find(row => row.entityType === 'projects')!.serverId, workerId: batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'c2-worker')!.serverId, leaderWorkerId: batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'c2-leader')!.serverId }
}
