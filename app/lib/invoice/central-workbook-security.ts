import type { VerifiedInvoiceSheetHeaders } from './central-workbook-headers'
import type { InvoiceImportWorkbook } from './excel'

declare const verifiedWorkbook: unique symbol

/** 只允许安全解析器创建：原文件摘要与可读取工作簿来自同一次完整核验。 */
export interface VerifiedCentralInvoiceWorkbook {
  readonly [verifiedWorkbook]: true
  readonly file: File
  readonly sha256: string
  readonly workbook: InvoiceImportWorkbook
  /** 与工作簿同一次安全解析所得的每表原始表头及列位置。 */
  readonly headers: readonly VerifiedInvoiceSheetHeaders[]
}

/** 安全核验尚未完成时不可读取或解析原文件，未来只返回已核验句柄。 */
export async function openVerifiedCentralInvoiceWorkbook(file: File, signal?: AbortSignal): Promise<VerifiedCentralInvoiceWorkbook> {
  if (signal?.aborted)
    throw new DOMException('读取已取消。', 'AbortError')
  if (/\.xls$/i.test(file.name))
    throw new Error('旧版 XLS 暂无法安全校验，请保留原文件并稍后处理。')
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('请选择 Excel 文件（.xlsx 或 .xls）。')
  throw new Error('工作簿安全核验暂不可用，请保留原文件并稍后重试。')
}
