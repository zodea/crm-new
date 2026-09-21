import type { PayrollARoundingCommand, PayrollARoundingCommandResult, PayrollARoundingRead, PayrollARoundingRevision, PayrollARoundingScope } from './central-a-rounding-contract'
import type { PayrollQuery } from './central-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { isPayrollABook } from './central-a-fees-validation'
import { payrollProblem } from './central-contract'

const month = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => !Object.keys(value).some(key => !keys.includes(key))
function fail(message: string): never {
  throw payrollProblem('validation-failed', message)
}

function rule(value: unknown): value is PayrollARoundingRevision['rule'] {
  return object(value) && exact(value, value.kind === 'off' ? ['kind'] : ['kind', 'stepFen'])
    && (value.kind === 'off' || (value.kind === 'floor' && value.stepFen === 10_000))
}

function scope(value: unknown): value is PayrollARoundingScope {
  return object(value) && exact(value, ['projectId', 'leaderWorkerId', 'book', 'month'])
    && isStableRouteIdentity(value.projectId) && isStableRouteIdentity(value.leaderWorkerId)
    && isPayrollABook(value.book) && month(value.month)
}

function revision(value: unknown): value is PayrollARoundingRevision {
  return object(value) && exact(value, ['id', 'projectId', 'leaderWorkerId', 'book', 'effectiveMonth', 'revision', 'rule', 'operatorId', 'createdAt', 'sourceVersion'])
    && isStableRouteIdentity(value.id) && isStableRouteIdentity(value.projectId) && isStableRouteIdentity(value.leaderWorkerId)
    && isPayrollABook(value.book) && month(value.effectiveMonth) && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && rule(value.rule) && isStableRouteIdentity(value.operatorId) && typeof value.createdAt === 'string' && !!value.createdAt
    && typeof value.sourceVersion === 'string' && !!value.sourceVersion
}

export function parsePayrollARoundingScope(value: unknown): PayrollARoundingScope {
  if (!scope(value))
    fail('A 工资取整范围无效')
  return value as PayrollARoundingScope
}

export function parsePayrollARoundingCommand(value: unknown): PayrollARoundingCommand {
  if (!object(value) || !exact(value, ['schemaVersion', 'commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'scope', 'action'])
    || value.schemaVersion !== 1 || !isStableRouteIdentity(value.commandId) || !isStableRouteIdentity(value.workspaceId) || !isStableRouteIdentity(value.actorId)
    || value.origin !== 'real' || value.requiredCapability !== 'payroll:write' || typeof value.sourceVersion !== 'string' || !value.sourceVersion || !scope(value.scope)
    || !object(value.action) || !exact(value.action, ['kind', 'rule']) || value.action.kind !== 'save-a-rounding' || !rule(value.action.rule)) {
    fail('A 工资取整提交不完整')
  }
  return value as unknown as PayrollARoundingCommand
}

export function decodePayrollARoundingRead(value: unknown, query: PayrollQuery, target: PayrollARoundingScope): PayrollARoundingRead {
  if (!object(value) || !object(value.context) || !scope(value.scope) || JSON.stringify(value.scope) !== JSON.stringify(target)
    || value.context.origin !== query.origin || !Array.isArray(value.context.capabilities) || !value.context.capabilities.includes('payroll:read')
    || typeof value.context.workspaceId !== 'string' || typeof value.context.actorId !== 'string' || typeof value.context.sourceVersion !== 'string' || typeof value.context.readonly !== 'boolean'
    || !(value.current === null || revision(value.current)) || !Array.isArray(value.revisions) || !value.revisions.every(revision)
    || !Array.isArray(value.readonlyReasons) || !value.readonlyReasons.every(item => typeof item === 'string')) {
    fail('A 工资取整读取不完整')
  }
  return value as unknown as PayrollARoundingRead
}

export function decodePayrollARoundingResult(value: unknown, command: PayrollARoundingCommand): PayrollARoundingCommandResult {
  if (!object(value) || value.schemaVersion !== 1 || value.commandId !== command.commandId || !revision(value.revision)
    || value.revision.projectId !== command.scope.projectId || value.revision.leaderWorkerId !== command.scope.leaderWorkerId
    || JSON.stringify(value.revision.book) !== JSON.stringify(command.scope.book) || value.revision.effectiveMonth !== command.scope.month
    || JSON.stringify(value.revision.rule) !== JSON.stringify(command.action.rule) || typeof value.sourceVersion !== 'string' || !value.sourceVersion) {
    fail('A 工资取整回执与原提交不一致')
  }
  return value as unknown as PayrollARoundingCommandResult
}
