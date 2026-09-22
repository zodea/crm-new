import type { QuantityMeasureTotal } from './totals'

/** 量值显示统一口径：空值显示「—」，数值四舍五入到 2 位（登记弹窗与户详情共用）。 */
export function formatQuantityValue(value: number | null): string {
  if (value == null)
    return '—'
  return String(Math.round(value * 100) / 100)
}

export function formatQuantityTotalCompleteness(total: QuantityMeasureTotal): string {
  if (total.unitMissing)
    return '单位待核对'
  if (total.completeness === 'complete')
    return '完整'
  return total.missingCount > 0 ? `缺 ${total.missingCount} 项` : '暂不可算'
}
