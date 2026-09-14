import type { PayrollAttendanceCommand, PayrollAttendanceCommandResult, PayrollAttendanceFact, PayrollAttendanceMatrixRead, PayrollAttendanceScope } from './central-attendance-contract'
import type { PayrollQuery } from './central-contract'
import { payrollCanonical } from './central-command-shared'
import { wireArray as array, wireExact as exact, wireFail as fail, wireFields as fields, wireId as id, wireNullableNumber as nullableNumber, wireNullableText as nullableText, wireObject as object, wireNonnegative as positive, wireStrings as strings, wireText as text, transformPayrollC1Wire, wireContext, wireDate, wireIntent, wireMonth } from './central-payroll-wire'

export const payrollAttendanceCanonical = payrollCanonical
export const encodePayrollAttendanceWire = (v: unknown) => transformPayrollC1Wire(v, false)
export function isPayrollAttendanceFact(v: unknown): v is PayrollAttendanceFact {
  return object(v) && fields(v, ['id', 'projectId', 'workerId', 'workDate', 'sourceFingerprint'], text) && fields(v, ['crewId', 'workContent', 'note', 'deletedAt', 'createdAt', 'updatedAt'], nullableText) && fields(v, ['hours', 'overtimeHours'], nullableNumber)
}
export function isPayrollAttendanceWorker(v: unknown) {
  return object(v) && id(v.id) && fields(v, ['name', 'crewId'], nullableText) && typeof v.eligible === 'boolean' && typeof v.historical === 'boolean' && strings(v.reasons) && wireIntent(v.source)
}
export function parsePayrollAttendanceScope(v: unknown, preview = true): PayrollAttendanceScope {
  exact(v, ['projectId', 'month', 'crewId'])
  if (!(id(v.projectId) || (preview && v.projectId === '')) || !(wireMonth(v.month) || (preview && v.month === '')) || !(v.crewId === null || id(v.crewId)))
    fail('考勤范围无效')
  return v as unknown as PayrollAttendanceScope
}
export function parsePayrollAttendanceCommand(raw: unknown): PayrollAttendanceCommand {
  const v = transformPayrollC1Wire(raw, true)
  exact(v, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'scope', 'action'])
  if (!fields(v, ['commandId', 'workspaceId', 'actorId', 'projectId'], id) || !text(v.sourceVersion) || !v.sourceVersion || !['real', 'demo'].includes(String(v.origin)) || v.requiredCapability !== 'payroll:write')
    fail('考勤提交身份不完整')
  const scope = parsePayrollAttendanceScope(v.scope, false)
  exact(v.action, ['kind', 'record'])
  if (v.action.kind !== 'upsert-attendance')
    fail('考勤动作无效')
  exact(v.action.record, ['workerId', 'crewId', 'workDate', 'hours', 'overtimeHours', 'workContent', 'note'])
  const r = v.action.record
  if (!id(r.workerId) || !(r.crewId === null || id(r.crewId)) || !wireDate(r.workDate) || !positive(r.hours) || !positive(r.overtimeHours) || r.hours + r.overtimeHours > 24 || !fields(r, ['workContent', 'note'], text) || r.workDate.slice(0, 7) !== scope.month || scope.projectId !== v.projectId)
    fail('考勤日期、工时或固定范围无效')
  return v as unknown as PayrollAttendanceCommand
}
export function decodePayrollAttendanceResult(v: unknown, command: PayrollAttendanceCommand): PayrollAttendanceCommandResult {
  exact(v, ['commandId', 'projectId', 'recordId', 'workerId', 'workDate', 'sourceVersion', 'outcome', 'logIds'])
  if (v.commandId !== command.commandId || v.projectId !== command.projectId || v.workerId !== command.action.record.workerId || v.workDate !== command.action.record.workDate || !id(v.recordId) || !text(v.sourceVersion) || !v.sourceVersion || v.outcome !== 'saved' || !strings(v.logIds))
    fail('考勤回执与原目标不一致')
  return v as unknown as PayrollAttendanceCommandResult
}
export function decodePayrollAttendanceRead(raw: unknown, query: PayrollQuery, scope: PayrollAttendanceScope): PayrollAttendanceMatrixRead {
  const v = transformPayrollC1Wire(raw, true)
  if (!object(v) || !wireContext(v.context, query.origin) || payrollCanonical(v.scope) !== payrollCanonical(scope) || !object(v.options) || !array(v.options.projects, p => object(p) && fields(p, ['id', 'name', 'code'], text)) || !array(v.options.crews, c => object(c) && id(c.id) && nullableText(c.name) && typeof c.eligible === 'boolean' && strings(c.reasons)) || !array(v.workers, isPayrollAttendanceWorker) || !array(v.records, isPayrollAttendanceFact) || !array(v.locks, l => object(l) && fields(l, ['projectId', 'month', 'workerId', 'formatFamily', 'kind'], text) && fields(l, ['statementId', 'dayworkRecordId', 'attendanceRecordId', 'evidenceId', 'legacyRecordId'], nullableText)) || !array(v.diagnostics, d => object(d) && fields(d, ['code', 'message'], text) && fields(d, ['recordId', 'workerId', 'field', 'tableName', 'entityId', 'legacyRecordId'], nullableText)) || !array(v.evidence, e => object(e) && text(e.entityId) && object(e.source) && Array.isArray(e.mappings)))
    fail('考勤读取内容或范围不完整')
  return v as unknown as PayrollAttendanceMatrixRead
}
