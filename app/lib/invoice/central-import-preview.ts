import type { ImportMapping } from '../kit/import-mapping'
import type { CentralInvoiceFields, CentralInvoiceImportSource } from './central-contract'
import type { InvoiceImportPreview } from './central-http'
import type { InvoiceMigrationCatalog } from './central-migration-catalog'
import { isISODateDTO } from '../../types/read-model'
import { buildImportRows, IMPORT_SOURCE_META_KEY } from '../kit/import-mapping'
import { createInvoiceWorkspaceCatalogClient } from './central-migration-catalog'
import { centralInvoiceHeaderStatus } from './central-workbook-headers'
import { openVerifiedCentralInvoiceWorkbook } from './central-workbook-security'
import { getInvoiceImportSourceMeta } from './excel'

type InvoiceField = keyof CentralInvoiceFields
const textFields = ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'] as const
const moneyFields = ['amount', 'taxAmount', 'totalAmount'] as const
const keys: readonly InvoiceField[] = [...textFields, ...moneyFields]

export interface InvoiceImportPreviewRow {
  source: CentralInvoiceImportSource
  fields: CentralInvoiceFields
  mappedFields: InvoiceField[]
  reviewReasons: string[]
  /** null 表示本行未查询，不得解释为没有重复。 */
  duplicatePreview: InvoiceImportPreview | null
}

export interface InvoiceImportCatalogSnapshot {
  catalog: InvoiceMigrationCatalog
  sourceVersions: { projects: string, suppliers: string }
}

/** 同名显示键会覆盖来源列，不能作为可核对的工作表。 */
export function hasAmbiguousInvoiceColumns(columns: readonly string[]) {
  return new Set(columns).size !== columns.length
}

/** 在既有目录客户端完成身份、权限、分页和响应校验后保留空目录的来源版本。 */
export function createInvoiceImportCatalogReader(options: Parameters<typeof createInvoiceWorkspaceCatalogClient>[0]) {
  return async (): Promise<InvoiceImportCatalogSnapshot> => {
    let response: unknown
    const client = createInvoiceWorkspaceCatalogClient({
      ...options,
      fetcher: async (url, request) => {
        response = await options.fetcher(url, request)
        return response
      },
    })
    const catalog = await client.load(['projects', 'suppliers'])
    if (!response || typeof response !== 'object' || !('sources' in response) || !Array.isArray(response.sources))
      throw new Error('目录来源版本不可核验。')
    const sources = response.sources
    const sourceVersion = (key: 'projects' | 'suppliers') => {
      const source = sources.find((item: { key?: unknown }) => item?.key === key)
      if (!source || source.state !== 'readable' || typeof source.sourceVersion !== 'string' || !source.sourceVersion)
        throw new Error('目录来源版本不可核验。')
      return source.sourceVersion
    }
    return { catalog, sourceVersions: { projects: sourceVersion('projects'), suppliers: sourceVersion('suppliers') } }
  }
}

/** 只提供读取能力，无法由此接口提交导入。 */
export async function previewCentralInvoiceWorkbook(options: {
  file: File
  sheetName: string
  mapping: ImportMapping
  loadCatalog: () => Promise<InvoiceImportCatalogSnapshot>
  preview: (input: { fields: CentralInvoiceFields, items: [], source: CentralInvoiceImportSource }) => Promise<InvoiceImportPreview>
  signal?: AbortSignal
}): Promise<{ rows: InvoiceImportPreviewRow[], catalog: InvoiceMigrationCatalog }> {
  const ensureActive = () => {
    if (options.signal?.aborted)
      throw new DOMException('读取已取消。', 'AbortError')
  }
  ensureActive()
  const verified = await openVerifiedCentralInvoiceWorkbook(options.file, options.signal)
  ensureActive()
  if (verified.file !== options.file)
    throw new Error('所选文件身份无法核验，请重新选择。')
  const fileDigest = verified.sha256
  const workbook = verified.workbook
  const sheet = workbook.sheets.find(item => item.name === options.sheetName)
  if (!sheet || sheet.sheetKind !== 'data' || !sheet.rows.length)
    throw new Error('请选择含发票数据的工作表。')
  if (hasAmbiguousInvoiceColumns(sheet.columns))
    throw new Error('工作表存在无法区分的列名，请调整表头后重新选择文件，或选择其他工作表。')
  const headerStatus = centralInvoiceHeaderStatus(verified.headers, sheet)
  if (headerStatus === 'missing')
    throw new Error('工作表原始表头证据不可核验，请重新选择文件。')
  if (headerStatus === 'collision')
    throw new Error('工作表存在无法区分的列名，请调整表头后重新选择文件，或选择其他工作表。')
  for (const [key, match] of Object.entries(options.mapping)) {
    if (!keys.includes(key as InvoiceField) || match.confidence !== 'confirmed' || match.column === IMPORT_SOURCE_META_KEY || !sheet.columns.includes(match.column))
      throw new Error('字段映射尚未确认或源列不存在。')
  }
  const snapshot = await options.loadCatalog()
  ensureActive()
  if (!snapshot.sourceVersions.projects || !snapshot.sourceVersions.suppliers)
    throw new Error('目录来源版本不可核验。')
  const projected = buildImportRows(options.mapping, sheet.rows)
  const rows: InvoiceImportPreviewRow[] = []
  const numbers = new Map<string, number[]>()
  for (const row of projected) {
    const meta = getInvoiceImportSourceMeta(row)
    if (!meta || meta.sourceSheet !== sheet.name || meta.sourceFileName !== options.file.name || !Number.isSafeInteger(meta.sourceRow) || meta.sourceRow < 1)
      throw new Error('发票来源工作表或原始行号不可核验。')
    const rawEntries: Array<[string, string | number | boolean | null]> = []
    for (const [key, value] of Object.entries(meta.rawValues)) {
      if (value === undefined || value === null)
        rawEntries.push([key, null])
      else if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))))
        rawEntries.push([key, value])
      else
        throw new Error(`第 ${meta.sourceRow} 行的原始值无法可靠保存。`)
    }
    const rawSnapshot: CentralInvoiceImportSource['rawSnapshot'] = Object.fromEntries(rawEntries)
    const source = { fileName: options.file.name, fileDigest, sheetName: meta.sourceSheet, rowNumber: meta.sourceRow, rawSnapshot }
    const fields: CentralInvoiceFields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
    const reviewReasons = [...meta.reviewReasons]
    for (const key of textFields)
      fields[key] = String(row[key] ?? '').trim()
    for (const key of moneyFields) {
      const value = String(row[key] ?? '').trim()
      if (!value)
        continue
      if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1_000_000_000_000) {
        reviewReasons.push(`${key} 金额无法可靠解析`)
        continue
      }
      fields[key] = Number(value)
    }
    if (fields.invoiceDate && !isISODateDTO(fields.invoiceDate))
      reviewReasons.push('日期须核对为有效的 YYYY-MM-DD 格式')
    if (!fields.invoiceNumber)
      reviewReasons.push('缺少发票号码')
    if (!fields.invoiceDate)
      reviewReasons.push('缺少发票日期')
    if (!fields.seller)
      reviewReasons.push('缺少销售方')
    if (fields.totalAmount === null || fields.totalAmount <= 0)
      reviewReasons.push('缺少有效价税合计')
    const indexes = numbers.get(fields.invoiceNumber) ?? []
    if (fields.invoiceNumber)
      numbers.set(fields.invoiceNumber, [...indexes, rows.length])
    rows.push({ source, fields, mappedFields: Object.keys(options.mapping) as InvoiceField[], reviewReasons, duplicatePreview: null })
  }
  for (const indexes of numbers.values()) {
    if (indexes.length > 1)
      indexes.forEach(index => rows[index]!.reviewReasons.push('本文件中发票号码重复，需逐行核对'))
  }
  let version: string | null = null
  for (const row of rows) {
    ensureActive()
    // 不以空票号或无法解析的票面值代替原值请求中央查重。
    if (!row.fields.invoiceNumber || (row.fields.invoiceDate && !isISODateDTO(row.fields.invoiceDate)) || row.reviewReasons.some(reason => reason.endsWith('金额无法可靠解析')))
      continue
    const result = await options.preview({ fields: row.fields, items: [], source: row.source })
    ensureActive()
    if (version !== null && result.sourceVersion !== version)
      throw new Error('发票来源在预览期间变化，请重新预览。')
    version = result.sourceVersion
    row.duplicatePreview = result
  }
  const latestCatalog = await options.loadCatalog()
  ensureActive()
  if (JSON.stringify(snapshot) !== JSON.stringify(latestCatalog))
    throw new Error('项目或分供方目录在预览期间变化，请重新预览。')
  // 使用同一条只读查重再次核对发票来源，避免最后一条之后的变化被当作同一快照。
  const lastChecked = [...rows].reverse().find(row => row.duplicatePreview !== null)
  if (lastChecked) {
    const latest = await options.preview({ fields: lastChecked.fields, items: [], source: lastChecked.source })
    ensureActive()
    if (latest.sourceVersion !== version)
      throw new Error('发票来源在预览期间变化，请重新预览。')
  }
  return { rows, catalog: snapshot.catalog }
}
