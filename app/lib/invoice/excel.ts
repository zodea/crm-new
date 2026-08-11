import type { ExportData } from '~/lib/kit/export'
import type { RawImportSheet, RawImportWorkbook } from '~/lib/util/excel'
import type { Invoice } from '~/stores/invoice'
import * as XLSX from 'xlsx'
import { IMPORT_SOURCE_META_KEY } from '~/lib/kit/import-mapping'

export const INVOICE_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type InvoiceSheetKind = 'data' | 'summary' | 'blank'
export type InvoiceSourceRowKind = 'data' | 'total' | 'blank' | 'summary'
export type InvoiceFormulaStatus = 'none' | 'resolved' | 'missing-cache' | 'invalid'

export interface InvoiceSourceCell {
  address: string
  columnIndex: number
  columnName: string
  rawValue: unknown
  displayValue: string
  formula: string | null
  cachedValue: unknown
  formulaStatus: InvoiceFormulaStatus
}

export interface InvoiceSourceRow {
  sheetName: string
  sourceRow: number
  rowKind: InvoiceSourceRowKind
  cells: readonly InvoiceSourceCell[]
  rawValues: Readonly<Record<string, unknown>>
  displayValues: Readonly<Record<string, string>>
  mergeRanges: readonly string[]
  formulaIssues: readonly string[]
}

export interface InvoiceImportSourceMeta {
  sourceFileName: string
  sourceSheet: string
  sourceRow: number
  sourceKey: string
  naturalKey: string
  rowKind: InvoiceSourceRowKind
  mergeRanges: readonly string[]
  rawColumns: readonly string[]
  rawValues: Readonly<Record<string, unknown>>
  displayValues: Readonly<Record<string, string>>
  formulaCells: readonly Pick<InvoiceSourceCell, 'address' | 'columnName' | 'formula' | 'cachedValue' | 'formulaStatus'>[]
  reviewReasons: readonly string[]
}

export interface InvoiceImportSheet extends RawImportSheet {
  sheetKind: InvoiceSheetKind
  sourceRows: readonly InvoiceSourceRow[]
  ignoredRows: readonly InvoiceSourceRow[]
}

export interface InvoiceImportWorkbook extends RawImportWorkbook {
  sheets: InvoiceImportSheet[]
}

export interface InvoiceImportReview {
  row: Record<string, unknown>
  sourceRow: number | null
  reasons: readonly string[]
}

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

const INVOICE_HEADER_HINTS = [
  '发票日期',
  '开票日期',
  '发票号码',
  '发票号',
  '价税合计',
  '税额',
  '开票单位',
  '公司名称',
] as const

const FORMULA_ERROR_PATTERN = /#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)/i
const SUMMARY_SHEET_PATTERN = /汇总|统计|summary|total/i

function displayCellValue(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null)
    return ''
  return cell.w ?? String(cell.v)
}

function formulaStatus(cell: XLSX.CellObject | undefined, displayValue: string): InvoiceFormulaStatus {
  if (!cell?.f)
    return 'none'
  if (cell.t === 'e' || FORMULA_ERROR_PATTERN.test(displayValue))
    return 'invalid'
  if (cell.v == null || displayValue === '')
    return 'missing-cache'
  return 'resolved'
}

function sheetMatrix(ws: XLSX.WorkSheet, range: XLSX.Range): string[][] {
  const matrix: string[][] = []
  for (let row = range.s.r; row <= range.e.r; row++) {
    const values: string[] = []
    for (let column = range.s.c; column <= range.e.c; column++) {
      values.push(displayCellValue(ws[cellAddress(row, column)]))
    }
    matrix.push(values)
  }
  for (const merge of ws['!merges'] ?? []) {
    const startRow = merge.s.r - range.s.r
    const endRow = merge.e.r - range.s.r
    const startColumn = merge.s.c - range.s.c
    const endColumn = merge.e.c - range.s.c
    const value = matrix[startRow]?.[startColumn] ?? ''
    if (!value)
      continue
    for (let row = startRow; row <= endRow; row++) {
      for (let column = startColumn; column <= endColumn; column++) {
        if (matrix[row]?.[column] === '')
          matrix[row]![column] = value
      }
    }
  }
  return matrix
}

function invoiceHeaderScore(row: readonly string[]): number {
  const hints = INVOICE_HEADER_HINTS.filter(hint => row.some(value => value.includes(hint))).length
  const nonEmpty = row.filter(value => value.trim()).length
  return hints * 100 + nonEmpty
}

function detectInvoiceHeaderRow(matrix: readonly (readonly string[])[]): number {
  let selected = 0
  let bestScore = -1
  for (let index = 0; index < Math.min(matrix.length, 30); index++) {
    const score = invoiceHeaderScore(matrix[index] ?? [])
    if (score > bestScore) {
      selected = index
      bestScore = score
    }
  }
  return selected
}

function duplicateColumnNames(values: readonly string[]): { name: string, index: number }[] {
  const counts = new Map<string, number>()
  return values.flatMap((value, index) => {
    const name = value.trim() ? value : `__EMPTY_${index + 1}`
    const count = counts.get(name) ?? 0
    counts.set(name, count + 1)
    return [{ name: count === 0 ? name : `${name}_${count}`, index }]
  })
}

function isBlankRow(values: readonly string[]): boolean {
  return values.every(value => value.trim() === '')
}

function hasTotalMarker(values: readonly string[]): boolean {
  return values.some(value => /合计|总计|小计|总数/.test(value))
}

function sourceRowKind(
  values: readonly string[],
  sheetKind: InvoiceSheetKind,
  invoiceNumberColumn: number | null,
): InvoiceSourceRowKind {
  if (isBlankRow(values))
    return 'blank'
  if (sheetKind === 'summary')
    return 'summary'
  if (hasTotalMarker(values))
    return 'total'
  if (invoiceNumberColumn != null && !values[invoiceNumberColumn]?.trim()) {
    // 公式合计行不一定写“合计”，但只要没有票号且存在金额/公式，仍保留为待复核的非业务行。
    const hasAmountOrFormula = values.some(value => value.trim() !== '')
    if (hasAmountOrFormula)
      return 'total'
  }
  return 'data'
}

function normalizedInvoiceKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLocaleUpperCase('zh-CN')
}

function readInvoiceSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  sourceFileName: string,
): InvoiceImportSheet {
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet)
    throw new Error(`工作表不存在：${sheetName}`)

  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1')
  const matrix = sheetMatrix(worksheet, range)
  const nonEmptyCells = matrix.some(row => !isBlankRow(row))
  const headerRow = nonEmptyCells ? detectInvoiceHeaderRow(matrix) : 0
  const headerValues = matrix[headerRow] ?? []
  const columns = duplicateColumnNames(headerValues)
  const displayColumns = columns.map(column => column.name)
  const hasInvoiceHeader = invoiceHeaderScore(headerValues) >= 100
  const sheetKind: InvoiceSheetKind = !nonEmptyCells
    ? 'blank'
    : SUMMARY_SHEET_PATTERN.test(sheetName) || !hasInvoiceHeader
      ? 'summary'
      : 'data'
  const invoiceNumberColumn = columns.findIndex(column => /发票号码|发票号|票号/.test(column.name))
  const mergeRanges = (worksheet['!merges'] ?? []).map(merge => XLSX.utils.encode_range(merge))
  const sourceRows: InvoiceSourceRow[] = []
  const rows: Record<string, unknown>[] = []
  const ignoredRows: InvoiceSourceRow[] = []

  for (let matrixRow = headerRow + 1; matrixRow <= range.e.r - range.s.r; matrixRow++) {
    const absoluteRow = range.s.r + matrixRow
    const rowValues = matrix[matrixRow] ?? []
    const cells = columns.map((column) => {
      const address = cellAddress(absoluteRow, range.s.c + column.index)
      const cell = worksheet[address]
      const displayValue = rowValues[column.index] ?? ''
      return {
        address,
        columnIndex: column.index,
        columnName: column.name,
        rawValue: cell?.v,
        displayValue,
        formula: cell?.f ?? null,
        cachedValue: cell?.f ? cell.v : undefined,
        formulaStatus: formulaStatus(cell, displayValue),
      } satisfies InvoiceSourceCell
    })
    const displayValues = Object.fromEntries(columns.map(column => [column.name, rowValues[column.index] ?? '']))
    const rawValues = Object.fromEntries(cells.map(cell => [cell.columnName, cell.rawValue]))
    const formulaCells = cells.filter(cell => cell.formula)
    const formulaIssues = formulaCells
      .filter(cell => cell.formulaStatus === 'missing-cache' || cell.formulaStatus === 'invalid')
      .map(cell => `${cell.columnName}（${cell.address}）：${cell.formulaStatus === 'missing-cache' ? '缺少缓存值' : '缓存值异常'}`)
    const rowKind = sourceRowKind(rowValues, sheetKind, invoiceNumberColumn >= 0 ? invoiceNumberColumn : null)
    const sourceRow: InvoiceSourceRow = {
      sheetName,
      sourceRow: absoluteRow + 1,
      rowKind,
      cells,
      rawValues,
      displayValues,
      mergeRanges,
      formulaIssues,
    }
    sourceRows.push(sourceRow)
    if (rowKind !== 'data') {
      ignoredRows.push(sourceRow)
      continue
    }

    const mappedRow: Record<string, unknown> = { ...displayValues }
    const naturalKey = normalizedInvoiceKey(mappedRow[displayColumns[invoiceNumberColumn] ?? ''])
    const metadata: InvoiceImportSourceMeta = {
      sourceFileName,
      sourceSheet: sheetName,
      sourceRow: sourceRow.sourceRow,
      sourceKey: `${sourceFileName}::${sheetName}::${sourceRow.sourceRow}`,
      naturalKey,
      rowKind,
      mergeRanges,
      rawColumns: displayColumns,
      rawValues,
      displayValues,
      formulaCells: formulaCells.map(cell => ({
        address: cell.address,
        columnName: cell.columnName,
        formula: cell.formula,
        cachedValue: cell.cachedValue,
        formulaStatus: cell.formulaStatus,
      })),
      reviewReasons: [
        ...formulaIssues,
        ...(naturalKey ? [] : ['缺少发票号码，需逐行复核']),
      ],
    }
    Object.defineProperty(mappedRow, IMPORT_SOURCE_META_KEY, {
      configurable: true,
      enumerable: false,
      value: metadata,
      writable: false,
    })
    rows.push(mappedRow)
  }

  return {
    name: sheetName,
    headerRow,
    range: worksheet['!ref'] ?? '',
    mergeRanges,
    formulaCount: sourceRows.flatMap(row => row.cells).filter(cell => cell.formula).length,
    columns: displayColumns,
    rows,
    sheetKind,
    sourceRows,
    ignoredRows,
  }
}

async function invoiceArrayBuffer(file: File | ArrayBuffer): Promise<ArrayBuffer> {
  if (file instanceof ArrayBuffer)
    return file
  return file.arrayBuffer()
}

/**
 * 发票专用 Excel 读取链：不把工作簿降级为普通二维数组，保留来源 sheet/行/列、显示值、合并区域和公式证据。
 * 合计/空白预留行和汇总 sheet 只进入 sourceRows/ignoredRows，不会误投影为业务发票行。
 */
export async function parseInvoiceWorkbookForMapping(
  file: File | ArrayBuffer,
  sourceFileName = typeof File !== 'undefined' && file instanceof File ? file.name : 'invoice-workbook.xlsx',
): Promise<InvoiceImportWorkbook> {
  const workbook = XLSX.read(await invoiceArrayBuffer(file), {
    type: 'array',
    codepage: 65001,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
  })
  return {
    sheets: workbook.SheetNames.map(sheetName => readInvoiceSheet(workbook, sheetName, sourceFileName)),
  }
}

export function getInvoiceImportSourceMeta(row: Record<string, unknown>): InvoiceImportSourceMeta | undefined {
  return row[IMPORT_SOURCE_META_KEY] as InvoiceImportSourceMeta | undefined
}

export function invoiceNaturalKey(row: Record<string, unknown>): string {
  return normalizedInvoiceKey(row.invoiceNumber)
}

export function invoiceSourceKey(row: Record<string, unknown>): string {
  const externalRef = normalizedInvoiceKey(row.externalRef)
  return externalRef || getInvoiceImportSourceMeta(row)?.sourceKey || ''
}

/**
 * 对投影后的发票行做双重去重标记：自然键（发票号码）和来源键（外部旧 ID，否则文件/sheet/行号）。
 * 只标记、不删除；重复行由导入 runner 进入逐行拒绝清单，避免静默覆盖已有台账。
 */
export function annotateInvoiceImportRows(
  rows: readonly Record<string, unknown>[],
  existingNaturalKeys: readonly string[] = [],
): Record<string, unknown>[] {
  const naturalSeen = new Set<string>()
  const sourceSeen = new Set<string>()
  const existing = new Set(existingNaturalKeys.map(normalizedInvoiceKey).filter(Boolean))
  return rows.map((row) => {
    const meta = getInvoiceImportSourceMeta(row)
    const naturalKey = invoiceNaturalKey(row)
    const sourceKey = invoiceSourceKey(row)
    const reasons = [...(meta?.reviewReasons ?? [])]
    if (naturalKey && (naturalSeen.has(naturalKey) || existing.has(naturalKey)))
      reasons.push('发票号码重复，需逐行复核')
    if (sourceKey && sourceSeen.has(sourceKey))
      reasons.push('来源键重复，需逐行复核')
    if (naturalKey)
      naturalSeen.add(naturalKey)
    if (sourceKey)
      sourceSeen.add(sourceKey)
    if (!meta)
      return row
    const nextMeta: InvoiceImportSourceMeta = {
      ...meta,
      naturalKey,
      reviewReasons: [...new Set(reasons)],
    }
    const nextRow = { ...row }
    Object.defineProperty(nextRow, IMPORT_SOURCE_META_KEY, {
      configurable: true,
      enumerable: false,
      value: nextMeta,
      writable: false,
    })
    return nextRow
  })
}

export function invoiceImportReview(row: Record<string, unknown>): InvoiceImportReview {
  const meta = getInvoiceImportSourceMeta(row)
  return {
    row,
    sourceRow: meta?.sourceRow ?? null,
    reasons: meta?.reviewReasons ?? [],
  }
}

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
