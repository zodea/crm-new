export type PrintPerPage = 1 | 2 | 4
export type PrintRotation = 0 | 90 | 180 | 270

export interface PrintableInvoice {
  id: string
  totalAmount: number
  printRotation: number
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
    .filter(invoice => selectedIds.has(invoice.id))
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
