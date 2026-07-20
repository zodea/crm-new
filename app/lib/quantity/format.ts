/** 量值显示统一口径：空值显示「—」，数值四舍五入到 2 位（登记弹窗与户详情共用）。 */
export function formatQuantityValue(value: number | null): string {
  if (value == null)
    return '—'
  return String(Math.round(value * 100) / 100)
}
