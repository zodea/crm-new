export type PrintPerPage = 1 | 2 | 4
export type PrintRotation = 0 | 90 | 180 | 270

export interface InvoicePrintRequest {
  ids: string[]
  rotations: Record<string, PrintRotation>
  perPage: PrintPerPage
  pageCount: number
  totalAmount: number
}

export interface PrintableInvoice {
  id: string
  totalAmount: number
  printRotation: number
  /** Invoice 传入时用于终态门禁；旧的纯排版 fixture 可省略这些字段。 */
  ocrStatus?: string
  reviewStatus?: string
  dupStatus?: string
}

export interface PrintSlot<T extends PrintableInvoice> {
  invoice: T
  rotation: PrintRotation
}

export interface PrintLayout<T extends PrintableInvoice> {
  pages: PrintSlot<T>[][]
  selectedCount: number
  pageCount: number
  totalAmount: number
}

export interface PrintQueueCheckResult {
  ok: boolean
  reason?: string
}

/** 打印队列只接受已完成识别、人工确认且未被重复排除的当前值。 */
export function checkPrintableInvoice(invoice: PrintableInvoice): PrintQueueCheckResult {
  if (!invoice.id.trim())
    return { ok: false, reason: '缺少票据 ID，不能进入打印队列' }
  if (invoice.ocrStatus != null && invoice.ocrStatus !== 'done')
    return { ok: false, reason: '识别尚未完成，不能进入打印队列' }
  if (invoice.reviewStatus != null && invoice.reviewStatus !== 'reviewed')
    return { ok: false, reason: '当前字段尚未完成人工确认，不能进入打印队列' }
  if (invoice.dupStatus === 'duplicate')
    return { ok: false, reason: '重复票据已排除，不能进入打印队列' }
  if (!Number.isFinite(invoice.totalAmount) || invoice.totalAmount <= 0)
    return { ok: false, reason: '价税合计缺失或金额异常，不能进入打印队列' }
  return { ok: true }
}

export function normalizePrintRotation(rotation: number): PrintRotation {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  return normalized as PrintRotation
}

export function rotatePrintItems(
  rotations: Readonly<Record<string, number>>,
  ids: readonly string[],
  degrees = 90,
): Record<string, PrintRotation> {
  const next = { ...rotations } as Record<string, PrintRotation>
  for (const id of ids)
    next[id] = normalizePrintRotation((rotations[id] ?? 0) + degrees)
  return next
}

export function buildPrintLayout<T extends PrintableInvoice>(
  invoices: readonly T[],
  selectedIds: ReadonlySet<string>,
  perPage: PrintPerPage,
  rotations: Readonly<Record<string, number>>,
): PrintLayout<T> {
  const selected = invoices
    .filter(invoice => selectedIds.has(invoice.id) && checkPrintableInvoice(invoice).ok)
    .map(invoice => ({
      invoice,
      rotation: normalizePrintRotation(rotations[invoice.id] ?? invoice.printRotation),
    }))
  const pages: PrintSlot<T>[][] = []
  for (let index = 0; index < selected.length; index += perPage)
    pages.push(selected.slice(index, index + perPage))

  return {
    pages,
    selectedCount: selected.length,
    pageCount: pages.length,
    totalAmount: selected.reduce((sum, slot) => sum + slot.invoice.totalAmount, 0),
  }
}
