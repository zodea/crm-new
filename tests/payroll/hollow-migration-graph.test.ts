import { expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { PAYROLL_CENTRAL_MIGRATION_TABLES } from '~/lib/migration/payroll-central-source'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_PARTS, readPayrollProjectMigrationGraphs } from '~/lib/migration/payroll-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES } from '~/lib/payroll/central-a-fees-schema'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '~/lib/payroll/central-hollow-deduction-schema'
import { emptyQuantityHollowMigrationGraph } from '~/lib/quantity/hollow-migration-graph'
import { createMemoryDb } from '../helpers/memory-db'

it('工资只出现部分空鼓扣款三表时拒绝导出，不能静默降回旧工资图', async () => {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    expect(await readPayrollProjectMigrationGraphs(db)).toEqual([])
    await db.execute('CREATE TABLE payroll_hollow_starts(id TEXT PRIMARY KEY)')
    await expect(readPayrollProjectMigrationGraphs(db)).rejects.toThrow('扣款')
  }
  finally { db.close() }
})

it('空结构合同采用outer v4及独立扣款三表，旧三个版本仍只接受原封闭字段', () => {
  const original = { schemaVersion: 1, projectId: 'p', ...Object.fromEntries(PAYROLL_MIGRATION_PARTS.map(part => [part, []])) }
  const central = { schemaVersion: 1, tables: Object.fromEntries(PAYROLL_CENTRAL_MIGRATION_TABLES.map(table => [table, []])) }
  const fees = { schemaVersion: 1, tables: Object.fromEntries(PAYROLL_A_FEES_MIGRATION_TABLES.map(table => [table, []])) }
  const deductions = { schemaVersion: 1, tables: Object.fromEntries(PAYROLL_HOLLOW_DEDUCTION_TABLES.map(table => [table, []])), quantity: emptyQuantityHollowMigrationGraph() }
  const current = { ...original, schemaVersion: 4, central, fees, deductions }
  expect(parsePayrollProjectGraph(current).schemaVersion).toBe(4)
  for (const legacy of [original, { ...original, schemaVersion: 2, central }, { ...original, schemaVersion: 3, central, fees }]) {
    expect(parsePayrollProjectGraph(legacy).schemaVersion).toBe(legacy.schemaVersion)
    expect(() => parsePayrollProjectGraph({ ...legacy, deductions })).toThrow()
  }
  expect(() => parsePayrollProjectGraph({ ...current, deductions: { ...deductions, quantity: undefined } })).toThrow()
  expect(() => parsePayrollProjectGraph({ ...current, deductions: { ...deductions, tables: { ...deductions.tables, unexpected: [] } } })).toThrow()
})
