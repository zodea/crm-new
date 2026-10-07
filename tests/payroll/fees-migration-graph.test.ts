import { expect, it } from 'vitest'
import { parsePayrollProjectGraph, readPayrollProjectMigrationGraphs } from '../../app/lib/migration/payroll-source'
import { initializePayrollAFeesSchema, PAYROLL_A_FEES_MIGRATION_TABLES } from '../../app/lib/payroll/central-a-fees-schema'
import { initializePayrollAdjustmentSchema } from '../../app/lib/payroll/central-adjustment-schema'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('费用图使用outer v3和独立fees v1，原v1/v2保持封闭白名单', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    await initializePayrollAdjustmentSchema(db)
    await initializePayrollAFeesSchema(db)
    await db.execute('INSERT INTO payroll_a_management_books(id,project_id,manager_worker_id,created_by,created_at,deleted_at) VALUES(\'book-original\',\'pa-project\',\'pa-worker-old\',\'operator\',\'2026-08-01T00:00:00.000Z\',NULL)')
    const [entity] = await readPayrollProjectMigrationGraphs(db)
    const graph = parsePayrollProjectGraph(JSON.parse(String(entity!.attributes!.payrollGraphJson)))
    expect(graph.schemaVersion).toBe(3)
    expect(graph.fees!.schemaVersion).toBe(1)
    expect(Object.keys(graph.fees!.tables)).toEqual(PAYROLL_A_FEES_MIGRATION_TABLES)
    expect(graph.fees!.tables.payroll_a_management_books[0]).toMatchObject({ id: 'book-original', manager_worker_id: 'pa-worker-old', deleted_at: null })
    expect(() => parsePayrollProjectGraph({ ...graph, schemaVersion: 2 })).toThrow()
    const { fees: _fees, ...v2 } = graph
    expect(parsePayrollProjectGraph({ ...v2, schemaVersion: 2 }).schemaVersion).toBe(2)
    expect(() => parsePayrollProjectGraph({ ...graph, fees: { ...graph.fees, schemaVersion: 2 } })).toThrow()
    expect(() => parsePayrollProjectGraph({ ...graph, fees: { ...graph.fees, tables: { ...graph.fees!.tables, unexpected: [] } } })).toThrow()
    const incomplete = structuredClone(graph)
    delete (incomplete.fees!.tables as Record<string, unknown>).payroll_a_management_ownership
    expect(() => parsePayrollProjectGraph(incomplete)).toThrow()
  }
  finally { db.close() }
})

it('真实旧中央库未建费用六表仍导出v2，原更正/发放正文无需补fees', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    await f.correct()
    for (const table of [...PAYROLL_A_FEES_MIGRATION_TABLES].reverse()) await f.db.execute(`DROP TABLE ${table}`)
    const [entity] = await readPayrollProjectMigrationGraphs(f.db)
    const graph = parsePayrollProjectGraph(JSON.parse(String(entity!.attributes!.payrollGraphJson)))
    expect(graph.schemaVersion).toBe(2)
    expect(Object.hasOwn(graph, 'fees')).toBe(false)
    expect(graph.central!.tables.payroll_adjustments).toHaveLength(1)
    expect(graph.central!.tables.payroll_command_receipts.length).toBeGreaterThan(0)
  }
  finally { await f.close() }
})
