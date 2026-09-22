import type { SoftDb } from '../db/soft-delete'
import type { PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollMigrationRow } from './payroll-source'

/** 完整中央证据扩展；所有 JSON 正文逐字运输，映射只作用于 SQL 身份列。 */
export const PAYROLL_CENTRAL_MIGRATION_COLUMNS = {
  payroll_a_subject_configs: ['id', 'project_id', 'crew_id', 'leader_worker_id', 'initial_pay_ratio', 'revision', 'updated_at', 'deleted_at'],
  payroll_a_price_revisions: ['id', 'price_id', 'project_id', 'crew_id', 'leader_worker_id', 'item_id', 'unit', 'mode', 'worker_id', 'effective_month', 'unit_price', 'scope_json', 'revision', 'operator_id', 'created_at'],
  payroll_a_statement_sources: ['statement_id', 'project_id', 'leader_worker_id', 'source_json'],
  payroll_c1_rate_revisions: ['id', 'project_id', 'worker_id', 'effective_month', 'daily_wage', 'overtime_rate', 'revision', 'operator_id', 'created_at'],
  payroll_c1_statement_sources: ['statement_id', 'project_id', 'leader_worker_id', 'source_json'],
  payroll_c2_statement_sources: ['statement_id', 'project_id', 'leader_worker_id', 'source_json'],
  payroll_command_receipts: ['command_id', 'actor_id', 'project_id', 'statement_id', 'config_scope_json', 'action', 'fingerprint', 'result_json', 'command_json'],
  payroll_adjustments: ['id', 'root_adjustment_id', 'corrects_adjustment_id', 'original_statement_id', 'project_id', 'format_family', 'status', 'reason', 'evidence_note', 'basis_json', 'signed_delta_fen', 'confirmed_snapshot_json', 'created_by', 'confirmed_by', 'confirmed_at', 'created_at', 'updated_at'],
  payroll_actual_events: ['id', 'project_id', 'kind', 'occurred_on', 'signed_amount_fen', 'proof_json', 'confirmed_snapshot_json', 'reverses_kind', 'reverses_id', 'confirmed_by', 'confirmed_at'],
  payroll_actual_allocations: ['id', 'event_id', 'worker_id', 'signed_amount_fen', 'proof_json'],
  payroll_adjustment_applications: ['id', 'adjustment_id', 'root_adjustment_id', 'kind', 'signed_applied_fen', 'actual_event_id', 'released_statement_id', 'balance_version', 'proof_json'],
  payroll_a_adjustment_coverage: ['id', 'adjustment_id', 'statement_id', 'component_key', 'command_id', 'source_version', 'coverage_json'],
} as const
export type PayrollCentralMigrationTable = keyof typeof PAYROLL_CENTRAL_MIGRATION_COLUMNS
export const PAYROLL_CENTRAL_MIGRATION_TABLES = Object.keys(PAYROLL_CENTRAL_MIGRATION_COLUMNS) as PayrollCentralMigrationTable[]
export interface PayrollCentralMigrationGraph extends PayrollJsonObject { schemaVersion: 1, tables: Record<PayrollCentralMigrationTable, PayrollMigrationRow[]> }
export function payrollCentralPrimaryKey(table: PayrollCentralMigrationTable): string {
  return table === 'payroll_command_receipts' ? 'command_id' : table.endsWith('_statement_sources') ? 'statement_id' : 'id'
}
function invalid(message: string): never {
  throw new Error(`工资迁移：中央完整原图${message}`)
}
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
export function parsePayrollCentralMigrationGraph(value: unknown): PayrollCentralMigrationGraph {
  if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(k => !['schemaVersion', 'tables'].includes(k)) || !object(value.tables) || Object.keys(value.tables).some(k => !PAYROLL_CENTRAL_MIGRATION_TABLES.includes(k as PayrollCentralMigrationTable)))
    invalid('结构无效')
  const tables = {} as PayrollCentralMigrationGraph['tables']
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
    const rows = value.tables[table]
    const columns: readonly string[] = PAYROLL_CENTRAL_MIGRATION_COLUMNS[table]
    const key = payrollCentralPrimaryKey(table)
    const ids = new Set<string>()
    if (!Array.isArray(rows))
      invalid(`缺少 ${table}`)
    tables[table] = rows.map((row) => {
      if (!object(row) || columns.some(c => !Object.hasOwn(row, c)) || Object.keys(row).some(c => !columns.includes(c)) || columns.some(c => row[c] !== null && typeof row[c] !== 'string' && (typeof row[c] !== 'number' || !Number.isFinite(row[c]))) || typeof row[key] !== 'string' || !row[key] || ids.has(row[key]))
        invalid(`${table} 原字段或身份无效`)
      ids.add(row[key])
      return { ...row } as PayrollMigrationRow
    })
  }
  return { schemaVersion: 1, tables }
}
export async function readPayrollCentralMigrationGraph(db: Pick<SoftDb, 'select'>): Promise<PayrollCentralMigrationGraph | undefined> {
  const present = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(t => t.name))
  const tables = {} as PayrollCentralMigrationGraph['tables']
  for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
    if (!present.has(table)) {
      tables[table] = []
      continue
    }
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(${table})`)
    const fields = PAYROLL_CENTRAL_MIGRATION_COLUMNS[table].map(c => columns.some(column => column.name === c) ? c : ['command_json', 'reverses_kind', 'reverses_id'].includes(c) ? `NULL AS ${c}` : invalid(`${table}.${c} 缺失`))
    tables[table] = await db.select<PayrollMigrationRow>(`SELECT ${fields.join(',')} FROM ${table} ORDER BY rowid`)
  }
  return PAYROLL_CENTRAL_MIGRATION_TABLES.some(table => present.has(table)) ? parsePayrollCentralMigrationGraph({ schemaVersion: 1, tables }) : undefined
}

/** 明确按根行或外键归属分桶；缺父不能静默丢失实际记录。 */
export function payrollCentralRowProject(table: PayrollCentralMigrationTable, row: PayrollMigrationRow, full: PayrollCentralMigrationGraph): string | null {
  if (typeof row.project_id === 'string')
    return row.project_id
  if (table === 'payroll_actual_allocations')
    return String(full.tables.payroll_actual_events.find(r => r.id === row.event_id)?.project_id ?? '') || null
  if (table === 'payroll_adjustment_applications' || table === 'payroll_a_adjustment_coverage')
    return String(full.tables.payroll_adjustments.find(r => r.id === row.adjustment_id)?.project_id ?? '') || null
  return null
}
