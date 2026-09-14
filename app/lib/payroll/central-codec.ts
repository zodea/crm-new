import type { PayrollDetailRead, PayrollListRead, PayrollQuery, PayrollSourcesRead } from './central-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollProblem } from './central-contract'
import { payrollFixedDecimal } from './central-payroll-wire'
import { payrollObject as object } from './central-snapshot'

const amounts = new Set(['cumulativeAmount', 'previouslyPaid', 'grossAmount', 'actualAmount', 'unitPrice', 'amount', 'unitRate'])
const decimals = new Set(['payRatio', 'quantity', 'hours', 'overtimeHours', 'laborUnits'])
const evidenceKeys = new Set(['snapshot', 'head', 'beforeData', 'afterData', 'evidence'])
function preciseRateDetail(value: unknown) {
  return object(value) && object(value.statement) && ['C1', 'C2'].includes(String(value.statement.formatFamily))
}
function transform(value: unknown, decode: boolean, preciseRates = false, path = ''): unknown {
  if (Array.isArray(value))
    return value.map(entry => transform(entry, decode, preciseRates, `${path}[]`))
  if (!object(value))
    return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (evidenceKeys.has(key))
      return [key, entry]
    if (amounts.has(key) || decimals.has(key)) {
      // C1 小时价与 C2 工价保留原精度；仅限详情已发/原行，金额与 A 合同不变。
      const preciseRate = preciseRates && key === 'unitPrice' && ['statement.lines[]', 'statement.stored.lines[]'].includes(path)
      const money = amounts.has(key) && !preciseRate
      if (entry === null)
        return [key, null]
      if (decode) {
        const pattern = money ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
        if (typeof entry !== 'string' || !pattern.test(entry) || !Number.isFinite(Number(entry)))
          throw payrollProblem('unavailable', '工资数值传输格式不完整')
        return [key, Number(entry)]
      }
      if (typeof entry !== 'number' || !Number.isFinite(entry))
        throw payrollProblem('unavailable', '工资数值不是已知金额或明确空值')
      return [key, money ? entry.toFixed(2) : preciseRate ? payrollFixedDecimal(entry) : String(entry)]
    }
    return [key, transform(entry, decode, preciseRates, path ? `${path}.${key}` : key)]
  }))
}
export function encodePayrollWire(value: unknown): unknown {
  return transform(value, false, preciseRateDetail(value))
}
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const numeric = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
const strings = (v: unknown) => Array.isArray(v) && v.every(text)
function diagnostic(v: unknown) {
  return object(v) && text(v.code) && text(v.message) && nullableText(v.tableName) && nullableText(v.recordId) && nullableText(v.field)
}
function array(v: unknown, check: (v: unknown) => boolean) {
  return Array.isArray(v) && v.every(check)
}
function snapshot(v: unknown) {
  return object(v) && ['not-released', 'complete', 'partial', 'missing', 'invalid'].includes(String(v.state)) && nullableText(v.raw) && nullableText(v.originalRaw) && (v.data === null || object(v.data)) && strings(v.issues)
}
function statement(v: unknown, query: PayrollQuery, id?: string) {
  return object(v) && text(v.id) && (!id || v.id === id) && ['central', 'isolated'].includes(String(v.recordKind)) && nullableText(v.legacyId) && text(v.projectId) && (!query.projectId || v.projectId === query.projectId) && (!query.month || v.month === query.month) && (!query.crewId || v.crewId === query.crewId)
    && ['month', 'formatFamily', 'periodKind', 'purpose', 'quantitySource', 'status', 'leaderWorkerId', 'sourceVersion'].every(key => text(v[key]))
    && ['projectName', 'crewId', 'crewName', 'leaderName', 'subjectConfigId', 'checkedAt', 'releasedAt', 'submittedAt', 'updatedAt', 'deletedAt', 'note'].every(key => nullableText(v[key]))
    && ['payRatio', 'cumulativeAmount', 'previouslyPaid', 'grossAmount', 'actualAmount'].every(key => numeric(v[key])) && typeof v.needsRecheck === 'boolean' && typeof v.hidden === 'boolean' && snapshot(v.snapshot) && array(v.diagnostics, diagnostic)
}
function member(v: unknown, id: string) {
  return object(v) && nullableText(v.id) && v.statementId === id && nullableText(v.workerId) && nullableText(v.workerName) && typeof v.isLeader === 'boolean' && nullableText(v.deletedAt)
}
function line(v: unknown, id: string) {
  return object(v) && nullableText(v.id) && v.statementId === id && ['workerId', 'workerName', 'itemId', 'itemName', 'unit', 'deletedAt'].every(key => nullableText(v[key])) && ['quantity', 'unitPrice', 'amount', 'sortOrder'].every(key => numeric(v[key]))
}
function link(v: unknown, id: string) {
  return object(v) && text(v.id) && v.statementId === id && text(v.dayworkRecordId) && nullableText(v.deletedAt)
}
function history(v: unknown) {
  return object(v) && ['id', 'tableName', 'recordId', 'operation'].every(key => text(v[key])) && ['operatedAt', 'operator', 'beforeRaw', 'afterRaw'].every(key => nullableText(v[key])) && 'beforeData' in v && 'afterData' in v
}
function evidence(v: unknown) {
  return object(v) && text(v.entityId) && object(v.source) && array(v.mappings, m => object(m) && text(m.tableName) && text(m.legacyId) && nullableText(m.centralId))
}
function lock(v: unknown, projectId?: string) {
  return object(v) && (!projectId || v.projectId === projectId) && ['projectId', 'month', 'workerId', 'statementId'].every(key => text(v[key])) && ['C1', 'C2'].includes(String(v.formatFamily)) && ['released-month', 'format-exclusion', 'daywork-occupation'].includes(String(v.kind)) && nullableText(v.dayworkRecordId)
}
function daywork(v: unknown, projectId?: string) {
  return object(v) && (!projectId || v.projectId === projectId) && ['id', 'projectId', 'workerId', 'workDate', 'status'].every(key => text(v[key])) && ['crewId', 'workerName', 'workContent', 'startTime', 'endTime', 'witness', 'confirmedOn', 'note', 'deletedAt'].every(key => nullableText(v[key])) && numeric(v.laborUnits)
}
export function decodePayrollRead<T extends PayrollListRead | PayrollDetailRead | PayrollSourcesRead>(input: unknown, kind: 'list' | 'detail' | 'sources', query: PayrollQuery, id?: string): T {
  const fail = (): never => {
    throw payrollProblem('unavailable', '工资读取内容或范围不完整')
  }
  if (!object(input) || !object(input.context))
    return fail()
  const c = input.context
  if (!['workspaceId', 'actorId', 'sourceVersion'].every(key => text(c[key]) && c[key]) || c.origin !== query.origin || c.readonly !== true || !strings(c.capabilities) || !(c.capabilities as string[]).includes('payroll:read') || (c.origin === 'demo' && !(c.capabilities as string[]).includes('demo:read')))
    return fail()
  const value = transform(input, true, kind === 'detail' && preciseRateDetail(input)) as Record<string, unknown>
  if (kind === 'list') {
    if (!array(value.rows, row => statement(row, query)) || !array(value.projects, p => object(p) && text(p.id) && text(p.name) && text(p.code)) || !array(value.diagnostics, diagnostic))
      return fail()
  }
  else if (kind === 'detail') {
    const s = value.statement
    if (!statement(s, query, id) || !object(s) || !object(s.stored) || !object(s.stored.head) || !array(value.history, history) || !array(value.evidence, evidence) || !array(s.locks, l => lock(l, String(s.projectId))))
      return fail()
    for (const source of [s, s.stored]) {
      if (!array(source.lines, l => line(l, String(s.id))) || !array(source.members, m => member(m, String(s.id))) || !array(source.allocations, a => member(a, String(s.id)) && object(a) && numeric(a.amount) && numeric(a.allocatedAmountFen)) || !array(source.dayworkLinks, l => link(l, String(s.id))))
        return fail()
    }
    if (!array(s.daywork, d => daywork(d, String(s.projectId))))
      return fail()
  }
  else {
    if (value.projectId !== query.projectId || !array(value.diagnostics, diagnostic) || !array(value.history, history) || !array(value.evidence, evidence) || !array(value.locks, l => lock(l, query.projectId))
      || !array(value.configs, c => object(c) && c.projectId === query.projectId && ['id', 'projectId', 'leaderWorkerId', 'formatFamily'].every(key => text(c[key])) && ['crewId', 'ruleText', 'updatedAt', 'deletedAt'].every(key => nullableText(c[key])) && numeric(c.unitRate) && (c.enabled === null || typeof c.enabled === 'boolean'))
      || !array(value.attendance, a => object(a) && a.projectId === query.projectId && ['id', 'workerId', 'workDate'].every(key => text(a[key])) && ['crewId', 'workerName', 'workContent', 'note', 'deletedAt'].every(key => nullableText(a[key])) && numeric(a.hours) && numeric(a.overtimeHours))
      || !array(value.daywork, d => daywork(d, query.projectId))) {
      return fail()
    }
  }
  return value as unknown as T
}
export function parsePayrollQuery(input: Record<string, unknown>): PayrollQuery {
  if (Object.keys(input).some(key => !['origin', 'includeDemo', 'projectId', 'month', 'crewId'].includes(key)))
    throw payrollProblem('invalid-query', '工资读取含不支持的范围字段')
  const origin = input.origin ?? 'real'
  if (!isDataOriginDTO(origin) || (input.includeDemo !== undefined && !['true', 'false', true, false].includes(input.includeDemo as string | boolean)))
    throw payrollProblem('invalid-query', '工资资料来源无效')
  for (const field of ['projectId', 'crewId'] as const) {
    if (input[field] !== undefined && !isStableRouteIdentity(input[field]))
      throw payrollProblem('invalid-query', '工资项目或班组身份无效')
  }
  if (input.month !== undefined && (typeof input.month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month)))
    throw payrollProblem('invalid-query', '工资月份必须是有效年月')
  return { origin, includeDemo: input.includeDemo === 'true' || input.includeDemo === true, ...(input.projectId ? { projectId: String(input.projectId) } : {}), ...(input.month ? { month: String(input.month) } : {}), ...(input.crewId ? { crewId: String(input.crewId) } : {}) }
}
