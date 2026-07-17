import { round2 } from '~/lib/util/number'

export type DeliveryAmountSource = 'calculated' | 'ocr' | 'manual'

export interface DeliveryAmountLine {
  id: string
  qty: number
  unitPrice: number
  amount: number
  amountSource: DeliveryAmountSource
}

export interface DeliveryAmountSummary {
  total: number
  mismatchedLineIds: string[]
  statedBalanced: boolean | null
  balanced: boolean
}

export function calculatedDeliveryAmount(line: Pick<DeliveryAmountLine, 'qty' | 'unitPrice'>): number {
  return round2(Number(line.qty || 0) * Number(line.unitPrice || 0))
}

export function editDeliveryAmountLine<T extends DeliveryAmountLine>(
  line: T,
  field: 'qty' | 'unitPrice' | 'amount',
  value: number,
): T {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0
  if (field === 'amount') {
    return {
      ...line,
      amount: round2(numeric),
      amountSource: 'manual',
    }
  }
  const next = { ...line, [field]: numeric }
  if (line.amountSource === 'calculated')
    next.amount = calculatedDeliveryAmount(next)
  return next
}

export function summarizeDeliveryAmounts(
  lines: readonly DeliveryAmountLine[],
  statedTotal: number | null,
): DeliveryAmountSummary {
  const total = round2(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0))
  const mismatchedLineIds = lines
    .filter(line => Math.abs(calculatedDeliveryAmount(line) - Number(line.amount || 0)) > 0.01)
    .map(line => line.id)
  const statedBalanced = statedTotal == null
    ? null
    : Math.abs(total - statedTotal) <= 1
  return {
    total,
    mismatchedLineIds,
    statedBalanced,
    balanced: lines.length > 0 && mismatchedLineIds.length === 0 && statedBalanced !== false,
  }
}
