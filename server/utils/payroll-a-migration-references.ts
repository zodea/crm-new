import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollACommand } from '../../app/lib/payroll/central-a-contract'
import { createHash } from 'node:crypto'
import { payrollACanonical } from '../../app/lib/payroll/central-a-calculation'
import { encodePayrollAWire, parsePayrollACommand } from '../../app/lib/payroll/central-a-codec'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { payrollC1ReceiptReferences } from './payroll-c1-migration-references'
import { payrollC2ReceiptReferences } from './payroll-c2-migration-references'

export const PAYROLL_A_REFERENCE_TABLES = ['payroll_a_subject_configs', 'payroll_a_price_revisions', 'payroll_a_statement_sources', 'payroll_command_receipts'] as const
const sqlFields = { project_id: 'projects', crew_id: 'crews', leader_worker_id: 'workers', worker_id: 'workers', item_id: 'items', statement_id: 'wage_statements' }
const sourceFields = { projectId: 'projects', crewId: 'crews', leaderWorkerId: 'workers', workerId: 'workers', itemId: 'items', completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', unitId: 'units', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms' }

function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', '工资迁移：新增 A 类原证据结构不可确认，不能安全撤回来源'))
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid()
}
function json(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string')
    return invalid()
  try {
    return object(JSON.parse(value))
  }
  catch { return invalid() }
}

/** 只解析 P1 封闭契约中的稳定关系；旧 snapshot_json 及未知扩展不递归猜 ID。 */
export async function payrollAMigrationReferences(db: TransactionDb): Promise<Set<string>> {
  const result = new Set<string>()
  function add(table: string, id: unknown) {
    if (id === null || id === undefined)
      return
    if (typeof id !== 'string' || !id)
      invalid()
    result.add(JSON.stringify([table, id]))
  }
  function fields(row: Record<string, unknown>, names: Record<string, string>) {
    for (const [field, table] of Object.entries(names)) add(table, row[field])
  }
  function priceScope(scope: Record<string, unknown>) {
    if (scope.kind === 'project')
      return
    if (scope.kind !== 'cells')
      invalid()
    for (const cell of array(scope.cells)) fields(object(cell), sourceFields)
  }
  function source(source: Record<string, unknown>) {
    if (source.schemaVersion !== 1)
      invalid()
    const subject = object(source.subject)
    fields(subject, sourceFields)
    for (const member of array(subject.memberWorkerIds)) add('workers', member)
    for (const value of array(source.facts)) {
      const fact = object(value)
      fields(fact, sourceFields)
      for (const id of array(fact.assignmentScopeIds)) add('unit_assignment_scopes', id)
      for (const value of array(fact.scopeRows)) {
        const scope = object(value)
        add('unit_assignment_scopes', scope.id)
        fields(scope, sourceFields)
      }
    }
    for (const value of array(source.priceRevisions)) {
      const price = object(value)
      fields(price, sourceFields)
      priceScope(object(price.scope))
    }
  }
  function receiptCommand(value: Record<string, unknown>) {
    const specific = payrollC1ReceiptReferences(value) ?? payrollC2ReceiptReferences(value)
    if (specific) {
      for (const reference of specific) result.add(reference)
      return
    }
    // 旧 NULL 没有原正文证据；只保留已有 SQL 列引用，不反推或回填命令。
    const raw = value.command_json
    if (raw === null || raw === undefined)
      return
    if (typeof raw !== 'string')
      invalid()
    const data = json(raw)
    if (payrollACanonical(data) !== raw || createHash('sha256').update(raw).digest('hex') !== value.fingerprint)
      invalid()
    let command: PayrollACommand
    try {
      command = parsePayrollACommand(encodePayrollAWire(data))
    }
    catch { return invalid() }
    for (const [field, submitted] of [['command_id', command.commandId], ['actor_id', command.actorId], ['project_id', command.projectId], ['action', command.action.kind]] as const) {
      if (value[field] !== undefined && value[field] !== submitted)
        invalid()
    }
    add('projects', command.projectId)
    add('wage_statements', command.statementId)
    if (command.configScope)
      fields({ ...command.configScope }, sourceFields)
    const action = command.action
    if (action.kind === 'save-a-draft') {
      fields({ ...action.draft }, sourceFields)
      for (const id of action.draft.memberWorkerIds) add('workers', id)
    }
    else if (action.kind === 'release-a') {
      for (const allocation of action.release.allocations) add('workers', allocation.workerId)
    }
    else if (action.kind === 'save-a-subject-config') {
      fields({ ...action.config }, sourceFields)
    }
    else if (action.kind === 'save-a-prices') {
      for (const price of action.prices) {
        fields({ ...price }, sourceFields)
        priceScope({ ...price.scope })
      }
    }
  }
  function row(table: string, value: Record<string, unknown>) {
    fields(value, sqlFields)
    if (table === 'payroll_a_price_revisions' && value.scope_json !== undefined)
      priceScope(json(value.scope_json))
    if (table === 'payroll_a_statement_sources' && value.source_json !== undefined)
      source(json(value.source_json))
    if (table === 'payroll_command_receipts') {
      if (value.config_scope_json !== null && value.config_scope_json !== undefined)
        fields(json(value.config_scope_json), sourceFields)
      receiptCommand(value)
    }
  }
  for (const table of PAYROLL_A_REFERENCE_TABLES) {
    for (const value of await db.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) row(table, value)
  }
  const logs = await db.select<{ table_name: string, record_id: string, before_data: string | null, after_data: string | null }>(`SELECT table_name,record_id,before_data,after_data FROM operation_logs WHERE table_name IN (${PAYROLL_A_REFERENCE_TABLES.map(() => '?').join(',')})`, [...PAYROLL_A_REFERENCE_TABLES])
  for (const log of logs) {
    add(log.table_name, log.record_id)
    for (const data of [log.before_data, log.after_data]) {
      if (data !== null)
        row(log.table_name, json(data))
    }
  }
  return result
}
