import * as XLSX from 'xlsx'

export const INVOICE_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024
export const INVOICE_WORKBOOK_MAX_EXPANDED_BYTES = 100 * 1024 * 1024
export const INVOICE_WORKBOOK_MAX_SHEETS = 20
export const INVOICE_WORKBOOK_MAX_ROWS = 5000
export const INVOICE_WORKBOOK_MAX_COLUMNS = 100
export const INVOICE_WORKBOOK_LIMIT_MESSAGE = '工作簿超出限制：文件最多 10 MiB、20 个工作表，每表最多 5000 行及 100 列，解压最多 100 MiB；请拆分后重试。'

export class InvoiceWorkbookLimitError extends Error {}

export function assertInvoiceWorkbookSize(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > INVOICE_WORKBOOK_MAX_BYTES)
    throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
}

/** 必须在任何矩阵或合并区展开之前调用；绝不裁剪工作簿。 */
export function assertInvoiceWorkbookRanges(workbook: XLSX.WorkBook, selectedSheet?: string) {
  if (workbook.SheetNames.length > INVOICE_WORKBOOK_MAX_SHEETS)
    throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
  if (selectedSheet !== undefined && !workbook.SheetNames.includes(selectedSheet))
    throw new InvoiceWorkbookLimitError('工作簿中不存在此工作表。')
  for (const sheetName of workbook.SheetNames) {
    if (selectedSheet !== undefined && sheetName !== selectedSheet)
      continue
    const sheet = workbook.Sheets[sheetName]
    if (!sheet)
      throw new InvoiceWorkbookLimitError('工作簿工作表不完整。')
    const check = (range: XLSX.Range) => {
      if (![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger) || range.s.r < 0 || range.s.c < 0 || range.e.r < range.s.r || range.e.c < range.s.c || range.e.r >= INVOICE_WORKBOOK_MAX_ROWS || range.e.c >= INVOICE_WORKBOOK_MAX_COLUMNS)
        throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
    }
    if (sheet['!ref'])
      check(XLSX.utils.decode_range(sheet['!ref']))
    for (const address of Object.keys(sheet)) {
      if (!address.startsWith('!')) {
        const cell = XLSX.utils.decode_cell(address)
        check({ s: cell, e: cell })
      }
    }
    const occupied = new Uint8Array(INVOICE_WORKBOOK_MAX_ROWS * INVOICE_WORKBOOK_MAX_COLUMNS)
    for (const range of sheet['!merges'] ?? []) {
      check(range)
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let column = range.s.c; column <= range.e.c; column++) {
          const index = row * INVOICE_WORKBOOK_MAX_COLUMNS + column
          if (occupied[index])
            throw new InvoiceWorkbookLimitError('工作簿合并单元格重叠，无法可靠核验。')
          occupied[index] = 1
        }
      }
    }
  }
}
