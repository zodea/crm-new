import type { SoftDb } from '../db/soft-delete'
import type { PayrollAFeesMigrationTable } from '../payroll/central-a-fees-schema'
import type { PayrollHollowDeductionTable } from '../payroll/central-hollow-deduction-schema'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import type { PayrollCentralMigrationGraph, PayrollCentralMigrationTable } from './payroll-central-source'
import type { PayrollFeesMigrationGraph } from './payroll-fees-source'
import type { PayrollHollowMigrationGraph } from './payroll-hollow-source'
import { PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../payroll/central-a-fees-schema'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../payroll/central-hollow-deduction-schema'
import { emptyQuantityHollowMigrationGraph } from '../quantity/hollow-migration-graph'
import { buildQuantityHollowMigrationGraphs } from '../quantity/hollow-migration-source'
import { readQuantityHollowTables } from '../quantity/hollow-migration-tables'
import { parsePayrollCentralMigrationGraph, PAYROLL_CENTRAL_MIGRATION_TABLES, payrollCentralPrimaryKey, payrollCentralRowProject, readPayrollCentralMigrationGraph } from './payroll-central-source'
import { parsePayrollFeesMigrationGraph, readPayrollFeesMigrationGraph } from './payroll-fees-source'
import { parsePayrollHollowMigrationGraph, readPayrollHollowDeductionTables } from './payroll-hollow-source'
import { readPayrollProofPackages } from './payroll-proof-package'

const identity = ['id', 'created_at', 'updated_at', 'deleted_at'] as const
export const PAYROLL_MIGRATION_COLUMNS = {
  configs: [...identity, 'project_id', 'crew_id', 'leader_worker_id', 'format_family', 'unit_rate', 'rule_text', 'enabled'],
  statements: [...identity, 'project_id', 'crew_id', 'leader_worker_id', 'subject_config_id', 'month', 'format_family', 'period_kind', 'purpose', 'quantity_source', 'status', 'needs_recheck', 'pay_ratio', 'cumulative_amount', 'previously_paid', 'gross_amount', 'actual_amount', 'source_version', 'source_updated_at', 'checked_source_version', 'adjustment_reason', 'operator_name', 'snapshot_json', 'checked_at', 'submitted_at', 'released_at', 'note'],
  lines: [...identity, 'statement_id', 'worker_id', 'item_id', 'item_name', 'unit', 'quantity', 'unit_price', 'amount', 'sort_order'],
  members: ['id', 'statement_id', 'worker_id', 'is_leader', 'created_at', 'deleted_at'],
  allocations: [...identity, 'statement_id', 'worker_id', 'allocated_amount_fen'],
  attendance: [...identity, 'project_id', 'crew_id', 'worker_id', 'work_date', 'hours', 'overtime_hours', 'work_content', 'note'],
  daywork: [...identity, 'project_id', 'crew_id', 'worker_id', 'work_date', 'work_content', 'start_time', 'end_time', 'labor_units', 'witness', 'confirmed_on', 'status', 'note'],
  statementDaywork: ['id', 'statement_id', 'daywork_record_id', 'created_at', 'deleted_at'],
  logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const
export const PAYROLL_MIGRATION_TABLES = { configs: 'payroll_subject_configs', statements: 'wage_statements', lines: 'wage_statement_lines', members: 'wage_statement_members', allocations: 'wage_statement_allocations', attendance: 'attendance_records', daywork: 'signed_daywork_records', statementDaywork: 'wage_statement_daywork_records', logs: 'operation_logs' } as const
export type PayrollMigrationPart = keyof typeof PAYROLL_MIGRATION_TABLES
export type PayrollMigrationRow = Record<string, string | number | null>
export type PayrollProjectGraph = { schemaVersion: 1 | 2 | 3 | 4, projectId: string, central?: PayrollCentralMigrationGraph, fees?: PayrollFeesMigrationGraph, deductions?: PayrollHollowMigrationGraph } & Record<PayrollMigrationPart, PayrollMigrationRow[]>
export const PAYROLL_MIGRATION_PARTS = Object.keys(PAYROLL_MIGRATION_TABLES) as PayrollMigrationPart[]
const roots = ['configs', 'statements', 'attendance', 'daywork'] as const
const children = ['lines', 'members', 'allocations', 'statementDaywork'] as const
function invalid(message: string): never {
  throw new Error(`工资迁移：${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function payrollLogSnapshot(value: unknown): Record<string, unknown> | null {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : null
    return object(parsed) ? parsed : null
  }
  catch { return null }
}

/** 仅校验可传输原图，不修正日期、空值、坏快照或不可证明历史。资格另作诊断。 */
export function parsePayrollProjectGraph(value: unknown, legacyProjectId?: string): PayrollProjectGraph {
  if (!object(value) || ![1, 2, 3, 4].includes(Number(value.schemaVersion)) || typeof value.schemaVersion !== 'number' || typeof value.projectId !== 'string' || !value.projectId.trim()
    || (legacyProjectId && value.projectId !== legacyProjectId) || Object.keys(value).some(key => !['schemaVersion', 'projectId', ...(Number(value.schemaVersion) >= 2 ? ['central'] : []), ...(Number(value.schemaVersion) >= 3 ? ['fees'] : []), ...(value.schemaVersion === 4 ? ['deductions'] : []), ...PAYROLL_MIGRATION_PARTS].includes(key))) {
    invalid('完整项目图身份或结构无效')
  }
  const graph = { schemaVersion: value.schemaVersion, projectId: value.projectId, ...(value.schemaVersion >= 2 ? { central: parsePayrollCentralMigrationGraph(value.central) } : {}), ...(value.schemaVersion >= 3 ? { fees: parsePayrollFeesMigrationGraph(value.fees) } : {}), ...(value.schemaVersion === 4 ? { deductions: parsePayrollHollowMigrationGraph(value.deductions) } : {}) } as PayrollProjectGraph
  for (const part of PAYROLL_MIGRATION_PARTS) {
    const columns: readonly string[] = PAYROLL_MIGRATION_COLUMNS[part]
    const entries = value[part]
    if (!Array.isArray(entries))
      invalid(`${part}必须完整提供`)
    const ids = new Set<string>()
    graph[part] = entries.map((entry) => {
      if (!object(entry) || columns.some(key => !Object.hasOwn(entry, key)) || Object.keys(entry).some(key => !columns.includes(key))
        || columns.some(key => entry[key] !== null && typeof entry[key] !== 'string' && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key])))
        || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)) {
        invalid(`${part}字段或稳定身份无效`)
      }
      ids.add(entry.id)
      return Object.fromEntries(columns.map(key => [key, entry[key]])) as PayrollMigrationRow
    })
  }
  if (roots.some(part => graph[part].some(row => row.project_id !== graph.projectId)))
    invalid('项目图混入其他项目的根记录')
  if (graph.central && PAYROLL_CENTRAL_MIGRATION_TABLES.some(table => graph.central!.tables[table].some(row => payrollCentralRowProject(table, row, graph.central!) !== graph.projectId)))
    invalid('中央工资事实缺少父关系或混入其他项目')
  if (graph.fees && PAYROLL_A_FEES_MIGRATION_TABLES.some(table => graph.fees!.tables[table].some(row => row.project_id !== graph.projectId)))
    invalid('费用原图混入其他项目')
  if (graph.deductions && (PAYROLL_HOLLOW_DEDUCTION_TABLES.some(table => graph.deductions!.tables[table].some(row => row.project_id !== graph.projectId)) || graph.deductions.quantity.tables.quantity_hollow_records.some(row => row.project_id !== graph.projectId)))
    invalid('扣款原图或数量原件混入其他项目')
  return graph
}

/** 原行存在时以其归属为准；缺失行按最后可证明的快照归属，每个事件只接管一次。 */
export function payrollLogProject(log: PayrollMigrationRow, graphs: readonly PayrollProjectGraph[]): string | null {
  if (PAYROLL_HOLLOW_DEDUCTION_TABLES.includes(log.table_name as PayrollHollowDeductionTable)) {
    const table = log.table_name as PayrollHollowDeductionTable
    const owners = graphs.filter(graph => graph.deductions?.tables[table].some(row => row.id === log.record_id))
    if (owners.length)
      return owners.length === 1 ? owners[0]!.projectId : null
    for (const data of [log.after_data, log.before_data].map(payrollLogSnapshot)) {
      if (typeof data?.project_id === 'string')
        return graphs.some(graph => graph.projectId === data.project_id) ? data.project_id : null
    }
    return null
  }
  if (PAYROLL_A_FEES_MIGRATION_TABLES.includes(log.table_name as PayrollAFeesMigrationTable)) {
    const table = log.table_name as PayrollAFeesMigrationTable
    const owners = graphs.filter(graph => graph.fees?.tables[table].some(row => row[payrollAFeesPrimaryKey(table)] === log.record_id))
    if (owners.length)
      return owners.length === 1 ? owners[0]!.projectId : null
    for (const data of [log.after_data, log.before_data].map(payrollLogSnapshot)) {
      if (typeof data?.project_id === 'string')
        return graphs.some(graph => graph.projectId === data.project_id) ? data.project_id : null
    }
    return null
  }
  if (PAYROLL_CENTRAL_MIGRATION_TABLES.includes(log.table_name as PayrollCentralMigrationTable)) {
    const table = log.table_name as PayrollCentralMigrationTable
    const owners = graphs.filter(g => g.central?.tables[table].some(row => row[payrollCentralPrimaryKey(table)] === log.record_id))
    if (owners.length)
      return owners.length === 1 ? owners[0]!.projectId : null
    for (const data of [log.after_data, log.before_data].map(payrollLogSnapshot)) {
      if (!data)
        continue
      const matching = graphs.filter(g => g.central && payrollCentralRowProject(table, data as PayrollMigrationRow, g.central) === g.projectId)
      if (matching.length)
        return matching.length === 1 ? matching[0]!.projectId : null
    }
    return null
  }
  const part = PAYROLL_MIGRATION_PARTS.find(part => part !== 'logs' && PAYROLL_MIGRATION_TABLES[part] === log.table_name)
  if (!part)
    return null
  const owners = graphs.filter(graph => graph[part].some(row => row.id === log.record_id))
  if (owners.length)
    return owners.length === 1 ? owners[0]!.projectId : null
  for (const value of [log.after_data, log.before_data]) {
    const snapshot = payrollLogSnapshot(value)
    if (!snapshot)
      continue
    const projectId = typeof snapshot.project_id === 'string' ? snapshot.project_id : null
    const parents = graphs.filter(graph => graph.statements.some(row => row.id === snapshot.statement_id))
    if (parents.length > 1 || (projectId && parents.length && parents[0]!.projectId !== projectId))
      return null
    if (projectId || parents.length)
      return projectId ?? parents[0]!.projectId
  }
  return null
}

export async function readPayrollProjectMigrationGraphs(db: Pick<SoftDb, 'select'>): Promise<CoreMigrationSourceEntityDTO[]> {
  const tables = Object.fromEntries(await Promise.all(PAYROLL_MIGRATION_PARTS.map(async part => [part, await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_MIGRATION_COLUMNS[part].join(',')} FROM ${PAYROLL_MIGRATION_TABLES[part]} ORDER BY id`)]))) as Record<PayrollMigrationPart, PayrollMigrationRow[]>
  const projects = await db.select<{ id: string, name: string }>('SELECT id,name FROM projects ORDER BY id')
  const central = await readPayrollCentralMigrationGraph(db)
  const fees = await readPayrollFeesMigrationGraph(db)
  const deductions = await readPayrollHollowDeductionTables(db)
  const proofPackages = deductions ? await readPayrollProofPackages(db) : new Map()
  if (deductions && (!fees || !central))
    invalid('扣款扩展缺少完整中央及费用原图')
  const hollowTables = deductions ? await readQuantityHollowTables(db) : null
  const hollowGraphs = hollowTables ? await buildQuantityHollowMigrationGraphs(db, hollowTables, projects.map(project => project.id)) : null
  if (fees && !central)
    invalid('费用扩展缺少中央原图')
  const projectIds = new Set(roots.flatMap(part => tables[part].map(row => String(row.project_id))))
  if (fees) {
    for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
      for (const row of fees.tables[table]) projectIds.add(String(row.project_id))
    }
  }
  if (deductions) {
    for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
      for (const row of deductions[table]) projectIds.add(String(row.project_id))
    }
  }
  if (central) {
    for (const table of PAYROLL_CENTRAL_MIGRATION_TABLES) {
      for (const row of central.tables[table]) {
        const projectId = payrollCentralRowProject(table, row, central)
        if (!projectId)
          invalid(`${table} 缺少可证明的项目或父关系，原库保持不变`)
        projectIds.add(projectId)
      }
    }
  }
  for (const log of tables.logs) {
    if (!PAYROLL_MIGRATION_PARTS.some(part => part !== 'logs' && PAYROLL_MIGRATION_TABLES[part] === log.table_name) && !PAYROLL_CENTRAL_MIGRATION_TABLES.includes(log.table_name as PayrollCentralMigrationTable) && !PAYROLL_A_FEES_MIGRATION_TABLES.includes(log.table_name as PayrollAFeesMigrationTable) && !PAYROLL_HOLLOW_DEDUCTION_TABLES.includes(log.table_name as PayrollHollowDeductionTable))
      continue
    for (const data of [log.before_data, log.after_data].map(payrollLogSnapshot)) {
      if (typeof data?.project_id === 'string' && projects.some(project => project.id === data.project_id))
        projectIds.add(data.project_id)
    }
  }
  if (children.some(part => tables[part].some(row => !tables.statements.some(head => head.id === row.statement_id))))
    invalid('存在缺工资头的孤立子记录，无法证明项目分桶；已阻断读取，原库保持不变')
  const graphs = [...projectIds].sort().map((projectId) => {
    if (!projects.some(project => project.id === projectId))
      invalid(`项目 ${projectId} 缺少原身份，已阻断读取，原库保持不变`)
    const projectCentral = central ? { schemaVersion: 1 as const, tables: Object.fromEntries(PAYROLL_CENTRAL_MIGRATION_TABLES.map(table => [table, central.tables[table].filter(row => payrollCentralRowProject(table, row, central) === projectId)])) as PayrollCentralMigrationGraph['tables'] } : undefined
    const projectFees = fees ? { schemaVersion: 1 as const, tables: Object.fromEntries(PAYROLL_A_FEES_MIGRATION_TABLES.map(table => [table, fees.tables[table].filter(row => row.project_id === projectId)])) as PayrollFeesMigrationGraph['tables'] } : undefined
    const projectDeductions = deductions ? parsePayrollHollowMigrationGraph({ schemaVersion: 1, tables: Object.fromEntries(PAYROLL_HOLLOW_DEDUCTION_TABLES.map(table => [table, deductions[table].filter(row => row.project_id === projectId)])), quantity: hollowGraphs?.get(projectId) ?? emptyQuantityHollowMigrationGraph(), ...(proofPackages.has(projectId) ? { proof: proofPackages.get(projectId) } : {}) }) : undefined
    const graph = { schemaVersion: projectDeductions ? 4 : projectFees ? 3 : projectCentral ? 2 : 1, projectId, logs: [], ...(projectCentral ? { central: projectCentral } : {}), ...(projectFees ? { fees: projectFees } : {}), ...(projectDeductions ? { deductions: projectDeductions } : {}) } as unknown as PayrollProjectGraph
    for (const part of roots)
      graph[part] = tables[part].filter(row => row.project_id === projectId)
    for (const part of children)
      graph[part] = tables[part].filter(row => graph.statements.some(head => head.id === row.statement_id))
    return parsePayrollProjectGraph(graph)
  })
  for (const graph of graphs)
    graph.logs = tables.logs.filter(log => payrollLogProject(log, graphs) === graph.projectId)
  const payrollLogs = tables.logs.filter(log => PAYROLL_MIGRATION_PARTS.some(part => part !== 'logs' && PAYROLL_MIGRATION_TABLES[part] === log.table_name) || PAYROLL_CENTRAL_MIGRATION_TABLES.includes(log.table_name as PayrollCentralMigrationTable) || PAYROLL_A_FEES_MIGRATION_TABLES.includes(log.table_name as PayrollAFeesMigrationTable) || PAYROLL_HOLLOW_DEDUCTION_TABLES.includes(log.table_name as PayrollHollowDeductionTable))
  if (payrollLogs.some(log => !graphs.some(graph => graph.logs.some(row => row.id === log.id))))
    invalid('历史审计缺少可证明项目归属，已阻断读取，不能静默丢失')
  return graphs.map(graph => ({ legacyId: graph.projectId, name: projects.find(row => row.id === graph.projectId)!.name, references: { projectId: graph.projectId }, attributes: { payrollGraphJson: JSON.stringify(graph) } }))
}
