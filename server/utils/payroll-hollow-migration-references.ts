import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollHollowAdoption, PayrollHollowPolicyRevision, PayrollHollowScope, PayrollHollowSnapshot, PayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { QuantityHollowFact } from '../../app/lib/quantity/central-hollow-contract'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { isPayrollHollowAdoption, isPayrollHollowSnapshot, isPayrollHollowStart } from '../../app/lib/payroll/central-hollow-deduction-snapshot'
import { isPayrollHollowPolicyRevision } from '../../app/lib/payroll/central-hollow-deduction-validation'
import { payrollHollowJson, readPayrollHollowReceipt } from './payroll-hollow-data'
import { PAYROLL_HOLLOW_SQL_REFERENCES } from './payroll-hollow-migration'

/** 显式 DTO 关系遍历，原检查计数为零、后来整改或退款均不解除原引用。 */
export function createPayrollHollowReferenceCollector() {
  const refs = new Set<string>()
  const add = (table: string, id: unknown) => {
    if (typeof id === 'string' && id)
      refs.add(JSON.stringify([table, id]))
  }
  function scope(value: PayrollHollowScope) {
    add('projects', value.projectId)
    add('crews', value.crewId)
    add('workers', value.leaderWorkerId)
    if (value.book?.bookPurpose === 'management')
      add('payroll_a_management_books', value.book.managementBookId)
  }
  function fact(value: QuantityHollowFact) {
    add('quantity_hollow_records', value.recordId)
    add('projects', value.location.projectId)
    for (const [field, table] of Object.entries({ unitId: 'units', assignmentId: 'unit_assignments', roomId: 'rooms', itemId: 'items' })) add(table, value.target[field as keyof QuantityHollowFact['target']])
    for (const [field, table] of Object.entries({ buildingId: 'buildings', floorId: 'floors', templateId: 'house_type_templates', templateLineId: 'house_type_template_items' })) add(table, value.location[field as keyof QuantityHollowFact['location']])
    add(value.originalParty.kind === 'worker' ? 'workers' : 'crews', value.originalParty.kind === 'worker' ? value.originalParty.workerId : value.originalParty.crewId)
    for (const revision of value.revisions) {
      add('quantity_hollow_revisions', revision.revisionId)
      add('quantity_hollow_revisions', revision.previousRevisionId)
      add('quantity_hollow_logs', revision.logId)
    }
    for (const event of value.rectifications) {
      add('quantity_hollow_rectifications', event.id)
      add('quantity_hollow_revisions', event.revisionId)
      add('quantity_hollow_logs', event.logId)
    }
  }
  function start(value: PayrollHollowStart) {
    scope(value.scope)
    add('wage_statements', value.statementId)
    add('payroll_hollow_starts', value.id)
    add('payroll_hollow_starts', value.previousStartId)
    add('payroll_command_receipts', value.commandId)
    for (const line of value.lines) {
      fact(line.fact)
      add('payroll_hollow_policy_revisions', line.policy.revisionId)
    }
  }
  function adoption(value: PayrollHollowAdoption) {
    scope(value.scope)
    add('wage_statements', value.statementId)
    add('payroll_hollow_starts', value.startId)
    add('payroll_hollow_adoptions', value.id)
    add('payroll_command_receipts', value.commandId)
    fact(value.line.fact)
    add('payroll_hollow_policy_revisions', value.line.policy.revisionId)
  }
  function snapshot(value: PayrollHollowSnapshot) {
    scope(value.scope)
    value.facts.forEach(fact)
    for (const policy of value.policies) {
      add('items', policy.itemId)
      add('payroll_hollow_policy_revisions', policy.revisionId)
    }
    if (value.start)
      start(value.start)
    value.adoptions.forEach(adoption)
    for (const processed of value.previousProcessed) {
      adoption(processed.adoption)
      processed.adjustmentIds.forEach(id => add('payroll_adjustments', id))
    }
  }
  return { refs, add, scope, fact, start, adoption, snapshot }
}

export async function payrollHollowMigrationReferences(tx: TransactionDb): Promise<Set<string>> {
  const { refs, add, scope, start, adoption, snapshot } = createPayrollHollowReferenceCollector()
  const present = new Set((await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    if (!present.has(table))
      continue
    const rows = await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)
    for (const row of rows) {
      for (const [field, target] of Object.entries(PAYROLL_HOLLOW_SQL_REFERENCES)) add(target, row[field])
      const raw = payrollHollowJson(row[table === 'payroll_hollow_policy_revisions' ? 'revision_json' : table === 'payroll_hollow_starts' ? 'start_json' : 'adoption_json'])
      if (table === 'payroll_hollow_policy_revisions' && isPayrollHollowPolicyRevision(raw)) {
        const value: PayrollHollowPolicyRevision = raw
        scope(value.scope)
        add('items', value.itemId)
        add('payroll_hollow_policies', value.policyId)
        add('payroll_hollow_policy_revisions', value.previousRevisionId)
      }
      else if (table === 'payroll_hollow_starts' && isPayrollHollowStart(raw)) {
        start(raw)
      }
      else if (table === 'payroll_hollow_adoptions' && isPayrollHollowAdoption(raw)) {
        adoption(raw)
      }
      else {
        throw payrollProblem('conflict', '空鼓扣款原件字段无法确认恢复引用')
      }
    }
  }
  const receipts = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE action IN (\'save-hollow-policies\',\'start-hollow-deduction\')')
  for (const row of receipts) {
    const { command, result } = readPayrollHollowReceipt(row)
    add('projects', command.projectId)
    add('wage_statements', command.target?.statementId)
    if (command.config)
      scope(command.config.scope)
    if (command.action.kind === 'save-hollow-policies') {
      for (const draft of command.action.policies) {
        add('payroll_hollow_policies', draft.policyId)
        add('payroll_hollow_policy_revisions', draft.baseRevisionId)
        add('items', draft.itemId)
      }
    }
    add('payroll_hollow_starts', result.startId)
    result.policyRevisionIds.forEach(id => add('payroll_hollow_policy_revisions', id))
  }
  const heads = await tx.select<{ id: string, snapshot_json: string | null }>('SELECT id,snapshot_json FROM wage_statements WHERE snapshot_json IS NOT NULL')
  for (const head of heads) {
    const raw = payrollHollowJson(head.snapshot_json)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      continue
    for (const name of ['aDocument', 'c1Document', 'c2Document']) {
      const document = (raw as Record<string, unknown>)[name]
      if (!document || typeof document !== 'object' || !Object.hasOwn(document, 'hollow'))
        continue
      const hollow = (document as Record<string, unknown>).hollow
      if (!isPayrollHollowSnapshot(hollow))
        throw payrollProblem('conflict', '工资冻结的空鼓原件无法确认恢复引用')
      snapshot(hollow)
    }
  }
  return refs
}
