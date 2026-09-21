import type { PayrollC1Command, PayrollC1CommandResult, PayrollC1ConfigRead, PayrollC1ConfigScope, PayrollC1FormInput, PayrollC1FormRead, PayrollC1FrozenDocument, PayrollC1OutputRead, PayrollC1StatementSourceSnapshot, PayrollC1StatementSourceSnapshotV2, PayrollC1StatementSourceVersioned } from './central-c1-contract'
import type { PayrollQuery } from './central-contract'
import { isPayrollAttendanceFact, isPayrollAttendanceWorker, parsePayrollAttendanceScope } from './central-attendance-codec'
import { payrollC1Lines } from './central-c1-calculation'
import { isPayrollCHollowDocument, isPayrollCHollowSource } from './central-c-hollow'
import { payrollCanonical } from './central-command-shared'
import { isPayrollHollowRead } from './central-hollow-deduction-read'
import { payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { isPayrollHollowSnapshot } from './central-hollow-deduction-snapshot'
import { wireArray as array, wireCent as cent, wireExact as exact, wireFail as fail, wireFields as fields, wireId as id, wireNullableNumber as nullableNumber, wireNullableText as nullableText, wireObject as object, wireNonnegative as positive, wireStrings as strings, wireText as text, transformPayrollC1Wire, wireContext, wireDate, wireIntent, wireMonth } from './central-payroll-wire'
import { isPayrollReleaseApplications } from './central-release-adjustment-wire'
import { isPayrollSourceIdentity } from './migration-identity'
import { amountInCents } from './statements'

export const encodePayrollC1Wire = (v: unknown) => transformPayrollC1Wire(v, false)
const statementIdentity = (v: unknown) => isPayrollSourceIdentity(v, 'wage_statements')
const attendanceIdentity = (v: unknown) => isPayrollSourceIdentity(v, 'attendance_records')
const rateIdentity = (v: unknown) => isPayrollSourceIdentity(v, 'payroll_c1_rate_revisions')
function draft(v: unknown, partial = false) {
  if (!object(v))
    return false
  const checks: Record<string, (v: unknown) => boolean> = { projectId: id, crewId: v => v === null || id(v), leaderWorkerId: id, memberWorkerIds: v => array(v, id), month: wireMonth, note: text }
  return Object.keys(v).every(k => k in checks) && Object.entries(checks).every(([key, test]) => (partial && (!(key in v) || (v[key] === '' && ['projectId', 'leaderWorkerId', 'month'].includes(key)))) || test(v[key]))
}
export function parsePayrollC1FormInput(raw: unknown): PayrollC1FormInput {
  const v = transformPayrollC1Wire(raw, true)
  exact(v, ['statementId', 'draftKey', 'draft'])
  if ((v.statementId === null ? !id(v.draftKey) : !statementIdentity(v.statementId) || v.draftKey !== undefined) || (v.draft !== undefined && !draft(v.draft, true)))
    fail('C1 读取缺少固定草稿或单据身份')
  return v as unknown as PayrollC1FormInput
}
export function parsePayrollC1ConfigScope(v: unknown): PayrollC1ConfigScope {
  const scope = parsePayrollAttendanceScope(v)
  if (!wireMonth(scope.month))
    fail('C1 配置月份无效')
  return scope
}
export function parsePayrollC1Command(raw: unknown): PayrollC1Command {
  const v = transformPayrollC1Wire(raw, true)
  exact(v, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'statementId', 'draftKey', 'configScope', 'action'])
  if (!fields(v, ['commandId', 'workspaceId', 'actorId', 'projectId'], id) || !text(v.sourceVersion) || !v.sourceVersion || !['real', 'demo'].includes(String(v.origin)) || v.requiredCapability !== 'payroll:write' || !(v.statementId === null || statementIdentity(v.statementId)) || !(v.draftKey === null || id(v.draftKey)) || !object(v.action))
    fail('C1 提交身份不完整')
  const a = v.action
  if (a.kind === 'save-c1-draft') {
    exact(a, ['kind', 'draft'])
    if (!draft(a.draft))
      fail('C1 草稿字段不完整')
  }
  else if (a.kind === 'check-c1') {
    exact(a, ['kind'])
  }
  else if (a.kind === 'release-c1') {
    exact(a, ['kind', 'release'])
    exact(a.release, ['actualAmount', 'allocations', 'adjustmentApplications'])
    if (a.release.adjustmentApplications !== undefined && !isPayrollReleaseApplications(a.release.adjustmentApplications))
      fail('C1 更正处理关联无效')
    if (!nullableNumber(a.release.actualAmount) || !array(a.release.allocations, (row) => {
      exact(row, ['workerId', 'amount'])
      return id(row.workerId) && nullableNumber(row.amount)
    })) {
      fail('C1 实发与分配内容无效')
    }
  }
  else if (a.kind === 'save-c1-rates') {
    exact(a, ['kind', 'rates'])
    if (!array(a.rates, (row) => {
      exact(row, ['workerId', 'dailyWage', 'overtimeRate'])
      return id(row.workerId) && [row.dailyWage, row.overtimeRate].every(n => n === null || positive(n))
    }) || !a.rates.length) {
      fail('个人工资配置无效')
    }
  }
  else {
    fail('C1 动作无效')
  }
  if (a.kind === 'save-c1-rates') {
    const scope = parsePayrollAttendanceScope(v.configScope, false)
    if (scope.projectId !== v.projectId || v.statementId !== null || v.draftKey !== null)
      fail('C1 配置提交与固定范围不一致')
  }
  else if (v.configScope !== null || (v.statementId === null ? a.kind !== 'save-c1-draft' || !id(v.draftKey) : v.draftKey !== null)) {
    fail('C1 工资提交缺少唯一目标')
  }
  return v as unknown as PayrollC1Command
}
export function isPayrollC1Rate(v: unknown) {
  if (!object(v) || !(v.configId === null || rateIdentity(v.configId)))
    return false
  if (!object(v) || !id(v.workerId) || !fields(v, ['workerName', 'configId', 'effectiveMonth'], nullableText) || !text(v.sourceVersion) || !fields(v, ['profileDailyWage', 'configuredDailyWage', 'configuredOvertimeRate', 'dailyWage', 'overtimeRate', 'revision'], nullableNumber))
    return false
  if (![v.profileDailyWage, v.configuredDailyWage, v.configuredOvertimeRate, v.dailyWage, v.overtimeRate].every(n => n === null || positive(n)))
    return false
  const daily = v.profileDailyWage ?? v.configuredDailyWage
  const overtime = v.configuredOvertimeRate ?? (daily === null ? null : Number(daily) / 8)
  return v.dailyWage === daily && v.overtimeRate === overtime && v.dailyWageSource === (v.profileDailyWage !== null ? 'worker-profile' : v.configuredDailyWage !== null ? 'payroll-config' : 'missing') && v.overtimeRateSource === (v.configuredOvertimeRate !== null ? 'payroll-config' : daily !== null ? 'daily-divided-eight' : 'missing') && (v.configId === null ? v.revision === null && v.effectiveMonth === null && v.configuredDailyWage === null && v.configuredOvertimeRate === null : Number.isInteger(v.revision) && Number(v.revision) > 0 && wireMonth(v.effectiveMonth))
}
function line(v: unknown) {
  return object(v) && fields(v, ['id', 'workerId', 'itemName'], text) && nullableText(v.workerName) && ['normal', 'overtime'].includes(String(v.kind)) && v.unit === '小时' && positive(v.quantity) && fields(v, ['unitPrice', 'amount'], nullableNumber) && array(v.attendanceIds, attendanceIdentity)
}
export function isPayrollC1StatementSourceSnapshot(v: unknown): v is PayrollC1StatementSourceSnapshot {
  if (!object(v) || Object.keys(v).some(k => !['schemaVersion', 'subject', 'month', 'facts', 'rates'].includes(k)) || v.schemaVersion !== 1 || !object(v.subject) || Object.keys(v.subject).some(k => !['projectId', 'crewId', 'leaderWorkerId', 'memberWorkerIds'].includes(k)) || !fields(v.subject, ['projectId', 'leaderWorkerId'], id) || !(v.subject.crewId === null || id(v.subject.crewId)) || !array(v.subject.memberWorkerIds, id) || !wireMonth(v.month) || !array(v.facts, isPayrollAttendanceFact) || !v.facts.length || !array(v.rates, isPayrollC1Rate))
    return false
  const source = v as unknown as PayrollC1StatementSourceSnapshot
  const ids = source.subject.memberWorkerIds
  return new Set(ids).size === ids.length && ids.includes(source.subject.leaderWorkerId) && source.rates.length === ids.length && new Set(source.rates.map(r => r.workerId)).size === ids.length && source.rates.every(r => ids.includes(r.workerId)) && new Set(source.facts.map(f => f.id)).size === source.facts.length && new Set(source.facts.map(f => `${f.workerId}:${f.workDate}`)).size === source.facts.length && source.facts.every(f => attendanceIdentity(f.id) && f.projectId === source.subject.projectId && ids.includes(f.workerId) && f.crewId === source.subject.crewId && f.deletedAt === null && wireDate(f.workDate) && f.workDate.slice(0, 7) === source.month && positive(f.hours) && positive(f.overtimeHours) && f.hours + f.overtimeHours <= 24)
}
export function isPayrollC1FrozenDocument(v: unknown): v is PayrollC1FrozenDocument {
  if (!object(v) || !statementIdentity(v.id))
    return false
  const zeroRelease = object(v) && isPayrollHollowSnapshot(v.hollow) && payrollHollowAllowsZeroRelease(v.hollow)
  if (!object(v) || !fields(v, ['id', 'projectId', 'projectName', 'leaderName', 'releasedAt', 'operatorName', 'note'], text) || !v.projectName || !v.leaderName || !v.operatorName || !nullableText(v.crewName) || !wireMonth(v.month) || v.formatFamily !== 'C1' || v.periodKind !== 'monthly' || v.payRatio !== 1 || !cent(v.grossAmount) || !cent(v.actualAmount) || (v.actualAmount === 0 && !zeroRelease) || v.actualAmount > v.grossAmount || !array(v.lines, line) || !array(v.rates, isPayrollC1Rate) || !array(v.attendance, isPayrollAttendanceFact) || !array(v.members, m => object(m) && id(m.workerId) && text(m.workerName) && !!m.workerName && typeof m.isLeader === 'boolean') || !array(v.allocations, a => object(a) && id(a.workerId) && text(a.workerName) && typeof a.isLeader === 'boolean' && cent(a.amount) && Number.isSafeInteger(a.allocatedAmountFen) && a.allocatedAmountFen === amountInCents(a.amount)))
    return false
  const d = v as unknown as PayrollC1FrozenDocument
  const ids = d.members.map(m => m.workerId)
  if (!(d.crewId === null || id(d.crewId)) || !isPayrollC1StatementSourceSnapshot({ schemaVersion: 1, subject: { projectId: d.projectId, crewId: d.crewId, leaderWorkerId: d.members.find(m => m.isLeader)?.workerId ?? '', memberWorkerIds: ids }, month: d.month, facts: d.attendance, rates: d.rates }))
    return false
  const calculated = payrollC1Lines(d.attendance, d.rates)
  return !!ids.length && new Set(ids).size === ids.length && d.members.filter(m => m.isLeader).length === 1 && d.members.find(m => m.isLeader)?.workerName === d.leaderName && d.rates.length === ids.length && new Set(d.rates.map(r => r.workerId)).size === ids.length && d.rates.every(r => d.members.some(m => m.workerId === r.workerId && m.workerName === r.workerName)) && d.lines.every(l => cent(l.amount) && positive(l.unitPrice)) && payrollCanonical(calculated) === payrollCanonical(d.lines) && isPayrollCHollowDocument(d, calculated.reduce((sum, l) => sum + amountInCents(l.amount!), 0)) && d.allocations.length === ids.length && new Set(d.allocations.map(a => a.workerId)).size === ids.length && d.allocations.every(a => d.members.some(m => m.workerId === a.workerId && m.workerName === a.workerName && m.isLeader === a.isLeader)) && d.allocations.reduce((sum, a) => sum + a.allocatedAmountFen, 0) === amountInCents(d.actualAmount)
}
export function isPayrollC1StatementSourceSnapshotV2(value: unknown): value is PayrollC1StatementSourceSnapshotV2 {
  if (!object(value) || value.schemaVersion !== 2)
    return false
  const { hollow, ...original } = value
  const legacy = { ...original, schemaVersion: 1 }
  return isPayrollC1StatementSourceSnapshot(legacy) && isPayrollCHollowSource(hollow, 'C1', legacy.subject, legacy.month) && hollow.adoptions.length === 0
}
export function isPayrollC1StatementSourceVersioned(value: unknown): value is PayrollC1StatementSourceVersioned {
  return isPayrollC1StatementSourceSnapshot(value) || isPayrollC1StatementSourceSnapshotV2(value)
}
export function decodePayrollC1Result(v: unknown, command: PayrollC1Command): PayrollC1CommandResult {
  exact(v, ['commandId', 'projectId', 'statementId', 'rateRevisionIds', 'sourceVersion', 'outcome', 'logIds', 'adjustmentApplicationIds'])
  if (v.adjustmentApplicationIds !== undefined && (!array(v.adjustmentApplicationIds, id) || new Set(v.adjustmentApplicationIds as string[]).size !== (v.adjustmentApplicationIds as string[]).length || command.action.kind !== 'release-c1' || command.action.release.adjustmentApplications === undefined || v.outcome !== 'released' || (v.adjustmentApplicationIds as string[]).length !== command.action.release.adjustmentApplications.length))
    fail('C1 更正应用回执与原提交不一致')
  const outcomes = { 'save-c1-draft': ['saved'], 'check-c1': ['checked'], 'release-c1': ['released', 'needs-recheck'], 'save-c1-rates': ['saved'] }
  if (v.commandId !== command.commandId || v.projectId !== command.projectId || (command.statementId !== null && v.statementId !== command.statementId) || !nullableText(v.statementId) || !text(v.sourceVersion) || !array(v.rateRevisionIds, rateIdentity) || !strings(v.logIds) || !outcomes[command.action.kind].includes(String(v.outcome)) || (command.action.kind === 'save-c1-rates' ? v.statementId !== null : !statementIdentity(v.statementId)))
    fail('C1 回执与原动作或单据不一致')
  return v as unknown as PayrollC1CommandResult
}
export function decodePayrollC1Read<T extends PayrollC1FormRead | PayrollC1ConfigRead | PayrollC1OutputRead>(raw: unknown, kind: 'form' | 'config' | 'output', query: PayrollQuery, target: PayrollC1FormInput | PayrollC1ConfigScope | string): T {
  const v = transformPayrollC1Wire(raw, true)
  if (!object(v) || !object(v.context) || !wireContext(v.context, query.origin))
    fail()
  if (kind === 'form' && v.hollow !== undefined && (!isPayrollHollowRead(v.hollow) || v.hollow.context.workspaceId !== v.context.workspaceId || v.hollow.context.actorId !== v.context.actorId || v.hollow.target.statementId !== v.statementId || v.hollow.target.draftKey !== v.draftKey))
    fail('C1空鼓读取与原工资目标不一致')
  if (kind === 'output') {
    if (v.statementId !== target || (v.state === 'available' ? !isPayrollC1FrozenDocument(v.document) || v.document.id !== target || !array(v.reasons, () => false) : v.state !== 'unavailable' || v.document !== null || !strings(v.reasons)))
      fail()
  }
  else {
    if (!object(v.options) || !array(v.options.projects, p => object(p) && fields(p, ['id', 'name', 'code'], text)) || !array(v.options.crews, c => object(c) && id(c.id) && nullableText(c.name) && typeof c.eligible === 'boolean' && strings(c.reasons)) || !array(v.options.workers, isPayrollAttendanceWorker) || !array(v.rates, isPayrollC1Rate))
      fail()
    if (kind === 'config') {
      if (payrollCanonical(v.scope) !== payrollCanonical(target) || !strings(v.readonlyReasons) || !Array.isArray(v.history))
        fail()
    }
    else if (!object(target) || v.statementId !== target.statementId || v.draftKey !== (target.statementId ? null : target.draftKey) || !['new', 'draft', 'checked', 'released'].includes(String(v.status)) || typeof v.needsRecheck !== 'boolean' || !draft(v.draft, true) || !array(v.members, isPayrollAttendanceWorker) || !array(v.facts, isPayrollAttendanceFact) || !array(v.sources, wireIntent) || !array(v.lines, line) || !array(v.blockers, b => object(b) && fields(b, ['code', 'message'], text) && fields(b, ['field', 'workerId', 'recordId', 'statementId'], nullableText) && wireIntent(b.source)) || !object(v.totals) || !object(v.totals.grossAmount) || !fields(v.totals.grossAmount, ['value', 'knownValue'], nullableNumber) || !['known', 'partial', 'unknown'].includes(String(v.totals.grossAmount.state)) || !strings(v.totals.grossAmount.reasons) || !object(v.eligibility) || !fields(v.eligibility, ['canSaveDraft', 'canCheck', 'canRelease', 'canOutput'], v => typeof v === 'boolean') || !strings(v.eligibility.reasons)) {
      fail()
    }
  }
  return v as unknown as T
}
