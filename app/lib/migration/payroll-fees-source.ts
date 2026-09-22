import type { SoftDb } from '../db/soft-delete'
import type { PayrollAFeesMigrationTable } from '../payroll/central-a-fees-schema'
import type { PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollMigrationRow } from './payroll-source'
import { PAYROLL_A_FEES_MIGRATION_COLUMNS, PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../payroll/central-a-fees-schema'

export interface PayrollFeesMigrationGraph extends PayrollJsonObject { schemaVersion: 1, tables: Record<PayrollAFeesMigrationTable, PayrollMigrationRow[]> }
function invalid(message: string): never {
  throw new Error(`工资迁移：费用原图${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePayrollFeesMigrationGraph(value: unknown): PayrollFeesMigrationGraph {
  if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'tables'].includes(key)) || !object(value.tables) || Object.keys(value.tables).some(key => !PAYROLL_A_FEES_MIGRATION_TABLES.includes(key as PayrollAFeesMigrationTable)))
    invalid('结构无效')
  const tables = {} as PayrollFeesMigrationGraph['tables']
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
    const rows = value.tables[table]
    const columns: readonly string[] = PAYROLL_A_FEES_MIGRATION_COLUMNS[table]
    const primary = payrollAFeesPrimaryKey(table)
    const ids = new Set<string>()
    if (!Array.isArray(rows))
      invalid(`缺少 ${table}`)
    tables[table] = rows.map((row) => {
      if (!object(row) || columns.some(column => !Object.hasOwn(row, column)) || Object.keys(row).some(column => !columns.includes(column)) || columns.some(column => row[column] !== null && typeof row[column] !== 'string' && (typeof row[column] !== 'number' || !Number.isFinite(row[column]))) || typeof row[primary] !== 'string' || !row[primary] || ids.has(row[primary]) || typeof row.project_id !== 'string' || !row.project_id)
        invalid(`${table}字段或稳定身份无效`)
      ids.add(row[primary])
      return Object.fromEntries(columns.map(column => [column, row[column]])) as PayrollMigrationRow
    })
  }
  return { schemaVersion: 1, tables }
}

/** 旧库六表全无时保留旧版本；部分表存在时必须具备完整扩展合同。 */
export async function readPayrollFeesMigrationGraph(db: Pick<SoftDb, 'select'>): Promise<PayrollFeesMigrationGraph | undefined> {
  const present = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  if (!PAYROLL_A_FEES_MIGRATION_TABLES.some(table => present.has(table)))
    return undefined
  const tables = {} as PayrollFeesMigrationGraph['tables']
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
    if (!present.has(table))
      invalid(`缺少 ${table}，不能部分导出`)
    const columns = new Set((await db.select<{ name: string }>(`PRAGMA table_info(${table})`)).map(row => row.name))
    if (PAYROLL_A_FEES_MIGRATION_COLUMNS[table].some(column => !columns.has(column)))
      invalid(`${table} 缺少原字段`)
    tables[table] = await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_A_FEES_MIGRATION_COLUMNS[table].join(',')} FROM ${table} ORDER BY rowid`)
  }
  return parsePayrollFeesMigrationGraph({ schemaVersion: 1, tables })
}
