import * as XLSX from 'xlsx'
import { parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'

/** 仅供合成文件测试；不提供生产环境安全校验。 */
export async function syntheticVerifiedInvoiceWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const workbook = await parseInvoiceWorkbookForMapping(buffer, file.name)
  const raw = XLSX.read(buffer, { type: 'array', codepage: 65001, cellFormula: true, cellNF: true, cellStyles: true })
  const headers = workbook.sheets.map((sheet) => {
    const rawSheet = raw.Sheets[sheet.name]!
    const range = XLSX.utils.decode_range(rawSheet['!ref'] ?? 'A1')
    return {
      sheetName: sheet.name,
      columns: sheet.columns.map((_, index) => {
        const cell = rawSheet[XLSX.utils.encode_cell({ r: range.s.r + sheet.headerRow, c: range.s.c + index })]
        return { index, rawHeader: cell ? XLSX.utils.format_cell(cell) : '' }
      }),
    }
  })
  return { file, sha256, workbook, headers }
}

/** 用于只验证 UI 权限/焦点的纯内存工作簿替身。 */
export function syntheticHeaders(workbook: { sheets: Array<{ name: string, columns: string[] }> }) {
  return workbook.sheets.map(sheet => ({ sheetName: sheet.name, columns: sheet.columns.map((rawHeader, index) => ({ index, rawHeader })) }))
}
