import type { ExportData } from '~/lib/kit/export'
import type { RawImportSheet, RawImportWorkbook } from '~/lib/util/excel'
import type { Invoice } from '~/stores/invoice'
import * as XLSX from 'xlsx'
import { IMPORT_SOURCE_META_KEY } from '~/lib/kit/import-mapping'

export const INVOICE_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type InvoiceSheetKind = 'data' | 'summary' | 'blank'
export type InvoiceSourceRowKind = 'data' | 'total' | 'blank' | 'summary'
export type InvoiceFormulaStatus = 'none' | 'resolved' | 'missing-cache' | 'invalid'

export interface InvoiceFontStyle {
  name: string
  sz: number
  bold?: boolean
  italic?: boolean
  color?: string
}

export interface InvoiceBorderSide {
  style: string
  color?: string
}

export interface InvoiceBorderStyle {
  top: InvoiceBorderSide
  bottom: InvoiceBorderSide
  left: InvoiceBorderSide
  right: InvoiceBorderSide
}

export interface InvoiceCellStyleSnapshot {
  styleId: number | null
  font: InvoiceFontStyle
  border: InvoiceBorderStyle
  alignment: {
    horizontal?: string
    vertical?: string
    wrapText?: boolean
  }
  numberFormat: string
}

export interface InvoiceWorksheetStyleSnapshot {
  sheetName: string
  freezeRows: number
  columns: readonly { min: number, max: number, width: number, wch: number }[]
  rows: readonly { row: number, hpt: number }[]
  cells: Readonly<Record<string, InvoiceCellStyleSnapshot>>
  mergedCells: readonly string[]
}

export interface InvoiceWorkbookFormatIssue {
  sheetName: string
  sourceRow: number | null
  address: string | null
  reason: string
}

export interface InvoiceWorkbookStyleReadback {
  sheets: readonly InvoiceWorksheetStyleSnapshot[]
  issues: readonly InvoiceWorkbookFormatIssue[]
}

export interface InvoiceXlsxStyleConfig {
  freezeRows?: number
  titleRowHeight?: number
  headerRowHeight?: number
  dataRowHeight?: number
  totalRowHeight?: number
  titleFont?: Partial<InvoiceFontStyle>
  headerFont?: Partial<InvoiceFontStyle>
  dataFont?: Partial<InvoiceFontStyle>
  totalFont?: Partial<InvoiceFontStyle>
  border?: Partial<InvoiceBorderStyle>
}

export interface InvoiceSourceCell {
  address: string
  columnIndex: number
  columnName: string
  rawValue: unknown
  displayValue: string
  formula: string | null
  cachedValue: unknown
  formulaStatus: InvoiceFormulaStatus
  styleId: number | null
  style: InvoiceCellStyleSnapshot | null
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
  styleIssues: readonly string[]
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
  style: InvoiceWorksheetStyleSnapshot | null
  styleIssues: readonly InvoiceWorkbookFormatIssue[]
}

export interface InvoiceImportWorkbook extends RawImportWorkbook {
  sheets: InvoiceImportSheet[]
}

export interface InvoiceImportReview {
  row: Record<string, unknown>
  sourceRow: number | null
  reasons: readonly string[]
}

export const MONEY_FORMAT = '0.00_);[Red]\\(0.00\\)'
export const DATE_FORMAT = 'yyyy"年"m"月"d"日";@'
const TEXT_FORMAT = '@'

type InvoiceStyleRole = 'title' | 'header' | 'data' | 'total'

interface InvoiceResolvedStyleConfig {
  freezeRows: number
  titleRowHeight: number
  headerRowHeight: number
  dataRowHeight: number
  totalRowHeight: number
  titleFont: InvoiceFontStyle
  headerFont: InvoiceFontStyle
  dataFont: InvoiceFontStyle
  totalFont: InvoiceFontStyle
  border: InvoiceBorderStyle
}

interface InvoiceStylePlan {
  roles: Map<string, { role: InvoiceStyleRole, numberFormat?: string }>
  freezeRows: number
}

const INVOICE_STYLE_PLANS = new WeakMap<XLSX.WorkSheet, InvoiceStylePlan>()

const DEFAULT_INVOICE_STYLE: InvoiceResolvedStyleConfig = {
  freezeRows: 2,
  titleRowHeight: 24,
  headerRowHeight: 28,
  dataRowHeight: 32,
  totalRowHeight: 24,
  titleFont: { name: '等线', sz: 16, bold: true },
  headerFont: { name: '等线', sz: 14, bold: true },
  dataFont: { name: '等线', sz: 12 },
  totalFont: { name: '等线', sz: 12, bold: true },
  border: {
    top: { style: 'thin', color: 'FF000000' },
    bottom: { style: 'thin', color: 'FF000000' },
    left: { style: 'thin', color: 'FF000000' },
    right: { style: 'thin', color: 'FF000000' },
  },
}

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

function resolveInvoiceStyleConfig(config: InvoiceXlsxStyleConfig = {}): InvoiceResolvedStyleConfig {
  const mergeFont = (font: Partial<InvoiceFontStyle> | undefined, fallback: InvoiceFontStyle): InvoiceFontStyle => ({
    ...fallback,
    ...font,
  })
  const mergeBorder = (border: Partial<InvoiceBorderStyle> | undefined): InvoiceBorderStyle => ({
    top: { ...DEFAULT_INVOICE_STYLE.border.top, ...border?.top },
    bottom: { ...DEFAULT_INVOICE_STYLE.border.bottom, ...border?.bottom },
    left: { ...DEFAULT_INVOICE_STYLE.border.left, ...border?.left },
    right: { ...DEFAULT_INVOICE_STYLE.border.right, ...border?.right },
  })
  return {
    freezeRows: Math.max(0, Math.trunc(config.freezeRows ?? DEFAULT_INVOICE_STYLE.freezeRows)),
    titleRowHeight: config.titleRowHeight ?? DEFAULT_INVOICE_STYLE.titleRowHeight,
    headerRowHeight: config.headerRowHeight ?? DEFAULT_INVOICE_STYLE.headerRowHeight,
    dataRowHeight: config.dataRowHeight ?? DEFAULT_INVOICE_STYLE.dataRowHeight,
    totalRowHeight: config.totalRowHeight ?? DEFAULT_INVOICE_STYLE.totalRowHeight,
    titleFont: mergeFont(config.titleFont, DEFAULT_INVOICE_STYLE.titleFont),
    headerFont: mergeFont(config.headerFont, DEFAULT_INVOICE_STYLE.headerFont),
    dataFont: mergeFont(config.dataFont, DEFAULT_INVOICE_STYLE.dataFont),
    totalFont: mergeFont(config.totalFont, DEFAULT_INVOICE_STYLE.totalFont),
    border: mergeBorder(config.border),
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function xmlAttribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1]
}

function xmlNumberAttribute(xml: string, name: string): number | undefined {
  const value = xmlAttribute(xml, name)
  return value == null ? undefined : Number(value)
}

function xmlBooleanAttribute(xml: string, name: string): boolean | undefined {
  const value = xmlAttribute(xml, name)
  if (value == null)
    return undefined
  return value === '1' || value.toLowerCase() === 'true'
}

function xmlSection(xml: string, tag: string): string {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? ''
}

function xmlTagList(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}\\b[^>]*?(?:\\/>|>[\\s\\S]*?</${tag}>)`, 'g')) ?? []
}

function styleColor(xml: string): string | undefined {
  const rgb = xmlAttribute(xml, 'rgb')
  if (rgb)
    return rgb
  return undefined
}

function styleFontFromXml(xml: string): InvoiceFontStyle {
  const nameXml = /<name\b[^>]*>(?:<\/name>)?/.exec(xml)?.[0] ?? ''
  const sizeXml = /<sz\b[^>]*>(?:<\/sz>)?/.exec(xml)?.[0] ?? ''
  const bold = /<b(?:\s[^>]*)?\/?>(?:<\/b>)?/.test(xml)
  const italic = /<i(?:\s[^>]*)?\/?>(?:<\/i>)?/.test(xml)
  return {
    name: decodeXmlAttribute(xmlAttribute(nameXml, 'val')) ?? '等线',
    sz: xmlNumberAttribute(sizeXml, 'val') ?? 12,
    bold: bold || undefined,
    italic: italic || undefined,
    color: styleColor(xml.match(/<color\b[^>]*>(?:<\/color>)?/)?.[0] ?? '')
      ?? undefined,
  }
}

function styleBorderSideFromXml(xml: string, side: string): InvoiceBorderSide {
  const sideXml = new RegExp(`<${side}\\b[^>]*>([\\s\\S]*?)</${side}>|<${side}\\b[^>]*/>`).exec(xml)?.[0] ?? ''
  return {
    style: xmlAttribute(sideXml, 'style') ?? 'none',
    color: styleColor(sideXml.match(/<color\b[^>]*>(?:<\/color>)?/)?.[0] ?? '') ?? undefined,
  }
}

function styleBorderFromXml(xml: string): InvoiceBorderStyle {
  return {
    top: styleBorderSideFromXml(xml, 'top'),
    bottom: styleBorderSideFromXml(xml, 'bottom'),
    left: styleBorderSideFromXml(xml, 'left'),
    right: styleBorderSideFromXml(xml, 'right'),
  }
}

function styleAlignmentFromXml(xml: string): InvoiceCellStyleSnapshot['alignment'] {
  const alignment = /<alignment\b[^>]*>(?:<\/alignment>)?/.exec(xml)?.[0] ?? ''
  return {
    horizontal: xmlAttribute(alignment, 'horizontal'),
    vertical: xmlAttribute(alignment, 'vertical'),
    wrapText: xmlBooleanAttribute(alignment, 'wrapText'),
  }
}

function styleRoleFont(role: InvoiceStyleRole, config: InvoiceResolvedStyleConfig): InvoiceFontStyle {
  if (role === 'title')
    return config.titleFont
  if (role === 'header')
    return config.headerFont
  if (role === 'total')
    return config.totalFont
  return config.dataFont
}

function createStylePlan(freezeRows: number): InvoiceStylePlan {
  return { roles: new Map(), freezeRows }
}

function assignStyle(
  worksheet: XLSX.WorkSheet,
  address: string,
  role: InvoiceStyleRole,
  numberFormat?: string,
) {
  const plan = INVOICE_STYLE_PLANS.get(worksheet)
  if (!plan)
    return
  plan.roles.set(address, { role, numberFormat })
}

function setRowHeights(worksheet: XLSX.WorkSheet, heights: readonly number[]) {
  worksheet['!rows'] = heights.map(hpt => ({ hpt }))
}

function cellStyleAddresses(
  worksheet: XLSX.WorkSheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  role: InvoiceStyleRole,
  numberFormats: Readonly<Record<number, string>> = {},
) {
  for (let row = startRow; row <= endRow; row++) {
    for (let column = startColumn; column <= endColumn; column++) {
      assignStyle(worksheet, cellAddress(row, column), role, numberFormats[column])
    }
  }
}

function newInvoiceStylePlan(worksheet: XLSX.WorkSheet, freezeRows: number) {
  INVOICE_STYLE_PLANS.set(worksheet, createStylePlan(freezeRows))
}

function bufferBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (readUInt32(bytes, offset) === 0x06054B50)
      return offset
  }
  return -1
}

interface InvoiceZipEntry {
  name: string
  data: Uint8Array
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('当前运行环境不支持 XLSX 压缩包解压')
  const blobBytes = new Uint8Array(bytes.length)
  blobBytes.set(bytes)
  const stream = new Blob([blobBytes.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readXlsxZipEntries(value: ArrayBuffer | Uint8Array): Promise<InvoiceZipEntry[]> {
  const bytes = bufferBytes(value)
  const end = findEndOfCentralDirectory(bytes)
  if (end < 0)
    throw new Error('不是可读取的 XLSX ZIP 包')
  const count = readUInt16(bytes, end + 10)
  const centralOffset = readUInt32(bytes, end + 16)
  const entries: InvoiceZipEntry[] = []
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (readUInt32(bytes, offset) !== 0x02014B50)
      throw new Error('XLSX 中央目录损坏')
    const method = readUInt16(bytes, offset + 10)
    const compressedSize = readUInt32(bytes, offset + 20)
    const nameLength = readUInt16(bytes, offset + 28)
    const extraLength = readUInt16(bytes, offset + 30)
    const commentLength = readUInt16(bytes, offset + 32)
    const localOffset = readUInt32(bytes, offset + 42)
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const localNameLength = readUInt16(bytes, localOffset + 26)
    const localExtraLength = readUInt16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    const data = method === 0
      ? new Uint8Array(compressed)
      : method === 8
        ? await inflateRaw(compressed)
        : (() => { throw new Error(`不支持的 XLSX 压缩方式：${method}`) })()
    entries.push({ name, data })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++)
      value = (value & 1) ? (value >>> 1) ^ 0xEDB88320 : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xFFFFFFFF
  for (const byte of bytes)
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xFF]!
  return (value ^ 0xFFFFFFFF) >>> 0
}

function writeUInt16(value: number): Uint8Array {
  return new Uint8Array([value & 0xFF, (value >>> 8) & 0xFF])
}

function writeUInt32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xFF,
    (value >>> 8) & 0xFF,
    (value >>> 16) & 0xFF,
    (value >>> 24) & 0xFF,
  ])
}

function writeStoredXlsxZip(entries: readonly InvoiceZipEntry[]): ArrayBuffer {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const checksum = crc32(entry.data)
    const local = concatBytes([
      writeUInt32(0x04034B50),
      writeUInt16(20),
      writeUInt16(0x800),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(entry.data.length),
      writeUInt32(entry.data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
      entry.data,
    ])
    localParts.push(local)
    const central = concatBytes([
      writeUInt32(0x02014B50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x800),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(checksum),
      writeUInt32(entry.data.length),
      writeUInt32(entry.data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name,
    ])
    centralParts.push(central)
    offset += local.length
  }
  const central = concatBytes(centralParts)
  const local = concatBytes(localParts)
  const end = concatBytes([
    writeUInt32(0x06054B50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.length),
    writeUInt32(local.length),
    writeUInt16(0),
  ])
  return concatBytes([local, central, end]).buffer as ArrayBuffer
}

function styleFontXml(font: InvoiceFontStyle): string {
  const color = font.color ? `<color rgb="${xmlEscape(font.color)}"/>` : ''
  return `<font><sz val="${font.sz}"/><name val="${xmlEscape(font.name)}"/>${font.bold ? '<b/>' : ''}${font.italic ? '<i/>' : ''}${color}</font>`
}

function styleBorderXml(border: InvoiceBorderStyle): string {
  const side = (name: string, value: InvoiceBorderSide) => `<${name} style="${xmlEscape(value.style)}">${value.color ? `<color rgb="${xmlEscape(value.color)}"/>` : ''}</${name}>`
  return `<border>${side('left', border.left)}${side('right', border.right)}${side('top', border.top)}${side('bottom', border.bottom)}<diagonal/></border>`
}

function styleKey(role: InvoiceStyleRole, numberFormat: string | undefined): string {
  return `${role}::${numberFormat ?? 'General'}`
}

interface InvoiceStylePatchContext {
  styleIds: Map<string, number>
  config: InvoiceResolvedStyleConfig
}

function numberFormatIdMap(stylesXml: string): Map<string, number> {
  const formats = new Map<string, number>([['General', 0], [TEXT_FORMAT, 49]])
  for (const match of stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*>(?:<\/numFmt>)?/g))
    formats.set(match[2]!.replaceAll('&quot;', '"'), Number(match[1]))
  return formats
}

function appendXmlSection(
  xml: string,
  tag: string,
  children: readonly string[],
): { xml: string, startIndex: number } {
  const sectionRegex = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`)
  const match = sectionRegex.exec(xml)
  if (!match)
    throw new Error(`XLSX styles.xml 缺少 ${tag}`)
  const count = Number(xmlAttribute(match[1] ?? '', 'count') ?? 0)
  const next = `${match[0].replace(/count="\d+"/, `count="${count + children.length}"`).replace(`</${tag}>`, `${children.join('')}</${tag}>`)}`
  return {
    xml: xml.slice(0, match.index) + next + xml.slice(match.index + match[0].length),
    startIndex: count,
  }
}

function appendNumberFormats(stylesXml: string, formats: readonly string[]): { xml: string, ids: Map<string, number> } {
  const ids = numberFormatIdMap(stylesXml)
  const missing = formats.filter(format => !ids.has(format) && format !== 'General' && format !== TEXT_FORMAT)
  if (!missing.length)
    return { xml: stylesXml, ids }
  const existingIds = [...ids.values()].filter(id => id >= 164)
  let nextId = Math.max(163, ...existingIds) + 1
  const children: string[] = []
  for (const format of missing) {
    const id = nextId++
    ids.set(format, id)
    children.push(`<numFmt numFmtId="${id}" formatCode="${xmlEscape(format)}"/>`)
  }
  const sectionRegex = /<numFmts([^>]*)>[\s\S]*?<\/numFmts>/
  const match = sectionRegex.exec(stylesXml)
  if (!match)
    throw new Error('XLSX styles.xml 缺少 numFmts')
  const count = Number(xmlAttribute(match[1] ?? '', 'count') ?? 0)
  const replacement = match[0]
    .replace(/count="\d+"/, `count="${count + children.length}"`)
    .replace('</numFmts>', `${children.join('')}</numFmts>`)
  return { xml: stylesXml.slice(0, match.index) + replacement + stylesXml.slice(match.index + match[0].length), ids }
}

function patchStylesXml(
  stylesXml: string,
  config: InvoiceResolvedStyleConfig,
  plans: readonly InvoiceStylePlan[],
): { xml: string, context: InvoiceStylePatchContext } {
  const roles: InvoiceStyleRole[] = ['title', 'header', 'data', 'total']
  const formats = [...new Set(plans.flatMap(plan => [...plan.roles.values()].map(value => value.numberFormat).filter((format): format is string => Boolean(format))))]
  let xml = stylesXml
  const formatResult = appendNumberFormats(xml, formats)
  xml = formatResult.xml
  const fonts = roles.map(role => styleFontXml(styleRoleFont(role, config)))
  const borders = [styleBorderXml(config.border)]
  const fontResult = appendXmlSection(xml, 'fonts', fonts)
  xml = fontResult.xml
  const borderResult = appendXmlSection(xml, 'borders', borders)
  xml = borderResult.xml
  const cellXfs = xmlSection(xml, 'cellXfs')
  const existingXfCount = Number(xmlAttribute(/<cellXfs\b[^>]*>/.exec(xml)?.[0] ?? '', 'count') ?? 0)
  const styleIds = new Map<string, number>()
  let nextStyleId = existingXfCount
  const styleChildren: string[] = []
  for (const role of roles) {
    const numberFormats = [...new Set(plans.flatMap(plan => [...plan.roles.values()]
      .filter(value => value.role === role)
      .map(value => value.numberFormat)))].filter((format): format is string => Boolean(format))
    for (const numberFormat of [undefined, ...numberFormats]) {
      const key = styleKey(role, numberFormat)
      if (styleIds.has(key))
        continue
      const fontId = fontResult.startIndex + roles.indexOf(role)
      const borderId = borderResult.startIndex
      const numFmtId = formatResult.ids.get(numberFormat ?? 'General') ?? 0
      const applyNumberFormat = numberFormat && numberFormat !== 'General' ? ' applyNumberFormat="1"' : ''
      styleChildren.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="${borderId}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"${applyNumberFormat}><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`)
      styleIds.set(key, nextStyleId++)
    }
  }
  if (!cellXfs)
    throw new Error('XLSX styles.xml 缺少 cellXfs')
  const sectionRegex = /<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/
  const match = sectionRegex.exec(xml)
  if (!match)
    throw new Error('XLSX styles.xml 缺少 cellXfs')
  const replacement = match[0]
    .replace(/count="\d+"/, `count="${existingXfCount + styleChildren.length}"`)
    .replace('</cellXfs>', `${styleChildren.join('')}</cellXfs>`)
  xml = xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length)
  return { xml, context: { styleIds, config } }
}

function setCellStyleId(xml: string, roleMap: InvoiceStylePlan['roles'], context: InvoiceStylePatchContext): string {
  return xml.replace(/<c([^>]*r="([A-Z]+\d+)"[^>]*)>/g, (tag, attributes: string, address: string) => {
    const planned = roleMap.get(address)
    if (!planned)
      return tag
    const id = context.styleIds.get(styleKey(planned.role, planned.numberFormat))
    if (id == null)
      return tag
    const nextAttributes = attributes.replace(/\s+s="\d+"/, '')
    return `<c${nextAttributes} s="${id}">`
  })
}

function freezeSheetXml(xml: string, freezeRows: number): string {
  if (freezeRows <= 0)
    return xml
  const topLeftCell = XLSX.utils.encode_cell({ r: freezeRows, c: 0 })
  const sheetViews = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="${topLeftCell}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeftCell}" sqref="${topLeftCell}"/></sheetView></sheetViews>`
  return /<sheetViews\b[\s\S]*?<\/sheetViews>/.test(xml)
    ? xml.replace(/<sheetViews\b[\s\S]*?<\/sheetViews>/, sheetViews)
    : xml.replace('</dimension>', `</dimension>${sheetViews}`)
}

function patchInvoiceXlsxPackage(
  value: ArrayBuffer,
  workbook: XLSX.WorkBook,
  config: InvoiceResolvedStyleConfig,
): ArrayBuffer {
  const bytes = bufferBytes(value)
  const end = findEndOfCentralDirectory(bytes)
  if (end < 0)
    throw new Error('导出 XLSX 不是可修改的 ZIP 包')
  const count = readUInt16(bytes, end + 10)
  const centralOffset = readUInt32(bytes, end + 16)
  const entries: InvoiceZipEntry[] = []
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (readUInt32(bytes, offset) !== 0x02014B50)
      throw new Error('导出 XLSX 中央目录损坏')
    const method = readUInt16(bytes, offset + 10)
    if (method !== 0)
      throw new Error('导出 XLSX 需要使用未压缩 ZIP 以写入样式')
    const compressedSize = readUInt32(bytes, offset + 20)
    const nameLength = readUInt16(bytes, offset + 28)
    const extraLength = readUInt16(bytes, offset + 30)
    const commentLength = readUInt16(bytes, offset + 32)
    const localOffset = readUInt32(bytes, offset + 42)
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const localNameLength = readUInt16(bytes, localOffset + 26)
    const localExtraLength = readUInt16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    entries.push({ name, data: new Uint8Array(bytes.subarray(dataStart, dataStart + compressedSize)) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  const plans = workbook.SheetNames.map(sheetName => INVOICE_STYLE_PLANS.get(workbook.Sheets[sheetName]!) ?? createStylePlan(0))
  const stylesEntry = entries.find(entry => entry.name === 'xl/styles.xml')
  const styleResult = stylesEntry ? patchStylesXml(new TextDecoder().decode(stylesEntry.data), config, plans) : null
  if (!styleResult)
    throw new Error('导出 XLSX 缺少 styles.xml')
  stylesEntry!.data = new TextEncoder().encode(styleResult.xml)
  workbook.SheetNames.forEach((sheetName, index) => {
    const entry = entries.find(item => item.name === `xl/worksheets/sheet${index + 1}.xml`)
    if (!entry)
      return
    const plan = plans[index]!
    entry.data = new TextEncoder().encode(freezeSheetXml(
      setCellStyleId(new TextDecoder().decode(entry.data), plan.roles, styleResult.context),
      plan.freezeRows,
    ))
  })
  return writeStoredXlsxZip(entries)
}

function decodeXmlAttribute(value: string | undefined): string | undefined {
  return value?.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}

function parseStyleDefinitions(stylesXml: string): InvoiceCellStyleSnapshot[] {
  const fontXml = xmlTagList(xmlSection(stylesXml, 'fonts'), 'font')
  const borderXml = xmlTagList(xmlSection(stylesXml, 'borders'), 'border')
  const formats = numberFormatIdMap(stylesXml)
  const formatById = new Map<number, string>([...formats.entries()].map(([format, id]) => [id, format]))
  const cellXfs = xmlTagList(xmlSection(stylesXml, 'cellXfs'), 'xf')
  return cellXfs.map((xfXml) => {
    const fontId = xmlNumberAttribute(xfXml, 'fontId') ?? 0
    const borderId = xmlNumberAttribute(xfXml, 'borderId') ?? 0
    const numFmtId = xmlNumberAttribute(xfXml, 'numFmtId') ?? 0
    return {
      styleId: null,
      font: styleFontFromXml(fontXml[fontId] ?? ''),
      border: styleBorderFromXml(borderXml[borderId] ?? ''),
      alignment: styleAlignmentFromXml(xfXml),
      numberFormat: formatById.get(numFmtId) ?? 'General',
    }
  })
}

function parseWorksheetStyle(
  sheetName: string,
  sheetXml: string,
  styleDefinitions: readonly InvoiceCellStyleSnapshot[],
): InvoiceWorksheetStyleSnapshot {
  const pane = /<pane[^>]*state="frozen"[^>]*>(?:<\/pane>)?/.exec(sheetXml)?.[0]
  const freezeRows = pane ? xmlNumberAttribute(pane, 'ySplit') ?? 0 : 0
  const columns = xmlTagList(xmlSection(sheetXml, 'cols'), 'col').map((column) => {
    const width = xmlNumberAttribute(column, 'width') ?? 0
    return {
      min: xmlNumberAttribute(column, 'min') ?? 1,
      max: xmlNumberAttribute(column, 'max') ?? 1,
      width,
      wch: Math.max(0, Math.round(width - 0.83203125)),
    }
  })
  const rows = xmlTagList(xmlSection(sheetXml, 'sheetData'), 'row').flatMap((rowXml) => {
    const hpt = xmlNumberAttribute(rowXml, 'ht')
    const row = xmlNumberAttribute(rowXml, 'r')
    return hpt != null && row != null ? [{ row, hpt }] : []
  })
  const cells: Record<string, InvoiceCellStyleSnapshot> = {}
  for (const cellXml of sheetXml.match(/<c[^>]*r="[A-Z]+\d+"[^>]*>(?:[\s\S]*?<\/c>|\s*\/\s*>)/g) ?? []) {
    const address = xmlAttribute(cellXml, 'r')
    if (!address)
      continue
    const styleId = xmlNumberAttribute(cellXml, 's')
    if (styleId == null)
      continue
    const style = styleDefinitions[styleId]
    if (!style)
      continue
    cells[address] = { ...style, styleId }
  }
  const mergedCells = [...sheetXml.matchAll(/<mergeCell[^>]*ref="([^"]+)"[^>]*>(?:<\/mergeCell>)?/g)].map(match => decodeXmlAttribute(match[1]) ?? '')
  return { sheetName, freezeRows, columns, rows, cells, mergedCells }
}

/**
 * 读取导出后的 XLSX 原始包，验证实际工作簿中的样式 XML，而不是只验证网页预览或 SheetJS 的二维值。
 */
export async function readInvoiceWorkbookStyleReadback(
  file: ArrayBuffer | Uint8Array,
): Promise<InvoiceWorkbookStyleReadback> {
  try {
    const entries = await readXlsxZipEntries(file)
    const entryMap = new Map(entries.map(entry => [entry.name, entry.data]))
    const stylesXml = entryMap.get('xl/styles.xml')
    if (!stylesXml)
      throw new Error('缺少 xl/styles.xml')
    const definitions = parseStyleDefinitions(new TextDecoder().decode(stylesXml))
    const sheets: InvoiceWorksheetStyleSnapshot[] = []
    const issues: InvoiceWorkbookFormatIssue[] = []
    for (let index = 0; ; index++) {
      const sheetXml = entryMap.get(`xl/worksheets/sheet${index + 1}.xml`)
      if (!sheetXml)
        break
      const sheetName = `sheet${index + 1}`
      sheets.push(parseWorksheetStyle(sheetName, new TextDecoder().decode(sheetXml), definitions))
    }
    if (!sheets.length)
      issues.push({ sheetName: '*', sourceRow: null, address: null, reason: '未找到任何工作表样式 XML' })
    return { sheets, issues }
  }
  catch (error) {
    return {
      sheets: [],
      issues: [{
        sheetName: '*',
        sourceRow: null,
        address: null,
        reason: `格式读取失败：${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
}

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
): InvoiceSourceRowKind {
  if (isBlankRow(values))
    return 'blank'
  if (sheetKind === 'summary')
    return 'summary'
  if (hasTotalMarker(values))
    return 'total'
  return 'data'
}

function normalizedInvoiceKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLocaleUpperCase('zh-CN')
}

function readInvoiceSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  sourceFileName: string,
  style: InvoiceWorksheetStyleSnapshot | null,
  styleIssues: readonly InvoiceWorkbookFormatIssue[],
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
      const cellStyle = style?.cells[address] ?? null
      return {
        address,
        columnIndex: column.index,
        columnName: column.name,
        rawValue: cell?.v,
        displayValue,
        formula: cell?.f ?? null,
        cachedValue: cell?.f ? cell.v : undefined,
        formulaStatus: formulaStatus(cell, displayValue),
        styleId: cellStyle?.styleId ?? null,
        style: cellStyle,
      } satisfies InvoiceSourceCell
    })
    const displayValues = Object.fromEntries(columns.map(column => [column.name, rowValues[column.index] ?? '']))
    const rawValues = Object.fromEntries(cells.map(cell => [cell.columnName, cell.rawValue]))
    const formulaCells = cells.filter(cell => cell.formula)
    const formulaIssues = formulaCells
      .filter(cell => cell.formulaStatus === 'missing-cache' || cell.formulaStatus === 'invalid')
      .map(cell => `${cell.columnName}（${cell.address}）：${cell.formulaStatus === 'missing-cache' ? '缺少缓存值' : '缓存值异常'}`)
    const rowNumber = absoluteRow + 1
    const rowStyleIssues = styleIssues
      .filter(issue => issue.sourceRow == null || issue.sourceRow === rowNumber || (issue.address != null && cells.some(cell => cell.address === issue.address)))
      .map(issue => issue.reason)
    const rowKind = sourceRowKind(rowValues, sheetKind)
    const sourceRow: InvoiceSourceRow = {
      sheetName,
      sourceRow: rowNumber,
      rowKind,
      cells,
      rawValues,
      displayValues,
      mergeRanges,
      formulaIssues,
      styleIssues: rowStyleIssues,
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
        ...rowStyleIssues,
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
    style,
    styleIssues,
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
  const buffer = await invoiceArrayBuffer(file)
  const workbook = XLSX.read(buffer, {
    type: 'array',
    codepage: 65001,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
  })
  const styleReadback = await readInvoiceWorkbookStyleReadback(buffer)
  return {
    sheets: workbook.SheetNames.map((sheetName, index) => {
      const style = styleReadback.sheets[index]
      const sheetIssues = styleReadback.issues
        .filter(issue => issue.sheetName === '*' || issue.sheetName === `sheet${index + 1}`)
        .map(issue => issue.sheetName === '*' ? { ...issue, sheetName } : issue)
      if (style)
        style.sheetName = sheetName
      return readInvoiceSheet(workbook, sheetName, sourceFileName, style ?? null, sheetIssues)
    }),
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

function writeWorkbook(workbook: XLSX.WorkBook, config: InvoiceResolvedStyleConfig): ExportData {
  const bytes = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    cellDates: true,
    cellStyles: true,
    compression: false,
  }) as ArrayBuffer
  return patchInvoiceXlsxPackage(bytes, workbook, config)
}

/** 下载给历史台账录入的标准模板；标题和说明独立放置，避免把示例数据误导入业务库。 */
export function createInvoiceImportTemplateXlsx(styleConfig: InvoiceXlsxStyleConfig = {}): ExportData {
  const config = resolveInvoiceStyleConfig(styleConfig)
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
  newInvoiceStylePlan(worksheet, config.freezeRows)
  cellStyleAddresses(worksheet, 0, 0, 0, INVOICE_IMPORT_COLUMNS.length - 1, 'title')
  cellStyleAddresses(worksheet, 1, 1, 0, INVOICE_IMPORT_COLUMNS.length - 1, 'header')
  setRowHeights(worksheet, [config.titleRowHeight, config.headerRowHeight])
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
  newInvoiceStylePlan(instructions, config.freezeRows)
  cellStyleAddresses(instructions, 0, 0, 0, 2, 'title')
  cellStyleAddresses(instructions, 1, 1, 0, 2, 'header')
  cellStyleAddresses(instructions, 2, 8, 0, 2, 'data')
  setRowHeights(instructions, [config.titleRowHeight, config.headerRowHeight, ...(Array.from({ length: 7 }).fill(config.dataRowHeight) as number[])])
  XLSX.utils.book_append_sheet(workbook, instructions, '填写说明')
  return writeWorkbook(workbook, config)
}

/**
 * 生成发票台账 Excel：标题带、列宽、金额/日期格式和连续重复值合并均写入 XLSX。
 * 合并只作用于连续且非空的供应商/归属项目单元格，避免把不同业务分组误合并。
 */
export function createInvoiceLedgerXlsxFromRows(
  rows: readonly InvoiceLedgerExportRow[],
  styleConfig: InvoiceXlsxStyleConfig = {},
): ExportData {
  const config = resolveInvoiceStyleConfig(styleConfig)
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

  newInvoiceStylePlan(worksheet, config.freezeRows)
  cellStyleAddresses(worksheet, 0, 0, 0, EXPORT_COLUMNS.length - 1, 'title')
  cellStyleAddresses(worksheet, 1, 1, 0, EXPORT_COLUMNS.length - 1, 'header')
  cellStyleAddresses(worksheet, dataStartRow, totalRow - 1, 0, EXPORT_COLUMNS.length - 1, 'data', {
    0: DATE_FORMAT,
    1: TEXT_FORMAT,
    4: MONEY_FORMAT,
  })
  cellStyleAddresses(worksheet, totalRow, totalRow, 0, EXPORT_COLUMNS.length - 1, 'total', { 4: MONEY_FORMAT })
  setRowHeights(worksheet, [
    config.titleRowHeight,
    config.headerRowHeight,
    ...(Array.from({ length: rows.length }).fill(config.dataRowHeight) as number[]),
    config.totalRowHeight,
  ])

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
  return writeWorkbook(workbook, config)
}

export function createInvoiceLedgerXlsx(
  invoices: readonly Invoice[],
  styleConfig: InvoiceXlsxStyleConfig = {},
): ExportData {
  return createInvoiceLedgerXlsxFromRows(invoiceLedgerRows(invoices), styleConfig)
}
