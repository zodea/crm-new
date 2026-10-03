import type { TestDb } from './memory-db'
import { createHash } from 'node:crypto'
import { runMigrations } from '../../app/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { saveSignedDayworkRecord, upsertC2SubjectConfig } from '../../app/lib/payroll/daywork'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { readQuantityCoreSource } from './quantity-migration-source'

/** 无工程量的真实签工源；用公开 Native 命令形成配置与相邻半工。 */
export async function seedPayrollC2MigrationSource(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c2-project', '零星签工工程'])
  for (const [id, name] of [['c2-crew', '原签工班组'], ['c2-current', '当前班组']])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', [id, name])
  for (const [id, name] of [['c2-leader', '原负责人'], ['c2-worker', '签工人员'], ['c2-zero', '无签工成员']])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,?,?)', [id, name, 'c2-crew', 'c2-project'])
  const configId = await upsertC2SubjectConfig(db, { projectId: 'c2-project', crewId: 'c2-crew', leaderWorkerId: 'c2-leader', unitRate: 350.125, ruleText: '' })
  const dayworkIds: string[] = []
  for (const [startTime, endTime, status] of [['08:00', '12:00', 'confirmed'], ['12:00', '16:00', 'draft']] as const) {
    dayworkIds.push(await saveSignedDayworkRecord(db, { projectId: 'c2-project', crewId: 'c2-crew', workerId: 'c2-worker', workDate: '2026-08-02', workContent: '原始半工内容', startTime, endTime, laborUnits: 0.5, witness: status === 'confirmed' ? '证明人' : null, confirmedOn: status === 'confirmed' ? '2026-08-05' : null, status, note: '原备注' }))
  }
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
