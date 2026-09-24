import type { PayrollActualPaymentDraft, PayrollActualPaymentTarget } from './central-actual-contract'
import type { PayrollActualPaymentCommand } from './central-adjustment-contract'
import { payrollProblem } from './central-contract'
import { wireExact, wireId, wireNullableNumber, wireObject, wireText } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

function fail(message: string): never {
  throw payrollProblem('validation-failed', message)
}
export function assertPayrollActualTarget(value: unknown): asserts value is PayrollActualPaymentTarget {
  wireExact(value, ['kind', 'draftKey', 'adjustmentIds'])
  if (value.kind !== 'actual-payment' || !wireId(value.draftKey) || !Array.isArray(value.adjustmentIds) || !value.adjustmentIds.length || !value.adjustmentIds.every(id => isPayrollSourceIdentity(id, 'payroll_adjustments')) || new Set(value.adjustmentIds).size !== value.adjustmentIds.length)
    fail('实际补退须指定独立草稿及不重复的原更正')
}
export function assertPayrollActualDraft(value: unknown): asserts value is PayrollActualPaymentDraft {
  wireExact(value, ['kind', 'occurredOn', 'amount', 'evidenceNote', 'allocations', 'applications'])
  if (!['supplement', 'refund'].includes(String(value.kind)) || !wireText(value.occurredOn) || !wireText(value.evidenceNote) || !wireNullableNumber(value.amount) || !Array.isArray(value.allocations) || !Array.isArray(value.applications))
    fail('实际补退字段不完整')
  for (const row of value.allocations) {
    wireExact(row, ['workerId', 'amount'])
    if (!wireId(row.workerId) || !wireNullableNumber(row.amount))
      fail('实际收退款人员或金额不完整')
  }
  for (const row of value.applications) {
    wireExact(row, ['adjustmentId', 'amount', 'balanceVersion'])
    if (!isPayrollSourceIdentity(row.adjustmentId, 'payroll_adjustments') || !wireNullableNumber(row.amount) || !wireText(row.balanceVersion))
      fail('更正处理关联或采用余额版本不完整')
  }
}
export function assertPayrollActualCommand(value: unknown): asserts value is PayrollActualPaymentCommand {
  wireExact(value, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'target', 'action'])
  if (!['commandId', 'workspaceId', 'actorId', 'projectId'].every(k => wireId(value[k])) || !wireText(value.sourceVersion) || !value.sourceVersion || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'payroll:write' || !wireObject(value.action))
    fail('实际补退提交身份不完整')
  assertPayrollActualTarget(value.target)
  wireExact(value.action, ['kind', 'payment'])
  if (value.action.kind !== 'confirm-actual-payment')
    fail('实际补退动作无效')
  assertPayrollActualDraft(value.action.payment)
}
