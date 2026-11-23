import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'

/** 每次仅生成合成数据，不访问用户文件。 */
export async function syntheticInvoiceWorkbook(invoiceNumber = 'SYNTHETIC-WORKBOOK', amount: number | null = null, ambiguous = false) {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['发票号码', '发票日期', '购买方', '购买方税号', '销售方', '销售方税号', '金额', '税额', '价税合计', '__importSource', '公式问题', '__proto__', '负零', ...(ambiguous ? ['税额', '税额_1'] : [])],
    [invoiceNumber, '2026-10-07', '合成主体', 'SUBCONTRACT-VERIFICATION', '合成分供方', 'CORRECTION-SELLER', amount, 0, 100, '保留表头', null, '真实特殊键', '-0', ...(ambiguous ? [2, 3] : [])],
  ])
  sheet.K2 = { t: 'e', f: '1/0', v: '#VALUE!', w: '#VALUE!' }
  XLSX.utils.book_append_sheet(book, sheet, '历史')
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array)
  const name = '历史.xlsx'
  const parsed = await parseInvoiceWorkbookForMapping(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, name)
  const meta = getInvoiceImportSourceMeta(parsed.sheets[0]!.rows[0]!)!
  const rawSnapshot = Object.fromEntries(Object.entries(meta.rawValues).map(([key, value]) => [key, value ?? null])) as Record<string, string | number | boolean | null>
  const source = { fileName: name, fileDigest: createHash('sha256').update(bytes).digest('hex'), sheetName: meta.sourceSheet, rowNumber: meta.sourceRow, rawSnapshot }
  const mapping = Object.fromEntries(Object.entries({ invoiceNumber: '发票号码', invoiceDate: '发票日期', buyer: '购买方', buyerTaxNo: '购买方税号', seller: '销售方', sellerTaxNo: '销售方税号', amount: '金额', taxAmount: '税额', totalAmount: '价税合计' }).map(([key, column]) => [key, { column, confidence: 'confirmed' as const }]))
  return { bytes, source, mapping, workbook: { fileName: name, fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }
}
