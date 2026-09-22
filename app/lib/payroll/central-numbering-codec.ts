import type { PayrollAOutputRead } from './central-a-contract'
import type { PayrollC1OutputRead } from './central-c1-contract'
import type { PayrollC2OutputRead } from './central-c2-contract'
import type { PayrollQuery } from './central-contract'
import type { PayrollNumberingCommand, PayrollNumberingInput, PayrollNumberingRead, PayrollNumberingResult, PayrollNumberingSettings, PayrollOfficialIssue } from './central-numbering-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { decodePayrollARead, encodePayrollAWire } from './central-a-codec'
import { decodePayrollC1Read, encodePayrollC1Wire } from './central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire } from './central-c2-codec'
import { payrollProblem } from './central-contract'
import { isPayrollSourceIdentity } from './migration-identity'

export const numberingObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const numberingExact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
export const officialNumber = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < Number.MAX_SAFE_INTEGER
export const officialNumberText = (value: unknown): value is string => typeof value === 'string' && /^\d{1,32}$/.test(value) && officialNumber(Number(value))
function invalid(message: string): never {
  throw payrollProblem('validation-failed', message)
}
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
export function isPayrollNumberingSettings(value: unknown): value is PayrollNumberingSettings {
  return numberingObject(value) && numberingExact(value, ['id', 'projectId', 'firstNumber', 'nextNumber', 'evidenceNote', 'initializedAt', 'operatorId'])
    && isPayrollSourceIdentity(value.id, 'payroll_numbering_settings') && isStableRouteIdentity(value.projectId) && officialNumber(value.firstNumber) && officialNumber(value.nextNumber) && value.nextNumber >= value.firstNumber
    && typeof value.evidenceNote === 'string' && !!value.evidenceNote.trim() && timestamp(value.initializedAt) && isStableRouteIdentity(value.operatorId)
}
export function isPayrollOfficialIssue(value: unknown): value is PayrollOfficialIssue {
  return numberingObject(value) && numberingExact(value, ['id', 'projectId', 'statementId', 'formatFamily', 'number', 'documentHash', 'issuedAt', 'operatorId', 'commandId'])
    && isPayrollSourceIdentity(value.id, 'payroll_official_issues') && isStableRouteIdentity(value.projectId) && isPayrollSourceIdentity(value.statementId, 'wage_statements') && isPayrollSourceIdentity(value.commandId, 'payroll_command_receipts')
    && ['A', 'C1', 'C2'].includes(String(value.formatFamily)) && officialNumberText(value.number) && typeof value.documentHash === 'string' && /^[a-f0-9]{64}$/.test(value.documentHash)
    && timestamp(value.issuedAt) && isStableRouteIdentity(value.operatorId)
}
export function parsePayrollNumberingInput(value: unknown): PayrollNumberingInput {
  if (!numberingObject(value) || !numberingExact(value, ['projectId', 'statementId']) || !isStableRouteIdentity(value.projectId) || !(value.statementId === null || isPayrollSourceIdentity(value.statementId, 'wage_statements')))
    invalid('正式编号读取缺少固定项目或原工资身份')
  return value as unknown as PayrollNumberingInput
}
export function parsePayrollNumberingCommand(value: unknown): PayrollNumberingCommand {
  if (!numberingObject(value) || !numberingExact(value, ['schemaVersion', 'commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'statementId', 'action'])
    || value.schemaVersion !== 1 || !isStableRouteIdentity(value.commandId) || !isStableRouteIdentity(value.workspaceId) || !isStableRouteIdentity(value.actorId)
    || value.origin !== 'real' || value.requiredCapability !== 'payroll:write' || typeof value.sourceVersion !== 'string' || !value.sourceVersion
    || !numberingObject(value.action)) {
    invalid('正式编号提交不完整')
  }
  parsePayrollNumberingInput({ projectId: value.projectId, statementId: value.statementId })
  const action = value.action as Record<string, unknown>
  if (action.kind === 'initialize') {
    if (!numberingExact(action, ['kind', 'nextNumber', 'evidenceNote']) || !officialNumber(action.nextNumber) || typeof action.evidenceNote !== 'string' || !action.evidenceNote.trim() || action.evidenceNote.length > 2000)
      invalid('请明确下一张正式编号及旧纸号核对依据')
  }
  else if (action.kind !== 'issue' || !numberingExact(action, ['kind']) || value.statementId === null) {
    invalid('正式出具必须选择一张真实已发工资')
  }
  return value as unknown as PayrollNumberingCommand
}

export function decodePayrollNumberingRead(value: unknown, query: PayrollQuery, input: PayrollNumberingInput): PayrollNumberingRead {
  if (query.projectId && query.projectId !== input.projectId)
    invalid('正式编号响应与查询项目不一致')
  if (!numberingObject(value) || !numberingExact(value, ['context', 'input', 'settings', 'issue', 'document', 'eligibility']) || !numberingObject(value.context)
    || value.context.origin !== query.origin || value.context.origin !== 'real' || !isStableRouteIdentity(value.context.workspaceId) || !isStableRouteIdentity(value.context.actorId)
    || !Array.isArray(value.context.capabilities) || !value.context.capabilities.every(capability => typeof capability === 'string') || !value.context.capabilities.includes('payroll:read')
    || value.context.readonly !== !value.context.capabilities.includes('payroll:write') || typeof value.context.sourceVersion !== 'string' || !value.context.sourceVersion
    || !numberingObject(value.input) || value.input.projectId !== input.projectId || value.input.statementId !== input.statementId
    || !(value.settings === null || (isPayrollNumberingSettings(value.settings) && value.settings.projectId === input.projectId))
    || !(value.issue === null || (isPayrollOfficialIssue(value.issue) && value.issue.projectId === input.projectId && value.issue.statementId === input.statementId))
    || !numberingObject(value.eligibility) || !numberingExact(value.eligibility, ['canInitialize', 'canIssue', 'canDownload', 'reasons'])
    || !['canInitialize', 'canIssue', 'canDownload'].every(key => typeof (value.eligibility as Record<string, unknown>)[key] === 'boolean')
    || !Array.isArray(value.eligibility.reasons) || !value.eligibility.reasons.every(reason => typeof reason === 'string')) {
    invalid('正式编号读取不完整或与所选范围不一致')
  }
  parsePayrollNumberingInput(value.input)
  let document: PayrollNumberingRead['document'] = null
  if (value.document !== null) {
    if (!input.statementId || !numberingObject(value.document) || value.document.projectId !== input.projectId || value.document.id !== input.statementId)
      invalid('正式出具的冻结工资与所选身份不一致')
    const output = { context: value.context, statementId: input.statementId, state: 'available', document: value.document, reasons: [] }
    if (value.document.formatFamily === 'A')
      document = decodePayrollARead<PayrollAOutputRead>(output, 'output', query, input.statementId).document
    else if (value.document.formatFamily === 'C1')
      document = decodePayrollC1Read<PayrollC1OutputRead>(output, 'output', query, input.statementId).document
    else if (value.document.formatFamily === 'C2')
      document = decodePayrollC2Read<PayrollC2OutputRead>(output, 'output', query, input.statementId).document
    else invalid('正式出具格式无效')
  }
  const result = { ...value, document } as unknown as PayrollNumberingRead
  if ((result.eligibility.canIssue && (!result.settings || !result.document || result.eligibility.reasons.length || result.context.readonly))
    || (result.eligibility.canInitialize && (result.settings || result.context.readonly))
    || (result.eligibility.canDownload && (!result.issue || !result.document || !result.settings))
    || (result.issue && !result.settings)
    || (result.issue && result.document && result.issue.formatFamily !== result.document.formatFamily)
    || (result.issue && result.settings && Number(result.issue.number) >= result.settings.nextNumber)) {
    invalid('正式编号读取的状态、序列或冻结格式互相冲突')
  }
  return result
}

export function encodePayrollNumberingRead(read: PayrollNumberingRead): unknown {
  const document = read.document
  return { ...read, document: document === null ? null : document.formatFamily === 'A' ? encodePayrollAWire(document) : document.formatFamily === 'C1' ? encodePayrollC1Wire(document) : encodePayrollC2Wire(document) }
}

export function decodePayrollNumberingResult(value: unknown, command: PayrollNumberingCommand): PayrollNumberingResult {
  if (!numberingObject(value) || !numberingExact(value, ['schemaVersion', 'commandId', 'settings', 'issue', 'sourceVersion']) || value.schemaVersion !== 1 || value.commandId !== command.commandId
    || !isPayrollNumberingSettings(value.settings) || value.settings.projectId !== command.projectId || typeof value.sourceVersion !== 'string' || !value.sourceVersion
    || !(value.issue === null || (isPayrollOfficialIssue(value.issue) && value.issue.projectId === command.projectId && value.issue.statementId === command.statementId && Number(value.issue.number) < value.settings.nextNumber))
    || (command.action.kind === 'issue' && value.issue === null)
    || (command.action.kind === 'initialize' && (value.settings.firstNumber !== command.action.nextNumber || value.settings.nextNumber !== command.action.nextNumber || value.settings.evidenceNote !== command.action.evidenceNote.trim() || value.settings.operatorId !== command.actorId))) {
    invalid('正式编号回执与原提交不一致')
  }
  return value as unknown as PayrollNumberingResult
}
