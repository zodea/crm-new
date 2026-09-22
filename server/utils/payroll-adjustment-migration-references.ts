import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAAdjustmentCoverage } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollActualFact, PayrollActualRef } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollAdjustmentBasisDraft, PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import { createHash } from 'node:crypto'
import { isPayrollAAdjustmentCoverage, isPayrollAAdjustmentReconciliation } from '../../app/lib/payroll/central-a-adjustment-validation'
import { isPayrollActualSnapshot } from '../../app/lib/payroll/central-actual-codec'
import { decodePayrollAdjustmentResult, isPayrollAdjustmentConfirmedSnapshot } from '../../app/lib/payroll/central-adjustment-codec'
import { initializePayrollAdjustmentSchema } from '../../app/lib/payroll/central-adjustment-schema'
import { assertPayrollAdjustmentDraft } from '../../app/lib/payroll/central-adjustment-validation'
import { encodePayrollAdjustmentWire, parsePayrollAdjustmentCommand } from '../../app/lib/payroll/central-adjustment-wire'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { wireExact, wireId, wireObject } from '../../app/lib/payroll/central-payroll-wire'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { createPayrollFeesReferenceCollector } from './payroll-fees-migration-references'
import { createPayrollHollowReferenceCollector } from './payroll-hollow-migration-references'

export const PAYROLL_ADJUSTMENT_REFERENCE_TABLES = ['payroll_adjustments', 'payroll_actual_events', 'payroll_actual_allocations', 'payroll_adjustment_applications', 'payroll_a_adjustment_coverage'] as const
const actions = ['save-adjustment-draft', 'confirm-adjustment', 'confirm-actual-payment', 'confirm-recording-reversal']
function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', '工资迁移：独立更正、补退或处理原证据无法确认，不能安全撤回来源'))
}
function json(value: unknown): Record<string, unknown> {
  try {
    const data: unknown = typeof value === 'string' ? JSON.parse(value) : null
    if (wireObject(data))
      return data
  }
  catch { /* 非空坏证据不能当作没有引用。 */ }
  return invalid()
}
export function createPayrollAdjustmentReferenceCollector() {
  const refs = new Set<string>()
  function add(table: string, id: unknown) {
    if (id === null || id === undefined)
      return
    if (!wireId(id))
      invalid()
    refs.add(JSON.stringify([table, id]))
  }
  function subject(value: { projectId?: unknown, crewId?: unknown, workerId?: unknown, leaderWorkerId?: unknown }) {
    add('projects', value.projectId)
    add('crews', value.crewId)
    add('workers', value.workerId)
    add('workers', value.leaderWorkerId)
  }
  function actualRef(value: PayrollActualRef) {
    add(value.kind === 'released-statement' ? 'wage_statements' : 'payroll_actual_events', value.kind === 'released-statement' ? value.statementId : value.eventId)
  }
  function original(value: PayrollOriginalWageRef) {
    subject(value)
    if (value.book)
      add('payroll_a_management_books', value.book.managementBookId)
    add('wage_statements', value.statementId)
    value.memberWorkerIds.forEach(id => add('workers', id))
    value.members.forEach(subject)
  }
  function coverage(value: PayrollAAdjustmentCoverage) {
    const revisionTable = value.negativeLineId ? 'payroll_a_negative_lines' : value.feeComponentKey ? 'payroll_a_fee_revisions' : 'payroll_a_price_revisions'
    add('payroll_adjustments', value.adjustmentId)
    add('payroll_adjustments', value.rootAdjustmentId)
    add('wage_statements', value.originalStatementId)
    add(revisionTable, value.originalPriceRevisionId)
    add(revisionTable, value.currentPriceRevisionId)
  }
  function basis(value: PayrollAdjustmentBasisDraft | null) {
    if (!value)
      return
    if (value.hollow) {
      const hollow = createPayrollHollowReferenceCollector()
      hollow.snapshot(value.hollow.source)
      for (const component of value.hollow.components) {
        hollow.add('payroll_hollow_adoptions', component.adoptionId)
        hollow.add('quantity_hollow_records', component.recordId)
      }
      for (const reference of hollow.refs) refs.add(reference)
    }
    if (value.formatFamily === 'C1') {
      value.rates.forEach((rate) => {
        subject(rate)
        add('payroll_c1_rate_revisions', rate.configId)
      })
      value.records.forEach((record) => {
        subject(record)
        add('attendance_records', record.recordId)
      })
    }
    else if (value.formatFamily === 'C2') {
      add('payroll_subject_configs', value.configId)
      value.records.forEach((record) => {
        subject(record)
        add('signed_daywork_records', record.recordId)
      })
    }
    else {
      const fees = createPayrollFeesReferenceCollector()
      if (value.source.schemaVersion !== 1) {
        fees.identity(value.source.book)
        fees.feesSnapshot(value.source.fees)
      }
      if (value.source.schemaVersion === 3) {
        const hollow = createPayrollHollowReferenceCollector()
        hollow.snapshot(value.source.hollow)
        for (const reference of hollow.refs) refs.add(reference)
      }
      if (value.fees)
        fees.basis(value.fees)
      for (const reference of fees.refs) refs.add(reference)
      subject(value.source.subject)
      value.source.subject.memberWorkerIds.forEach(id => add('workers', id))
      const fields = { completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', unitId: 'units', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms', itemId: 'items' } as const
      for (const fact of value.source.facts) {
        subject(fact)
        for (const [field, table] of Object.entries(fields)) add(table, fact[field as keyof typeof fields])
        fact.assignmentScopeIds.forEach(id => add('unit_assignment_scopes', id))
        fact.scopeRows.forEach((row) => {
          add('unit_assignment_scopes', row.id)
          add('rooms', row.roomId)
          add('items', row.itemId)
        })
      }
      for (const price of value.source.priceRevisions) {
        subject(price)
        add('payroll_a_price_revisions', price.id)
        add('items', price.itemId)
        if (price.scope.kind === 'cells') {
          price.scope.cells.forEach((cell) => {
            add('units', cell.unitId)
            add('rooms', cell.roomId)
            add('items', cell.itemId)
          })
        }
      }
      value.components.forEach(component => add('payroll_a_price_revisions', component.priceRevisionId))
      if (value.source.adjustmentReconciliation)
        reconciliation(value.source.adjustmentReconciliation)
    }
  }
  function reconciliation(value: unknown) {
    if (!isPayrollAAdjustmentReconciliation(value))
      invalid()
    basis(value.rawBasis)
    basis(value.effectiveBasis)
    value.coverage.forEach(coverage)
  }
  function fact(value: PayrollActualFact) {
    actualRef(value.ref)
    if (value.reverses)
      actualRef(value.reverses)
    add('projects', value.projectId)
    value.originalStatementIds.forEach(id => add('wage_statements', id))
    value.adjustmentIds.forEach(id => add('payroll_adjustments', id))
    value.applicationIds.forEach(id => add('payroll_adjustment_applications', id))
    value.allocations.forEach(subject)
    value.historicalMembers.forEach(subject)
  }
  return { refs, add, subject, actualRef, original, coverage, basis, reconciliation, fact }
}

/** P4 必须先分派，不能把更正正文交给旧 A 解码而误阻无关项目恢复。 */
export function payrollAdjustmentReceiptReferences(value: Record<string, unknown>): Set<string> | null {
  if (!actions.includes(String(value.action)))
    return null
  const c = createPayrollAdjustmentReferenceCollector()
  try {
    const raw = json(value.command_json)
    if (payrollCanonical(raw) !== value.command_json || createHash('sha256').update(String(value.command_json)).digest('hex') !== value.fingerprint)
      invalid()
    const command = parsePayrollAdjustmentCommand(encodePayrollAdjustmentWire(raw))
    const result = decodePayrollAdjustmentResult(json(value.result_json), command)
    if (value.command_id !== command.commandId || value.actor_id !== command.actorId || value.project_id !== command.projectId || value.action !== command.action.kind || value.statement_id !== result.originalStatementId || value.config_scope_json !== null)
      invalid()
    c.add('projects', command.projectId)
    c.add('wage_statements', result.originalStatementId)
    c.add('payroll_adjustments', result.adjustmentId)
    c.add('payroll_actual_events', result.actualEventId)
    result.applicationIds.forEach(id => c.add('payroll_adjustment_applications', id))
    if ('adjustmentId' in command.target) {
      c.add('payroll_adjustments', command.target.adjustmentId)
      if (command.target.adjustmentId === null)
        c.add('wage_statements', command.target.originalStatementId)
    }
    else if (command.target.kind === 'actual-payment') {
      command.target.adjustmentIds.forEach(id => c.add('payroll_adjustments', id))
    }
    else {
      c.actualRef(command.target.original)
    }
    if (command.action.kind === 'save-adjustment-draft') {
      c.add('payroll_adjustments', command.action.draft.correctsAdjustmentId)
      c.basis(command.action.draft.basis)
    }
    else if (command.action.kind === 'confirm-actual-payment') {
      command.action.payment.allocations.forEach(c.subject)
    }
    return c.refs
  }
  catch { return invalid() }
}

/** 工资域五张独立表、原审计和冻结覆盖均是恢复保护来源，不通过当前姓名反推关系。 */
export async function payrollAdjustmentMigrationReferences(tx: TransactionDb): Promise<Set<string>> {
  await initializePayrollAdjustmentSchema(tx)
  const c = createPayrollAdjustmentReferenceCollector()
  const fields = { project_id: 'projects', worker_id: 'workers', original_statement_id: 'wage_statements', statement_id: 'wage_statements', released_statement_id: 'wage_statements', root_adjustment_id: 'payroll_adjustments', corrects_adjustment_id: 'payroll_adjustments', adjustment_id: 'payroll_adjustments', event_id: 'payroll_actual_events', actual_event_id: 'payroll_actual_events' }
  function row(table: string, value: Record<string, unknown>) {
    for (const [field, target] of Object.entries(fields)) c.add(target, value[field])
    if (table === 'payroll_adjustments') {
      const draft = { reason: value.reason, evidenceNote: value.evidence_note, correctsAdjustmentId: value.corrects_adjustment_id, basis: value.basis_json === 'null' ? null : json(value.basis_json) }
      assertPayrollAdjustmentDraft(draft)
      c.basis(draft.basis)
      if (value.confirmed_snapshot_json !== null) {
        const snapshot = json(value.confirmed_snapshot_json)
        if (!isPayrollAdjustmentConfirmedSnapshot(snapshot))
          invalid()
        c.original(snapshot.original)
        c.basis(snapshot.preview.before)
        c.basis(snapshot.preview.after)
        c.add('payroll_adjustments', snapshot.rootAdjustmentId)
        c.add('payroll_adjustments', snapshot.correctsAdjustmentId)
      }
    }
    else if (table === 'payroll_actual_events') {
      const snapshot: unknown = json(value.confirmed_snapshot_json)
      if (!isPayrollActualSnapshot(snapshot))
        invalid()
      snapshot.originals.forEach(c.original)
      snapshot.applicationIds.forEach(id => c.add('payroll_adjustment_applications', id))
      if ('kind' in snapshot) {
        c.fact(snapshot.originalFact)
        snapshot.applications.forEach((application) => {
          c.add('payroll_adjustments', application.adjustmentId)
          c.add('payroll_adjustments', application.rootAdjustmentId)
          c.add('payroll_adjustment_applications', application.originalApplicationId)
        })
      }
      else {
        snapshot.draft.allocations.forEach(c.subject)
        snapshot.draft.applications.forEach(application => c.add('payroll_adjustments', application.adjustmentId))
      }
    }
    else if (table === 'payroll_actual_allocations') {
      const proof = json(value.proof_json)
      wireExact(proof, ['workerId', 'workerName', 'crewId'])
      c.subject(proof)
    }
    else if (table === 'payroll_adjustment_applications') {
      const proof = json(value.proof_json)
      if (value.kind === 'recording-reversal')
        c.add('payroll_adjustment_applications', proof.originalApplicationId)
      else if (value.kind === 'later-release')
        c.add('wage_statements', proof.originalStatementId)
      else if (value.kind !== 'actual-payment')
        invalid()
    }
    else if (table === 'payroll_a_adjustment_coverage') {
      const proof = json(value.coverage_json)
      if (!isPayrollAAdjustmentCoverage(proof))
        invalid()
      c.coverage(proof)
    }
  }
  try {
    for (const table of PAYROLL_ADJUSTMENT_REFERENCE_TABLES) {
      for (const value of await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) row(table, value)
    }
    const logs = await tx.select<{ table_name: string, record_id: string, before_data: string | null, after_data: string | null }>(`SELECT * FROM operation_logs WHERE table_name IN (${PAYROLL_ADJUSTMENT_REFERENCE_TABLES.map(() => '?').join(',')})`, [...PAYROLL_ADJUSTMENT_REFERENCE_TABLES])
    for (const log of logs) {
      c.add(log.table_name, log.record_id)
      for (const value of [log.before_data, log.after_data]) {
        if (value !== null)
          row(log.table_name, json(value))
      }
    }
    for (const value of await tx.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources')) {
      const source = json(value.source_json)
      if (source.adjustmentReconciliation !== undefined)
        c.reconciliation(source.adjustmentReconciliation)
    }
    return c.refs
  }
  catch { return invalid() }
}
