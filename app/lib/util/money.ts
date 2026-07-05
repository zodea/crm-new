// 金额格式化：¥#,##0.00 千分位 + 强制两位小数，完整展示不省略。
// 统一替代散落各页面的内联 fmtMoney 副本（对齐设计源码 kit 的 yuan()），
// 落实 DATABASE.md「金额一律两位小数完整展示」铁律与 #50 AC②。

export interface FormatMoneyOptions {
  /** 是否加 ¥ 前缀，默认 false。 */
  currency?: boolean
  /** null / NaN / 空串 的占位符，默认 '—'。 */
  blank?: string
}

/**
 * 格式化金额为 `#,##0.00`（可选 ¥ 前缀）。
 * - 强制两位小数、千分位分组，不做省略；
 * - 接受 number 或数字字符串；非数值返回 blank 占位。
 */
export function formatMoney(
  value: number | string | null | undefined,
  options: FormatMoneyOptions = {},
): string {
  const { currency = false, blank = '—' } = options
  const n = typeof value === 'string' ? Number.parseFloat(value) : value
  if (n == null || Number.isNaN(n))
    return blank
  const body = n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency ? `¥${body}` : body
}

/** 带 ¥ 前缀的便捷封装（对齐设计源码 kit 的 yuan()）。 */
export function yuan(value: number | string | null | undefined, blank = '—'): string {
  return formatMoney(value, { currency: true, blank })
}
