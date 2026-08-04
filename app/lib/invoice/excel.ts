import type { ExportData } from '~/lib/kit/export'
import type { Invoice } from '~/stores/invoice'
import * as XLSX from 'xlsx'

export const INVOICE_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const MONEY_FORMAT = '0.00_);[Red]\\(0.00\\)'
const DATE_FORMAT = 'yyyy"年"m"月"d"日";@'

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

/**
 * 生成发票台账 Excel：标题带、列宽、金额/日期格式和连续重复值合并均写入 XLSX。
 * 合并只作用于连续且非空的供应商/归属项目单元格，避免把不同业务分组误合并。
 */
export function createInvoiceLedgerXlsx(invoices: readonly Invoice[]): ExportData {
  const rows = invoiceLedgerRows(invoices)
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
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
}
