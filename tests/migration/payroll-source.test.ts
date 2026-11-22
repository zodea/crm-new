import { expect, it } from 'vitest'
import { PAYROLL_CENTRAL_MIGRATION_TABLES } from '~/lib/migration/payroll-central-source'
import { parsePayrollProjectGraph, readPayrollProjectMigrationGraphs } from '~/lib/migration/payroll-source'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { payrollOriginalSnapshot, seedPayrollMigrationSource, seedReleasedPayrollMigrationSource } from '../helpers/payroll-migration-source'

it('公开旧库读取包含八表、独立未领用来源和冻结原文，不因没有工资漏项目', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const source = await seedPayrollMigrationSource(db)
    const entities = (source.entities as Record<string, Array<{ legacyId: string, attributes: Record<string, unknown> }>>).payroll_projects
    expect(entities).toHaveLength(2)
    const graph = JSON.parse(String(entities!.find(row => row.legacyId === 'pay-project')!.attributes.payrollGraphJson))
    expect(graph.statements[0].snapshot_json).toBe(payrollOriginalSnapshot)
    expect(graph.lines[0].deleted_at).toBe('2026-08-31 01:00:00')
    expect(graph.members).toHaveLength(2)
    expect(graph.allocations).toContainEqual(expect.objectContaining({ worker_id: 'pay-zero', allocated_amount_fen: 0 }))
    expect(graph.statementDaywork).toHaveLength(1)
    expect(graph.logs).toHaveLength(1)
    const independent = JSON.parse(String(entities!.find(row => row.legacyId === 'pay-independent')!.attributes.payrollGraphJson))
    expect(independent.statements).toEqual([])
    expect(independent.configs).toHaveLength(1)
    expect(independent.attendance[0].hours).toBe(0)
    expect(independent.daywork[0].status).toBe('draft')
  }
  finally { db.close() }
})

it('真实核对两次再发放的完整 C2 原图保冻结姓名费率和零成员，不追随当前更正', async () => {
  const db = await createMigratedMemoryDb()
  try {
    const seeded = await seedReleasedPayrollMigrationSource(db)
    const graph = JSON.parse(String(seeded.source.entities.payroll_projects![0]!.attributes!.payrollGraphJson))
    const snapshot = JSON.parse(seeded.snapshot)
    expect(snapshot.subjectConfig).toMatchObject({ unitRate: 300, ruleText: '冻结时人工确认规则' })
    expect(snapshot.members).toContainEqual(expect.objectContaining({ workerName: '冻结时零成员' }))
    expect(snapshot.allocations).toContainEqual(expect.objectContaining({ workerId: 'pay-healthy-zero', allocatedAmountFen: 0 }))
    expect(graph.statements[0].snapshot_json).toBe(seeded.snapshot)
    expect(graph.configs[0].unit_rate).toBe(350)
    expect(graph.lines.filter((row: { deleted_at: string | null }) => row.deleted_at !== null)).toHaveLength(2)
    expect(graph.statementDaywork.filter((row: { deleted_at: string | null }) => row.deleted_at !== null)).toHaveLength(2)
  }
  finally { db.close() }
})

it('中央工资只剩原审计的损坏旧库仍运输有项目归属的原文，不因当前表为空静默丢失', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    await f.refund(correction.adjustment.id, 40)
    const logs = await f.db.select<{ id: string, after_data: string }>('SELECT id,after_data FROM operation_logs WHERE table_name=\'payroll_actual_events\'')
    // 故障注入模拟只剩原审计；不提供正式删除工资事实的命令。
    await f.db.execute('PRAGMA foreign_keys=OFF')
    for (const table of [...PAYROLL_CENTRAL_MIGRATION_TABLES].reverse()) await f.db.execute(`DELETE FROM ${table}`)
    await f.db.execute('DELETE FROM operation_logs WHERE table_name<>\'payroll_actual_events\'')
    const graphs = await readPayrollProjectMigrationGraphs(f.db)
    const graph = parsePayrollProjectGraph(JSON.parse(String(graphs.find(row => row.legacyId === 'p')!.attributes!.payrollGraphJson)))
    expect(graph.schemaVersion).toBe(3)
    expect(graph.central!.tables.payroll_actual_events).toEqual([])
    expect(graph.logs).toEqual(expect.arrayContaining(logs.map(row => expect.objectContaining(row))))
  }
  finally { await f.close() }
})
