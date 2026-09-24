import type { PayrollBatchFundingInput, PayrollBatchFundingItemInput, PayrollBatchFundingItemSuggestion, PayrollBatchFundingSuggestion } from './central-batch-contract'

const MAX_SAFE_FEN = BigInt(Number.MAX_SAFE_INTEGER)
const BIGINT_ZERO = BigInt(0)
const BIGINT_ONE = BigInt(1)
const BIGINT_HUNDRED = BigInt(100)

function assertFen(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label}必须是安全范围内的非负整数分`)
}

function safeFen(value: bigint, label: string): number {
  if (value < BIGINT_ZERO || value > MAX_SAFE_FEN)
    throw new Error(`${label}超出安全金额范围`)
  return Number(value)
}

function inputBlockers(item: PayrollBatchFundingItemInput): string[] {
  if (typeof item.bookKey !== 'string' || !item.bookKey.trim())
    throw new Error(`工资 ${item.itemId} 缺少稳定簿身份`)
  if (item.eligibleAmountFen === null)
    return ['当前未付应领仍未知']
  assertFen(item.eligibleAmountFen, `工资 ${item.itemId} 的当前未付应领`)
  if (item.formatFamily === 'A' && item.rounding.state === 'missing')
    return ['A 工资尚未明确取整规则']
  if (item.formatFamily === 'A' && item.rounding.state === 'not-applicable')
    throw new Error(`A 工资 ${item.itemId} 的取整状态无效`)
  if (item.formatFamily !== 'A' && item.rounding.state !== 'not-applicable')
    throw new Error(`${item.formatFamily} 工资 ${item.itemId} 不能采用 A 取整规则`)
  if (item.rounding.state === 'configured') {
    if (!item.rounding.revisionId || !Number.isSafeInteger(item.rounding.revision) || item.rounding.revision <= 0 || !/^\d{4}-\d{2}$/.test(item.rounding.effectiveMonth) || !item.rounding.sourceVersion)
      throw new Error(`A 工资 ${item.itemId} 的取整来源不完整`)
    if (item.rounding.rule.kind === 'floor' && item.rounding.rule.stepFen !== 10_000)
      throw new Error(`A 工资 ${item.itemId} 只支持已定的整百取整档`)
  }
  return []
}

function initialShare(item: PayrollBatchFundingItemInput, numerator: bigint, totalWeight: bigint): number {
  if (item.rounding.state === 'configured' && item.rounding.rule.kind === 'floor') {
    const step = BigInt(item.rounding.rule.stepFen)
    return safeFen((numerator / (totalWeight * step)) * step, `工资 ${item.itemId} 的建议金额`)
  }
  return safeFen(numerator / totalWeight, `工资 ${item.itemId} 的初分金额`)
}

function stableOrder(left: PayrollBatchFundingItemInput, right: PayrollBatchFundingItemInput): number {
  for (const key of ['bookKey', 'itemId'] as const) {
    if (left[key] !== right[key])
      return left[key] < right[key] ? -1 : 1
  }
  return 0
}

function allocateFlexible(items: PayrollBatchFundingItemSuggestion[], funding: bigint): void {
  const totalWeight = items.reduce((total, item) => total + BigInt(item.eligibleAmountFen!), BIGINT_ZERO)
  if (totalWeight === BIGINT_ZERO)
    return
  const distributable = funding < totalWeight ? funding : totalWeight
  const shares = items.map((item) => {
    const numerator = distributable * BigInt(item.eligibleAmountFen!)
    item.exactSuggestedAmountFen = initialShare(item, numerator, totalWeight)
    // 先补回各行与精确比例间的整分差，再按小数余数分尾；不会把整百差全给某一行。
    item.suggestedAmountFen = safeFen(numerator / totalWeight, `工资 ${item.itemId} 的建议金额`)
    return { item, remainder: numerator % totalWeight }
  })
  let remainder = distributable - items.reduce((total, item) => total + BigInt(item.suggestedAmountFen!), BIGINT_ZERO)
  shares.sort((left, right) => left.remainder === right.remainder ? stableOrder(left.item, right.item) : left.remainder > right.remainder ? -1 : 1)
  for (const { item } of shares) {
    if (remainder === BIGINT_ZERO)
      break
    item.suggestedAmountFen! += 1
    remainder -= BIGINT_ONE
  }
}

export function parsePayrollBatchFundingFen(value: string): number {
  const match = /^(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match)
    throw new Error('资金金额必须是非负且最多两位小数的明确金额')
  const fen = BigInt(match[1]!) * BIGINT_HUNDRED + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  if (fen > MAX_SAFE_FEN)
    throw new Error('资金金额超出安全范围')
  return Number(fen)
}

export function suggestPayrollBatchFunding(input: PayrollBatchFundingInput): PayrollBatchFundingSuggestion {
  assertFen(input.fundingAmountFen, '资金金额')
  if (!input.items.length)
    throw new Error('资金建议至少需要一张工资单')
  if (new Set(input.items.map(item => item.itemId)).size !== input.items.length)
    throw new Error('资金建议不能重复选择同一工资单')

  const initial = input.items.map(item => ({ item, blockers: inputBlockers(item) }))
  if (initial.some(row => row.blockers.length)) {
    return {
      state: 'incomplete',
      fundingAmountFen: input.fundingAmountFen,
      eligibleTotalFen: null,
      distributableFen: null,
      suggestedTotalFen: null,
      unallocatedFen: null,
      overAllocatedFen: 0,
      items: initial.map(({ item, blockers }) => ({ ...item, exactSuggestedAmountFen: null, suggestedAmountFen: null, blockers })),
      diagnostics: ['所选工资含未知余额或未明确配置，不能把缺口按零参与权重建议'],
    }
  }

  const eligibleTotal = initial.reduce((total, row) => total + BigInt(row.item.eligibleAmountFen!), BIGINT_ZERO)
  const funding = BigInt(input.fundingAmountFen)
  const distributable = funding < eligibleTotal ? funding : eligibleTotal
  const items: PayrollBatchFundingItemSuggestion[] = initial.map(({ item }) => ({ ...item, exactSuggestedAmountFen: 0, suggestedAmountFen: 0, blockers: [] }))
  let remaining = funding
  const deferred: PayrollBatchFundingItemSuggestion[] = []
  for (const item of items.filter(item => item.requiresFullAmount).sort(stableOrder)) {
    const amount = BigInt(item.eligibleAmountFen!)
    if (amount > remaining) {
      deferred.push(item)
      continue
    }
    item.exactSuggestedAmountFen = item.eligibleAmountFen
    item.suggestedAmountFen = item.eligibleAmountFen
    remaining -= amount
  }
  allocateFlexible(items.filter(item => !item.requiresFullAmount), remaining)
  const suggestedTotal = items.reduce((total, item) => total + BigInt(item.suggestedAmountFen!), BIGINT_ZERO)
  const unallocated = funding - suggestedTotal
  const diagnostics: string[] = []
  if (deferred.length)
    diagnostics.push(`${deferred.length} 份工资因资金不足整单金额而暂缓，未生成部分发放建议`)
  if (unallocated > BIGINT_ZERO)
    diagnostics.push(deferred.length ? `保留 ${unallocated} 分：普通工资已到可发上限，余额不足暂缓工资的整单金额` : `保留 ${unallocated} 分：资金超过所选工资的可发上限`)
  if (eligibleTotal === BIGINT_ZERO)
    diagnostics.push('所选工资当前均无可发余额，不生成支付')

  return {
    state: 'ready',
    fundingAmountFen: input.fundingAmountFen,
    eligibleTotalFen: safeFen(eligibleTotal, '可发余额合计'),
    distributableFen: safeFen(distributable, '可建议资金'),
    suggestedTotalFen: safeFen(suggestedTotal, '建议金额合计'),
    unallocatedFen: safeFen(unallocated, '未分配资金'),
    overAllocatedFen: 0,
    items,
    diagnostics,
  }
}
