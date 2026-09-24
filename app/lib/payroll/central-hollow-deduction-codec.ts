import type { PayrollQuery } from './central-contract'
import type { PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowConfigQuery, PayrollHollowConfigRead } from './central-hollow-deduction-contract'
import { payrollCanonical } from './central-command-shared'
import { isPayrollHollowConfigRead } from './central-hollow-deduction-read'
import { assertPayrollHollowCommand, hollowDeductionExact, hollowDeductionFail } from './central-hollow-deduction-validation'
import { decodePayrollHollowWire } from './central-hollow-deduction-wire'
import { wireText } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

export { isPayrollHollowConfigRead, isPayrollHollowRead } from './central-hollow-deduction-read'
export { decodePayrollHollowWire, encodePayrollHollowWire } from './central-hollow-deduction-wire'

export function decodePayrollHollowConfigRead(raw: unknown, query: PayrollQuery, target: PayrollHollowConfigQuery): PayrollHollowConfigRead {
  const value = decodePayrollHollowWire(raw)
  if (!isPayrollHollowConfigRead(value) || value.context.origin !== query.origin || payrollCanonical(value.query) !== payrollCanonical(target))
    hollowDeductionFail('空鼓配置读取与固定主体或月份不一致')
  return value
}

export function parsePayrollHollowCommand(raw: unknown): PayrollHollowCommand {
  const command = decodePayrollHollowWire(raw)
  assertPayrollHollowCommand(command)
  return command
}

export function decodePayrollHollowResult(value: unknown, command: PayrollHollowCommand): PayrollHollowCommandResult {
  hollowDeductionExact(value, ['commandId', 'projectId', 'statementId', 'startId', 'policyRevisionIds', 'sourceVersion', 'outcome', 'logIds'])
  if (value.commandId !== command.commandId || value.projectId !== command.projectId || !wireText(value.sourceVersion) || !value.sourceVersion
    || !Array.isArray(value.policyRevisionIds) || !value.policyRevisionIds.every(id => isPayrollSourceIdentity(id, 'payroll_hollow_policy_revisions')) || new Set(value.policyRevisionIds).size !== value.policyRevisionIds.length
    || !Array.isArray(value.logIds) || !value.logIds.length || !value.logIds.every(id => isPayrollSourceIdentity(id, 'operation_logs')) || new Set(value.logIds).size !== value.logIds.length) {
    hollowDeductionFail('扣款提交回执与原命令不匹配')
  }
  if (command.action.kind === 'start-hollow-deduction') {
    if (value.outcome !== 'started' || value.statementId !== command.target?.statementId || !isPayrollSourceIdentity(value.startId, 'payroll_hollow_starts') || value.policyRevisionIds.length)
      hollowDeductionFail('扣款启动回执缺少原单或准确启动记录')
  }
  else if (value.outcome !== 'saved' || value.statementId !== null || value.startId !== null || value.policyRevisionIds.length !== command.action.policies.length) {
    hollowDeductionFail('扣款配置回执的修订集合不完整')
  }
  return value as unknown as PayrollHollowCommandResult
}
