export interface InvoiceBorderSide {
  style: string
  color?: string
}

export interface InvoiceBorderStyle {
  top: InvoiceBorderSide
  bottom: InvoiceBorderSide
  left: InvoiceBorderSide
  right: InvoiceBorderSide
}

export type InvoiceBorderOverrides = {
  [Side in keyof InvoiceBorderStyle]?: Partial<InvoiceBorderSide>
}

// Open XML BorderStyleValues；保留旧配置中合法但不在常用控件里的线型。
const borderLineStyles: ReadonlySet<string> = new Set([
  'none',
  'thin',
  'medium',
  'dashed',
  'dotted',
  'thick',
  'double',
  'hair',
  'mediumDashed',
  'dashDot',
  'mediumDashDot',
  'dashDotDot',
  'mediumDashDotDot',
  'slantDashDot',
])

function normalizeBorderColor(value: string | undefined): string | undefined {
  if (value === undefined)
    return undefined
  if (typeof value !== 'string')
    throw new Error('边框颜色须填写 6 位 RGB 或 8 位 ARGB 十六进制色值')
  const entered = value.trim()
  if (!entered)
    return 'FF000000'
  const color = entered.replace(/^#/, '').toUpperCase()
  if (!/^(?:[0-9A-F]{6}|[0-9A-F]{8})$/.test(color))
    throw new Error('边框颜色须填写 6 位 RGB 或 8 位 ARGB 十六进制色值')
  return color.length === 6 ? `FF${color}` : color
}

function resolveSide(overrides: Partial<InvoiceBorderSide> | undefined, fallback: InvoiceBorderSide): InvoiceBorderSide {
  const value = { ...fallback, ...overrides }
  if (!borderLineStyles.has(value.style))
    throw new Error('边框线型无效，请重新选择')
  return { ...value, color: normalizeBorderColor(value.color) }
}

/** 新分组逐边继承旧配置；未设置的字段不会把用户既有样式重置为默认。 */
export function resolveInvoiceBorder(
  overrides: InvoiceBorderOverrides | undefined,
  fallback: InvoiceBorderStyle,
): InvoiceBorderStyle {
  return {
    top: resolveSide(overrides?.top, fallback.top),
    bottom: resolveSide(overrides?.bottom, fallback.bottom),
    left: resolveSide(overrides?.left, fallback.left),
    right: resolveSide(overrides?.right, fallback.right),
  }
}

/** CSS 没有 Excel 的点划复合线型，按实/虚/点/双线近似显示；原值仍写入 XLSX。 */
function previewSide(side: InvoiceBorderSide): string {
  if (side.style === 'none')
    return 'none'
  const width = side.style === 'thick' || side.style === 'double'
    ? 3
    : side.style.startsWith('medium') ? 2 : side.style === 'hair' ? 0.5 : 1
  const line = side.style === 'double'
    ? 'double'
    : side.style === 'dotted' ? 'dotted' : /dash/i.test(side.style) ? 'dashed' : 'solid'
  const argb = normalizeBorderColor(side.color) ?? 'FF000000'
  const color = argb.slice(0, 2) === 'FF' ? `#${argb.slice(2)}` : `#${argb.slice(2)}${argb.slice(0, 2)}`
  return `${width}px ${line} ${color}`
}

export function invoiceBorderPreviewStyle(border: InvoiceBorderStyle) {
  // 输入中的不完整颜色暂不应用，提交时由统一校验返回具体原因。
  function preview(side: InvoiceBorderSide) {
    try {
      return previewSide(side)
    }
    catch { return previewSide({ ...side, color: undefined }) }
  }
  return {
    borderTop: preview(border.top),
    borderBottom: preview(border.bottom),
    borderLeft: preview(border.left),
    borderRight: preview(border.right),
  }
}
