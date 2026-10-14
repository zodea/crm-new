import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadPayrollAttendanceFacts } from '../../server/utils/payroll-attendance-facts'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollC1Source } from '../helpers/payroll-c1-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it('逐日事实保原组、7.51小数和真零，坏未来日期不消失且软删原行仍可读', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollC1Source(db)
    await initializePayrollSchema(db)
    const query = { projectId: 'c1-project', month: '2026-08' }
    const first = await loadPayrollAttendanceFacts(db, query)
    expect(first.diagnostics).toEqual([])
    expect(first.rows).toHaveLength(2)
    expect(first.rows.find(row => row.id === 'c1-attendance')).toMatchObject({ crewId: 'c1-crew-old', hours: 7.51, overtimeHours: 2, workContent: '原班组施工' })
    expect(first.rows.find(row => row.id === 'c1-attendance-zero')).toMatchObject({ hours: 0, overtimeHours: 0 })
    await db.execute('UPDATE attendance_records SET work_content=\'同量不同原内容\' WHERE id=\'c1-attendance\'')
    expect((await loadPayrollAttendanceFacts(db, query)).sourceVersion).not.toBe(first.sourceVersion)
    await db.execute('UPDATE attendance_records SET deleted_at=\'2026-09-14\' WHERE id=\'c1-attendance-zero\'')
    await db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours) VALUES (\'invalid-future\',\'c1-project\',\'c1-worker\',\'2026-13-01\',1)')
    await db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours) VALUES (\'valid-future\',\'c1-project\',\'c1-worker\',\'2026-09-01\',1)')
    const changed = await loadPayrollAttendanceFacts(db, query)
    expect(changed.rows.find(row => row.id === 'c1-attendance-zero')?.deletedAt).toBe('2026-09-14')
    expect(changed.rows.some(row => row.id === 'valid-future')).toBe(false)
    expect(changed.diagnostics).toContainEqual(expect.objectContaining({ code: 'attendance-date-invalid', recordId: 'invalid-future', workerId: 'c1-worker' }))
    expect(changed.diagnostics.some(row => row.recordId === 'valid-future')).toBe(false)
  }
  finally { db.close() }
})

it('公开迁入隔离旧考勤仍可定位原图，已知工人保映射但不造可写考勤ID', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollC1Source(db)
    await db.execute('PRAGMA foreign_keys=OFF')
    await db.execute('UPDATE attendance_records SET crew_id=\'missing-original-crew\' WHERE id=\'c1-attendance\'')
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    const hash = createHash('sha256').update(bytes).digest('hex')
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('attendance-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('attendance-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('attendance-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('attendance-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const workerId = batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'c1-worker')!.serverId
    const facts = await quantityTestInstance.withWorkspaceTransaction(tx => loadPayrollAttendanceFacts(tx, { projectId, month: '2026-08' }))
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0]!.hours).toBe(0)
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'attendance-isolated', recordId: null, legacyRecordId: 'c1-attendance', workerId, tableName: 'attendance_records' }))
    expect(facts.evidence).toHaveLength(1)
    expect(facts.evidence[0]!.source.attendance).toContainEqual(expect.objectContaining({ id: 'c1-attendance', crew_id: 'missing-original-crew', hours: 7.51 }))
    expect(facts.evidence[0]!.mappings).toContainEqual(expect.objectContaining({ tableName: 'attendance_records', legacyId: 'c1-attendance', centralId: null }))
  }
  finally { db.close() }
})
