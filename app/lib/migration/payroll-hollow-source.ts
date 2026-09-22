import type { SoftDb } from '../db/soft-delete'
import type { PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollHollowDeductionTable } from '../payroll/central-hollow-deduction-schema'
import type { QuantityHollowMigrationGraph } from '../quantity/hollow-migration-contract'
import type { PayrollProofPackage } from './payroll-proof-package'
import type { PayrollMigrationRow } from './payroll-source'
import { PAYROLL_HOLLOW_DEDUCTION_COLUMNS, PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../payroll/central-hollow-deduction-schema'
import { hollowExact, parseQuantityHollowMigrationGraph } from '../quantity/hollow-migration-graph'
import { parsePayrollProofPackage } from './payroll-proof-package'

export type PayrollHollowMigrationGraph = PayrollJsonObject & {
  schemaVersion: 1
  tables: Record<PayrollHollowDeductionTable, PayrollMigrationRow[]>
  quantity: QuantityHollowMigrationGraph & PayrollJsonObject
  proof?: PayrollProofPackage
}
function invalid(message: string): never {
  throw new Error(`工资迁移：空鼓扣款原图${message}`)
}

export function parsePayrollHollowDeductionTables(value: unknown): PayrollHollowMigrationGraph['tables'] {
  if (!hollowExact(value, PAYROLL_HOLLOW_DEDUCTION_TABLES))
    invalid('必须完整提供三表且不得带未知表')
  const tables = {} as PayrollHollowMigrationGraph['tables']
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    const entries = value[table]
    const columns = PAYROLL_HOLLOW_DEDUCTION_COLUMNS[table]
    const ids = new Set<string>()
    if (!Array.isArray(entries))
      invalid(`缺少 ${table}`)
    tables[table] = entries.map((row) => {
      if (!hollowExact(row, columns) || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.project_id !== 'string' || !row.project_id)
        invalid(`${table}字段或原身份无效`)
      ids.add(row.id)
      return Object.fromEntries(columns.map(column => [column, row[column]])) as PayrollMigrationRow
    })
  }
  return tables
}
export function parsePayrollHollowMigrationGraph(value: unknown): PayrollHollowMigrationGraph {
  if (!hollowExact(value, ['schemaVersion', 'tables', 'quantity', ...(value && typeof value === 'object' && Object.hasOwn(value, 'proof') ? ['proof'] : [])]) || value.schemaVersion !== 1)
    invalid('必须提供独立三表与数量原件闭包')
  return { schemaVersion: 1, tables: parsePayrollHollowDeductionTables(value.tables), quantity: parseQuantityHollowMigrationGraph(value.quantity) as QuantityHollowMigrationGraph & PayrollJsonObject, ...(value.proof !== undefined ? { proof: parsePayrollProofPackage(value.proof) } : {}) }
}

/** 三表不存在仍保持旧外层；部分升级、缺列或未知列不可默许为无扣款。 */
export async function readPayrollHollowDeductionTables(db: Pick<SoftDb, 'select'>): Promise<PayrollHollowMigrationGraph['tables'] | undefined> {
  const names = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  if (!PAYROLL_HOLLOW_DEDUCTION_TABLES.some(table => names.has(table)))
    return undefined
  const tables = {} as PayrollHollowMigrationGraph['tables']
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    if (!names.has(table))
      invalid(`缺少 ${table}，不能部分导出`)
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(${table})`)
    const expected: readonly string[] = PAYROLL_HOLLOW_DEDUCTION_COLUMNS[table]
    if (columns.length !== expected.length || columns.some(column => !expected.includes(column.name)))
      invalid(`${table}原字段不完整或包含未知列`)
    tables[table] = await db.select<PayrollMigrationRow>(`SELECT ${expected.join(',')} FROM ${table} ORDER BY rowid`)
  }
  return parsePayrollHollowDeductionTables(tables)
}
