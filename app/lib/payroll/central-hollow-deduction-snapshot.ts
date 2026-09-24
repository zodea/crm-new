import type { PayrollAAmount } from './central-a-contract'
import type { PayrollHollowTotals } from './central-hollow-deduction-calculation'
import type { PayrollHollowAdoption, PayrollHollowProcessedAmount, PayrollHollowSelectedLine, PayrollHollowSnapshot, PayrollHollowStart } from './central-hollow-deduction-contract'
import { isQuantityHollowFact, isQuantityHollowProofRef } from '../quantity/central-hollow-codec'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { payrollAAmount, payrollAMoney } from './central-a-calculation'
import { payrollCanonical } from './central-command-shared'
import { calculatePayrollHollowTotals } from './central-hollow-deduction-calculation'
import { hollowDeductionKeys, isPayrollHollowPolicy, isPayrollHollowScope, isPayrollHollowTimestamp } from './central-hollow-deduction-validation'
import { wireArray, wireId, wireMonth, wireNonnegative, wireNullableNumber, wireNumber, wireStrings, wireText } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
export function isPayrollHollowAmount(v: unknown): v is PayrollAAmount {
  return hollowDeductionKeys(v, ['value', 'knownValue', 'state', 'reasons']) && wireNullableNumber(v.value) && wireNullableNumber(v.knownValue) && wireStrings(v.reasons)
    && (v.state === 'known' ? wireNumber(v.value) && v.value === v.knownValue && v.reasons.length === 0 : v.value === null && (v.state === 'partial' ? wireNumber(v.knownValue) : v.state === 'unknown' && v.knownValue === null))
}
export function isPayrollHollowSelectedLine(v: unknown): v is PayrollHollowSelectedLine {
  return hollowDeductionKeys(v, ['recordId', 'proof', 'fact', 'policy', 'count', 'unitAmount', 'amount'])
    && isQuantitySourceIdentity(v.recordId, 'quantity_hollow_records') && isQuantityHollowProofRef(v.proof) && isQuantityHollowFact(v.fact)
    && v.recordId === v.fact.recordId && same(v.proof, v.fact.proof) && Number.isSafeInteger(v.count) && Number(v.count) > 0 && v.count === v.fact.remainingCount
    && isPayrollHollowPolicy(v.policy) && v.policy.enabled === true && v.policy.itemId === v.fact.target.itemId
    && wireNonnegative(v.unitAmount) && v.policy.unitAmount === v.unitAmount && wireNonnegative(v.amount)
    && v.amount === payrollAMoney(Number(v.count) * v.unitAmount) && Number.isSafeInteger(Math.round(v.amount * 100))
}
export function isPayrollHollowStart(v: unknown): v is PayrollHollowStart {
  if (!hollowDeductionKeys(v, ['id', 'projectId', 'statementId', 'previousStartId', 'scope', 'month', 'sourceVersion', 'lines', 'amount', 'commandId', 'createdBy', 'createdAt'])
    || !['projectId', 'createdBy'].every(key => wireId(v[key])) || !isPayrollSourceIdentity(v.id, 'payroll_hollow_starts') || !isPayrollSourceIdentity(v.statementId, 'wage_statements') || !isPayrollSourceIdentity(v.commandId, 'payroll_command_receipts')
    || (v.previousStartId !== null && !isPayrollSourceIdentity(v.previousStartId, 'payroll_hollow_starts')) || !isPayrollHollowScope(v.scope) || v.scope.projectId !== v.projectId
    || !wireMonth(v.month) || !wireText(v.sourceVersion) || !v.sourceVersion || !isPayrollHollowTimestamp(v.createdAt)
    || !wireArray(v.lines, isPayrollHollowSelectedLine) || !v.lines.length || !wireNonnegative(v.amount)) {
    return false
  }
  const start = v as unknown as PayrollHollowStart
  return start.lines.every(line => line.fact.location.projectId === start.projectId)
    && new Set(start.lines.map(line => line.recordId)).size === start.lines.length
    && start.amount === payrollAMoney(start.lines.reduce((total, line) => total + line.amount, 0))
}
export function isPayrollHollowAdoption(v: unknown): v is PayrollHollowAdoption {
  return hollowDeductionKeys(v, ['id', 'projectId', 'statementId', 'startId', 'scope', 'month', 'line', 'commandId', 'createdBy', 'createdAt'])
    && ['projectId', 'createdBy'].every(key => wireId(v[key])) && isPayrollSourceIdentity(v.id, 'payroll_hollow_adoptions') && isPayrollSourceIdentity(v.statementId, 'wage_statements') && isPayrollSourceIdentity(v.startId, 'payroll_hollow_starts') && isPayrollSourceIdentity(v.commandId, 'payroll_command_receipts')
    && isPayrollHollowScope(v.scope) && v.scope.projectId === v.projectId && wireMonth(v.month)
    && isPayrollHollowSelectedLine(v.line) && v.line.fact.location.projectId === v.projectId && isPayrollHollowTimestamp(v.createdAt)
}
export function isPayrollHollowProcessedAmount(v: unknown): v is PayrollHollowProcessedAmount {
  return hollowDeductionKeys(v, ['adoption', 'effectiveAmount', 'adjustmentIds', 'sourceVersion']) && isPayrollHollowAdoption(v.adoption)
    && isPayrollHollowAmount(v.effectiveAmount) && (v.effectiveAmount.value === null || v.effectiveAmount.value >= 0)
    && wireArray(v.adjustmentIds, value => isPayrollSourceIdentity(value, 'payroll_adjustments')) && new Set(v.adjustmentIds).size === v.adjustmentIds.length && wireText(v.sourceVersion) && v.sourceVersion.length > 0
}
export function isPayrollHollowTotals(v: unknown): v is PayrollHollowTotals {
  return hollowDeductionKeys(v, ['claimSubtotal', 'previousProcessed', 'currentDeduction', 'availableBeforeDeduction', 'grossAmount', 'reasons'])
    && ['claimSubtotal', 'previousProcessed', 'currentDeduction', 'availableBeforeDeduction', 'grossAmount'].every(key => isPayrollHollowAmount(v[key])) && wireStrings(v.reasons)
}
export function isPayrollHollowSnapshot(v: unknown): v is PayrollHollowSnapshot {
  if (!hollowDeductionKeys(v, ['schemaVersion', 'scope', 'month', 'sourceVersion', 'state', 'facts', 'policies', 'start', 'previousProcessed', 'adoptions', 'totals', 'reasons'])
    || v.schemaVersion !== 1 || !isPayrollHollowScope(v.scope) || !wireMonth(v.month) || !wireText(v.sourceVersion) || !v.sourceVersion
    || !['available', 'unavailable'].includes(String(v.state)) || !wireArray(v.facts, isQuantityHollowFact) || !wireArray(v.policies, isPayrollHollowPolicy)
    || (v.start !== null && !isPayrollHollowStart(v.start)) || !wireArray(v.previousProcessed, isPayrollHollowProcessedAmount) || !wireArray(v.adoptions, isPayrollHollowAdoption)
    || !isPayrollHollowTotals(v.totals) || !wireStrings(v.reasons)) {
    return false
  }
  const snapshot = v as unknown as PayrollHollowSnapshot
  if (snapshot.facts.some(fact => fact.location.projectId !== snapshot.scope.projectId)
    || new Set(snapshot.facts.map(fact => fact.recordId)).size !== snapshot.facts.length
    || new Set(snapshot.policies.map(policy => policy.itemId)).size !== snapshot.policies.length
    || new Set(snapshot.previousProcessed.map(row => row.adoption.id)).size !== snapshot.previousProcessed.length
    || new Set(snapshot.adoptions.map(row => row.line.recordId)).size !== snapshot.adoptions.length
    || (snapshot.state === 'available' && snapshot.reasons.length)) {
    return false
  }
  const start = snapshot.start
  if (start && (!same(start.scope, snapshot.scope) || start.month !== snapshot.month || (snapshot.state === 'available' && start.lines.some(line => !snapshot.facts.some(fact => same(fact, line.fact))))))
    return false
  if (snapshot.adoptions.some(adoption => !start || adoption.startId !== start.id || adoption.statementId !== start.statementId || !same(adoption.scope, snapshot.scope) || adoption.month !== snapshot.month || !start.lines.some(line => same(line, adoption.line))))
    return false
  const processed = payrollAAmount(snapshot.previousProcessed.map(row => row.effectiveAmount.value), snapshot.previousProcessed.flatMap(row => row.effectiveAmount.reasons))
  if (!same(processed, snapshot.totals.previousProcessed) || (snapshot.state === 'available' && snapshot.totals.currentDeduction.value !== (start?.amount ?? 0)))
    return false
  return same(snapshot.totals, calculatePayrollHollowTotals({ formatFamily: snapshot.scope.formatFamily, claimSubtotal: snapshot.totals.claimSubtotal, previousProcessed: snapshot.totals.previousProcessed, currentDeduction: snapshot.totals.currentDeduction }))
}
