import type { PayrollWritableContext } from './central-contract'
import type { PayrollHollowConfigRead, PayrollHollowRead, PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import { isQuantityHollowFact } from '../quantity/central-hollow-codec'
import { payrollAAmount } from './central-a-calculation'
import { isPayrollAFeeContext, isPayrollAFeeNavigation } from './central-a-fees-read-primitives'
import { payrollCanonical } from './central-command-shared'
import { isPayrollHollowAdoption, isPayrollHollowAmount, isPayrollHollowSnapshot, isPayrollHollowStart, isPayrollHollowTotals } from './central-hollow-deduction-snapshot'
import { hollowDeductionKeys, isPayrollHollowConfigQuery, isPayrollHollowPolicy, isPayrollHollowPolicyRevision, isPayrollHollowScope } from './central-hollow-deduction-validation'
import { wireArray, wireId, wireMonth, wireObject, wireStrings } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
export function isPayrollHollowRead(v: unknown): v is PayrollHollowRead {
  const row = (value: unknown) => hollowDeductionKeys(value, ['fact', 'policy', 'state', 'amount', 'adoption', 'source', 'sourceUnavailableReasons', 'reasons']) && isQuantityHollowFact(value.fact) && isPayrollHollowPolicy(value.policy) && value.policy.itemId === value.fact.target.itemId
    && ['ready', 'disabled', 'rectified', 'already-processed', 'needs-decision', 'unknown'].includes(String(value.state)) && isPayrollHollowAmount(value.amount)
    && (value.adoption === null || isPayrollHollowAdoption(value.adoption)) && (value.source === null || isPayrollAFeeNavigation(value.source)) && wireStrings(value.sourceUnavailableReasons) && wireStrings(value.reasons)
  const departure = (value: unknown) => value === null || (hollowDeductionKeys(value, ['workerIds', 'message']) && wireArray(value.workerIds, wireId) && typeof value.message === 'string')
  if (!hollowDeductionKeys(v, ['context', 'target', 'scope', 'month', 'state', 'rows', 'starts', 'snapshot', 'current', 'totals', 'departureNotice', 'eligibility', 'reasons'])
    || !wireObject(v.context) || !isPayrollAFeeContext(v.context, v.context.origin)
    || !hollowDeductionKeys(v.target, ['statementId', 'draftKey']) || (v.target.statementId === null ? !wireId(v.target.draftKey) : !isPayrollSourceIdentity(v.target.statementId, 'wage_statements') || v.target.draftKey !== null)
    || (v.scope !== null && !isPayrollHollowScope(v.scope)) || (v.month !== null && !wireMonth(v.month)) || !['available', 'unavailable'].includes(String(v.state))
    || !wireArray(v.starts, isPayrollHollowStart) || (v.snapshot !== null && !isPayrollHollowSnapshot(v.snapshot)) || !isPayrollHollowTotals(v.totals) || !wireStrings(v.reasons)
    || !hollowDeductionKeys(v.eligibility, ['canStart', 'reasons']) || typeof v.eligibility.canStart !== 'boolean' || !wireStrings(v.eligibility.reasons)
    || !departure(v.departureNotice) || !wireArray(v.rows, row)
    || (v.current !== null && (!hollowDeductionKeys(v.current, ['sourceVersion', 'state', 'rows', 'departureNotice', 'reasons']) || typeof v.current.sourceVersion !== 'string' || !['available', 'unavailable'].includes(String(v.current.state)) || !wireArray(v.current.rows, row) || !departure(v.current.departureNotice) || !wireStrings(v.current.reasons)))) {
    return false
  }
  const read = v as unknown as PayrollHollowRead
  if (read.state === 'available' && (!read.snapshot || read.snapshot.state !== 'available' || read.reasons.length))
    return false
  if (read.snapshot && (!same(read.scope, read.snapshot.scope) || read.month !== read.snapshot.month || !same(read.totals, read.snapshot.totals)))
    return false
  if (read.eligibility.canStart && (read.context.readonly || read.target.statementId === null || read.eligibility.reasons.length))
    return false
  const validRows = (rows: PayrollHollowRead['rows']) => new Set(rows.map(row => row.fact.recordId)).size === rows.length
    && rows.every(row => row.fact.location.projectId === read.scope?.projectId && (row.adoption === null || row.adoption.line.recordId === row.fact.recordId))
  if (!validRows(read.rows))
    return false
  if (read.current && (!read.snapshot || !validRows(read.current.rows)
    || read.current.rows.some(row => !read.snapshot!.facts.some(fact => fact.recordId === row.fact.recordId && fact.target.itemId === row.fact.target.itemId && fact.target.unitId === row.fact.target.unitId)))) {
    return false
  }
  return read.starts.every(start => start.statementId === read.target.statementId && same(start.scope, read.scope) && start.month === read.month)
}
export function isPayrollHollowConfigRead(v: unknown): v is PayrollHollowConfigRead {
  return hollowDeductionKeys(v, ['context', 'query', 'policies', 'revisions', 'eligibility', 'reasons']) && wireObject(v.context) && isPayrollAFeeContext(v.context, v.context.origin)
    && isPayrollHollowConfigQuery(v.query) && wireArray(v.policies, isPayrollHollowPolicy) && wireArray(v.revisions, isPayrollHollowPolicyRevision)
    && hollowDeductionKeys(v.eligibility, ['canSave', 'reasons']) && typeof v.eligibility.canSave === 'boolean' && wireStrings(v.eligibility.reasons) && wireStrings(v.reasons)
    && (!v.eligibility.canSave || (!v.context.readonly && !v.eligibility.reasons.length))
}
/** 已发只读 DTO 用原冻结端点构造；原来源当前变化另行展示，不重算原单。 */
export function payrollHollowFrozenRead(base: PayrollWritableContext, statementId: string, snapshot: PayrollHollowSnapshot): PayrollHollowRead {
  const reasons = ['已发工资保留原扣款依据，只能通过独立更正处理']
  return { context: { ...base, readonly: !base.capabilities.includes('payroll:write') }, target: { statementId, draftKey: null }, scope: snapshot.scope, month: snapshot.month, state: 'available', rows: snapshot.facts.map((fact) => {
    const adoption = snapshot.adoptions.find(value => value.line.recordId === fact.recordId) ?? snapshot.previousProcessed.find(value => value.adoption.line.recordId === fact.recordId)?.adoption ?? null
    const policy = snapshot.policies.find(value => value.itemId === fact.target.itemId)!
    return { fact, policy, state: adoption ? 'already-processed' : !policy.enabled ? 'disabled' : fact.remainingCount ? 'ready' : 'rectified', amount: payrollAAmount([adoption?.line.amount ?? 0]), adoption, source: null, sourceUnavailableReasons: ['原冻结位置保留；当前来源须独立读取验证'], reasons: [] }
  }), starts: snapshot.start ? [snapshot.start] : [], snapshot, current: null, totals: snapshot.totals, departureNotice: null, eligibility: { canStart: false, reasons }, reasons: [] }
}

export function payrollHollowFrozenReadWithCurrent(base: PayrollWritableContext, statementId: string, snapshot: PayrollHollowSnapshot, current: PayrollHollowRead): PayrollHollowRead {
  const frozen = payrollHollowFrozenRead(base, statementId, snapshot)
  const frozenRecordIds = new Set(snapshot.facts.map(fact => fact.recordId))
  return { ...frozen, current: { sourceVersion: current.context.sourceVersion, state: current.state, rows: current.rows.filter(row => frozenRecordIds.has(row.fact.recordId)), departureNotice: current.departureNotice, reasons: current.reasons } }
}
