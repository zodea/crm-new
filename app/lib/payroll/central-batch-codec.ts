import type { PayrollBatchCommand, PayrollBatchConfirmInput, PayrollBatchDecision, PayrollBatchPlanRead, PayrollBatchPreviewInput, PayrollBatchPreviewItem, PayrollBatchPreviewRead } from './central-batch-service-contract'
import type { PayrollQuery } from './central-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollProblem } from './central-contract'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
}
function month(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)
}
function safeFen(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function nullableFen(value: unknown): value is number | null {
  return value === null || safeFen(value)
}
function fail(message: string, code: 'validation-failed' | 'unavailable' = 'validation-failed'): never {
  throw payrollProblem(code, message)
}
function target(value: unknown): value is { itemId: string, statementId: string, formatFamily: 'A' | 'C1' | 'C2' } {
  return object(value) && exact(value, ['itemId', 'statementId', 'formatFamily'])
    && isStableRouteIdentity(value.itemId) && isStableRouteIdentity(value.statementId) && ['A', 'C1', 'C2'].includes(String(value.formatFamily))
}
function allocation(value: unknown): boolean {
  return object(value) && exact(value, ['workerId', 'amountFen']) && isStableRouteIdentity(value.workerId) && safeFen(value.amountFen)
}
function decision(value: unknown): value is PayrollBatchDecision {
  if (!object(value) || typeof value.kind !== 'string')
    return false
  if (value.kind === 'defer' || value.kind === 'check')
    return exact(value, ['kind'])
  const allowed = Object.hasOwn(value, 'adjustmentApplications')
    ? ['kind', 'actualAmountFen', 'allocations', 'adjustmentApplications']
    : ['kind', 'actualAmountFen', 'allocations']
  return value.kind === 'release' && exact(value, allowed) && safeFen(value.actualAmountFen)
    && Array.isArray(value.allocations) && value.allocations.every(allocation)
    && (!Object.hasOwn(value, 'adjustmentApplications') || Array.isArray(value.adjustmentApplications))
}
export function parsePayrollBatchPreviewInput(value: unknown): PayrollBatchPreviewInput {
  if (!object(value) || !exact(value, ['purpose', 'projectId', 'month', 'statementIds', 'fundingAmountFen'])
    || !['check', 'release'].includes(String(value.purpose)) || !isStableRouteIdentity(value.projectId) || !month(value.month)
    || !Array.isArray(value.statementIds) || !value.statementIds.length || !value.statementIds.every(isStableRouteIdentity)
    || new Set(value.statementIds).size !== value.statementIds.length || !nullableFen(value.fundingAmountFen)
    || (value.purpose === 'release' ? value.fundingAmountFen === null : value.fundingAmountFen !== null)) {
    fail('批量工资预览输入不完整')
  }
  return value as unknown as PayrollBatchPreviewInput
}
function confirmInput(value: unknown): value is PayrollBatchConfirmInput {
  if (!object(value) || !exact(value, ['purpose', 'projectId', 'month', 'previewVersion', 'fundingAmountFen', 'items']))
    return false
  if (!['check', 'release'].includes(String(value.purpose)) || !isStableRouteIdentity(value.projectId) || !month(value.month)
    || typeof value.previewVersion !== 'string' || !value.previewVersion || !nullableFen(value.fundingAmountFen)
    || (value.purpose === 'release' ? value.fundingAmountFen === null : value.fundingAmountFen !== null) || !Array.isArray(value.items) || !value.items.length) {
    return false
  }
  return value.items.every(item => object(item) && exact(item, ['itemId', 'statementId', 'formatFamily', 'decision'])
    && target({ itemId: item.itemId, statementId: item.statementId, formatFamily: item.formatFamily }) && decision(item.decision))
}
export function parsePayrollBatchCommand(value: unknown): PayrollBatchCommand {
  if (!object(value) || !exact(value, ['schemaVersion', 'commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'action'])
    || value.schemaVersion !== 1 || !isStableRouteIdentity(value.commandId) || !isStableRouteIdentity(value.workspaceId) || !isStableRouteIdentity(value.actorId)
    || value.origin !== 'real' || value.requiredCapability !== 'payroll:write' || !object(value.action) || !exact(value.action, ['kind', 'input']) || !object(value.action.input)) {
    fail('批量工资确认提交不完整')
  }
  const input = value.action.input
  const validConfirm = value.action.kind === 'confirm-batch' && confirmInput(input)
  const validPrepare = value.action.kind === 'prepare-batch-item' && exact(input, ['planId', 'planVersion', 'executeCommandId'])
    && isStableRouteIdentity(input.planId) && typeof input.planVersion === 'string' && !!input.planVersion && isStableRouteIdentity(input.executeCommandId)
  const validExecute = value.action.kind === 'execute-batch-original' && exact(input, ['planId', 'planVersion'])
    && isStableRouteIdentity(input.planId) && typeof input.planVersion === 'string' && !!input.planVersion
  if (!validConfirm && !validPrepare && !validExecute)
    fail('批量工资确认提交不完整')
  return value as unknown as PayrollBatchCommand
}
function context(value: unknown, query: PayrollQuery): boolean {
  return object(value) && value.origin === query.origin && typeof value.workspaceId === 'string' && typeof value.actorId === 'string'
    && typeof value.sourceVersion === 'string' && Array.isArray(value.capabilities) && value.capabilities.includes('payroll:read') && typeof value.readonly === 'boolean'
}
function previewItem(value: unknown): value is PayrollBatchPreviewItem {
  return object(value) && target(value.target) && isStableRouteIdentity(value.leaderWorkerId) && (value.leaderName === null || typeof value.leaderName === 'string')
    && Array.isArray(value.members) && value.members.every(member => object(member) && exact(member, ['workerId', 'workerName']) && isStableRouteIdentity(member.workerId) && (member.workerName === null || typeof member.workerName === 'string'))
    && typeof value.status === 'string' && typeof value.needsRecheck === 'boolean' && nullableFen(value.eligibleAmountFen) && typeof value.requiresFullAmount === 'boolean'
    && object(value.rounding) && ['missing', 'configured', 'not-applicable'].includes(String(value.rounding.state))
    && object(value.basis) && typeof value.basis.basisHash === 'string' && typeof value.basis.checkedSourceVersion === 'string' && object(value.basis.evidence)
    && Array.isArray(value.reasons) && value.reasons.every(reason => typeof reason === 'string')
}
export function decodePayrollBatchPreview(value: unknown, query: PayrollQuery, input: PayrollBatchPreviewInput): PayrollBatchPreviewRead {
  if (!object(value) || value.schemaVersion !== 1 || !context(value.context, query) || JSON.stringify(value.input) !== JSON.stringify(input)
    || typeof value.previewVersion !== 'string' || !value.previewVersion || !Array.isArray(value.items) || !value.items.every(previewItem)
    || value.items.length !== input.statementIds.length || value.items.some((item, index) => item.target.statementId !== input.statementIds[index])
    || !(value.funding === null || object(value.funding)) || !Array.isArray(value.reasons) || !value.reasons.every(reason => typeof reason === 'string')) {
    fail('批量工资预览回读不完整', 'unavailable')
  }
  return value as unknown as PayrollBatchPreviewRead
}
function matchesPlanCommand(value: Record<string, unknown>, command?: PayrollBatchCommand): boolean {
  if (!command)
    return true
  if (!object(value.context) || value.context.workspaceId !== command.workspaceId || value.context.actorId !== command.actorId || value.context.origin !== command.origin)
    return false
  // 计划的 commandId 固定为首次确认编号；准备/执行另有自己的幂等编号。
  return command.action.kind === 'confirm-batch'
    ? value.commandId === command.commandId && value.projectId === command.action.input.projectId && value.month === command.action.input.month
    : value.planId === command.action.input.planId
}
export function decodePayrollBatchPlan(value: unknown, query: PayrollQuery, planId?: string, command?: PayrollBatchCommand): PayrollBatchPlanRead {
  if (!object(value) || value.schemaVersion !== 1 || !context(value.context, query) || !isStableRouteIdentity(value.planId) || (planId && value.planId !== planId)
    || !matchesPlanCommand(value, command) || !isStableRouteIdentity(value.commandId) || !isStableRouteIdentity(value.projectId)
    || (query.projectId && value.projectId !== query.projectId) || !month(value.month) || (query.month && value.month !== query.month)
    || !['check', 'release'].includes(String(value.purpose)) || !nullableFen(value.fundingAmountFen) || !['ready', 'prepared', 'needs-recheck', 'complete', 'unavailable'].includes(String(value.state))
    || !(value.preparedExecuteCommandId === null || isStableRouteIdentity(value.preparedExecuteCommandId))
    || !Number.isSafeInteger(value.nextItemIndex) || Number(value.nextItemIndex) < 0 || !Number.isSafeInteger(value.expectedPayrollRevision) || Number(value.expectedPayrollRevision) < 0
    || typeof value.planVersion !== 'string' || !value.planVersion || !Array.isArray(value.items)
    || !value.items.every(item => object(item) && decision(item.decision) && previewItem(item))
    || !Array.isArray(value.outcomes) || value.outcomes.length !== value.items.length || !value.outcomes.every(outcome => object(outcome)
      && isStableRouteIdentity(outcome.itemId) && ['succeeded', 'not-executed', 'unknown', 'pending', 'deferred'].includes(String(outcome.state))
      && ['not-started', 'prepared', 'checked', 'released', 'needs-recheck', 'not-applied', 'unavailable'].includes(String(outcome.attemptState))
      && nullableFen(outcome.plannedAmountFen) && nullableFen(outcome.actualAmountFen))
    || !Array.isArray(value.reasons) || !value.reasons.every(reason => typeof reason === 'string')) {
    fail('批量工资计划回读不完整', 'unavailable')
  }
  return value as unknown as PayrollBatchPlanRead
}
