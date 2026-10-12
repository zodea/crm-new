import type { PayrollDayworkCommand } from '../../app/lib/payroll/central-daywork-contract'
import { afterEach, expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollC2ReceiptReferences } from '../../server/utils/payroll-c2-migration-references'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'

const session = resolveBusinessSession()

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

function databaseFacts() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it('独立反例：原签工跨项目及人员移动后仅余可靠回执，仍在恢复删除前保护原行；去掉该回执才可准备', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c2-destination', '签工目标工程'])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', ['c2-destination-crew', '目标班组'])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,?,?)', ['c2-destination-worker', '目标人员', 'c2-destination-crew', 'c2-destination'])
    await db.execute('INSERT INTO payroll_subject_configs(id,project_id,crew_id,leader_worker_id,format_family,unit_rate,rule_text) VALUES (?,?,?,?,\'C2\',?,\'\')', ['c2-destination-config', 'c2-destination', 'c2-destination-crew', 'c2-destination-worker', 360])
    const imported = await importPayrollC2MigrationSource(db)
    const mapped = (type: string, legacyId: string) => imported.batch.mappings.find(row => row.entityType === type && row.legacyId === legacyId)!.serverId
    const originalProjectId = mapped('projects', 'c2-project')
    const destinationProjectId = mapped('projects', 'c2-destination')
    const destinationWorkerId = mapped('workers', 'c2-destination-worker')
    const destinationCrewId = mapped('crews', 'c2-destination-crew')
    const list = await payrollService.dayworkList({ origin: 'real' }, { projectId: originalProjectId, month: '2026-08', crewId: null, dayworkStatuses: [] })
    const originalRecord = list.records.find(row => row.status === 'draft')!
    const read = await payrollService.dayworkForm({ origin: 'real' }, { recordId: originalRecord.id })
    const raw = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<Record<string, unknown>>('SELECT * FROM signed_daywork_records WHERE id=?', [originalRecord.id]))[0]!)
    const command: PayrollDayworkCommand = {
      commandId: 'b-independent-move-original',
      workspaceId: read.context.workspaceId,
      actorId: read.context.actorId,
      origin: 'real',
      requiredCapability: 'payroll:write',
      sourceVersion: read.context.sourceVersion,
      projectId: originalProjectId,
      recordId: originalRecord.id,
      draftKey: null,
      originalScope: { projectId: originalProjectId, crewId: originalRecord.crewId, workerId: originalRecord.workerId, workDate: originalRecord.workDate },
      action: { kind: 'save-daywork', record: { projectId: destinationProjectId, crewId: destinationCrewId, workerId: destinationWorkerId, workDate: '2026-09-03', workContent: '独立审查：合法跨项目移动原签工', startTime: '08:00', endTime: '12:00', laborUnits: 0.5, witness: '目标现场证明人', confirmedOn: '2026-09-06', status: 'confirmed', note: '' } },
    }
    const saved = await payrollService.executeDaywork(command)
    expect(saved).toMatchObject({ projectId: originalProjectId, recordProjectId: destinationProjectId, recordId: originalRecord.id, workerId: destinationWorkerId, status: 'confirmed' })
    expect((await payrollService.dayworkForm({ origin: 'real' }, { recordId: originalRecord.id })).record).toMatchObject({ projectId: destinationProjectId, workerId: destinationWorkerId, workDate: '2026-09-03' })
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      const [receipt] = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
      const references = payrollC2ReceiptReferences(receipt!)!
      for (const [table, id] of [['projects', originalProjectId], ['projects', destinationProjectId], ['workers', originalRecord.workerId], ['workers', destinationWorkerId], ['crews', originalRecord.crewId], ['crews', destinationCrewId], ['signed_daywork_records', originalRecord.id]])
        expect(references.has(JSON.stringify([table, id]))).toBe(true)
      // 健康命令与冷读完成后才模拟损坏：恢复原 SQL 行并移走该命令审计，只留下真实回执。
      const columns = Object.keys(raw).filter(column => column !== 'id')
      await tx.execute(`UPDATE signed_daywork_records SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`, [...columns.map(column => raw[column]), originalRecord.id])
      for (const logId of saved.logIds)
        await tx.execute('DELETE FROM operation_logs WHERE id=?', [logId])
    })
    const authority = coreMigrationTestInstance.snapshot(session)
    const removal = { ...authority, entities: authority.entities.filter(entity => !(entity.entityType === 'payroll_projects' && entity.legacyId === 'c2-project')) }
    const before = await databaseFacts()
    await expect(quantityTestInstance.prepareMigrationSnapshot(removal)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await databaseFacts()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)

    // 区分力对照：去掉唯一剩余独立回执后同一候选能够准备，前一拒绝不是其他残存事实误触发。
    await quantityTestInstance.withWorkspaceTransaction(tx => tx.execute('DELETE FROM payroll_command_receipts WHERE command_id=?', [command.commandId]))
    const withoutReceipt = await databaseFacts()
    const candidate = await quantityTestInstance.prepareMigrationSnapshot(removal)
    await candidate.abort()
    expect(await databaseFacts()).toEqual(withoutReceipt)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
  }
  finally { db.close() }
})
