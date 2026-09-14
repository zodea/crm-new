import { expect, it } from 'vitest'
import { PAYROLL_CENTRAL_MIGRATION_TABLES } from '~/lib/migration/payroll-central-source'
import { parsePayrollProjectGraph, readPayrollProjectMigrationGraphs } from '~/lib/migration/payroll-source'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

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
