import type { SoftDb } from '../db/soft-delete'
import type { PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollMigrationRow } from './payroll-source'

/** P7 original plans and attempts remain source history, never current execution authority. */
export const PAYROLL_COORDINATION_COLUMNS = {
  payroll_a_rounding_revisions: ['id', 'project_id', 'leader_worker_id', 'book_purpose', 'management_book_id', 'effective_month', 'revision', 'rule_json', 'operator_id', 'created_at'],
  payroll_batch_plans: ['id', 'workspace_id', 'actor_id', 'origin', 'project_id', 'month', 'purpose', 'schema_version', 'plan_json', 'plan_hash', 'base_payroll_revision', 'expected_payroll_revision', 'next_item_index', 'revision', 'state', 'created_at', 'confirmed_at'],
  payroll_batch_attempts: ['id', 'plan_id', 'item_id', 'attempt_no', 'prepare_command_id', 'execute_command_id', 'payroll_command_id', 'command_json', 'command_hash', 'execute_json', 'execute_hash', 'basis_hash', 'before_payroll_revision', 'after_payroll_revision', 'state', 'result_json', 'problem_json', 'created_at', 'finished_at'],
  payroll_batch_command_receipts: ['command_id', 'workspace_id', 'actor_id', 'project_id', 'plan_id', 'action', 'command_json', 'fingerprint', 'result_json', 'created_at'],
} as const
export type PayrollCoordinationTable = keyof typeof PAYROLL_COORDINATION_COLUMNS
export const PAYROLL_COORDINATION_TABLES = Object.keys(PAYROLL_COORDINATION_COLUMNS) as PayrollCoordinationTable[]
export interface PayrollCoordinationGraph extends PayrollJsonObject { schemaVersion: 1, presentTables: PayrollCoordinationTable[], tables: Record<PayrollCoordinationTable, PayrollMigrationRow[]> }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(): never {
  throw new Error('工资P7取整、完整原计划或原执行证据无法核实')
}

export function coordinationRowProject(table: PayrollCoordinationTable, row: PayrollMigrationRow, graph: PayrollCoordinationGraph): string | null {
  return table === 'payroll_batch_attempts' ? String(graph.tables.payroll_batch_plans.find(plan => plan.id === row.plan_id)?.project_id ?? '') || null : typeof row.project_id === 'string' ? row.project_id : null
}
export function parsePayrollCoordinationGraph(raw: unknown): PayrollCoordinationGraph {
  if (!object(raw) || raw.schemaVersion !== 1 || Object.keys(raw).sort().join(',') !== 'presentTables,schemaVersion,tables' || !object(raw.tables) || Object.keys(raw.tables).sort().join(',') !== [...PAYROLL_COORDINATION_TABLES].sort().join(',') || !Array.isArray(raw.presentTables) || new Set(raw.presentTables).size !== raw.presentTables.length || raw.presentTables.some(table => !PAYROLL_COORDINATION_TABLES.includes(table)))
    invalid()
  const tables = {} as PayrollCoordinationGraph['tables']
  for (const table of PAYROLL_COORDINATION_TABLES) {
    const rows = raw.tables[table]
    const columns: readonly string[] = PAYROLL_COORDINATION_COLUMNS[table]
    if (!Array.isArray(rows) || (!raw.presentTables.includes(table) && rows.length))
      invalid()
    const ids = new Set<string>()
    tables[table] = rows.map((row) => {
      if (!object(row) || Object.keys(row).sort().join(',') !== [...columns].sort().join(',') || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))))
        invalid()
      const id = row[table === 'payroll_batch_command_receipts' ? 'command_id' : 'id']
      if (typeof id !== 'string' || !id || ids.has(id))
        invalid()
      ids.add(id)
      for (const [field, value] of Object.entries(row)) {
        if (field.endsWith('_json') && value !== null) {
          if (typeof value !== 'string')
            invalid()
          try {
            JSON.parse(value)
          }
          catch { invalid() }
        }
      }
      return row as PayrollMigrationRow
    })
  }
  const graph: PayrollCoordinationGraph = { schemaVersion: 1, presentTables: [...raw.presentTables], tables }
  for (const row of tables.payroll_batch_attempts) {
    const plan = tables.payroll_batch_plans.find(plan => plan.id === row.plan_id)
    if (!plan)
      invalid()
  }
  for (const row of tables.payroll_batch_command_receipts) {
    const plan = tables.payroll_batch_plans.find(plan => plan.id === row.plan_id)
    if (!plan || row.project_id !== plan.project_id || row.workspace_id !== plan.workspace_id || row.actor_id !== plan.actor_id)
      invalid()
  }
  return graph
}
export async function readPayrollCoordinationGraph(db: Pick<SoftDb, 'select'>): Promise<PayrollCoordinationGraph | undefined> {
  const present = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  const presentTables = PAYROLL_COORDINATION_TABLES.filter(table => present.has(table))
  if (!presentTables.length)
    return undefined
  const tables = Object.fromEntries(await Promise.all(PAYROLL_COORDINATION_TABLES.map(async table => [table, present.has(table) ? await db.select(`SELECT ${PAYROLL_COORDINATION_COLUMNS[table].join(',')} FROM ${table} ORDER BY ${table === 'payroll_batch_command_receipts' ? 'command_id' : 'id'}`) : []])))
  return parsePayrollCoordinationGraph({ schemaVersion: 1, presentTables, tables })
}
