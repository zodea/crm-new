export interface InvoiceRecognitionField {
  key: string
  label: string
}

export interface InvoiceRecognitionChange {
  key: string
  label: string
  before: string
  after: string
}

/** 识别会写入的票面字段；标签与识别校对、整页编辑的字段名一致。归属项目不由识别产生，不在其中。 */
export const INVOICE_RECOGNITION_FIELDS: readonly InvoiceRecognitionField[] = [
  { key: 'invoiceNumber', label: '单据编号' },
  { key: 'invoiceDate', label: '开票日期' },
  { key: 'buyer', label: '购买方' },
  { key: 'buyerTaxNo', label: '购买方税号' },
  { key: 'seller', label: '供应商' },
  { key: 'sellerTaxNo', label: '供应商税号' },
  { key: 'invoiceType', label: '票据类型' },
  { key: 'totalAmount', label: '价税合计' },
  { key: 'taxAmount', label: '税额' },
  { key: 'taxRate', label: '税率' },
  { key: 'remark', label: '票面备注' },
]

function display(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : ''
  return String(value).trim()
}

/**
 * 重新识别可以覆盖当前字段，但须告诉用户哪些值被改掉：
 * 逐字段比较识别前用户看到的值与识别结果，只返回有变化的字段。
 */
export function invoiceRecognitionChanges(
  fields: readonly InvoiceRecognitionField[],
  before: object,
  after: object,
): InvoiceRecognitionChange[] {
  return fields.flatMap(({ key, label }) => {
    const rawBefore = (before as Record<string, unknown>)[key]
    const rawAfter = (after as Record<string, unknown>)[key]
    const from = display(rawBefore)
    const to = display(rawAfter)
    // 只有金额等数值字段按数值比较（表单中 "800.00" 与 800 相同）；票号等长数字串必须按文本比较，否则超出双精度后会被误判相等。
    const numeric = typeof rawBefore === 'number' || typeof rawAfter === 'number'
    if (from === to || (numeric && from !== '' && to !== '' && Number(from) === Number(to)))
      return []
    return [{ key, label, before: from, after: to }]
  })
}

/** 变动的单行文本（提醒清单与保存确认弹窗共用）：「字段：原值 → 新值」，空值写「（空）」。 */
export function formatInvoiceRecognitionChange(change: InvoiceRecognitionChange): string {
  return `${change.label}：${change.before || '（空）'} → ${change.after || '（空）'}`
}

/** 重新识别草稿保存前的二次确认正文：列出将写入的变动（识别前 → 当前草稿，含草稿上的人工修改）。 */
export function invoiceRecognitionSaveMessage(changes: readonly InvoiceRecognitionChange[]): string {
  const lines = changes.length
    ? [`以下 ${changes.length} 项与识别前不同（原值 → 新值）：`, ...changes.map(change => `· ${formatInvoiceRecognitionChange(change)}`)]
    : ['本次识别结果与识别前的票面字段一致。']
  return [...lines, '', '保存后发票回到“待校对”，需重新确认。'].join('\n')
}

/** recognized = 识别改了该字段；edited = 识别改过后又被人工修改（保存前一直标记）。 */
export type InvoiceRecognitionMark = 'recognized' | 'edited'

export const INVOICE_RECOGNITION_MARK_LABEL: Record<InvoiceRecognitionMark, string> = {
  recognized: '识别变动',
  edited: '已人工修改',
}

export interface InvoiceRecognitionFieldMark {
  mark: InvoiceRecognitionMark
  /** 识别前用户看到的值（可访问说明用） */
  before: string
}

/**
 * 草稿字段标记：只标识别前后不同的字段；当前值已不同于识别结果时标为「已人工修改」。
 */
export function invoiceRecognitionMarks(
  fields: readonly InvoiceRecognitionField[],
  before: object,
  recognized: object,
  current: object,
): Record<string, InvoiceRecognitionFieldMark> {
  const edited = new Set(invoiceRecognitionChanges(fields, recognized, current).map(change => change.key))
  return Object.fromEntries(invoiceRecognitionChanges(fields, before, recognized).map(change => [
    change.key,
    { mark: edited.has(change.key) ? 'edited' : 'recognized', before: change.before },
  ]))
}
