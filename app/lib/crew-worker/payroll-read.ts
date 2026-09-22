import type { PayrollActualFact, PayrollActualFacts, PayrollSignedAmount } from '../payroll/central-actual-contract'
import { payrollAAmount } from '../payroll/central-a-calculation'
import { isPayrollActualFact, isPayrollSignedAmount } from '../payroll/central-actual-codec'
import { decodePayrollAdjustmentWire, encodePayrollAdjustmentWire } from '../payroll/central-adjustment-wire'
import { payrollCanonical } from '../payroll/central-command-shared'
import { payrollProblem } from '../payroll/central-contract'
import { wireExact, wireObject, wireStrings } from '../payroll/central-payroll-wire'

export interface PayrollHostScope { kind: 'project' | 'crew' | 'worker', id: string }
export interface PayrollHostSection {
  scope: PayrollHostScope
  status: PayrollActualFacts['status']
  rows: Array<{ fact: PayrollActualFact, scopedAmount: PayrollSignedAmount }>
  netAmount: PayrollSignedAmount
  sourceVersion: string
  reasons: string[]
}

export function unavailablePayrollHostSection(scope: PayrollHostScope, status: 'forbidden' | 'unavailable', reason: string): PayrollHostSection {
  return { scope, status, rows: [], netAmount: payrollAAmount([null], [reason]), sourceVersion: status, reasons: [reason] }
}

function scopedAmount(fact: PayrollActualFact, scope: PayrollHostScope): PayrollSignedAmount {
  if (scope.kind === 'project')
    return fact.signedAmount
  if (scope.kind === 'crew') {
    if (fact.historicalMembers.length && fact.historicalMembers.every(member => member.crewId === scope.id))
      return fact.signedAmount
    const crewMembers = fact.historicalMembers.filter(member => member.crewId === scope.id)
    const allocations = fact.allocations.filter(row => row.crewId === scope.id)
    const complete = fact.allocationState === 'complete' && fact.allocations.every(row => row.crewId !== null)
    const missing = !complete && (!crewMembers.length || crewMembers.some(member => !allocations.some(row => row.workerId === member.workerId)))
    return payrollAAmount(allocations.map(row => row.amount), missing ? ['原班组归属或个人实际分配未完整记录，不能将整单重复计入各班组'] : [])
  }
  const allocation = fact.allocations.find(row => row.workerId === scope.id)
  if (allocation?.amount != null)
    return payrollAAmount([allocation.amount])
  if (fact.allocationState === 'complete' && fact.historicalMembers.some(member => member.workerId === scope.id))
    return payrollAAmount([0])
  return payrollAAmount([null], ['这笔历史个人分配尚未完整记录，不能采用整单金额或当前名册推算'])
}

/** 原班组/个人归属由调用方的原工资稳定关系限定，不依赖当前人员名册。 */
export function buildPayrollHostSection(scope: PayrollHostScope, facts: PayrollActualFacts): PayrollHostSection {
  if (facts.status === 'forbidden' || facts.status === 'unavailable')
    return unavailablePayrollHostSection(scope, facts.status, facts.status === 'forbidden' ? '无工资收付查看权限' : '工资收付来源暂不可用')
  const unique = new Map<string, PayrollActualFact>()
  for (const fact of facts.rows) {
    const previous = unique.get(fact.identity)
    if (previous && payrollCanonical(previous) !== payrollCanonical(fact))
      return unavailablePayrollHostSection(scope, 'unavailable', '同一工资实际来源出现冲突，请核对原记录')
    unique.set(fact.identity, fact)
  }
  const rows = [...unique.values()].map(fact => ({ fact, scopedAmount: scopedAmount(fact, scope) }))
  const sourceReasons = facts.netAmount.reasons.filter(reason => !facts.rows.some(row => row.signedAmount.reasons.includes(reason)))
  const reasons = [...new Set([...sourceReasons, ...rows.flatMap(row => row.scopedAmount.reasons)])]
  const netAmount = payrollAAmount(rows.map(row => row.scopedAmount.value), reasons)
  return { scope, rows, netAmount, reasons, sourceVersion: facts.sourceVersion, status: facts.status === 'partial' || netAmount.state !== 'known' ? 'partial' : 'complete' }
}

export const encodePayrollHostSection = (section: PayrollHostSection) => encodePayrollAdjustmentWire(section)

export function decodePayrollHostSection(raw: unknown, expected: PayrollHostScope): PayrollHostSection {
  const value = decodePayrollAdjustmentWire(raw)
  const fail = () => {
    throw payrollProblem('unavailable', '工资收付分区与原档案、实际来源或金额不一致，请重新读取')
  }
  try {
    wireExact(value, ['scope', 'status', 'rows', 'netAmount', 'sourceVersion', 'reasons'])
    if (!wireObject(value.scope) || payrollCanonical(value.scope) !== payrollCanonical(expected)
      || !['complete', 'partial', 'forbidden', 'unavailable'].includes(String(value.status))
      || !Array.isArray(value.rows) || !isPayrollSignedAmount(value.netAmount)
      || typeof value.sourceVersion !== 'string' || !value.sourceVersion || !wireStrings(value.reasons)) {
      return fail()
    }
    const identities = new Set<string>()
    for (const row of value.rows) {
      wireExact(row, ['fact', 'scopedAmount'])
      if (!isPayrollActualFact(row.fact) || !isPayrollSignedAmount(row.scopedAmount)
        || identities.has(row.fact.identity) || (expected.kind === 'project' && row.fact.projectId !== expected.id)
        || payrollCanonical(row.scopedAmount) !== payrollCanonical(scopedAmount(row.fact, expected))) {
        return fail()
      }
      if (expected.kind !== 'project' && row.fact.historicalMembers.length
        && !row.fact.historicalMembers.some(member => (expected.kind === 'worker' ? member.workerId : member.crewId) === expected.id)
        && !row.fact.allocations.some(allocation => (expected.kind === 'worker' ? allocation.workerId : allocation.crewId) === expected.id)) {
        return fail()
      }
      identities.add(row.fact.identity)
    }
    const section = value as unknown as PayrollHostSection
    if (section.status === 'forbidden' || section.status === 'unavailable') {
      if (section.rows.length || section.netAmount.state !== 'unknown')
        return fail()
    }
    else if (section.status === 'complete' && section.netAmount.state !== 'known') {
      return fail()
    }
    else if (payrollCanonical(section.netAmount) !== payrollCanonical(payrollAAmount(section.rows.map(row => row.scopedAmount.value), section.reasons))) {
      return fail()
    }
    return section
  }
  catch { return fail() }
}
