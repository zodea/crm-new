import type { PayrollBatchFundingInput, PayrollBatchFundingItemInput, PayrollBatchFundingItemSuggestion, PayrollBatchFundingSuggestion } from './central-batch-contract'

const MAX_SAFE_FEN = BigInt(Number.MAX_SAFE_INTEGER)

function assertFen(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label}必须是安全范围内的非负整数分`)
}

function safeFen(value: bigint, label: string): number {
  if (value < 0n || value > MAX_SAFE_FEN)
    throw new Error(`${label}超出安全金额范围`)
  return Number(value)
}

function inputBlockers(item: PayrollBatchFundingItemInput): string[] {
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

function roundedShare(item: PayrollBatchFundingItemInput, distributable: bigint, totalWeight: bigint): number {
  const weight = BigInt(item.eligibleAmountFen!)
  const numerator = distributable * weight
  if (item.rounding.state === 'configured' && item.rounding.rule.kind === 'floor') {
    const step = BigInt(item.rounding.rule.stepFen)
    return safeFen((numerator / (totalWeight * step)) * step, `工资 ${item.itemId} 的建议金额`)
  }
  return safeFen((2n * numerator + totalWeight) / (2n * totalWeight), `工资 ${item.itemId} 的建议金额`)
}

export function parsePayrollBatchFundingFen(value: string): number {
  const match = /^(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match)
    throw new Error('资金金额必须是非负且最多两位小数的明确金额')
  const fen = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
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

  const eligibleTotal = initial.reduce((total, row) => total + BigInt(row.item.eligibleAmountFen!), 0n)
  const funding = BigInt(input.fundingAmountFen)
  const distributable = funding < eligibleTotal ? funding : eligibleTotal
  const items: PayrollBatchFundingItemSuggestion[] = initial.map(({ item }) => {
    const calculated = eligibleTotal === 0n ? 0 : roundedShare(item, distributable, eligibleTotal)
    const blockers: string[] = []
    let suggestedAmountFen = calculated
    if (item.requiresFullAmount && calculated !== item.eligibleAmountFen) {
      blockers.push(`本单已启动空鼓扣款，只能明确整单发放 ${item.eligibleAmountFen} 分或暂不支付`)
      suggestedAmountFen = 0
    }
    return { ...item, exactSuggestedAmountFen: calculated, suggestedAmountFen, blockers }
  })
  const suggestedTotal = items.reduce((total, item) => total + BigInt(item.suggestedAmountFen!), 0n)
  const overAllocated = suggestedTotal > funding ? suggestedTotal - funding : 0n
  const unallocated = overAllocated === 0n ? funding - suggestedTotal : null
  const diagnostics: string[] = []
  if (overAllocated > 0n)
    diagnostics.push(`按分取整后的建议合计超过资金 ${overAllocated} 分，请经办人明确分配尾差`)
  else if (unallocated! > 0n)
    diagnostics.push(`仍有 ${unallocated} 分未自动分配，请经办人明确调整`)
  if (eligibleTotal === 0n)
    diagnostics.push('所选工资当前均无可发余额，不生成支付')

  return {
    state: overAllocated > 0n || items.some(item => item.blockers.length) ? 'blocked' : 'ready',
    fundingAmountFen: input.fundingAmountFen,
    eligibleTotalFen: safeFen(eligibleTotal, '可发余额合计'),
    distributableFen: safeFen(distributable, '可建议资金'),
    suggestedTotalFen: safeFen(suggestedTotal, '建议金额合计'),
    unallocatedFen: unallocated === null ? null : safeFen(unallocated, '未分配资金'),
    overAllocatedFen: safeFen(overAllocated, '超出资金'),
    items,
    diagnostics,
  }
}
