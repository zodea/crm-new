import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollFeesMigrationGraph } from '../../app/lib/migration/payroll-fees-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollAFeesMigrationTable } from '../../app/lib/payroll/central-a-fees-schema'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { initializePayrollAFeesSchema, PAYROLL_A_FEES_MIGRATION_COLUMNS, PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
export const PAYROLL_FEES_SQL_REFERENCES = { project_id: 'projects', crew_id: 'crews', leader_worker_id: 'workers', manager_worker_id: 'workers', statement_id: 'wage_statements', first_statement_id: 'wage_statements', management_book_id: 'payroll_a_management_books', management_revision_id: 'payroll_a_management_book_revisions' }
export function mapPayrollFeesMigrationGraph(source: PayrollFeesMigrationGraph | undefined, entityId: string, mapping: Map<string, PayrollIdentityMapping>): PayrollFeesMigrationGraph | undefined {
  if (!source)
    return undefined
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
    const primary = payrollAFeesPrimaryKey(table)
    for (const row of source.tables[table]) {
      const legacyId = String(row[primary])
      const centralId = primary === 'statement_id' ? mapping.get(key('wage_statements', legacyId))?.centralId ?? null : `${entityId}:${table}:${encodeURIComponent(legacyId)}`
      mapping.set(key(table, legacyId), { tableName: table, legacyId, centralId })
    }
  }
  return { schemaVersion: 1, tables: Object.fromEntries(PAYROLL_A_FEES_MIGRATION_TABLES.map(table => [table, source.tables[table].map(row => mapPayrollFeesMigrationRow(table, row, entityId, mapping))])) as PayrollFeesMigrationGraph['tables'] }
}
export function mapPayrollFeesMigrationRow(table: PayrollAFeesMigrationTable, row: PayrollMigrationRow, entityId: string, mapping: ReadonlyMap<string, PayrollIdentityMapping>): PayrollMigrationRow {
  function id(table: string, value: unknown): string | null {
    if (value === null)
      return null
    const target = mapping.get(key(table, value))?.centralId
    if (!target)
      throw payrollProblem('conflict', `工资迁移：费用原图 ${table}/${String(value)} 缺少明确映射`)
    return target
  }
  const primary = payrollAFeesPrimaryKey(table)
  const result = { ...row, [primary]: id(table, row[primary]) }
  for (const [field, target] of Object.entries(PAYROLL_FEES_SQL_REFERENCES)) {
    if (field !== primary && Object.hasOwn(row, field))
      result[field] = id(target, row[field])
  }
  if (table === 'payroll_a_fee_revisions')
    result.fee_id = `${entityId}:payroll-fee:${encodeURIComponent(String(row.fee_id))}`
  if (table === 'payroll_a_negative_lines')
    result.line_id = `${entityId}:payroll-negative-line:${encodeURIComponent(String(row.line_id))}`
  if (table === 'payroll_a_management_ownership') {
    let parts: unknown
    try {
      parts = JSON.parse(String(row.ownership_key))
    }
    catch { throw payrollProblem('conflict', '费用原归属键不是明确五段身份') }
    if (!Array.isArray(parts) || parts.length !== 5 || parts.some(part => typeof part !== 'string' || !part) || JSON.stringify(parts) !== row.ownership_key)
      throw payrollProblem('conflict', '费用原归属键不是明确五段身份')
    result.ownership_key = JSON.stringify(['projects', 'units', 'unit_assignments', 'rooms', 'items'].map((table, index) => id(table, parts[index])))
  }
  return result
}
export function payrollFeesGraphKeys(graph: PayrollFeesMigrationGraph | undefined): string[] {
  return graph ? PAYROLL_A_FEES_MIGRATION_TABLES.flatMap(table => graph.tables[table].map(row => key(table, row[payrollAFeesPrimaryKey(table)]))) : []
}
export function payrollFeesGraphFingerprint(graph: PayrollFeesMigrationGraph | undefined) {
  return graph ? PAYROLL_A_FEES_MIGRATION_TABLES.map(table => [table, graph.tables[table].toSorted((a, b) => String(a[payrollAFeesPrimaryKey(table)]).localeCompare(String(b[payrollAFeesPrimaryKey(table)]))).map(row => PAYROLL_A_FEES_MIGRATION_COLUMNS[table].map(column => row[column]))]) : null
}
export async function readPayrollFeesMigrationRows(tx: TransactionDb): Promise<PayrollFeesMigrationGraph> {
  await initializePayrollAFeesSchema(tx)
  const tables = {} as PayrollFeesMigrationGraph['tables']
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) tables[table] = await tx.select<PayrollMigrationRow>(`SELECT ${PAYROLL_A_FEES_MIGRATION_COLUMNS[table].join(',')} FROM ${table} ORDER BY rowid`)
  return { schemaVersion: 1, tables }
}
export async function insertPayrollFeesMigrationGraph(tx: TransactionDb, graph: PayrollFeesMigrationGraph | undefined) {
  if (!graph)
    return
  await initializePayrollAFeesSchema(tx)
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
    const columns = PAYROLL_A_FEES_MIGRATION_COLUMNS[table]
    for (const row of graph.tables[table]) await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
}
export async function removePayrollFeesMigrationGraph(tx: TransactionDb, graph: PayrollFeesMigrationGraph | undefined) {
  if (!graph)
    return
  for (const table of [...PAYROLL_A_FEES_MIGRATION_TABLES].reverse()) {
    for (const row of graph.tables[table]) await tx.execute(`DELETE FROM ${table} WHERE ${payrollAFeesPrimaryKey(table)}=?`, [row[payrollAFeesPrimaryKey(table)]])
  }
}
