import type { PayrollAAmount, PayrollADraft, PayrollAFormRead, PayrollARatioDefault, PayrollAReleaseDraft } from './central-a-contract'
import { payrollHollowAllowsZeroRelease } from './central-hollow-deduction-release'
import { payrollAmount } from './read-presentation'

export function payrollInputNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

export function payrollAmountSummary(value: PayrollAAmount): string {
  if (value.state === 'known' && value.value !== null)
    return payrollAmount(value.value)
  return value.knownValue === null ? '未能确定' : `已知 ${payrollAmount(value.knownValue)} · 来源未齐`
}

export function payrollRatioLabel(value: PayrollARatioDefault): string {
  const labels: Record<PayrollARatioDefault['source'], string> = { 'previous-statement': '沿用上月单据比例', 'subject-config': '负责人首月配置', 'crew-config': '班组明确配置', 'settlement-default': '结算默认比例，可按本次约定调整', 'retention-fixed': '尾款固定为 100%', 'missing': '首月比例尚未明确，请先配置' }
  return labels[value.source]
}

export function payrollDraft(value: Partial<PayrollADraft>): PayrollADraft {
  return { projectId: value.projectId ?? '', month: value.month ?? '', periodKind: value.periodKind ?? 'monthly', crewId: value.crewId ?? null, leaderWorkerId: value.leaderWorkerId ?? '', memberWorkerIds: [...value.memberWorkerIds ?? []], payRatio: value.payRatio ?? null, note: value.note ?? '', ...(value.book ? { book: { ...value.book } } : {}), ...(value.ratioPlan ? { ratioPlan: { schemaVersion: 1, itemRatios: value.ratioPlan.itemRatios.map(row => ({ ...row })), feeRatios: value.ratioPlan.feeRatios.map(row => ({ ...row })) } } : {}) }
}

export function payrollReleaseDefault(read: PayrollAFormRead): PayrollAReleaseDraft {
  const amount = read.totals.grossAmount.value
  return { actualAmount: amount, allocations: read.members.map(member => ({ workerId: member.id, amount: member.id === read.draft.leaderWorkerId ? amount : 0 })) }
}

function fen(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0)
    return null
  const result = Math.round(value * 100)
  return Math.abs(value * 100 - result) <= 1e-8 && Number.isSafeInteger(result) ? result : null
}

/** 仅校验用户输入，最终工资与此前已付由中央事务核验。 */
export function payrollReleaseError(read: PayrollAFormRead, draft: PayrollAReleaseDraft): string {
  if (draft.actualAmount === null)
    return '请填写实际发放总额，空白不代表零。'
  const actual = fen(draft.actualAmount)
  const gross = fen(read.totals.grossAmount.value)
  const zeroAllowed = read.eligibility.canRelease && payrollHollowAllowsZeroRelease(read.hollow?.snapshot)
  if (actual === null || (actual === 0 && !zeroAllowed))
    return '实际发放金额必须大于 0 且精确到分。'
  if (gross === null)
    return '核算应发尚未确定，请先补齐来源并重新核对。'
  if (actual > gross)
    return `实际发放不能超过本次核算应发 ${payrollAmount(gross / 100)}。`
  const members = new Set(read.members.map(member => member.id))
  const ids = new Set(draft.allocations.map(item => item.workerId))
  if (ids.size !== draft.allocations.length || ids.size !== members.size || [...ids].some(id => !members.has(id)))
    return '请保留全部原请款成员，零金额成员也必须填写。'
  const amounts = draft.allocations.map(item => fen(item.amount))
  if (amounts.includes(null))
    return '每位成员的收款金额都须填写，非负且精确到分。'
  const total = amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  return total === actual ? '' : `成员合计与实际发放相差 ${payrollAmount(Math.abs(total - actual) / 100)}，请核对。`
}
