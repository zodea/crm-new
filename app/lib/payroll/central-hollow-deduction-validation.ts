import type { PayrollHollowCommand, PayrollHollowConfigQuery, PayrollHollowPolicy, PayrollHollowPolicyDraft, PayrollHollowPolicyRevision, PayrollHollowScope } from './central-hollow-deduction-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { payrollProblem } from './central-contract'
import { wireId, wireMonth, wireNonnegative, wireObject, wireText } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

export function hollowDeductionFail(message = '空鼓扣款资料不完整或包含不支持的内容'): never {
  throw payrollProblem('validation-failed', message)
}
export function hollowDeductionKeys(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return wireObject(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
}
export function hollowDeductionExact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!hollowDeductionKeys(v, keys))
    hollowDeductionFail()
}
export function isPayrollHollowScope(v: unknown): v is PayrollHollowScope {
  if (!hollowDeductionKeys(v, ['projectId', 'crewId', 'leaderWorkerId', 'formatFamily', 'book']) || !wireId(v.projectId) || !wireId(v.leaderWorkerId) || (v.crewId !== null && !wireId(v.crewId)))
    return false
  if (v.formatFamily === 'C1' || v.formatFamily === 'C2')
    return v.book === null
  return v.formatFamily === 'A' && hollowDeductionKeys(v.book, ['bookPurpose', 'managementBookId'])
    && (v.book.bookPurpose === 'ordinary' ? v.book.managementBookId === null : v.book.bookPurpose === 'management' && isPayrollSourceIdentity(v.book.managementBookId, 'payroll_a_management_books'))
}
export function isPayrollHollowConfigQuery(v: unknown): v is PayrollHollowConfigQuery {
  return hollowDeductionKeys(v, ['scope', 'month']) && isPayrollHollowScope(v.scope) && wireMonth(v.month)
}
export function isPayrollHollowPolicyDraft(v: unknown): v is PayrollHollowPolicyDraft {
  return hollowDeductionKeys(v, ['policyId', 'baseRevisionId', 'itemId', 'enabled', 'unitAmount', 'effectiveMonth'])
    && (v.policyId === null ? v.baseRevisionId === null : isPayrollSourceIdentity(v.policyId, 'payroll-hollow-policy') && isPayrollSourceIdentity(v.baseRevisionId, 'payroll_hollow_policy_revisions'))
    && isQuantitySourceIdentity(v.itemId, 'items') && typeof v.enabled === 'boolean'
    && (v.unitAmount === null || wireNonnegative(v.unitAmount)) && wireMonth(v.effectiveMonth)
}
export function isPayrollHollowPolicy(v: unknown): v is PayrollHollowPolicy {
  if (!hollowDeductionKeys(v, ['itemId', 'itemName', 'enabled', 'unitAmount', 'source', 'revisionId', 'sourceVersion'])
    || !isQuantitySourceIdentity(v.itemId, 'items') || (v.itemName !== null && !wireText(v.itemName))
    || (v.enabled !== null && typeof v.enabled !== 'boolean') || (v.unitAmount !== null && !wireNonnegative(v.unitAmount))
    || !wireText(v.sourceVersion) || !v.sourceVersion) {
    return false
  }
  if (v.source === 'default')
    return v.revisionId === null && v.enabled === true && v.unitAmount === 30
  if (v.source === 'configured')
    return isPayrollSourceIdentity(v.revisionId, 'payroll_hollow_policy_revisions') && typeof v.enabled === 'boolean'
  return v.source === 'legacy-unavailable' && v.revisionId === null
}
export function isPayrollHollowTimestamp(v: unknown): v is string {
  return wireText(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(new Date(v).getTime())
}
export function isPayrollHollowPolicyRevision(v: unknown): v is PayrollHollowPolicyRevision {
  return hollowDeductionKeys(v, ['id', 'policyId', 'itemId', 'enabled', 'unitAmount', 'effectiveMonth', 'scope', 'previousRevisionId', 'commandId', 'createdBy', 'createdAt'])
    && isPayrollSourceIdentity(v.id, 'payroll_hollow_policy_revisions') && isPayrollSourceIdentity(v.policyId, 'payroll-hollow-policy') && isPayrollSourceIdentity(v.commandId, 'payroll_command_receipts') && wireId(v.createdBy)
    && (v.previousRevisionId === null || isPayrollSourceIdentity(v.previousRevisionId, 'payroll_hollow_policy_revisions'))
    && isQuantitySourceIdentity(v.itemId, 'items') && typeof v.enabled === 'boolean'
    && (v.unitAmount === null || wireNonnegative(v.unitAmount)) && wireMonth(v.effectiveMonth)
    && isPayrollHollowScope(v.scope) && isPayrollHollowTimestamp(v.createdAt)
}
export function assertPayrollHollowCommand(v: unknown): asserts v is PayrollHollowCommand {
  hollowDeductionExact(v, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'target', 'config', 'action'])
  if (!['commandId', 'workspaceId', 'actorId', 'projectId'].every(key => wireId(v[key])) || v.origin !== 'real' || v.requiredCapability !== 'payroll:write' || !wireText(v.sourceVersion) || !v.sourceVersion || !wireObject(v.action))
    hollowDeductionFail('空鼓扣款提交的项目、身份或权限不完整')
  if (v.action.kind === 'save-hollow-policies') {
    hollowDeductionExact(v.action, ['kind', 'policies'])
    if (v.target !== null || !isPayrollHollowConfigQuery(v.config) || v.config.scope.projectId !== v.projectId || !Array.isArray(v.action.policies) || !v.action.policies.length || !v.action.policies.every(isPayrollHollowPolicyDraft)
      || new Set(v.action.policies.map(policy => policy.itemId)).size !== v.action.policies.length) {
      hollowDeductionFail('扣款配置须绑定原请款主体和项目，分项不可重复')
    }
  }
  else if (v.action.kind === 'start-hollow-deduction') {
    hollowDeductionExact(v.action, ['kind'])
    if (v.config !== null || !hollowDeductionKeys(v.target, ['statementId', 'draftKey']) || !isPayrollSourceIdentity(v.target.statementId, 'wage_statements') || v.target.draftKey !== null)
      hollowDeductionFail('请先保存工资草稿，再对这张单明确开始扣款')
  }
  else {
    hollowDeductionFail('不支持的空鼓扣款动作')
  }
}
