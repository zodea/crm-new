import type { QuantityHollowFact } from '../quantity/central-hollow-contract'
import type { QuantityHollowCommandKey, QuantityHollowMigrationGraph } from '../quantity/hollow-migration-contract'
import type { PayrollHollowAdjustmentBasis, PayrollHollowAdoption, PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowPolicy, PayrollHollowPolicyRevision, PayrollHollowScope, PayrollHollowSelectedLine, PayrollHollowSnapshot, PayrollHollowStart } from './central-hollow-deduction-contract'
import { hollowCommandIdentity } from '../quantity/hollow-migration-graph'
import { quantityHollowTypedMapper } from '../quantity/hollow-migration-mapping'
import { payrollProblem } from './central-contract'

export const PAYROLL_HOLLOW_OUTPUT_IDENTITY_TABLES = ['payroll_hollow_policy_revisions', 'payroll_hollow_starts', 'payroll_hollow_adoptions', 'payroll_a_management_books', 'payroll_command_receipts', 'payroll_adjustments', 'quantity_hollow_records', 'quantity_hollow_revisions', 'quantity_hollow_rectifications', 'quantity_hollow_logs', 'quantity_hollow_log_commands', 'units', 'unit_assignments', 'rooms', 'items', 'buildings', 'floors', 'house_type_templates', 'house_type_template_items'] as const

export function createPayrollMigratedHollowMapper(d: { id: (table: string, id: string) => string, nullableId: (table: string, id: string | null) => string | null, quantity?: QuantityHollowMigrationGraph, quantityCommand?: (logId: string, commandId: string) => string }) {
  const { id, nullableId } = d
  function scope(value: PayrollHollowScope): PayrollHollowScope {
    const common = { projectId: id('projects', value.projectId), crewId: nullableId('crews', value.crewId), leaderWorkerId: id('workers', value.leaderWorkerId) }
    return value.formatFamily === 'A' ? { ...value, ...common, book: value.book.bookPurpose === 'ordinary' ? value.book : { ...value.book, managementBookId: id('payroll_a_management_books', value.book.managementBookId) } } : { ...value, ...common }
  }
  const quantity = quantityHollowTypedMapper(id, key => ({ ...key, commandId: id('quantity_hollow_commands', hollowCommandIdentity(key)) }))
  function fact(value: QuantityHollowFact): QuantityHollowFact {
    if (!d.quantity && !d.quantityCommand)
      throw payrollProblem('unavailable', '工资扣款缺少已证数量原件闭包')
    return quantity.fact(value, (logId, commandId): QuantityHollowCommandKey => {
      const log = d.quantity!.tables.quantity_hollow_logs.find(row => row.id === logId)
      const receipt = d.quantity!.tables.quantity_hollow_command_receipts.find(row => row.id === log?.command_receipt_id)
      if (!log || !receipt || receipt.command_id !== commandId || log.record_id !== value.recordId || receipt.record_id !== value.recordId)
        throw payrollProblem('unavailable', '工资采用的原检查命令三元组无法证明')
      return { workspaceId: String(receipt.workspace_id), actorId: String(receipt.actor_id), commandId }
    }, d.quantityCommand)
  }
  function policy(value: PayrollHollowPolicy): PayrollHollowPolicy {
    return { ...value, itemId: id('items', value.itemId), revisionId: nullableId('payroll_hollow_policy_revisions', value.revisionId) }
  }
  function policyRevision(value: PayrollHollowPolicyRevision): PayrollHollowPolicyRevision {
    return { ...value, id: id('payroll_hollow_policy_revisions', value.id), policyId: id('payroll_hollow_policies', value.policyId), itemId: id('items', value.itemId), previousRevisionId: nullableId('payroll_hollow_policy_revisions', value.previousRevisionId), scope: scope(value.scope), commandId: id('payroll_command_receipts', value.commandId) }
  }
  function line(value: PayrollHollowSelectedLine): PayrollHollowSelectedLine {
    return { ...value, recordId: id('quantity_hollow_records', value.recordId), proof: quantity.proof(value.proof), fact: fact(value.fact), policy: policy(value.policy) }
  }
  function start(value: PayrollHollowStart): PayrollHollowStart {
    return { ...value, id: id('payroll_hollow_starts', value.id), projectId: id('projects', value.projectId), statementId: id('wage_statements', value.statementId), previousStartId: nullableId('payroll_hollow_starts', value.previousStartId), scope: scope(value.scope), lines: value.lines.map(line), commandId: id('payroll_command_receipts', value.commandId) }
  }
  function adoption(value: PayrollHollowAdoption): PayrollHollowAdoption {
    return { ...value, id: id('payroll_hollow_adoptions', value.id), projectId: id('projects', value.projectId), statementId: id('wage_statements', value.statementId), startId: id('payroll_hollow_starts', value.startId), scope: scope(value.scope), line: line(value.line), commandId: id('payroll_command_receipts', value.commandId) }
  }
  function snapshot(value: PayrollHollowSnapshot): PayrollHollowSnapshot {
    return { ...value, scope: scope(value.scope), facts: value.facts.map(fact), policies: value.policies.map(policy), start: value.start === null ? null : start(value.start), previousProcessed: value.previousProcessed.map(row => ({ ...row, adoption: adoption(row.adoption), adjustmentIds: row.adjustmentIds.map(value => id('payroll_adjustments', value)) })), adoptions: value.adoptions.map(adoption) }
  }
  function command(value: PayrollHollowCommand): PayrollHollowCommand {
    return { ...value, commandId: id('payroll_command_receipts', value.commandId), projectId: id('projects', value.projectId), target: value.target?.statementId ? { statementId: id('wage_statements', value.target.statementId), draftKey: null } : value.target, config: value.config ? { ...value.config, scope: scope(value.config.scope) } : null, action: value.action.kind === 'save-hollow-policies' ? { ...value.action, policies: value.action.policies.map(policy => ({ ...policy, policyId: nullableId('payroll_hollow_policies', policy.policyId), baseRevisionId: nullableId('payroll_hollow_policy_revisions', policy.baseRevisionId), itemId: id('items', policy.itemId) })) } : value.action }
  }
  function basis(value: PayrollHollowAdjustmentBasis): PayrollHollowAdjustmentBasis {
    return { ...value, source: snapshot(value.source), components: value.components.map(row => ({ ...row, adoptionId: id('payroll_hollow_adoptions', row.adoptionId), recordId: id('quantity_hollow_records', row.recordId) })) }
  }
  function result(value: PayrollHollowCommandResult): PayrollHollowCommandResult {
    return { ...value, commandId: id('payroll_command_receipts', value.commandId), projectId: id('projects', value.projectId), statementId: nullableId('wage_statements', value.statementId), startId: nullableId('payroll_hollow_starts', value.startId), policyRevisionIds: value.policyRevisionIds.map(value => id('payroll_hollow_policy_revisions', value)), logIds: value.logIds.map(value => id('operation_logs', value)) }
  }
  return { scope, policy, policyRevision, line, start, adoption, fact, snapshot, command, result, basis }
}
