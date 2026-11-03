import type { PayrollAAmount, PayrollALine, PayrollAPeriodKind } from './central-a-contract'
import type { PayrollAFeeLine, PayrollANegativeLineRevision } from './central-a-fees-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollAAmount, payrollAMoney } from './central-a-calculation'
import { amountInCents } from './statements'

/** 工程量分项与费用项均使用原稳定身份，不按名称、楼栋或价格修订号猜测。 */
export interface PayrollAItemRatio {
  itemId: string
  ratio: number | null
}

/** 未单独指定的费用使用整单默认比例，明确的 0 不被默认值覆盖。 */
export interface PayrollAFeeRatio {
  kind: 'fee' | 'negative'
  id: string
  ratio: number
}

export interface PayrollARatioPlan {
  schemaVersion: 1
  itemRatios: PayrollAItemRatio[]
  feeRatios: PayrollAFeeRatio[]
}

/** 数据边界保留 null 为未填写，不按旧单整单比例补造分项值。 */
export function isPayrollARatioPlan(value: unknown): value is PayrollARatioPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const plan = value as Record<string, unknown>
  if (Object.keys(plan).sort().join(',') !== 'feeRatios,itemRatios,schemaVersion' || plan.schemaVersion !== 1 || !Array.isArray(plan.itemRatios) || !Array.isArray(plan.feeRatios))
    return false
  const itemIds = new Set<string>()
  for (const entry of plan.itemRatios) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'itemId,ratio' || !isQuantitySourceIdentity(entry.itemId, 'items') || itemIds.has(entry.itemId) || (entry.ratio !== null && !validRatio(entry.ratio, 'monthly')))
      return false
    itemIds.add(entry.itemId)
  }
  const feeIds = new Set<string>()
  for (const entry of plan.feeRatios) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'id,kind,ratio' || !['fee', 'negative'].includes(entry.kind) || !isStableRouteIdentity(entry.id) || !validRatio(entry.ratio, 'monthly'))
      return false
    const key = JSON.stringify([entry.kind, entry.id])
    if (feeIds.has(key))
      return false
    feeIds.add(key)
  }
  return true
}

export interface PayrollARatioCalculation {
  itemRatios: PayrollAItemRatio[]
  feeRatios: PayrollAFeeRatio[]
  itemAmounts: Array<{ itemId: string, amount: PayrollAAmount }>
  feeAmounts: Array<{ kind: 'fee' | 'negative', id: string, amount: PayrollAAmount }>
  cumulativeAmount: PayrollAAmount
  reasons: string[]
}

/** 只沿明确同簿上月快照承接相同身份；新增项保持未填写。 */
export function carryPayrollARatioPlan(input: {
  periodKind: PayrollAPeriodKind
  itemIds: readonly string[]
  feeIds: readonly { kind: 'fee' | 'negative', id: string }[]
  current?: PayrollARatioPlan
  previous?: PayrollARatioPlan
}): { plan: PayrollARatioPlan, reasons: string[] } {
  const reasons: string[] = []
  if ((input.current && !isPayrollARatioPlan(input.current)) || (input.previous && !isPayrollARatioPlan(input.previous)))
    return { plan: { schemaVersion: 1, itemRatios: [], feeRatios: [] }, reasons: ['比例计划格式或身份不完整'] }
  const itemIds = [...new Set(input.itemIds)].sort()
  const feeIds = new Set(input.feeIds.map(row => JSON.stringify([row.kind, row.id])))
  const currentItems = new Map(input.current?.itemRatios.map(row => [row.itemId, row.ratio]) ?? [])
  const previousItems = new Map(input.previous?.itemRatios.map(row => [row.itemId, row.ratio]) ?? [])
  if (input.periodKind === 'retention' && (input.current?.itemRatios.some(row => row.ratio !== null && row.ratio !== 1) || input.current?.feeRatios.some(row => row.ratio !== 1)))
    reasons.push('尾款的分项与费用比例固定为 100%')
  if ([...currentItems.keys()].some(id => !itemIds.includes(id)) || (input.current?.feeRatios ?? []).some(row => !feeIds.has(JSON.stringify([row.kind, row.id]))))
    reasons.push('已填写的比例对应分项或费用已变化，请重新核对')
  const itemRatios = itemIds.map(itemId => ({ itemId, ratio: input.periodKind === 'retention' ? 1 : currentItems.has(itemId) ? currentItems.get(itemId)! : previousItems.get(itemId) ?? null }))
  for (const [itemId, ratio] of currentItems) {
    if (!itemIds.includes(itemId))
      itemRatios.push({ itemId, ratio })
  }
  const selectedFees = new Map<string, PayrollAFeeRatio>()
  for (const entry of input.current ? input.current.feeRatios : input.previous?.feeRatios ?? []) {
    const key = JSON.stringify([entry.kind, entry.id])
    if (feeIds.has(key))
      selectedFees.set(key, { ...entry, ratio: input.periodKind === 'retention' ? 1 : entry.ratio })
  }
  return { plan: { schemaVersion: 1, itemRatios, feeRatios: [...selectedFees.values()].sort((a, b) => JSON.stringify([a.kind, a.id]).localeCompare(JSON.stringify([b.kind, b.id]))) }, reasons }
}

function validRatio(value: unknown, periodKind: PayrollAPeriodKind): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 && (periodKind !== 'retention' || value === 1)
}

function safeCentsSum(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    total += amountInCents(value)
    if (!Number.isSafeInteger(total))
      return null
  }
  return total
}

function amountForRatio(values: Array<number | null>, ratio: number | null, reason: string): PayrollAAmount {
  if (values.some(value => value !== null && (!Number.isFinite(value) || !Number.isSafeInteger(amountInCents(value)) || Math.abs(value * 100 - amountInCents(value)) > 1e-8)))
    return payrollAAmount([null], [reason])
  const complete = payrollAAmount(values)
  if (ratio === null || complete.knownValue === null)
    return payrollAAmount([null], [reason])
  const knownCents = safeCentsSum(values.filter((value): value is number => value !== null))
  if (knownCents === null)
    return payrollAAmount([null], [reason])
  const knownValue = payrollAMoney((knownCents / 100) * ratio)
  if (!Number.isSafeInteger(amountInCents(knownValue)))
    return payrollAAmount([null], [reason])
  if (complete.value === null)
    return { value: null, knownValue, state: 'partial', reasons: [reason] }
  return payrollAAmount([knownValue])
}

/** 对同一分项的行先累计到分，再应用该分项比例；费用与负价分别采用各自比例。 */
export function calculatePayrollAItemRatios(input: {
  periodKind: PayrollAPeriodKind
  defaultRatio: number | null
  itemRatios: readonly PayrollAItemRatio[]
  feeRatios: readonly PayrollAFeeRatio[]
  workLines: readonly (Pick<PayrollALine, 'itemId' | 'amount'> & Partial<Pick<PayrollALine, 'itemName'>>)[]
  feeLines: readonly (Pick<PayrollAFeeLine, 'feeId' | 'amount'> & Partial<Pick<PayrollAFeeLine, 'name'>>)[]
  negativeLines: readonly (Pick<PayrollANegativeLineRevision, 'lineId' | 'signedAmountFen'> & Partial<Pick<PayrollANegativeLineRevision, 'label'>>)[]
}): PayrollARatioCalculation {
  const reasons: string[] = []
  const itemById = new Map<string, number | null>()
  for (const entry of input.itemRatios) {
    if (!entry.itemId || itemById.has(entry.itemId) || (entry.ratio !== null && !validRatio(entry.ratio, input.periodKind)))
      reasons.push('工资分项比例身份重复或比例无效')
    else
      itemById.set(entry.itemId, entry.ratio)
  }
  const feeById = new Map<string, number>()
  for (const entry of input.feeRatios) {
    const key = JSON.stringify([entry.kind, entry.id])
    if (!entry.id || !['fee', 'negative'].includes(entry.kind) || feeById.has(key) || !validRatio(entry.ratio, input.periodKind))
      reasons.push('费用比例身份重复或比例无效')
    else
      feeById.set(key, entry.ratio)
  }
  const groups = new Map<string, Array<number | null>>()
  for (const line of input.workLines)
    groups.set(line.itemId, [...groups.get(line.itemId) ?? [], line.amount])
  const itemAmounts = [...groups].map(([itemId, values]) => {
    const ratio = input.periodKind === 'retention' ? 1 : itemById.get(itemId) ?? null
    const name = input.workLines.find(line => line.itemId === itemId)?.itemName || '名称未记录'
    if (ratio === null)
      reasons.push(`工程量分项 ${name} 尚未填写比例`)
    return { itemId, amount: amountForRatio(values, ratio, `工程量分项 ${name} 的金额或比例未完整提供`) }
  })
  const feeGroups = new Map<string, Array<number | null>>()
  for (const line of input.feeLines)
    feeGroups.set(line.feeId, [...feeGroups.get(line.feeId) ?? [], line.amount.value])
  const feeValues: Array<{ kind: 'fee' | 'negative', id: string, values: Array<number | null> }> = [
    ...[...feeGroups].map(([id, values]) => ({ kind: 'fee' as const, id, values })),
    ...input.negativeLines.map(line => ({ kind: 'negative' as const, id: line.lineId, values: [line.signedAmountFen === null ? null : line.signedAmountFen / 100] })),
  ]
  const feeAmounts = feeValues.map(({ kind, id, values }) => {
    const fallback = input.periodKind === 'retention' ? 1 : input.defaultRatio
    const ratio = feeById.get(JSON.stringify([kind, id])) ?? (validRatio(fallback, input.periodKind) ? fallback : null)
    const name = (kind === 'fee' ? input.feeLines.find(line => line.feeId === id)?.name : input.negativeLines.find(line => line.lineId === id)?.label) || '名称未记录'
    if (ratio === null)
      reasons.push(`费用 ${name} 尚未填写默认比例或单独比例`)
    return { kind, id, amount: amountForRatio(values, ratio, `费用 ${name} 的金额或比例未完整提供`) }
  })
  const allAmounts = [...itemAmounts.map(item => item.amount), ...feeAmounts.map(fee => fee.amount)]
  reasons.push(...allAmounts.flatMap(amount => amount.reasons))
  const known = allAmounts.flatMap(amount => amount.knownValue === null ? [] : [amount.knownValue])
  const complete = allAmounts.every(amount => amount.state === 'known') && reasons.length === 0
  const knownCents = safeCentsSum(known)
  if (knownCents === null) {
    const message = '分项累计金额超出安全精度，不能核算'
    return { itemRatios: [...input.itemRatios], feeRatios: [...input.feeRatios], itemAmounts, feeAmounts, cumulativeAmount: payrollAAmount([null], [message]), reasons: [...new Set([...reasons, message])] }
  }
  const knownValue = known.length || complete ? payrollAMoney(knownCents / 100) : null
  const cumulativeAmount: PayrollAAmount = { value: complete ? knownValue : null, knownValue, state: complete ? 'known' : known.length ? 'partial' : 'unknown', reasons: [...new Set(reasons)] }
  return { itemRatios: [...input.itemRatios], feeRatios: [...input.feeRatios], itemAmounts, feeAmounts, cumulativeAmount, reasons: [...new Set(reasons)] }
}
