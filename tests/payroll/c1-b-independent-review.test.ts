import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollC1Source } from '../helpers/payroll-c1-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

function readAll() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it.each(['frozen-lines', 'frozen-leader', 'frozen-month', 'deleted-source-link', 'invalid-date-source'] as const)('迟到迁入来源互斥复用全部原证据，不能越过后来真实考勤：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    await seedPayrollC1Source(db)
    await db.execute('DELETE FROM attendance_records')
    // 这是明确的缺损历史原件，不冒充新健康工资；P0 必须保留仍可证明的已发成员和月份。
    const snapshot: Record<string, unknown> = {}
    if (kind === 'frozen-lines')
      snapshot.lines = [{ workerId: 'c1-zero' }]
    if (kind === 'frozen-leader')
      snapshot.leaderWorkerId = 'c1-zero'
    if (kind === 'frozen-month')
      Object.assign(snapshot, { month: '2026-08', memberWorkerIds: ['c1-zero'] })
    if (kind !== 'invalid-date-source')
      await db.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (\'old-release\',\'c1-project\',\'c1-worker\',?,\'C2\',\'field\',\'released\',300,?)', [kind === 'frozen-month' ? '2026-07' : '2026-08', JSON.stringify(snapshot)])
    else
      await db.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units,status) VALUES (\'invalid-date-daywork\',\'c1-project\',\'c1-zero\',\'2026-08-99\',0.5,\'draft\')')
    if (kind === 'deleted-source-link') {
      await db.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units,status,deleted_at) VALUES (\'old-daywork\',\'c1-project\',\'c1-zero\',\'2026-08-02\',0.5,\'confirmed\',\'2026-09-01\')')
      await db.execute('INSERT INTO wage_statement_daywork_records(id,statement_id,daywork_record_id,deleted_at) VALUES (\'old-link\',\'old-release\',\'old-daywork\',\'2026-09-01\')')
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    const hash = createHash('sha256').update(bytes).digest('hex')
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('review-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('review-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('review-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('review-confirm'), batchId: batch.batchId }, session)
    const authority = coreMigrationTestInstance.snapshot(session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const workerId = batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'c1-zero')!.serverId
    const originalMatrix = await payrollService.attendanceMatrix({ origin: 'real' }, { projectId, month: '2026-08', crewId: null })
    expect(originalMatrix.locks).toContainEqual(expect.objectContaining({ workerId, month: '2026-08', kind: kind === 'invalid-date-source' ? 'daywork-occupation' : 'released-month' }))
    const withoutPayroll = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'payroll_projects') })
    withoutPayroll.commit()
    const matrix = await payrollService.attendanceMatrix({ origin: 'real' }, originalMatrix.scope)
    const worker = matrix.workers.find(row => row.id === workerId)!
    await payrollService.executeAttendance({ commandId: 'review-later-attendance', workspaceId: matrix.context.workspaceId, actorId: matrix.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId, crewId: worker.crewId, workDate: '2026-08-25', hours: 0, overtimeHours: 0, workContent: '后来真实零考勤', note: '' } } })
    const before = await readAll()
    let rejection: unknown
    try {
      const candidate = await quantityTestInstance.prepareMigrationSnapshot(authority)
      await candidate.abort()
    }
    catch (cause) { rejection = cause }
    expect(await readAll()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
    expect(rejection).toMatchObject({ problem: { code: 'conflict' } })
  }
  finally { db.close() }
})
