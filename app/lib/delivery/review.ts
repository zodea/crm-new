import { round2 } from '~/lib/util/number'

export type DeliveryAmountSource = 'calculated' | 'ocr' | 'manual'

export interface DeliveryAmountLine {
  id: string
  qty: number | null
  unitPrice: number | null
  amount: number | null
  amountSource: DeliveryAmountSource
}

export interface DeliveryAmountSummary {
  total: number
  mismatchedLineIds: string[]
  statedBalanced: boolean | null
  balanced: boolean
}

export function calculatedDeliveryAmount(line: Pick<DeliveryAmountLine, 'qty' | 'unitPrice'>): number | null {
  if (line.qty == null || line.unitPrice == null)
    return null
  return round2(line.qty * line.unitPrice)
}

export function editDeliveryAmountLine<T extends DeliveryAmountLine>(
  line: T,
  field: 'qty' | 'unitPrice' | 'amount',
  value: number,
): T {
  const numeric = Number.isFinite(value) ? value : null
  if (field === 'amount') {
    return {
      ...line,
      amount: numeric == null ? null : round2(numeric),
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
  const total = round2(lines.reduce((sum, line) => sum + (line.amount ?? 0), 0))
  const mismatchedLineIds = lines
    .filter((line) => {
      if (line.amount == null)
        return true
      const calculated = calculatedDeliveryAmount(line)
      return calculated != null && Math.abs(calculated - line.amount) > 0.01
    })
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
