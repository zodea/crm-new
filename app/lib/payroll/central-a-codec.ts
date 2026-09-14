import type { PayrollACommand, PayrollACommandResult, PayrollAConfigRead, PayrollAConfigScope, PayrollAFormInput, PayrollAFormRead, PayrollAFrozenDocument, PayrollAOutputRead, PayrollAStatementSourceSnapshot } from './central-a-contract'
import type { PayrollQuery } from './central-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { isPayrollAAdjustmentReconciliation } from './central-a-adjustment-validation'
import { isPayrollAFeesFormExtension } from './central-a-fees-read-validation'
import { isPayrollABook, isPayrollAFeesFrozenDocument } from './central-a-fees-validation'
import { payrollProblem } from './central-contract'
import { isPayrollReleaseApplications, transformPayrollReleaseApplications } from './central-release-adjustment-wire'
import { payrollObject as object } from './central-snapshot'
import { amountInCents } from './statements'

const moneyFields = new Set(['unitPrice', 'amount', 'actualAmount', 'workAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount', 'listAmount'])
const decimalFields = new Set(['payRatio', 'initialPayRatio', 'quantity', 'knownQuantity', 'fieldQty'])
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const cents = amountInCents
const centAmount = (v: unknown): v is number => number(v) && v >= 0 && Number.isSafeInteger(cents(v)) && Math.abs(v * 100 - cents(v)) < 1e-8
const nullableNumber = (v: unknown) => v === null || number(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text)
const array = (v: unknown, check: (v: unknown) => boolean) => Array.isArray(v) && v.every(check)
const fields = (v: Record<string, unknown>, names: string[], check: (v: unknown) => boolean) => names.every(name => check(v[name]))
const month = (v: unknown) => text(v) && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)
const kinds = ['monthly', 'settlement', 'retention']
function fail(message = '工资核算数据不完整'): never {
  throw payrollProblem('validation-failed', message)
}
function exact(v: unknown, names: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(name => !names.includes(name)))
    fail('工资请求包含不支持的字段')
}
function transform(value: unknown, decode: boolean): unknown {
  if (Array.isArray(value))
    return value.map(entry => transform(entry, decode))
  if (!object(value))
    return value
  const metric = 'knownValue' in value && 'state' in value
  const ratio = 'explicitlyConfigured' in value || ('statementId' in value && 'configId' in value && 'source' in value)
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => {
    if (['history', 'beforeData', 'afterData'].includes(key))
      return [key, child]
    if (key === 'adjustmentApplications')
      return [key, transformPayrollReleaseApplications(child, decode)]
    const monetary = moneyFields.has(key) || (metric && ['value', 'knownValue'].includes(key))
    const numeric = monetary || decimalFields.has(key) || (ratio && key === 'value') || ('dimension' in value && ['before', 'after', 'current', 'effective'].includes(key))
    if (!numeric || object(child))
      return [key, transform(child, decode)]
    if (child === null)
      return [key, null]
    if (decode) {
      if (!text(child) || !(monetary ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(child) || !Number.isFinite(Number(child)))
        fail('工资金额、比例或数量传输格式无效')
      return [key, Number(child)]
    }
    if (!number(child))
      fail('工资数值必须明确或保留为空')
    if (monetary && (!Number.isSafeInteger(cents(child)) || Math.abs(child * 100 - cents(child)) > 1e-8))
      fail('工资金额须精确到分，不能在传输时自动改变输入')
    return [key, monetary ? child.toFixed(2) : String(child)]
  }))
}
export const encodePayrollAWire = (value: unknown) => transform(value, false)
export const decodePayrollAWire = (value: unknown) => transform(value, true)

function scope(v: unknown) {
  if (!object(v) || !['project', 'cells'].includes(String(v.kind)))
    return false
  return v.kind === 'project' || array(v.cells, cell => object(cell) && fields(cell, ['unitId', 'roomId', 'itemId'], isStableRouteIdentity))
}
function fact(v: unknown) {
  return object(v) && fields(v, ['ownershipKey', 'completionId', 'assignmentId', 'stageId', 'stageItemId', 'unitId', 'floorId', 'buildingId', 'templateId', 'templateLineId', 'roomId', 'itemId', 'completedAt', 'sourceFingerprint'], text)
    && fields(v, ['workerId', 'crewId', 'unit', 'fieldFormula', 'buildingName', 'floorName', 'unitName', 'templateName', 'roomName', 'itemName', 'workerName', 'crewName'], nullableText)
    && nullableNumber(v.fieldQty) && strings(v.assignmentScopeIds) && ['whole-trade', 'selected'].includes(String(v.scopeKind))
    && array(v.scopeRows, row => object(row) && fields(row, ['id', 'roomId', 'itemId'], text) && nullableText(row.deletedAt))
}
function intent(v: unknown) {
  return v === null || (object(v) && ((v.kind === 'unavailable' && text(v.reason)) || (['entity-list', 'entity-detail', 'entity-subview', 'source-record'].includes(String(v.kind)) && object(v.filters) && nullableText(v.variant) && nullableText(v.view) && (v.kind === 'entity-list' ? text(v.entity) : object(v.subject) && text(v.subject.id) && text(v.subject.entity)))))
}
function blocker(v: unknown) {
  return object(v) && fields(v, ['code', 'message'], text) && fields(v, ['locationLabel', 'sourceUnavailableReason', 'field', 'completionId', 'assignmentId', 'unitId', 'roomId', 'itemId', 'workerId', 'statementId'], nullableText) && intent(v.source)
}
function member(v: unknown) {
  return object(v) && text(v.id) && nullableText(v.name) && nullableText(v.crewId) && typeof v.eligible === 'boolean' && strings(v.reasons) && intent(v.source)
}
function options(v: unknown) {
  return object(v) && array(v.projects, p => object(p) && fields(p, ['id', 'name', 'code'], text)) && array(v.crews, c => object(c) && text(c.id) && nullableText(c.name) && typeof c.eligible === 'boolean' && strings(c.reasons)) && array(v.workers, member)
}
function history(v: unknown) {
  return object(v) && fields(v, ['id', 'tableName', 'recordId', 'operation'], text) && fields(v, ['operatedAt', 'operator', 'beforeRaw', 'afterRaw'], nullableText) && 'beforeData' in v && 'afterData' in v
}
function price(v: unknown) {
  return object(v) && fields(v, ['id', 'priceId', 'projectId', 'leaderWorkerId', 'itemId'], text) && fields(v, ['crewId', 'itemName', 'unit', 'workerId', 'workerName', 'operatorId', 'createdAt'], nullableText) && ['baseline', 'worker-exception'].includes(String(v.mode)) && month(v.effectiveMonth) && nullableNumber(v.unitPrice) && Number.isInteger(v.revision) && scope(v.scope) && typeof v.editable === 'boolean' && strings(v.readonlyReasons)
}
export function isPayrollAStatementSourceSnapshot(v: unknown): v is PayrollAStatementSourceSnapshot {
  if (object(v) && v.adjustmentReconciliation !== undefined && !isPayrollAAdjustmentReconciliation(v.adjustmentReconciliation))
    return false
  if (!object(v) || v.schemaVersion !== 1 || !object(v.subject) || !fields(v.subject, ['projectId', 'leaderWorkerId'], isStableRouteIdentity)
    || !nullableText(v.subject.crewId) || !strings(v.subject.memberWorkerIds) || !v.subject.memberWorkerIds.includes(String(v.subject.leaderWorkerId))
    || new Set(v.subject.memberWorkerIds).size !== v.subject.memberWorkerIds.length || !array(v.facts, fact) || !Array.isArray(v.facts) || !v.facts.length || !array(v.priceRevisions, price)) {
    return false
  }
  return true
}
function line(v: unknown) {
  return object(v) && fields(v, ['id', 'workerId', 'itemId'], text) && fields(v, ['workerName', 'itemName', 'unit'], nullableText) && fields(v, ['quantity', 'knownQuantity', 'unitPrice', 'amount'], nullableNumber) && strings(v.priceRevisionIds) && array(v.facts, fact) && array(v.sources, intent) && array(v.blockers, blocker)
}
function amount(v: unknown) {
  return object(v) && nullableNumber(v.value) && nullableNumber(v.knownValue) && ['known', 'partial', 'unknown'].includes(String(v.state)) && strings(v.reasons) && (v.state === 'known' ? v.value !== null && v.value === v.knownValue : v.value === null) && (v.state !== 'unknown' || v.knownValue === null)
}
function draft(v: unknown, partial: boolean) {
  if (!object(v))
    return false
  const checks: Record<string, (v: unknown) => boolean> = { projectId: isStableRouteIdentity, leaderWorkerId: isStableRouteIdentity, crewId: v => v === null || isStableRouteIdentity(v), memberWorkerIds: v => array(v, isStableRouteIdentity), month, periodKind: v => kinds.includes(String(v)), payRatio: nullableNumber, note: text, book: v => v === undefined || isPayrollABook(v) }
  return Object.keys(v).every(key => key in checks) && Object.entries(checks).every(([key, check]) => {
    // 读取预览允许尚未选定/主动清空选择；持久保存继续执行完整身份与日期校验。
    if (partial && (!(key in v) || (v[key] === '' && ['projectId', 'leaderWorkerId', 'month'].includes(key))))
      return true
    return check(v[key])
  })
}
export function parsePayrollAFormInput(v: unknown): PayrollAFormInput {
  exact(v, ['statementId', 'draftKey', 'draft'])
  if (v.statementId === null ? !isStableRouteIdentity(v.draftKey) : !isStableRouteIdentity(v.statementId) || v.draftKey !== undefined)
    fail('工资读取缺少唯一单据或草稿身份')
  const next = transform(v, true) as Record<string, unknown>
  if (next.draft !== undefined && !draft(next.draft, true))
    fail('工资草稿预览字段无效')
  return next as unknown as PayrollAFormInput
}
export function parsePayrollAConfigScope(v: unknown): PayrollAConfigScope {
  exact(v, ['projectId', 'month', 'crewId', 'leaderWorkerId'])
  if (!isStableRouteIdentity(v.projectId) || !month(v.month) || !(v.crewId === null || isStableRouteIdentity(v.crewId)) || !(v.leaderWorkerId === null || isStableRouteIdentity(v.leaderWorkerId)))
    fail('工资配置读取范围无效')
  return v as unknown as PayrollAConfigScope
}
export function parsePayrollACommand(value: unknown): PayrollACommand {
  exact(value, ['commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'sourceVersion', 'projectId', 'statementId', 'draftKey', 'configScope', 'action'])
  if (!fields(value, ['commandId', 'workspaceId', 'actorId', 'projectId'], isStableRouteIdentity) || !text(value.sourceVersion) || !value.sourceVersion || !['real', 'demo'].includes(String(value.origin)) || value.requiredCapability !== 'payroll:write' || !(value.statementId === null || isStableRouteIdentity(value.statementId)) || !(value.draftKey === null || isStableRouteIdentity(value.draftKey)))
    fail('工资提交身份不完整')
  if (value.configScope !== null)
    parsePayrollAConfigScope(value.configScope)
  const next = transform(value, true) as Record<string, unknown>
  const action = next.action
  if (!object(action))
    fail('工资动作无效')
  if (action.kind === 'save-a-draft') {
    exact(action, ['kind', 'draft'])
    if (!draft(action.draft, false))
      fail('工资草稿字段不完整')
  }
  else if (action.kind === 'check-a') {
    exact(action, ['kind'])
  }
  else if (action.kind === 'set-a-pay-ratio') {
    exact(action, ['kind', 'payRatio'])
    if (!nullableNumber(action.payRatio))
      fail('单据比例无效')
  }
  else if (action.kind === 'release-a') {
    exact(action, ['kind', 'release'])
    exact(action.release, ['actualAmount', 'allocations', 'adjustmentApplications'])
    if (action.release.adjustmentApplications !== undefined && !isPayrollReleaseApplications(action.release.adjustmentApplications))
      fail('A 工资更正处理关联无效')
    if (!nullableNumber(action.release.actualAmount) || !array(action.release.allocations, (row) => {
      exact(row, ['workerId', 'amount'])
      return isStableRouteIdentity(row.workerId) && nullableNumber(row.amount)
    })) {
      fail('发放须提供实际金额与完整分配')
    }
  }
  else if (action.kind === 'save-a-subject-config') {
    exact(action, ['kind', 'config'])
    exact(action.config, ['crewId', 'leaderWorkerId', 'initialPayRatio'])
    if (!(action.config.crewId === null || isStableRouteIdentity(action.config.crewId)) || !isStableRouteIdentity(action.config.leaderWorkerId) || !nullableNumber(action.config.initialPayRatio))
      fail('请款主体配置无效')
  }
  else if (action.kind === 'save-a-prices') {
    exact(action, ['kind', 'prices'])
    if (!array(action.prices, (row) => {
      exact(row, ['priceId', 'itemId', 'unit', 'mode', 'workerId', 'effectiveMonth', 'unitPrice', 'scope'])
      exact(row.scope, row.scope && object(row.scope) && row.scope.kind === 'project' ? ['kind'] : ['kind', 'cells'])
      if (row.scope.kind === 'cells' && Array.isArray(row.scope.cells))
        row.scope.cells.forEach(cell => exact(cell, ['unitId', 'roomId', 'itemId']))
      return (row.priceId === null || isStableRouteIdentity(row.priceId)) && isStableRouteIdentity(row.itemId) && nullableText(row.unit) && ['baseline', 'worker-exception'].includes(String(row.mode)) && (row.workerId === null || isStableRouteIdentity(row.workerId)) && month(row.effectiveMonth) && nullableNumber(row.unitPrice) && scope(row.scope)
    })) {
      fail('工资价格字段不完整')
    }
  }
  else { fail('工资动作尚未支持') }
  return next as unknown as PayrollACommand
}
export function isPayrollAFrozenDocument(v: unknown): v is PayrollAFrozenDocument {
  const fees = object(v) && (Object.hasOwn(v, 'book') || Object.hasOwn(v, 'fees')) ? isPayrollAFeesFrozenDocument(v) ? v : false : null
  if (fees === false)
    return false
  if (!object(v) || !fields(v, ['id', 'projectId', 'projectName', 'leaderName', 'releasedAt', 'operatorName', 'note'], text) || !v.projectName || !v.leaderName || !v.operatorName || !nullableText(v.crewName) || !month(v.month) || !kinds.includes(String(v.periodKind)) || v.formatFamily !== 'A' || !fields(v, ['payRatio', 'workAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount', 'actualAmount'], number))
    return false
  if (!Array.isArray(v.lines) || (!v.lines.length && fees?.book.bookPurpose !== 'management') || !array(v.lines, l => line(l) && object(l) && number(l.quantity) && l.quantity >= 0 && fields(l, ['unitPrice', 'amount'], centAmount) && fields(l, ['workerName', 'itemName', 'unit'], x => text(x) && x.length > 0)) || !Array.isArray(v.members) || !v.members.length || !array(v.members, m => object(m) && text(m.workerId) && text(m.workerName) && !!m.workerName && typeof m.isLeader === 'boolean') || !array(v.allocations, a => object(a) && text(a.workerId) && text(a.workerName) && typeof a.isLeader === 'boolean' && centAmount(a.amount) && Number.isSafeInteger(a.allocatedAmountFen) && cents(a.amount) === a.allocatedAmountFen) || !array(v.previousPayments, p => object(p) && text(p.statementId) && month(p.month) && centAmount(p.amount)))
    return false
  if (!fields(v, ['workAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount', 'actualAmount'], centAmount) || Number(v.payRatio) < 0 || Number(v.payRatio) > 1 || (v.periodKind === 'retention' && v.payRatio !== 1) || Number(v.actualAmount) <= 0 || Number(v.actualAmount) > Number(v.grossAmount))
    return false
  const members = v.members as Array<{ workerId: string, workerName: string, isLeader: boolean }>
  const allocations = v.allocations as Array<{ workerId: string, allocatedAmountFen: number }>
  const lines = v.lines as PayrollAFrozenDocument['lines']
  const payments = v.previousPayments as PayrollAFrozenDocument['previousPayments']
  const ownership = lines.flatMap(l => l.facts.map(f => f.ownershipKey))
  if (new Set(ownership).size !== ownership.length || lines.some(l => !l.facts.length || !l.priceRevisionIds.length || l.facts.some(f => f.fieldQty === null || f.unit !== l.unit) || !members.some(m => m.workerId === l.workerId && m.workerName === l.workerName) || Math.abs(l.facts.reduce((sum, f) => sum + (f.fieldQty ?? 0), 0) - l.quantity!) > 1e-8 || cents(l.quantity! * l.unitPrice!) !== cents(l.amount!)))
    return false
  const reconciliation = v.adjustmentReconciliation
  if (reconciliation !== undefined && (!isPayrollAAdjustmentReconciliation(reconciliation) || reconciliation.rawCumulative.value !== v.cumulativeAmount || reconciliation.availableAmount.value !== v.grossAmount || reconciliation.rawBasis.payRatio !== v.payRatio || reconciliation.reasons.length))
    return false
  if (lines.reduce((sum, l) => sum + cents(l.amount!), 0) !== cents(Number(v.workAmount)) || cents(Number(fees ? fees.listAmount : v.workAmount) * Number(v.payRatio)) !== cents(Number(v.cumulativeAmount)) || payments.reduce((sum, p) => sum + cents(p.amount), 0) !== cents(Number(v.previouslyPaid)) || (reconciliation === undefined && Math.max(0, cents(Number(v.cumulativeAmount)) - cents(Number(v.previouslyPaid))) !== cents(Number(v.grossAmount))))
    return false
  return new Set(members.map(m => m.workerId)).size === members.length && members.filter(m => m.isLeader).length === 1 && allocations.length === members.length && new Set(allocations.map(a => a.workerId)).size === members.length && allocations.every(a => members.some(m => m.workerId === a.workerId)) && allocations.reduce((sum, a) => sum + a.allocatedAmountFen, 0) === cents(Number(v.actualAmount))
}
export function decodePayrollARead<T extends PayrollAFormRead | PayrollAConfigRead | PayrollAOutputRead>(raw: unknown, kind: 'form' | 'config' | 'output', query: PayrollQuery, target: PayrollAFormInput | PayrollAConfigScope | string): T {
  const value = transform(raw, true)
  if (!object(value) || !object(value.context))
    fail()
  if (value.adjustmentReconciliation !== undefined && !isPayrollAAdjustmentReconciliation(value.adjustmentReconciliation))
    fail('A 更正包含组成或实际净额无法核实')
  const c = value.context
  if (!fields(c, ['workspaceId', 'actorId', 'sourceVersion'], text) || c.origin !== query.origin || !strings(c.capabilities) || !c.capabilities.includes('payroll:read') || typeof c.readonly !== 'boolean' || (c.origin === 'demo' && (!c.readonly || !c.capabilities.includes('demo:read'))))
    fail()
  if (kind !== 'output' && c.origin === 'real' && c.readonly !== !(c.capabilities as string[]).includes('payroll:write'))
    fail('工资读取权限与可写状态不一致')
  if (kind === 'form') {
    if ((Object.hasOwn(value, 'fees') || Object.hasOwn(value, 'bookProof') || (object(value.draft) && Object.hasOwn(value.draft, 'book'))) && !isPayrollAFeesFormExtension(value))
      fail('工资费用用途或读取依据不完整')
    if (!text(value.paymentSourceVersion))
      fail()
    if (!object(target) || value.statementId !== target.statementId || value.draftKey !== (target.statementId ? null : target.draftKey) || !['new', 'draft', 'checked', 'released'].includes(String(value.status)) || typeof value.needsRecheck !== 'boolean' || !draft(value.draft, true) || !options(value.options) || !array(value.members, member) || !array(value.facts, fact) || !array(value.lines, line) || !array(value.prices, price) || !array(value.blockers, blocker) || !object(value.totals) || !fields(value.totals, ['workAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount'], amount) || !object(value.ratioDefault) || !nullableNumber(value.ratioDefault.value) || !['previous-statement', 'subject-config', 'crew-config', 'settlement-default', 'retention-fixed', 'missing'].includes(String(value.ratioDefault.source)) || !fields(value.ratioDefault, ['statementId', 'configId', 'sourceVersion'], nullableText) || !object(value.eligibility) || !fields(value.eligibility, ['canSaveDraft', 'canCheck', 'canRelease', 'canOutput'], v => typeof v === 'boolean') || !strings(value.eligibility.reasons))
      fail()
  }
  else if (kind === 'config') {
    const matchesScope = (actual: unknown, expected: unknown) => object(actual) && object(expected) && ['projectId', 'month', 'crewId', 'leaderWorkerId'].every(key => actual[key] === expected[key])
    if (!matchesScope(value.scope, target) || !options(value.options) || !array(value.prices, price) || !strings(value.readonlyReasons) || !array(value.history, history) || !array(value.priceOptions, p => object(p) && text(p.itemId) && nullableText(p.itemName) && nullableText(p.unit) && array(p.scopes, scope)))
      fail()
    if (value.subject !== null && (!object(value.subject) || !fields(value.subject, ['id', 'projectId', 'leaderWorkerId'], text) || !nullableText(value.subject.crewId) || !nullableNumber(value.subject.initialPayRatio) || !Number.isInteger(value.subject.revision)))
      fail()
    if (value.crewRatio !== null && (!object(value.crewRatio) || !text(value.crewRatio.crewId) || !nullableNumber(value.crewRatio.value) || typeof value.crewRatio.explicitlyConfigured !== 'boolean' || !text(value.crewRatio.sourceVersion)))
      fail()
  }
  else if (value.statementId !== target || (value.state === 'available' ? !isPayrollAFrozenDocument(value.document) || value.document.id !== target || !array(value.reasons, () => false) : value.state !== 'unavailable' || value.document !== null || !strings(value.reasons))) {
    fail()
  }
  return value as unknown as T
}
export function decodePayrollAResult(v: unknown, command: PayrollACommand): PayrollACommandResult {
  if (object(v)) {
    for (const key of ['adjustmentApplicationIds', 'adjustmentCoverageIds']) {
      if (v[key] !== undefined && (!array(v[key], isStableRouteIdentity) || new Set(v[key] as string[]).size !== (v[key] as string[]).length || command.action.kind !== 'release-a' || v.outcome !== 'released'))
        fail('A 工资更正回执身份或动作不一致')
    }
    if (v.adjustmentApplicationIds !== undefined && (command.action.kind !== 'release-a' || command.action.release.adjustmentApplications === undefined || (v.adjustmentApplicationIds as string[]).length !== command.action.release.adjustmentApplications.length))
      fail('A 工资更正应用回执与原提交不一致')
  }
  if (!object(v) || v.commandId !== command.commandId || v.projectId !== command.projectId || (command.statementId !== null && v.statementId !== command.statementId) || !nullableText(v.statementId) || !nullableText(v.subjectConfigId) || !text(v.sourceVersion) || !strings(v.priceRevisionIds) || !strings(v.logIds) || !['saved', 'checked', 'released', 'needs-recheck'].includes(String(v.outcome)))
    fail('工资提交回执与原目标不一致')
  if (!command.action.kind.startsWith('save-a-prices') && command.action.kind !== 'save-a-subject-config' && !v.statementId)
    fail('工资回执缺少单据身份')
  const outcomes: Record<PayrollACommand['action']['kind'], string[]> = { 'save-a-draft': ['saved'], 'check-a': ['checked'], 'set-a-pay-ratio': ['saved', 'needs-recheck'], 'release-a': ['released', 'needs-recheck'], 'save-a-subject-config': ['saved'], 'save-a-prices': ['saved'] }
  if (!outcomes[command.action.kind].includes(String(v.outcome)))
    fail('工资回执结果与原动作不一致')
  return v as unknown as PayrollACommandResult
}
