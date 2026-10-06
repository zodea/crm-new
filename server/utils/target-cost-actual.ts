import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CostCategory } from '../../app/lib/project/cost-control'
import type { TargetCostCategory, TargetCostMetric, TargetCostSummary } from '../../app/lib/target-cost/central-contract'
import type { TargetCostDetailItem } from '../../app/lib/target-cost/detail'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { remainingCostAmount, sumCostAmounts } from '../../app/lib/project/cost-amounts'
import { COST_CATEGORIES } from '../../app/lib/project/cost-control'
import { round2 } from '../../app/lib/util/number'

export type BudgetActualMetric = 'signedAmount' | 'settledAmount' | 'paidAmount'
export interface BudgetActualRow {
  /** 原业务来源身份；付款使用 paymentId + allocationId，跨合同/结算仅计一次。 */
  identity: string
  projectId: string
  category: CostCategory
  amount: number | null
}
export interface BudgetActualSource {
  id: string
  version: string
  metric: BudgetActualMetric
  categories: CostCategory[]
  status: 'complete' | 'pending' | 'forbidden' | 'unavailable'
  rows: BudgetActualRow[]
}
export interface TargetCostActualFacts { projectId: string | null, sourceVersion: string, categories: Array<{ category: CostCategory } & Record<BudgetActualMetric, TargetCostMetric>> }
export interface TargetCostActualReadContext { db: TransactionDb, context: BusinessSession }
const METRICS: BudgetActualMetric[] = ['signedAmount', 'settledAmount', 'paidAmount']

/** 来源不完整时，knownValue 仅为已知部分，value 不产生假的完整余额。 */
export function aggregateTargetCostActual(projectId: string | null, sources: readonly BudgetActualSource[]): TargetCostActualFacts {
  const sourceVersion = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
  const conflicting = new Set<string>()
  const identities = new Map<string, { category: CostCategory, amount: number | null }>()
  for (const source of sources.filter(source => source.status === 'complete' || source.status === 'pending')) {
    for (const row of source.rows.filter(row => row.projectId === projectId)) {
      const key = `${source.metric}\u0000${row.identity}`
      const previous = identities.get(key)
      if (previous && (previous.category !== row.category || previous.amount !== row.amount))
        conflicting.add(key)
      identities.set(key, row)
    }
  }
  const categories = [...new Set<CostCategory>([...COST_CATEGORIES, ...sources.flatMap(source => source.rows.filter(row => row.projectId === projectId).map(row => row.category))])]
  return { projectId, sourceVersion, categories: categories.map((category) => {
    const result = { category } as TargetCostActualFacts['categories'][number]
    for (const metric of METRICS) {
      if (!projectId) {
        result[metric] = { value: null, knownValue: null, status: 'not-applicable', missingSources: ['未关联项目'] }
        continue
      }
      if (metric === 'signedAmount' && ['工人工资', '费用报销'].includes(category)) {
        result[metric] = { value: null, knownValue: null, status: 'not-applicable', missingSources: [] }
        continue
      }
      const matching = sources.filter(source => source.metric === metric && source.categories.includes(category))
      const missing = new Set<string>()
      const entries = new Map<string, number | null>()
      let knownEmpty = false
      if (!matching.length)
        missing.add(`${category}来源尚未接入`)
      for (const source of matching) {
        if (source.status !== 'complete')
          missing.add(`${source.id}:${source.status}`)
        if (source.status === 'forbidden' || source.status === 'unavailable')
          continue
        const scopedRows = source.rows.filter(row => row.projectId === projectId && row.category === category)
        knownEmpty ||= source.status === 'complete' && scopedRows.length === 0
        for (const row of scopedRows) {
          if (conflicting.has(`${metric}\u0000${row.identity}`)) {
            missing.add(`${source.id}:同一事实归属或金额不一致`)
            entries.set(row.identity, null)
          }
          else if (row.amount == null || !Number.isFinite(row.amount)) {
            missing.add(`${source.id}:金额或归属未确定`)
            entries.set(row.identity, null)
          }
          else if (entries.has(row.identity) && entries.get(row.identity) !== row.amount) {
            missing.add(`${source.id}:同一事实金额不一致`)
            entries.set(row.identity, null)
          }
          else {
            entries.set(row.identity, row.amount)
          }
        }
      }
      const knownValues = [...entries.values()].filter((value): value is number => value != null)
      const knownValue = (knownEmpty && entries.size === 0) || knownValues.length ? round2(knownValues.reduce((sum, value) => sum + value, 0)) : null
      result[metric] = { value: missing.size ? null : knownValue, knownValue, status: missing.size ? (knownValue == null ? 'pending' : 'partial') : 'complete', missingSources: [...missing] }
    }
    return result
  }) }
}

function combine(metrics: TargetCostMetric[]): TargetCostMetric {
  const applicable = metrics.filter(metric => metric.status !== 'not-applicable')
  const complete = applicable.length > 0 && applicable.every(metric => metric.status === 'complete')
  const known = applicable.filter(metric => metric.knownValue != null)
  const knownValue = known.length ? round2(known.reduce((sum, metric) => sum + metric.knownValue!, 0)) : null
  return { value: complete ? knownValue : null, knownValue, status: complete ? 'complete' : known.length ? 'partial' : applicable.length === 0 ? 'not-applicable' : 'pending', missingSources: [...new Set(metrics.flatMap(metric => metric.missingSources))] }
}
export function buildTargetCostComparison(id: string, items: TargetCostDetailItem[], facts: TargetCostActualFacts) {
  const categories: TargetCostCategory[] = facts.categories.map((actual) => {
    const matching = items.filter(item => item.category === actual.category)
    const target = sumCostAmounts(matching.map(item => item.amount), '目标成本明细:pending')
    const targetAmount = target.value
    const remainingAmount = actual.settledAmount.status === 'not-applicable' ? { ...actual.settledAmount } : remainingCostAmount(target, actual.settledAmount)
    const subcontract = ['专业分包', '合同劳务'].includes(actual.category)
    const other = ['机械', '其他'].includes(actual.category)
    const navigation = (metric: TargetCostMetric, entity: 'contract' | 'settlement' | 'subcontract-document', variant: string | null): NavigationIntentDTO | null => metric.knownValue == null || !variant || !facts.projectId ? null : { kind: 'entity-list', entity, variant, view: null, filters: { projectId: facts.projectId, dataOrigin: 'real', costCategory: actual.category } }
    return { id: `${id}:${actual.category}`, ...actual, targetAmount, targetLineCount: matching.length, remainingAmount, sources: {
      contract: navigation(actual.signedAmount, 'contract', actual.category === '材料' ? 'material' : subcontract ? 'subcontract' : other ? 'other_expense' : null),
      settlement: navigation(actual.settledAmount, subcontract ? 'subcontract-document' : 'settlement', subcontract ? 'settlement' : other ? 'other_settlement' : null),
      // 已知支付沿已接管结算来源核对，不制造尚未接管的独立付款入口。
      payment: actual.category === '工人工资' && actual.paidAmount.knownValue != null && facts.projectId
        ? { kind: 'entity-list', entity: 'wage-statement', variant: 'actual-ledger', view: null, filters: { projectId: facts.projectId, dataOrigin: 'real', costCategory: '工人工资' } } as NavigationIntentDTO
        : navigation(actual.paidAmount, subcontract ? 'subcontract-document' : 'settlement', subcontract ? 'settlement' : other ? 'other_settlement' : null),
      reimbursement: null,
    } }
  })
  const target = sumCostAmounts(items.map(item => item.amount), '目标成本明细:pending')
  const itemTotal = target.value
  const settledAmount = combine(categories.map(row => row.settledAmount))
  // 部分科目的余额不是项目的已知余额，必须先有完整实际成本才能扣减总预算。
  const remainingAmount = settledAmount.status === 'not-applicable' ? { ...settledAmount } : remainingCostAmount(target, settledAmount)
  const summary: TargetCostSummary = { itemTotal, signedAmount: combine(categories.map(row => row.signedAmount)), settledAmount, paidAmount: combine(categories.map(row => row.paidAmount)), remainingAmount }
  return { categories, summary }
}
