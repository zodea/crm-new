import type { ExportData } from '~/lib/kit/export'
import type { Invoice } from '~/stores/invoice'
import * as XLSX from 'xlsx'

export const INVOICE_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const MONEY_FORMAT = '0.00_);[Red]\\(0.00\\)'
const DATE_FORMAT = 'yyyy"年"m"月"d"日";@'

const INVOICE_IMPORT_COLUMNS = [
  { label: '发票日期', width: 15 },
  { label: '发票号码', width: 23 },
  { label: '供应商', width: 30 },
  { label: '购买方', width: 30 },
  { label: '价税合计', width: 12 },
  { label: '税额', width: 12 },
  { label: '票据类型', width: 16 },
  { label: '归属项目', width: 24 },
  { label: '备注', width: 24 },
  { label: '外部旧ID / 匹配标识', width: 24 },
] as const

export interface InvoiceLedgerExportRow {
  invoiceDate: string
  invoiceNumber: string
  seller: string
  invoiceType: string
  totalAmount: number
  projectName: string
  source: string
  remark: string
}

const EXPORT_COLUMNS: readonly { key: keyof InvoiceLedgerExportRow, label: string, width: number }[] = [
  { key: 'invoiceDate', label: '发票日期', width: 15 },
  { key: 'invoiceNumber', label: '发票号码', width: 23 },
  { key: 'seller', label: '供应商', width: 30 },
  { key: 'invoiceType', label: '票据类型', width: 16 },
  { key: 'totalAmount', label: '价税合计', width: 12 },
  { key: 'projectName', label: '归属项目', width: 24 },
  { key: 'source', label: '来源', width: 10 },
  { key: 'remark', label: '备注', width: 20 },
]

export function invoiceLedgerRows(invoices: readonly Invoice[]): InvoiceLedgerExportRow[] {
  return invoices.map(invoice => ({
    invoiceDate: invoice.invoiceDate,
    invoiceNumber: invoice.invoiceNumber,
    seller: invoice.seller,
    invoiceType: invoice.invoiceType,
    totalAmount: Number(invoice.totalAmount || 0),
    projectName: invoice.ownerKind === 'personal' ? '个人开支' : invoice.projectName,
    source: invoice.source === 'scan' ? '扫描' : 'Excel 导入',
    remark: invoice.remark,
  }))
}

function cellAddress(row: number, column: number): string {
  return XLSX.utils.encode_cell({ r: row, c: column })
}

function excelDateValue(value: string): Date | string {
  const match = value.match(/^(\d{4})[-/]([01]\d)[-/]([0-3]\d)$/)
  if (!match)
    return value
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? value : date
}

function mergeContiguousValues(
  worksheet: XLSX.WorkSheet,
  rows: readonly InvoiceLedgerExportRow[],
  column: number,
  startRow: number,
) {
  let groupStart = 0

  for (let index = 1; index <= rows.length; index++) {
    const previous = rows[index - 1]?.[EXPORT_COLUMNS[column]!.key]
    const current = rows[index]?.[EXPORT_COLUMNS[column]!.key]
    const changed = index === rows.length || current !== previous || current === '' || current == null
    if (!changed)
      continue

    if (index - groupStart > 1 && previous !== '' && previous != null) {
      worksheet['!merges'] ??= []
      worksheet['!merges'].push({
        s: { r: startRow + groupStart, c: column },
        e: { r: startRow + index - 1, c: column },
      })
    }
    groupStart = index
  }
}

function writeWorkbook(workbook: XLSX.WorkBook): ExportData {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
}

/** 下载给历史台账录入的标准模板；标题和说明独立放置，避免把示例数据误导入业务库。 */
export function createInvoiceImportTemplateXlsx(): ExportData {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['发票导入模板'],
    INVOICE_IMPORT_COLUMNS.map(column => column.label),
  ])
  worksheet['!cols'] = INVOICE_IMPORT_COLUMNS.map(column => ({ wch: column.width }))
  worksheet['!merges'] = [{
    s: { r: 0, c: 0 },
    e: { r: 0, c: INVOICE_IMPORT_COLUMNS.length - 1 },
  }]
  XLSX.utils.book_append_sheet(workbook, worksheet, '发票导入')

  const instructions = XLSX.utils.aoa_to_sheet([
    ['字段填写说明', '', ''],
    ['字段', '是否必填', '填写规则'],
    ['发票号码', '是', '按文本填写，保留前导零'],
    ['价税合计', '是', '填写大于 0 的数值，不要带货币符号'],
    ['归属项目', '是', '填写系统中的项目名称；个人费用填写“个人开支”'],
    ['发票日期', '否', '支持 YYYY-MM-DD 或 YYYY/MM/DD'],
    ['税额', '否', '未填写时按 0 处理，不含税金额由价税合计减税额'],
    ['外部旧ID / 匹配标识', '否', '用于历史系统对账'],
    ['其他字段', '否', '供应商、购买方、票据类型和备注按原文填写'],
  ])
  instructions['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 60 }]
  instructions['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  XLSX.utils.book_append_sheet(workbook, instructions, '填写说明')
  return writeWorkbook(workbook)
}

/**
 * 生成发票台账 Excel：标题带、列宽、金额/日期格式和连续重复值合并均写入 XLSX。
 * 合并只作用于连续且非空的供应商/归属项目单元格，避免把不同业务分组误合并。
 */
export function createInvoiceLedgerXlsxFromRows(rows: readonly InvoiceLedgerExportRow[]): ExportData {
  const values = [
    ['发票台账'],
    EXPORT_COLUMNS.map(column => column.label),
    ...rows.map(row => EXPORT_COLUMNS.map(column =>
      column.key === 'invoiceDate' ? excelDateValue(row.invoiceDate) : row[column.key],
    )),
    ['总数'],
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(values)
  const workbook = XLSX.utils.book_new()
  const dataStartRow = 2
  const totalRow = dataStartRow + rows.length

  worksheet['!cols'] = EXPORT_COLUMNS.map(column => ({ wch: column.width }))
  worksheet['!merges'] = [{
    s: { r: 0, c: 0 },
    e: { r: 0, c: EXPORT_COLUMNS.length - 1 },
  }]
  mergeContiguousValues(worksheet, rows, 2, dataStartRow)
  mergeContiguousValues(worksheet, rows, 5, dataStartRow)

  for (let row = dataStartRow; row < totalRow; row++) {
    const dateCell = worksheet[cellAddress(row, 0)]
    if (dateCell)
      dateCell.z = DATE_FORMAT
    const amountCell = worksheet[cellAddress(row, 4)]
    if (amountCell) {
      amountCell.t = 'n'
      amountCell.z = MONEY_FORMAT
    }
  }

  const totalCell = worksheet[cellAddress(totalRow, 4)] ?? { t: 'n', v: 0 }
  totalCell.t = 'n'
  totalCell.v = rows.reduce((sum, row) => sum + row.totalAmount, 0)
  totalCell.z = MONEY_FORMAT
  worksheet[cellAddress(totalRow, 4)] = totalCell
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalRow, c: EXPORT_COLUMNS.length - 1 },
  })

  XLSX.utils.book_append_sheet(workbook, worksheet, '发票台账')
  return writeWorkbook(workbook)
}

export function createInvoiceLedgerXlsx(invoices: readonly Invoice[]): ExportData {
  return createInvoiceLedgerXlsxFromRows(invoiceLedgerRows(invoices))
}
