import type { VerifiedInvoiceSheetHeaders } from './central-workbook-headers'
import type { InvoiceImportWorkbook } from './excel'
import { inspectCentralInvoiceWorkbook } from './central-workbook-browser'

const verifiedWorkbook: unique symbol = Symbol('verified invoice workbook')

/** 只允许安全解析器创建：原文件摘要与可读取工作簿来自同一次完整核验。 */
export interface VerifiedCentralInvoiceWorkbook {
  readonly [verifiedWorkbook]: true
  readonly file: File
  readonly sha256: string
  readonly workbook: InvoiceImportWorkbook
  /** 与工作簿同一次安全解析所得的每表原始表头及列位置。 */
  readonly headers: readonly VerifiedInvoiceSheetHeaders[]
}

/** 预览只消费经 ZIP、XML 和范围核验的工作簿。 */
export async function openVerifiedCentralInvoiceWorkbook(file: File, signal?: AbortSignal): Promise<VerifiedCentralInvoiceWorkbook> {
  if (signal?.aborted)
    throw new DOMException('读取已取消。', 'AbortError')
  if (/\.xls$/i.test(file.name))
    throw new Error('旧版 XLS 暂无法安全校验，请保留原文件并稍后处理。')
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('请选择 Excel 文件（.xlsx 或 .xls）。')
  const { sha256, workbook } = await inspectCentralInvoiceWorkbook(file, signal)
  const headers = workbook.sheets.map(sheet => ({ sheetName: sheet.name, columns: (sheet.rawHeaders ?? []).map((rawHeader, index) => ({ index, rawHeader })) }))
  return { [verifiedWorkbook]: true, file, sha256, workbook, headers }
}
