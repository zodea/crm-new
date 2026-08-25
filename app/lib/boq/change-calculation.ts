import type { BoqChangeOperation } from './read-model'
import { round2 } from '~/lib/util/number'

export interface BoqChangeCalculationTarget {
  effectiveQty: number
  effectiveUnitPrice: number
}

export interface CalculatedBoqChangeLine {
  amount: number
  deltaQty: number | null
  newUnitPrice: number | null
}

export function requiredBoqFinite(value: number | undefined | null, label: string): number {
  if (value == null)
    throw new Error(`${label}不能为空`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    throw new Error(`${label}必须是有效数字`)
  return parsed
}

export function calculateBoqChangeLine(
  operation: BoqChangeOperation,
  target: BoqChangeCalculationTarget | null,
  deltaQty: number | null | undefined,
  newUnitPrice: number | null | undefined,
): CalculatedBoqChangeLine {
  if (operation === 'add') {
    const qty = requiredBoqFinite(deltaQty, '新增工程量')
    const price = requiredBoqFinite(newUnitPrice, '新增合同单价')
    if (qty <= 0 || price < 0)
      throw new Error('新增工程量必须大于 0，合同单价不能为负数')
    return { amount: round2(qty * price), deltaQty: qty, newUnitPrice: price }
  }
  if (!target)
    throw new Error('调量或调价必须指向有效清单行')
  if (operation === 'qty') {
    const delta = requiredBoqFinite(deltaQty, '调整工程量')
    if (delta === 0)
      throw new Error('调整工程量不能为 0')
    if (target.effectiveQty + delta < 0)
      throw new Error('调整后合同工程量不能为负数')
    return { amount: round2(delta * target.effectiveUnitPrice), deltaQty: delta, newUnitPrice: null }
  }
  const price = requiredBoqFinite(newUnitPrice, '调整后合同单价')
  if (price < 0)
    throw new Error('调整后合同单价不能为负数')
  if (price === target.effectiveUnitPrice)
    throw new Error('调整后合同单价没有变化')
  return {
    amount: round2(target.effectiveQty * (price - target.effectiveUnitPrice)),
    deltaQty: null,
    newUnitPrice: price,
  }
}
