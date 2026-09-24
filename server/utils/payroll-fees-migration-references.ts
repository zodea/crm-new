import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAFeesSourceSnapshot } from '../../app/lib/payroll/central-a-fees-contract'
import { createHash } from 'node:crypto'
import { payrollACanonical } from '../../app/lib/payroll/central-a-calculation'
import { encodePayrollAFeesWire, parsePayrollAFeesCommand } from '../../app/lib/payroll/central-a-fees-codec'
import { PAYROLL_A_FEES_MIGRATION_TABLES } from '../../app/lib/payroll/central-a-fees-schema'
import { isPayrollAStatementSourceSnapshotV2 } from '../../app/lib/payroll/central-a-fees-validation'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { PAYROLL_FEES_SQL_REFERENCES } from './payroll-fees-migration'

const fields = { projectId: 'projects', crewId: 'crews', leaderWorkerId: 'workers', workerId: 'workers', managerWorkerId: 'workers', statementId: 'wage_statements', firstStatementId: 'wage_statements', firstCommandId: 'payroll_command_receipts', managementBookId: 'payroll_a_management_books', managementRevisionId: 'payroll_a_management_book_revisions', originalNegativeRevisionId: 'payroll_a_negative_lines', feeRevisionId: 'payroll_a_fee_revisions', completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', unitId: 'units', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms', itemId: 'items' }
function invalid(): never {
  throw payrollProblem('conflict', '工资迁移：费用原证据引用无法确认，不能安全撤回来源')
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid()
function json(v: unknown): Record<string, unknown> {
  try {
    return object(JSON.parse(String(v)))
  }
  catch { return invalid() }
}
function nullableJson(v: unknown): Record<string, unknown> | null {
  return v === null || v === 'null' ? null : json(v)
}

/** 只遍历明确 DTO 字段与六张表声明的 JSON 结构，绝不递归猜字符串。 */
export function createPayrollFeesReferenceCollector() {
  const refs = new Set<string>()
  function add(table: string, value: unknown) {
    if (value === null || value === undefined)
      return
    if (typeof value !== 'string' || !value)
      invalid()
    refs.add(JSON.stringify([table, value]))
  }
  function identity(value: unknown) {
    const row = object(value)
    for (const [field, table] of Object.entries(fields)) add(table, row[field])
    if (row.ownershipKey !== undefined) {
      let parts: unknown
      try {
        parts = JSON.parse(String(row.ownershipKey))
      }
      catch { return invalid() }
      if (!Array.isArray(parts) || parts.length !== 5 || JSON.stringify(parts) !== row.ownershipKey)
        invalid()
      ;['projects', 'units', 'unit_assignments', 'rooms', 'items'].forEach((table, index) => add(table, parts[index]))
    }
  }
  function priceScope(value: unknown) {
    const scope = object(value)
    if (scope.kind === 'project')
      return
    if (scope.kind !== 'cells')
      invalid()
    array(scope.cells).forEach(identity)
  }
  function scope(value: unknown) {
    for (const entry of array(object(value).assignments)) {
      const row = object(entry)
      identity(row)
      array(row.scopeIds).forEach(id => add('unit_assignment_scopes', id))
      array(row.cells).forEach(identity)
    }
  }
  function fact(value: unknown) {
    const row = object(value)
    identity(row)
    array(row.assignmentScopeIds).forEach(id => add('unit_assignment_scopes', id))
    array(row.scopeRows).forEach((value) => {
      identity(value)
      add('unit_assignment_scopes', object(value).id)
    })
  }
  function adoption(value: unknown) {
    if (value === null)
      return
    const row = object(value)
    if (row.kind === 'confirmed-housing-items')
      array(row.itemIds).forEach(id => add('items', id))
    else if (row.kind === 'crew-rent' || row.kind === 'crew-management')
      identity(row.fact)
    else invalid()
  }
  function actual(value: unknown) {
    if (value === null)
      return
    const row = object(value)
    if (row.kind === 'released-statement')
      add('wage_statements', row.statementId)
    else if (row.kind === 'actual-event')
      add('payroll_actual_events', row.eventId)
    else invalid()
  }
  function fee(value: unknown) {
    const row = object(value)
    identity(row)
    add('payroll_a_fee_revisions', row.id ?? row.baseRevisionId)
    const basis = object(row.basis)
    if (basis.kind !== 'completed-field-quantity')
      invalid()
    array(basis.itemIds).forEach(id => add('items', id))
    priceScope(basis.scope)
    adoption(row.adoptedDefault)
  }
  function negative(value: unknown) {
    const row = object(value)
    identity(row)
    add('payroll_a_negative_lines', row.id ?? row.baseRevisionId)
    scope(row.scope)
    actual(row.actualRef)
  }
  function proof(value: unknown) {
    const row = object(value)
    if (row.schemaVersion !== 1)
      invalid()
    identity(row)
    identity(row.identity)
    fact(row.fact)
  }
  function source(value: unknown) {
    if (!isPayrollAStatementSourceSnapshotV2(value))
      invalid()
    identity(value.book)
    feesSnapshot(value.fees)
  }
  function feesSnapshot(fees: PayrollAFeesSourceSnapshot) {
    if (fees.crewDefaults)
      identity(fees.crewDefaults)
    fees.feeRevisions.forEach(fee)
    if (fees.management) {
      identity(fees.management.book)
      add('payroll_a_management_books', fees.management.book.id)
      identity(fees.management.revision)
      add('payroll_a_management_book_revisions', fees.management.revision.id)
      scope(fees.management.revision.scope)
    }
    fees.managementOwnership.forEach((claim) => {
      identity(claim)
      add('payroll_a_management_ownership', claim.id)
      proof(claim.proof)
    })
    fees.negativeLines.forEach(negative)
    fees.lines.forEach((line) => {
      identity(line)
      line.feeRevisionIds.forEach(id => add('payroll_a_fee_revisions', id))
      line.components.forEach((component) => {
        identity(component)
        fact(component.fact)
        if (component.managementOwnership)
          identity(component.managementOwnership)
      })
    })
  }
  function basis(value: unknown) {
    const row = object(value)
    identity(row.book)
    array(row.components).forEach(identity)
    array(row.negativeLines).forEach(negative)
  }
  function row(table: string, value: Record<string, unknown>) {
    for (const [field, target] of Object.entries(PAYROLL_FEES_SQL_REFERENCES)) add(target, value[field])
    if (value.ownership_key !== undefined)
      identity({ ownershipKey: value.ownership_key })
    if (table === 'payroll_a_management_book_revisions')
      scope(json(value.scope_json))
    if (table === 'payroll_a_fee_revisions') {
      const basis = json(value.basis_json)
      array(basis.itemIds).forEach(id => add('items', id))
      priceScope(basis.scope)
      adoption(nullableJson(value.adopted_default_json))
    }
    if (table === 'payroll_a_negative_lines') {
      scope(json(value.scope_json))
      actual(nullableJson(value.actual_ref_json))
    }
    if (table === 'payroll_a_management_ownership')
      proof(json(value.proof_json))
  }
  return { refs, add, identity, scope, fee, negative, source, feesSnapshot, basis, row }
}

export function payrollFeesReceiptReferences(value: Record<string, unknown>): Set<string> | null {
  if (!['save-a-fees', 'save-a-management-book', 'start-a-management-draft', 'save-a-negative-lines'].includes(String(value.action)))
    return null
  const c = createPayrollFeesReferenceCollector()
  if (value.command_json === null || value.command_json === undefined)
    return c.refs
  const raw = String(value.command_json)
  const parsed = json(raw)
  if (payrollACanonical(parsed) !== raw || createHash('sha256').update(raw).digest('hex') !== value.fingerprint)
    invalid()
  const command = parsePayrollAFeesCommand(encodePayrollAFeesWire(parsed))
  for (const [field, expected] of [['command_id', command.commandId], ['actor_id', command.actorId], ['project_id', command.projectId], ['action', command.action.kind]] as const) {
    if (value[field] !== expected)
      invalid()
  }
  c.identity(command)
  c.identity(command.book)
  if (command.configScope) {
    c.identity(command.configScope)
    c.identity(command.configScope.book)
  }
  const action = command.action
  if (action.kind === 'save-a-fees') {
    action.fees.forEach(c.fee)
    action.remove.forEach(row => c.add('payroll_a_fee_revisions', row.baseRevisionId))
  }
  else if (action.kind === 'save-a-management-book') {
    c.identity(action.management)
    c.add('payroll_a_management_book_revisions', action.management.baseRevisionId)
    c.scope(action.management.scope)
  }
  else if (action.kind === 'start-a-management-draft') {
    c.identity(action)
  }
  else {
    action.lines.forEach(c.negative)
    action.remove.forEach(row => c.add('payroll_a_negative_lines', row.baseRevisionId))
  }
  return c.refs
}

export async function payrollFeesMigrationReferences(db: TransactionDb): Promise<Set<string>> {
  const c = createPayrollFeesReferenceCollector()
  const present = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
    if (present.has(table)) {
      for (const row of await db.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) c.row(table, row)
    }
  }
  const logs = await db.select<{ table_name: string, record_id: string, before_data: string | null, after_data: string | null }>(`SELECT id,table_name,record_id,before_data,after_data FROM operation_logs WHERE table_name IN (${PAYROLL_A_FEES_MIGRATION_TABLES.map(() => '?').join(',')})`, [...PAYROLL_A_FEES_MIGRATION_TABLES])
  for (const log of logs) {
    c.add(log.table_name, log.record_id)
    for (const data of [log.before_data, log.after_data]) {
      if (data !== null)
        c.row(log.table_name, json(data))
    }
  }
  return c.refs
}
