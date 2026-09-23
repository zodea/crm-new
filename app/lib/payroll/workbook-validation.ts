import type { PayrollWorkbookCommand, PayrollWorkbookInput } from './central-workbook-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollProblem } from './central-contract'
import { numberingExact, numberingObject } from './central-numbering-codec'
import { isPayrollSourceIdentity } from './migration-identity'

export const workbookText = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
export function parsePayrollWorkbookInput(value: unknown): PayrollWorkbookInput {
  if (!numberingObject(value) || !numberingExact(value, ['projectId', 'mode', 'statementIds', 'rosterArchiveId'])
    || !isStableRouteIdentity(value.projectId) || !['leader-cycle', 'project-month'].includes(String(value.mode))
    || !Array.isArray(value.statementIds) || !value.statementIds.length || value.statementIds.length > 2000
    || !value.statementIds.every(id => isPayrollSourceIdentity(id, 'wage_statements')) || new Set(value.statementIds).size !== value.statementIds.length
    || !(value.rosterArchiveId === null || isStableRouteIdentity(value.rosterArchiveId))) {
    throw payrollProblem('validation-failed', '请明确同项目的原工资范围、输出模式及所选名册版本')
  }
  return { ...value, statementIds: [...value.statementIds].sort() } as PayrollWorkbookInput
}
export function parsePayrollWorkbookCommand(value: unknown): PayrollWorkbookCommand {
  if (!numberingObject(value) || !numberingExact(value, ['schemaVersion', 'commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'input', 'action'])
    || value.schemaVersion !== 1 || ![value.commandId, value.workspaceId, value.actorId].every(isStableRouteIdentity)
    || value.origin !== 'real' || value.requiredCapability !== 'payroll:write' || !workbookText(value.sourceVersion) || value.action !== 'archive') {
    throw payrollProblem('validation-failed', '工资输出目录提交不完整')
  }
  return { ...value, input: parsePayrollWorkbookInput(value.input) } as PayrollWorkbookCommand
}
