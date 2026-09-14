import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollCentralMigrationGraph, PayrollCentralMigrationTable } from '../../app/lib/migration/payroll-central-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollAFeesMigrationTable } from '../../app/lib/payroll/central-a-fees-schema'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { PAYROLL_CENTRAL_MIGRATION_COLUMNS, PAYROLL_CENTRAL_MIGRATION_TABLES, payrollCentralPrimaryKey } from '../../app/lib/migration/payroll-central-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { initializePayrollAdjustmentSchema } from '../../app/lib/payroll/central-adjustment-schema'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
const references = { project_id: 'projects', crew_id: 'crews', leader_worker_id: 'workers', worker_id: 'workers', item_id: 'items', statement_id: 'wage_statements', original_statement_id: 'wage_statements', released_statement_id: 'wage_statements', root_adjustment_id: 'payroll_adjustments', corrects_adjustment_id: 'payroll_adjustments', adjustment_id: 'payroll_adjustments', actual_event_id: 'payroll_actual_events', event_id: 'payroll_actual_events', command_id: 'payroll_command_receipts' }
function invalid(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', `工资迁移：中央工资原图${message}`))
}

export function mapPayrollCentralMigrationGraph(source: PayrollCentralMigrationGraph | undefined, entityId: string, mapping: Map<string, PayrollIdentityMapping>): PayrollCentralMigrationGraph | undefined {
  if (!source)
    return undefined
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
    const primary = payrollCentralPrimaryKey(table)
    for (const row of source.tables[table]) {
      const id = String(row[primary])
      const centralId = primary === 'statement_id' ? mapping.get(key('wage_statements', id))?.centralId ?? null : `${entityId}:${table}:${encodeURIComponent(id)}`
      mapping.set(key(table, id), { tableName: table, legacyId: id, centralId })
    }
  }
  const tables = {} as PayrollCentralMigrationGraph['tables']
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) tables[table] = source.tables[table].map(row => mapPayrollCentralMigrationRow(table, row, entityId, mapping))
  return { schemaVersion: 1, tables }
}
export function mapPayrollCentralMigrationRow(table: PayrollCentralMigrationTable, row: PayrollMigrationRow, entityId: string, mapping: ReadonlyMap<string, PayrollIdentityMapping>): PayrollMigrationRow {
  function mapped(table: string, id: unknown): string | null {
    if (id === null)
      return null
    const identity = mapping.get(key(table, id))
    if (!identity?.centralId)
      invalid(` ${table}/${String(id)} 缺少明确身份，不能部分接管更正或实际收付`)
    return identity.centralId
  }
  const primary = payrollCentralPrimaryKey(table)
  const result = { ...row, [primary]: mapped(table, row[primary]) }
  for (const [field, target] of Object.entries(references)) {
    if (Object.hasOwn(row, field) && field !== primary)
      result[field] = mapped(target, row[field])
  }
  if (row.reverses_id !== null && row.reverses_id !== undefined) {
    if (!['released-statement', 'actual-event'].includes(String(row.reverses_kind)))
      invalid('错记冲销指向种类无效')
    result.reverses_id = mapped(row.reverses_kind === 'released-statement' ? 'wage_statements' : 'payroll_actual_events', row.reverses_id)
  }
  // price_id 是价格修订系列身份，没有独立表；以本原图命名空间隔离。
  if (table === 'payroll_a_price_revisions')
    result.price_id = `${entityId}:payroll-price:${encodeURIComponent(String(row.price_id))}`
  return result
}
export function payrollCentralGraphKeys(graph: PayrollCentralMigrationGraph | undefined): string[] {
  return graph ? PAYROLL_CENTRAL_MIGRATION_TABLES.flatMap(table => graph.tables[table].map(row => key(table, row[payrollCentralPrimaryKey(table)]))) : []
}
export function payrollCentralGraphFingerprint(graph: PayrollCentralMigrationGraph | undefined) {
  return graph ? PAYROLL_CENTRAL_MIGRATION_TABLES.map(table => [table, graph.tables[table].toSorted((a, b) => String(a[payrollCentralPrimaryKey(table)]).localeCompare(String(b[payrollCentralPrimaryKey(table)]))).map(row => PAYROLL_CENTRAL_MIGRATION_COLUMNS[table].map(column => row[column]))]) : null
}
export async function readPayrollCentralMigrationRows(tx: TransactionDb): Promise<PayrollCentralMigrationGraph> {
  await initializePayrollAdjustmentSchema(tx)
  const tables = {} as PayrollCentralMigrationGraph['tables']
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) tables[table] = await tx.select<PayrollMigrationRow>(`SELECT ${PAYROLL_CENTRAL_MIGRATION_COLUMNS[table].join(',')} FROM ${table} ORDER BY rowid`)
  return { schemaVersion: 1, tables }
}
export async function removePayrollCentralMigrationGraph(tx: TransactionDb, graph: PayrollCentralMigrationGraph | undefined) {
  if (!graph)
    return
  for (const table of [...PAYROLL_CENTRAL_MIGRATION_TABLES].reverse()) {
    for (const row of graph.tables[table]) await tx.execute(`DELETE FROM ${table} WHERE ${payrollCentralPrimaryKey(table)}=?`, [row[payrollCentralPrimaryKey(table)]])
  }
}
export async function insertPayrollCentralMigrationGraph(tx: TransactionDb, graph: PayrollCentralMigrationGraph | undefined) {
  if (!graph)
    return
  await initializePayrollAdjustmentSchema(tx)
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
    const columns = PAYROLL_CENTRAL_MIGRATION_COLUMNS[table]
    for (const row of graph.tables[table]) await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(c => row[c]))
  }
}

/** 迁入所有者的原行先逐字段核对；只有独立事实才构成反向阻挡。 */
export function payrollIndependentReferenceReader(tx: TransactionDb, owned: Set<string>): TransactionDb {
  return { execute: tx.execute.bind(tx), async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await tx.select<Record<string, unknown>>(sql, params)
    const table = /\bFROM\s+([a-z_]\w*)/i.exec(sql)?.[1]
    if (!table)
      return rows as T[]
    const primary = PAYROLL_CENTRAL_MIGRATION_TABLES.includes(table as PayrollCentralMigrationTable) ? payrollCentralPrimaryKey(table as PayrollCentralMigrationTable) : PAYROLL_A_FEES_MIGRATION_TABLES.includes(table as PayrollAFeesMigrationTable) ? payrollAFeesPrimaryKey(table as PayrollAFeesMigrationTable) : 'id'
    return rows.filter(row => !owned.has(key(table, row[primary]))) as T[]
  } }
}
