import type { PayrollC2Command, PayrollC2CommandResult, PayrollC2ConfigFact, PayrollC2ConfigRead, PayrollC2ConfigScope, PayrollC2FormInput, PayrollC2FormRead, PayrollC2FrozenDocument, PayrollC2OutputRead, PayrollC2StatementSourceSnapshot } from './central-c2-contract'
import type { PayrollQuery } from './central-contract'
import { payrollC2Lines } from './central-c2-calculation'
import { payrollC2OriginalOutput } from './central-c2-output-identity'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { isPayrollDayworkFact, isPayrollDayworkRecordRead, isPayrollParticipantOptions } from './central-daywork-codec'
import { wireArray as array, wireExact as exact, wireFields as fields, wireId as id, wireNullableText as nullableText, wireNullableNumber as number, wireObject as object, wireText as text, transformPayrollC2Wire, wireCent, wireContext, wireDate, wireIntent, wireMonth, wireStrings } from './central-payroll-wire'
import { isPayrollReleaseApplications } from './central-release-adjustment-wire'
import { amountInCents } from './statements'

export const encodePayrollC2Wire = (value: unknown) => transformPayrollC2Wire(value, false)
function fail(message = 'C2 读取或提交内容不完整'): never {
  throw payrollProblem('validation-failed', message)
}
const nullableId = (value: unknown) => value === null || id(value)
const uniqueIds = (value: unknown): value is string[] => array(value, id) && new Set(value).size === value.length
function draft(value: unknown, partial = false) {
  if (!object(value))
    return false
  const checks: Record<string, (v: unknown) => boolean> = { projectId: id, crewId: nullableId, leaderWorkerId: id, memberWorkerIds: uniqueIds, month: wireMonth, note: text }
  return Object.keys(value).every(k => k in checks) && Object.entries(checks).every(([key, check]) => (partial && (!(key in value) || (value[key] === '' && ['projectId', 'leaderWorkerId', 'month'].includes(key)))) || check(value[key]))
}
export function parsePayrollC2FormInput(raw: unknown): PayrollC2FormInput {
  const value = transformPayrollC2Wire(raw, true)
  exact(value, ['statementId', 'draftKey', 'draft'])
  if ((value.statementId === null ? !id(value.draftKey) : !id(value.statementId) || value.draftKey !== undefined) || (value.draft !== undefined && !draft(value.draft, true)))
    fail('C2 表单缺少固定单据或草稿身份')
  return value as unknown as PayrollC2FormInput
}
export function parsePayrollC2ConfigScope(raw: unknown, allowEmpty = true): PayrollC2ConfigScope {
  exact(raw, ['projectId', 'leaderWorkerId'])
  if (!['projectId', 'leaderWorkerId'].every(k => id(raw[k]) || (allowEmpty && raw[k] === '')))
    fail('C2 配置需要明确项目与负责人')
  return raw as unknown as PayrollC2ConfigScope
}
export function isPayrollC2ConfigFact(value: unknown): value is PayrollC2ConfigFact {
  return object(value) && fields(value, ['id', 'projectId', 'leaderWorkerId'], id) && nullableId(value.crewId) && fields(value, ['formatFamily', 'ruleText', 'createdAt', 'updatedAt', 'deletedAt'], nullableText) && number(value.unitRate) && (value.enabled === null || typeof value.enabled === 'boolean') && text(value.sourceFingerprint) && !!value.sourceFingerprint && object(value.original)
}
export function parsePayrollC2Command(raw: unknown): PayrollC2Command {
  const value = transformPayrollC2Wire(raw, true)
  exact(value, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'statementId', 'draftKey', 'configScope', 'configId', 'action'])
  if (!fields(value, ['commandId', 'workspaceId', 'actorId', 'projectId'], id) || !text(value.sourceVersion) || !value.sourceVersion || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'payroll:write' || !nullableId(value.statementId) || !nullableId(value.draftKey) || !nullableId(value.configId) || !object(value.action))
    fail('C2 提交身份不完整')
  const action = value.action
  if (action.kind === 'save-c2-config') {
    exact(action, ['kind', 'config'])
    exact(action.config, ['crewId', 'unitRate', 'ruleText'])
    if (!nullableId(action.config.crewId) || !number(action.config.unitRate) || !nullableText(action.config.ruleText))
      fail('C2 主体单价或规则内容不完整')
    const scope = parsePayrollC2ConfigScope(value.configScope, false)
    if (scope.projectId !== value.projectId || value.statementId !== null || value.draftKey !== null)
      fail('C2 配置提交与固定范围不一致')
  }
  else {
    if (value.configScope !== null || value.configId !== null || (value.statementId === null ? action.kind !== 'save-c2-draft' || !id(value.draftKey) : value.draftKey !== null))
      fail('C2 工资必须保留唯一原单据或新稿目标')
    if (action.kind === 'save-c2-draft') {
      exact(action, ['kind', 'draft'])
      if (!draft(action.draft))
        fail('C2 工资主体与月份不完整')
    }
    else if (action.kind === 'check-c2') {
      exact(action, ['kind'])
    }
    else if (action.kind === 'release-c2') {
      exact(action, ['kind', 'release'])
      exact(action.release, ['actualAmount', 'allocations', 'adjustmentApplications'])
      if (action.release.adjustmentApplications !== undefined && !isPayrollReleaseApplications(action.release.adjustmentApplications))
        fail('C2 的独立更正处理引用无效')
      if (!number(action.release.actualAmount) || !array(action.release.allocations, (row) => {
        exact(row, ['workerId', 'amount'])
        return id(row.workerId) && number(row.amount)
      })) {
        fail('C2 实发与全成员分配内容不完整')
      }
    }
    else { fail('不支持的 C2 动作') }
  }
  return value as unknown as PayrollC2Command
}
export function decodePayrollC2Result(value: unknown, command: PayrollC2Command): PayrollC2CommandResult {
  exact(value, ['commandId', 'projectId', 'statementId', 'configId', 'dayworkRecordIds', 'dayworkLinkIds', 'sourceVersion', 'outcome', 'logIds', 'adjustmentApplicationIds'])
  if (value.adjustmentApplicationIds !== undefined && (!uniqueIds(value.adjustmentApplicationIds) || command.action.kind !== 'release-c2' || command.action.release.adjustmentApplications === undefined || value.outcome !== 'released' || value.adjustmentApplicationIds.length !== command.action.release.adjustmentApplications.length))
    fail('C2 更正处理回执与原实际发放不一致')
  const config = command.action.kind === 'save-c2-config'
  const outcomes = { 'save-c2-config': ['saved'], 'save-c2-draft': ['saved'], 'check-c2': ['checked'], 'release-c2': ['released', 'needs-recheck'] }
  if (value.commandId !== command.commandId || value.projectId !== command.projectId || !id(value.configId) || (config && command.configId !== null && value.configId !== command.configId) || (config ? value.statementId !== null : !id(value.statementId) || (command.statementId !== null && value.statementId !== command.statementId)) || !uniqueIds(value.dayworkRecordIds) || !uniqueIds(value.dayworkLinkIds) || !uniqueIds(value.logIds) || !text(value.sourceVersion) || !value.sourceVersion || !outcomes[command.action.kind].includes(String(value.outcome)))
    fail('C2 回执与原动作、配置或单据不一致')
  if (config ? value.dayworkRecordIds.length !== 0 || value.dayworkLinkIds.length !== 0 : value.dayworkRecordIds.length !== value.dayworkLinkIds.length)
    fail('C2 回执的原签工与物理关联不完整')
  return value as unknown as PayrollC2CommandResult
}

export function isPayrollC2StatementSourceSnapshot(value: unknown): value is PayrollC2StatementSourceSnapshot {
  if (!object(value) || Object.keys(value).some(k => !['schemaVersion', 'subject', 'month', 'facts', 'config', 'members', 'qualificationVersion'].includes(k)) || value.schemaVersion !== 1 || !object(value.subject) || Object.keys(value.subject).some(k => !['projectId', 'crewId', 'leaderWorkerId', 'memberWorkerIds'].includes(k)) || !fields(value.subject, ['projectId', 'leaderWorkerId'], id) || !nullableId(value.subject.crewId) || !uniqueIds(value.subject.memberWorkerIds) || !wireMonth(value.month) || !array(value.facts, isPayrollDayworkFact) || !value.facts.length || !isPayrollC2ConfigFact(value.config) || !array(value.members, m => object(m) && id(m.workerId) && text(m.workerName) && !!m.workerName && nullableId(m.crewId)) || !text(value.qualificationVersion) || !value.qualificationVersion)
    return false
  const source = value as unknown as PayrollC2StatementSourceSnapshot
  const ids = source.subject.memberWorkerIds
  const config = source.config
  if (!ids.includes(source.subject.leaderWorkerId) || source.members.length !== ids.length || new Set(source.members.map(m => m.workerId)).size !== ids.length || source.members.some(m => !ids.includes(m.workerId) || m.crewId !== source.subject.crewId) || config.projectId !== source.subject.projectId || config.leaderWorkerId !== source.subject.leaderWorkerId || config.crewId !== source.subject.crewId || config.formatFamily !== 'C2' || config.enabled !== true || config.deletedAt !== null || config.unitRate === null || config.unitRate <= 0 || config.ruleText === null || new Set(source.facts.map(f => f.id)).size !== source.facts.length)
    return false
  if (Object.entries({ id: config.id, project_id: config.projectId, crew_id: config.crewId, leader_worker_id: config.leaderWorkerId, format_family: config.formatFamily, unit_rate: config.unitRate, rule_text: config.ruleText, enabled: 1, deleted_at: null }).some(([key, entry]) => config.original[key] !== entry))
    return false
  for (const fact of source.facts) {
    if (fact.projectId !== source.subject.projectId || fact.crewId !== source.subject.crewId || !ids.includes(fact.workerId) || !wireDate(fact.workDate) || fact.workDate.slice(0, 7) !== source.month || fact.deletedAt !== null || fact.status !== 'confirmed' || (fact.laborUnits !== 0.5 && fact.laborUnits !== 1) || !fact.workContent?.trim() || !fact.witness?.trim() || !wireDate(fact.confirmedOn) || fact.confirmedOn < fact.workDate || !text(fact.startTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fact.startTime) || !text(fact.endTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fact.endTime) || fact.startTime >= fact.endTime)
      return false
    if (Object.entries({ id: fact.id, project_id: fact.projectId, crew_id: fact.crewId, worker_id: fact.workerId, work_date: fact.workDate, work_content: fact.workContent, start_time: fact.startTime, end_time: fact.endTime, labor_units: fact.laborUnits, witness: fact.witness, confirmed_on: fact.confirmedOn, status: fact.status, note: fact.note, deleted_at: null }).some(([key, entry]) => fact.original[key] !== entry))
      return false
    const sameDay = source.facts.filter(other => other.workerId === fact.workerId && other.workDate === fact.workDate)
    const { startTime, endTime } = fact
    if (sameDay.reduce((sum, r) => sum + r.laborUnits!, 0) > 1 || sameDay.some(other => other.id !== fact.id && other.startTime! < endTime && other.endTime! > startTime))
      return false
  }
  return true
}
export function isPayrollC2FrozenDocument(value: unknown): value is PayrollC2FrozenDocument {
  if (!object(value) || !fields(value, ['id', 'projectId', 'projectName', 'leaderName', 'releasedAt', 'operatorName', 'note'], text) || !value.projectName || !value.leaderName || !value.operatorName || !nullableId(value.crewId) || !nullableText(value.crewName) || value.formatFamily !== 'C2' || value.periodKind !== 'monthly' || value.payRatio !== 1 || !wireMonth(value.month) || !wireCent(value.grossAmount) || !wireCent(value.actualAmount) || value.actualAmount <= 0 || value.actualAmount > value.grossAmount || !array(value.members, m => object(m) && id(m.workerId) && text(m.workerName) && !!m.workerName && typeof m.isLeader === 'boolean') || !array(value.allocations, a => object(a) && id(a.workerId) && text(a.workerName) && typeof a.isLeader === 'boolean' && wireCent(a.amount) && Number.isSafeInteger(a.allocatedAmountFen) && a.allocatedAmountFen === amountInCents(a.amount)) || !Array.isArray(value.lines))
    return false
  const document = value as unknown as PayrollC2FrozenDocument
  const ids = document.members.map(m => m.workerId)
  if (document.members.filter(m => m.isLeader).length !== 1 || !isPayrollC2StatementSourceSnapshot({ schemaVersion: 1, subject: { projectId: document.projectId, crewId: document.crewId, leaderWorkerId: document.members.find(m => m.isLeader)?.workerId ?? '', memberWorkerIds: ids }, month: document.month, facts: document.daywork, config: document.config, members: document.members.map(m => ({ workerId: m.workerId, workerName: m.workerName, crewId: document.crewId })), qualificationVersion: 'frozen-qualification' }))
    return false
  const lines = payrollC2Lines(document.daywork, document.config, document.members)
  return document.members.find(m => m.isLeader)?.workerName === document.leaderName && payrollCanonical(lines) === payrollCanonical(document.lines) && lines.every(l => l.amount !== null && wireCent(l.amount)) && lines.reduce((sum, l) => sum + amountInCents(l.amount!), 0) === amountInCents(document.grossAmount) && document.allocations.length === ids.length && new Set(document.allocations.map(a => a.workerId)).size === ids.length && document.allocations.every(a => document.members.some(m => m.workerId === a.workerId && m.workerName === a.workerName && m.isLeader === a.isLeader)) && document.allocations.reduce((sum, a) => sum + a.allocatedAmountFen, 0) === amountInCents(document.actualAmount)
}

export function decodePayrollC2Read<T extends PayrollC2FormRead | PayrollC2ConfigRead | PayrollC2OutputRead>(raw: unknown, kind: 'form' | 'config' | 'output', query: PayrollQuery, target: PayrollC2FormInput | PayrollC2ConfigScope | string): T {
  const value = transformPayrollC2Wire(raw, true)
  if (!object(value) || !wireContext(value.context, query.origin))
    fail()
  if (kind === 'output') {
    const document = object(value.document) && value.document.identityMapping !== undefined ? payrollC2OriginalOutput(value.document) : value.document
    if (value.statementId !== target || (value.state === 'available' ? !isPayrollC2FrozenDocument(document) || !object(value.document) || value.document.id !== target || !array(value.reasons, () => false) : value.state !== 'unavailable' || value.document !== null || !wireStrings(value.reasons)))
      fail()
  }
  else {
    if (!isPayrollParticipantOptions(value.options) || !Array.isArray(value.diagnostics) || !Array.isArray(value.evidence))
      fail()
    if (kind === 'config') {
      const inScope = (entry: unknown) => isPayrollC2ConfigFact(entry) && object(target) && 'projectId' in target && 'leaderWorkerId' in target && entry.projectId === target.projectId && entry.leaderWorkerId === target.leaderWorkerId
      if (payrollCanonical(value.scope) !== payrollCanonical(target) || !(value.config === null || inScope(value.config)) || !array(value.configs, inScope) || !object(value.draft) || !nullableId(value.draft.crewId) || !number(value.draft.unitRate) || !nullableText(value.draft.ruleText) || !wireStrings(value.readonlyReasons) || !Array.isArray(value.history))
        fail()
    }
    else if (!object(target) || value.statementId !== target.statementId || value.draftKey !== (target.statementId ? null : target.draftKey) || !['new', 'draft', 'checked', 'released'].includes(String(value.status)) || typeof value.needsRecheck !== 'boolean' || !draft(value.draft, true) || !array(value.members, m => object(m) && id(m.id) && nullableText(m.name) && nullableId(m.crewId) && typeof m.eligible === 'boolean' && typeof m.historical === 'boolean' && wireStrings(m.reasons) && wireIntent(m.source)) || !array(value.facts, isPayrollDayworkRecordRead) || !uniqueIds(value.adoptedRecordIds) || !text(value.qualificationVersion) || !array(value.sources, wireIntent) || !(value.config === null || isPayrollC2ConfigFact(value.config)) || !(value.storedSource === null || isPayrollC2StatementSourceSnapshot(value.storedSource)) || !array(value.lines, line => object(line) && fields(line, ['id', 'workerId', 'itemName'], text) && nullableText(line.workerName) && line.kind === 'daywork' && line.unit === '工' && number(line.quantity) && number(line.unitPrice) && (line.amount === null || wireCent(line.amount)) && uniqueIds(line.dayworkIds)) || !array(value.blockers, b => object(b) && fields(b, ['code', 'message'], text) && fields(b, ['field', 'workerId', 'recordId', 'statementId'], nullableText) && wireIntent(b.source)) || !object(value.totals) || !object(value.totals.grossAmount) || !fields(value.totals.grossAmount, ['value', 'knownValue'], v => v === null || wireCent(v)) || !['known', 'partial', 'unknown'].includes(String(value.totals.grossAmount.state)) || !wireStrings(value.totals.grossAmount.reasons) || !object(value.eligibility) || !fields(value.eligibility, ['canSaveDraft', 'canCheck', 'canRelease', 'canOutput'], v => typeof v === 'boolean') || !wireStrings(value.eligibility.reasons)) {
      fail()
    }
  }
  return value as unknown as T
}
