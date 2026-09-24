import type { PayrollParticipantOptions, PayrollQuery } from './central-contract'
import type { PayrollDayworkCommand, PayrollDayworkCommandResult, PayrollDayworkFact, PayrollDayworkFormInput, PayrollDayworkFormRead, PayrollDayworkListRead, PayrollDayworkRecordRead, PayrollDayworkScope } from './central-daywork-contract'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { transformPayrollC2Wire, wireArray, wireContext, wireDate, wireExact, wireFields, wireId, wireIntent, wireMonth, wireNullableNumber, wireNullableText, wireObject, wireStrings, wireText } from './central-payroll-wire'

export const encodePayrollDayworkWire = (value: unknown) => transformPayrollC2Wire(value, false)
function fail(message = '签工读取或提交内容不完整'): never {
  throw payrollProblem('validation-failed', message)
}
const nullableId = (value: unknown) => value === null || wireId(value)
const uniqueIds = (value: unknown): value is string[] => wireArray(value, wireId) && new Set(value).size === value.length
export function isPayrollParticipantOptions(value: unknown): value is PayrollParticipantOptions {
  return wireObject(value) && wireArray(value.projects, p => wireObject(p) && wireFields(p, ['id', 'name', 'code'], wireText)) && wireArray(value.crews, c => wireObject(c) && wireId(c.id) && wireNullableText(c.name) && typeof c.eligible === 'boolean' && wireStrings(c.reasons)) && wireArray(value.workers, w => wireObject(w) && wireId(w.id) && wireNullableText(w.name) && nullableId(w.crewId) && typeof w.eligible === 'boolean' && typeof w.historical === 'boolean' && wireStrings(w.reasons) && wireIntent(w.source))
}
function recordDraft(value: unknown, partial = false) {
  if (!wireObject(value))
    return false
  const checks: Record<string, (v: unknown) => boolean> = { projectId: wireId, crewId: nullableId, workerId: wireId, workDate: wireText, workContent: wireText, startTime: wireText, endTime: wireText, laborUnits: wireNullableNumber, witness: wireText, confirmedOn: wireNullableText, status: v => v === 'draft' || v === 'confirmed', note: wireText }
  return Object.keys(value).every(k => k in checks) && Object.entries(checks).every(([key, check]) => (partial && (!(key in value) || (['projectId', 'workerId'].includes(key) && value[key] === ''))) || check(value[key]))
}
export function isPayrollDayworkFact(value: unknown): value is PayrollDayworkFact {
  return wireObject(value) && wireFields(value, ['id', 'projectId', 'workerId'], wireId) && nullableId(value.crewId) && wireText(value.workDate) && wireFields(value, ['workContent', 'startTime', 'endTime', 'witness', 'confirmedOn', 'status', 'note', 'createdAt', 'updatedAt', 'deletedAt'], wireNullableText) && wireNullableNumber(value.laborUnits) && wireText(value.sourceFingerprint) && !!value.sourceFingerprint && wireObject(value.original)
}
export function parsePayrollDayworkFormInput(raw: unknown): PayrollDayworkFormInput {
  const value = transformPayrollC2Wire(raw, true)
  wireExact(value, ['recordId', 'draftKey', 'draft'])
  if ((value.recordId === null ? !wireId(value.draftKey) : !wireId(value.recordId) || value.draftKey !== undefined) || (value.draft !== undefined && !recordDraft(value.draft, true)))
    fail('签工表单缺少固定原记录或草稿身份')
  return value as unknown as PayrollDayworkFormInput
}

export function parsePayrollDayworkScope(raw: unknown, allowEmpty = true): PayrollDayworkScope {
  wireExact(raw, ['projectId', 'month', 'crewId', 'dayworkStatuses'])
  if (!(wireId(raw.projectId) || (allowEmpty && raw.projectId === '')) || !(wireMonth(raw.month) || (allowEmpty && raw.month === '')) || !(raw.crewId === null || wireId(raw.crewId)) || !wireArray(raw.dayworkStatuses, s => s === 'draft' || s === 'confirmed') || new Set(raw.dayworkStatuses).size !== raw.dayworkStatuses.length)
    throw payrollProblem('validation-failed', '签工范围无效')
  return raw as unknown as PayrollDayworkScope
}

export function parsePayrollDayworkCommand(raw: unknown): PayrollDayworkCommand {
  const value = transformPayrollC2Wire(raw, true)
  wireExact(value, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'recordId', 'draftKey', 'originalScope', 'action'])
  if (!wireFields(value, ['commandId', 'workspaceId', 'actorId', 'projectId'], wireId) || !wireText(value.sourceVersion) || !value.sourceVersion || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'payroll:write' || !nullableId(value.recordId) || !nullableId(value.draftKey) || !wireObject(value.action))
    fail('签工提交身份不完整')
  if (value.recordId === null) {
    if (!wireId(value.draftKey) || value.originalScope !== null || value.action.kind !== 'save-daywork')
      fail('新签工必须保留唯一草稿目标')
  }
  else {
    wireExact(value.originalScope, ['projectId', 'crewId', 'workerId', 'workDate'])
    if (value.draftKey !== null || value.originalScope.projectId !== value.projectId || !wireId(value.originalScope.workerId) || !nullableId(value.originalScope.crewId) || !wireText(value.originalScope.workDate))
      fail('原签工身份与原范围不一致')
  }
  const action = value.action
  if (action.kind === 'save-daywork') {
    wireExact(action, ['kind', 'record'])
    if (!recordDraft(action.record) || (value.recordId === null && (action.record as Record<string, unknown>).projectId !== value.projectId))
      fail('签工保存正文或新项目不完整')
  }
  else if (action.kind === 'confirm-daywork') {
    wireExact(action, ['kind', 'confirmation'])
    wireExact(action.confirmation, ['witness', 'confirmedOn'])
    if (!wireFields(action.confirmation, ['witness', 'confirmedOn'], wireText))
      fail('人工确认缺少证明人和日期')
  }
  else { fail('不支持的签工动作') }
  return value as unknown as PayrollDayworkCommand
}
export function decodePayrollDayworkResult(value: unknown, command: PayrollDayworkCommand): PayrollDayworkCommandResult {
  wireExact(value, ['commandId', 'projectId', 'recordId', 'recordProjectId', 'workerId', 'workDate', 'status', 'affectedStatementIds', 'recordFingerprint', 'sourceVersion', 'outcome', 'logIds'])
  const saved = command.action.kind === 'save-daywork' ? command.action.record : command.originalScope
  if (!saved || value.commandId !== command.commandId || value.projectId !== command.projectId || !wireId(value.recordId) || (command.recordId !== null && value.recordId !== command.recordId) || value.recordProjectId !== saved.projectId || value.workerId !== saved.workerId || value.workDate !== saved.workDate || value.status !== (command.action.kind === 'save-daywork' ? command.action.record.status : 'confirmed') || value.outcome !== (command.action.kind === 'save-daywork' ? 'saved' : 'confirmed') || !uniqueIds(value.affectedStatementIds) || !wireText(value.recordFingerprint) || !/^[a-f0-9]{64}$/.test(value.recordFingerprint) || !wireText(value.sourceVersion) || !value.sourceVersion || !uniqueIds(value.logIds))
    fail('签工回执与原提交或记录不一致')
  return value as unknown as PayrollDayworkCommandResult
}
export function isPayrollDayworkRecordRead(value: unknown): value is PayrollDayworkRecordRead {
  return isPayrollDayworkFact(value) && wireObject(value) && wireFields(value, ['workerName', 'crewName'], wireNullableText) && wireIntent(value.source) && Array.isArray(value.occupations) && Array.isArray(value.locks) && Array.isArray(value.diagnostics) && wireObject(value.eligibility) && typeof value.eligibility.canEdit === 'boolean' && typeof value.eligibility.canConfirm === 'boolean' && wireStrings(value.eligibility.reasons) && ['available', 'pending', 'occupied', 'invalid', 'deleted'].includes(String(value.availability))
}
export function decodePayrollDayworkRead<T extends PayrollDayworkListRead | PayrollDayworkFormRead>(raw: unknown, kind: 'list' | 'form', query: PayrollQuery, target: PayrollDayworkScope | PayrollDayworkFormInput): T {
  const value = transformPayrollC2Wire(raw, true)
  if (!wireObject(value) || !wireContext(value.context, query.origin) || !isPayrollParticipantOptions(value.options) || !Array.isArray(value.diagnostics) || !Array.isArray(value.evidence))
    fail()
  if (kind === 'list') {
    if (!('month' in target) || payrollCanonical(value.scope) !== payrollCanonical(target) || !wireArray(value.records, record => isPayrollDayworkRecordRead(record) && record.projectId === target.projectId && (!wireDate(record.workDate) || record.workDate.slice(0, 7) === target.month) && (target.crewId === null || record.crewId === target.crewId) && (!target.dayworkStatuses.length || ((record.status === 'draft' || record.status === 'confirmed') && target.dayworkStatuses.includes(record.status)))) || !Array.isArray(value.locks))
      fail()
  }
  else if (!('recordId' in target) || value.recordId !== target.recordId || value.draftKey !== (target.recordId ? null : target.draftKey) || (target.recordId ? !isPayrollDayworkRecordRead(value.record) || !wireObject(value.record) || value.record.id !== target.recordId : value.record !== null) || !recordDraft(value.draft, true) || !wireObject(value.eligibility) || typeof value.eligibility.canEdit !== 'boolean' || typeof value.eligibility.canConfirm !== 'boolean' || !wireStrings(value.eligibility.reasons)) {
    fail()
  }
  return value as unknown as T
}
