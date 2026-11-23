import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceFields, CentralInvoiceImportSource, CentralInvoiceItem } from '../../app/lib/invoice/central-contract'
import type { InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import type { InvoiceImportWorkbook, InvoiceSourceCell } from '../../app/lib/invoice/excel'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import * as XLSX from 'xlsx'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { invoiceCorrectionChanges } from '../../app/lib/invoice/correction-contract'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'
import { assertInvoiceWorkbookRanges, INVOICE_WORKBOOK_MAX_BYTES, InvoiceWorkbookLimitError } from '../../app/lib/invoice/workbook-limits'
import { IMPORT_SOURCE_META_KEY } from '../../app/lib/kit/import-mapping'
import { boundedInvoiceXlsx } from './production-invoice-workbook-limits'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function fail(code: 'validation-failed' | 'conflict' | 'unavailable', message: string): never {
  throw new CentralInvoiceProblem(code, message)
}

export interface PreparedInvoiceWorkbook {
  fileName: string
  bytes: Uint8Array
  sha256: string
  row: Record<string, unknown>
  columns: readonly string[]
  unsafeFormulaColumns: readonly string[]
}
interface ParsedWorkbook { parsed: Awaited<ReturnType<typeof parseInvoiceWorkbookForMapping>> }
export type InvoiceWorkbookMapping = Partial<Record<keyof CentralInvoiceFields, { column: string, confidence: 'confirmed' }>>

/** 严格 XML 预检尚未实现，不得将工作簿正文交给 SheetJS。 */
async function requireVerifiedWorkbookXml(): Promise<void> {
  throw new CentralInvoiceProblem('unavailable', '工作簿安全核验暂不可用，请保留原文件并稍后重试。')
}

async function parseWorkbook(bytes: Uint8Array, fileName: string, sheetName: string): Promise<ParsedWorkbook> {
  if (/\.xls$/i.test(fileName))
    throw new CentralInvoiceProblem('unavailable', '旧版 XLS 暂无法安全校验，请保留原件并稍后处理。')
  await requireVerifiedWorkbookXml()
  const safe = await boundedInvoiceXlsx(bytes)
  const array = safe.buffer.slice(safe.byteOffset, safe.byteOffset + safe.byteLength) as ArrayBuffer
  const metadata = XLSX.read(array, { type: 'array', bookSheets: true, WTF: true })
  if (metadata.SheetNames.length > 20)
    return fail('validation-failed', '工作簿最多支持 20 个工作表，请拆分后重试。')
  if (!metadata.SheetNames.includes(sheetName))
    return fail('validation-failed', '工作簿中不存在此工作表。')
  if (new Set(metadata.SheetNames.map(name => name.toLowerCase())).size !== metadata.SheetNames.length)
    return fail('validation-failed', '工作簿含重名工作表，无法可靠核验。')
  for (const current of metadata.SheetNames) {
    if (current === sheetName)
      continue
    const workbook = XLSX.read(array, { type: 'array', codepage: 65001, cellFormula: true, cellNF: true, cellStyles: true, sheetStubs: true, sheets: current, WTF: true })
    assertInvoiceWorkbookRanges(workbook, current)
  }
  const selected = XLSX.read(array, { type: 'array', codepage: 65001, cellFormula: true, cellNF: true, cellStyles: true, sheetStubs: true, sheets: sheetName, WTF: true })
  assertInvoiceWorkbookRanges(selected, sheetName)
  const parsed = await parseInvoiceWorkbookForMapping(array, fileName, { workbook: selected, selectedSheet: sheetName })
  return { parsed }
}

export function unsafeInvoiceFormulaColumns(cells: readonly (Pick<InvoiceSourceCell, 'columnName' | 'formulaStatus'> & Partial<Pick<InvoiceSourceCell, 'inheritedFormulaIssue'>>)[]): string[] {
  return [...new Set(cells.filter(cell => cell.formulaStatus === 'invalid' || cell.formulaStatus === 'missing-cache' || cell.inheritedFormulaIssue != null).map(cell => cell.columnName))]
}

/** 按预览使用的列和值投影规则重建票面；未映射字段保留空值。 */
export function assertInvoiceWorkbookImport(fields: CentralInvoiceFields, items: CentralInvoiceItem[], mapping: unknown, row: Record<string, unknown>, columns: readonly string[], unsafeFormulaColumns: readonly string[]): asserts mapping is InvoiceWorkbookMapping {
  if (unsafeFormulaColumns.length)
    return fail('validation-failed', '来源行存在无法核验的公式缓存，请人工复核。')
  const text = ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'] as const
  const money = ['amount', 'taxAmount', 'totalAmount'] as const
  const keys: readonly string[] = [...text, ...money]
  if (!object(mapping) || !Object.keys(mapping).length || items.length || Object.entries(mapping).some(([key, match]) => !keys.includes(key) || !object(match)
    || Object.keys(match).sort().join(',') !== 'column,confidence' || match.confidence !== 'confirmed' || typeof match.column !== 'string'
    || match.column === IMPORT_SOURCE_META_KEY || !columns.includes(match.column) || unsafeFormulaColumns.includes(match.column) || !Object.hasOwn(row, match.column))) {
    return fail('validation-failed', '请选择原工作簿中的明确字段映射；此导入不包含货物明细。')
  }
  const expected: CentralInvoiceFields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
  for (const key of text) {
    const match = mapping[key]
    if (object(match) && typeof match.column === 'string')
      expected[key] = String(row[match.column] ?? '').trim()
  }
  for (const key of money) {
    const match = mapping[key]
    if (!object(match) || typeof match.column !== 'string')
      continue
    const value = String(row[match.column] ?? '').trim()
    if (!value)
      continue
    if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1_000_000_000_000)
      return fail('validation-failed', '工作簿金额无法可靠解析。')
    const number = Number(value)
    expected[key] = number === 0 ? 0 : number
  }
  const normalized = { ...fields, amount: fields.amount === 0 ? 0 : fields.amount, taxAmount: fields.taxAmount === 0 ? 0 : fields.taxAmount, totalAmount: fields.totalAmount === 0 ? 0 : fields.totalAmount }
  if (!isDeepStrictEqual(normalized, expected))
    return fail('conflict', '提交票面与原工作簿映射结果不一致，请重新核对。')
}

export function verifiedInvoiceSourceRow(parsed: InvoiceImportWorkbook, source: CentralInvoiceImportSource): { row: Record<string, unknown>, columns: readonly string[], unsafeFormulaColumns: readonly string[] } {
  const sheet = parsed.sheets.find(item => item.name === source.sheetName && item.sheetKind === 'data')
  if (sheet && new Set(sheet.columns).size !== sheet.columns.length)
    return fail('validation-failed', '工作表存在重名歧义列，无法可靠映射。')
  const row = sheet?.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === source.rowNumber)
  const meta = row && getInvoiceImportSourceMeta(row)
  const raw: Row = Object.create(null)
  if (!meta || meta.sourceSheet !== source.sheetName)
    return fail('validation-failed', '工作簿中不存在此数据来源行。')
  for (const [key, entry] of Object.entries(meta.rawValues)) {
    if (entry == null)
      raw[key] = null
    else if (typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry) && (!Number.isInteger(entry) || Number.isSafeInteger(entry))))
      raw[key] = typeof entry === 'number' && entry === 0 ? 0 : entry
    else return fail('validation-failed', '来源行含无法可靠保存的值。')
  }
  const byColumn = ([left]: [string, unknown], [right]: [string, unknown]) => left < right ? -1 : left > right ? 1 : 0
  const snapshot = Object.entries(source.rawSnapshot).map(([key, value]): [string, unknown] => [key, typeof value === 'number' && value === 0 ? 0 : value]).sort(byColumn)
  if (!isDeepStrictEqual(Object.entries(raw).sort(byColumn), snapshot))
    return fail('validation-failed', '来源行快照与工作簿正文不一致。')
  const sourceRow = sheet!.sourceRows.find(item => item.sourceRow === source.rowNumber)
  if (!sourceRow)
    return fail('validation-failed', '工作簿中不存在此数据来源行。')
  return { row: row!, columns: sheet!.columns, unsafeFormulaColumns: unsafeInvoiceFormulaColumns(sourceRow.cells) }
}

export function assertInvoiceWorkbookFill(before: InvoiceCorrectionContent, after: InvoiceCorrectionContent, mapping: Partial<Record<keyof InvoiceCorrectionContent['fields'], string>>, row: Record<string, unknown>, columns: readonly string[], unsafeFormulaColumns: readonly string[]) {
  if (unsafeFormulaColumns.length)
    return fail('validation-failed', '来源行存在无法核验的公式缓存，请人工复核。')
  const changes = invoiceCorrectionChanges(before, after)
  const numeric = ['amount', 'taxAmount', 'totalAmount']
  const fields = ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'amount', 'taxAmount', 'totalAmount', 'taxRate', 'remark']
  if (!changes.length || !isDeepStrictEqual({ ...before, fields: after.fields }, after)
    || !Object.keys(mapping).length || Object.entries(mapping).some(([key, column]) => !fields.includes(key) || typeof column !== 'string' || !column)) {
    return fail('conflict', '工作簿只能补充原本为空的票面字段。')
  }
  const invoiceColumn = Object.hasOwn(mapping, 'invoiceNumber') ? mapping.invoiceNumber : undefined
  if (!invoiceColumn || invoiceColumn === IMPORT_SOURCE_META_KEY || !columns.includes(invoiceColumn) || !Object.hasOwn(row, invoiceColumn))
    return fail('validation-failed', '补空必须明确映射工作簿中的发票号码。')
  // 中央预览以来源值的 JS trim 对比数据库票号的 SQLite trim（默认仅 ASCII 空格）。
  const sourceNumber = String(row[invoiceColumn] ?? '').trim()
  const targetNumber = before.fields.invoiceNumber.replace(/^ +| +$/g, '')
  if (!before.fields.invoiceNumber.trim() || !sourceNumber || sourceNumber !== targetNumber)
    return fail('conflict', '工作簿票号与已有发票不一致，不能补空。')
  for (const [key, column] of Object.entries(mapping)) {
    if (!column || column === IMPORT_SOURCE_META_KEY || !columns.includes(column) || unsafeFormulaColumns.includes(column) || !Object.hasOwn(row, column))
      return fail('validation-failed', '补空映射的源列不存在。')
    const raw = String(row[column] ?? '').trim()
    if (numeric.includes(key) && raw && (!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Math.abs(Number(raw)) > 1_000_000_000_000))
      return fail('validation-failed', '工作簿金额无法可靠解析。')
    const mapped = numeric.includes(key) ? (raw ? Number(raw) : null) : raw
    const existing = before.fields[key as keyof typeof before.fields]
    if (key !== 'invoiceNumber' && existing !== '' && existing !== null && mapped !== '' && mapped !== null && existing !== mapped)
      return fail('conflict', '工作簿与已有字段冲突，请人工处理。')
  }
  for (const change of changes) {
    const key = change.path.startsWith('fields.') ? change.path.slice(7) : ''
    const column = mapping[key as keyof typeof mapping]
    if (!column || (change.before !== '' && change.before !== null))
      return fail('conflict', '工作簿只能补充原本为空的票面字段。')
    const raw = String(row[column] ?? '').trim()
    const mapped = numeric.includes(key) ? (raw ? Number(raw) : null) : raw
    if (mapped === '' || mapped === null || change.after !== mapped)
      return fail('conflict', '补充字段与工作簿来源不一致。')
  }
}

/** 只处理请求内原字节，不创建数据库记录；失败的整批不会留下工作簿。 */
export async function prepareInvoiceWorkbook(value: unknown, source: CentralInvoiceImportSource): Promise<PreparedInvoiceWorkbook> {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'fileName,fileSize,payloadBase64'
    || typeof value.fileName !== 'string' || value.fileName !== source.fileName || !/\.(?:xlsx|xls)$/i.test(value.fileName)
    || !Number.isSafeInteger(value.fileSize) || Number(value.fileSize) < 1 || Number(value.fileSize) > INVOICE_WORKBOOK_MAX_BYTES
    || typeof value.payloadBase64 !== 'string' || value.payloadBase64.length !== Math.ceil(Number(value.fileSize) / 3) * 4) {
    return fail('validation-failed', '请提供与来源一致且不超过 10 MiB 的 Excel 原工作簿，超限请拆分。')
  }
  if (!source.fileName.isWellFormed() || typeof source.sheetName !== 'string' || !source.sheetName.isWellFormed())
    return fail('validation-failed', '工作簿文件名或工作表名称含无法可靠保存的字符，请核对原文件。')
  const bytes = Buffer.from(value.payloadBase64, 'base64')
  if (bytes.length !== value.fileSize || bytes.toString('base64') !== value.payloadBase64 || hash(bytes) !== source.fileDigest)
    return fail('validation-failed', '工作簿正文、大小或来源摘要不一致。')
  let workbook: ParsedWorkbook
  try {
    workbook = await parseWorkbook(bytes, value.fileName, source.sheetName)
  }
  catch (cause) {
    if (cause instanceof CentralInvoiceProblem)
      throw cause
    if (cause instanceof InvoiceWorkbookLimitError)
      return fail('validation-failed', cause.message)
    return fail('validation-failed', '无法读取原工作簿。')
  }
  return { fileName: value.fileName, bytes, sha256: source.fileDigest, ...verifiedInvoiceSourceRow(workbook.parsed, source) }
}

/** 仅由成功导入或成功更正的外层事务调用。 */
export async function bindInvoiceWorkbook(tx: TransactionDb, input: { workbook: PreparedInvoiceWorkbook, source: CentralInvoiceImportSource, mapping: unknown, commandId: string, invoiceId: string, kind: 'import' | 'correction', actorId: string, now: string }) {
  const { workbook, source } = input
  const [old] = await tx.select<Row>('SELECT w.id,w.file_ref_id,f.owner_type,f.owner_id,f.category,f.deleted_at,f.file_name,f.file_size,p.content,p.sha256 FROM invoice_import_workbooks w LEFT JOIN file_refs f ON f.id=w.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE w.sha256=?', [workbook.sha256])
  let workbookId: string
  if (old) {
    if (typeof old.id !== 'string' || !old.id || typeof old.file_ref_id !== 'string' || !old.file_ref_id
      || old.owner_type !== 'invoice_workbook' || old.owner_id !== old.id || old.category !== 'invoice-import-workbook' || old.deleted_at !== null
      || typeof old.file_name !== 'string' || !old.file_name || !(old.content instanceof Uint8Array)
      || old.file_size !== workbook.bytes.length || old.sha256 !== workbook.sha256 || !Buffer.from(old.content).equals(Buffer.from(workbook.bytes))) {
      return fail('unavailable', '已有工作簿正文、摘要或归属不一致，不能复用。')
    }
    workbookId = old.id
  }
  else {
    workbookId = randomUUID()
    const fileId = randomUUID()
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'invoice_workbook\',?,?,?,?,\'invoice-import-workbook\',?,?)', [fileId, workbookId, workbook.fileName, workbook.bytes.length, 'application/octet-stream', input.actorId, input.now])
    await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [fileId, workbook.bytes, workbook.sha256])
    await tx.execute('INSERT INTO invoice_import_workbooks VALUES(?,?,?,?)', [workbookId, fileId, workbook.sha256, input.now])
  }
  const prior = await tx.select<Row>('SELECT command_id,invoice_id FROM invoice_import_workbook_rows WHERE workbook_id=? AND sheet_name=? AND row_number=?', [workbookId, source.sheetName, source.rowNumber])
  const oldRows = await tx.select<Row>('SELECT command_id,invoice_id FROM invoice_import_sources WHERE file_digest=? AND sheet_name=? AND row_number=?', [source.fileDigest, source.sheetName, source.rowNumber])
  if (prior.some(row => row.invoice_id !== input.invoiceId) || oldRows.some(row => row.invoice_id !== input.invoiceId)
    || (input.kind === 'import' && (prior.length > 0 || oldRows.some(row => row.command_id !== input.commandId)))) {
    return fail('conflict', '此工作簿来源行已用于其他发票或已导入，请核对原记录。')
  }
  await tx.execute('INSERT INTO invoice_import_workbook_rows VALUES(?,?,?,?,?,?,?,?)', [input.commandId, workbookId, input.invoiceId, input.kind, source.sheetName, source.rowNumber, JSON.stringify(source), JSON.stringify(input.mapping)])
}

/** 保证正文与成功行双向存在，供冷读取和备份恢复共同使用。 */
export async function validateInvoiceWorkbooks(tx: TransactionDb) {
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'invoices\'')
  if (participant?.schema_version !== 4)
    return
  const books = await tx.select<Row>('SELECT w.*,f.owner_type,f.owner_id,f.file_name,f.file_size,f.category,f.deleted_at,length(p.content) AS payload_size,p.sha256 AS payload_sha256 FROM invoice_import_workbooks w LEFT JOIN file_refs f ON f.id=w.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=f.id')
  const rows = await tx.select<Row>('SELECT * FROM invoice_import_workbook_rows ORDER BY workbook_id,sheet_name,row_number')
  const refs = await tx.select<Row>('SELECT id FROM file_refs WHERE owner_type=\'invoice_workbook\'')
  const bookIds = new Set(rows.map(row => row.workbook_id))
  const commands = new Map(rows.map(row => [row.command_id, row]))
  const sourceOwners = new Map<string, unknown>()
  for (const row of rows) {
    const key = JSON.stringify([row.workbook_id, row.sheet_name, row.row_number])
    if (sourceOwners.has(key) && sourceOwners.get(key) !== row.invoice_id)
      return fail('unavailable', '同一工作簿来源行不能归属于不同发票。')
    sourceOwners.set(key, row.invoice_id)
  }
  let cacheKey: string | undefined
  let cached: ParsedWorkbook | undefined
  if (refs.length !== books.length)
    return fail('unavailable', '工作簿文件引用数量不一致。')
  for (const book of books) {
    if (book.owner_type !== 'invoice_workbook' || book.owner_id !== book.id || book.category !== 'invoice-import-workbook' || book.deleted_at !== null
      || typeof book.file_name !== 'string' || !book.file_name || !Number.isSafeInteger(book.file_size) || Number(book.file_size) < 1 || Number(book.file_size) > INVOICE_WORKBOOK_MAX_BYTES || book.file_size !== book.payload_size
      || book.sha256 !== book.payload_sha256 || !bookIds.has(book.id)) {
      return fail('unavailable', '工作簿正文、文件归属或成功来源不完整。')
    }
    const [payload] = await tx.select<Row>('SELECT content FROM file_payloads WHERE file_ref_id=?', [book.file_ref_id])
    if (!(payload?.content instanceof Uint8Array) || hash(payload.content) !== book.sha256)
      return fail('unavailable', '工作簿正文或摘要不完整。')
  }
  for (const row of rows) {
    const book = books.find(item => item.id === row.workbook_id)
    const [receipt] = await tx.select<Row>('SELECT action,invoice_id FROM invoice_command_receipts WHERE command_id=?', [row.command_id])
    let source: unknown
    try {
      source = JSON.parse(String(row.source_json))
    }
    catch { return fail('unavailable', '工作簿来源行损坏。') }
    if (!book || !receipt || receipt.invoice_id !== row.invoice_id || !object(source) || Object.keys(source).sort().join(',') !== 'fileDigest,fileName,rawSnapshot,rowNumber,sheetName'
      || typeof source.fileName !== 'string' || !source.fileName.trim() || source.fileName.length > 240 || /[/\\]/.test(source.fileName) || !/\.(?:xlsx|xls)$/i.test(source.fileName)
      || !object(source.rawSnapshot) || source.fileDigest !== book.sha256 || source.sheetName !== row.sheet_name || source.rowNumber !== row.row_number) {
      return fail('unavailable', '工作簿来源行与成功发票回执不一致。')
    }
    let actual: { row: Record<string, unknown>, columns: readonly string[], unsafeFormulaColumns: readonly string[] }
    try {
      const nextKey = JSON.stringify([book.id, source.sheetName])
      let workbook = cacheKey === nextKey ? cached : undefined
      if (!workbook) {
        cached = undefined
        cacheKey = undefined
        const [payload] = await tx.select<Row>('SELECT content FROM file_payloads WHERE file_ref_id=?', [book.file_ref_id])
        if (!(payload?.content instanceof Uint8Array))
          return fail('unavailable', '工作簿正文不完整。')
        const body = payload.content
        workbook = await parseWorkbook(body, String(source.fileName), String(source.sheetName))
        cacheKey = nextKey
        cached = workbook
      }
      actual = verifiedInvoiceSourceRow(workbook.parsed, source as unknown as CentralInvoiceImportSource)
    }
    catch (cause) {
      if (cause instanceof CentralInvoiceProblem && cause.problem.code === 'unavailable')
        throw cause
      return fail('unavailable', '工作簿来源行与正文不一致。')
    }
    const oldRows = await tx.select<Row>('SELECT invoice_id FROM invoice_import_sources WHERE file_digest=? AND sheet_name=? AND row_number=?', [book.sha256, row.sheet_name, row.row_number])
    if (oldRows.some(item => item.invoice_id !== row.invoice_id))
      return fail('unavailable', '同一工作簿来源行不能归属于不同发票。')
    let mapping: unknown
    try {
      mapping = JSON.parse(String(row.mapping_json))
    }
    catch { return fail('unavailable', '工作簿字段映射损坏。') }
    if (row.command_kind === 'import') {
      const [original] = await tx.select<Row>('SELECT * FROM invoice_import_sources WHERE command_id=?', [row.command_id])
      const [audit] = await tx.select<Row>('SELECT after_json FROM invoice_audits WHERE command_id=?', [row.command_id])
      let after: unknown
      try {
        after = JSON.parse(String(audit?.after_json))
      }
      catch { return fail('unavailable', '工作簿导入发票审计损坏。') }
      if (receipt.action !== 'import-workbook' || !original || original.invoice_id !== row.invoice_id || original.source_json !== row.source_json || !object(after) || !object(after.fields) || !Array.isArray(after.items))
        return fail('unavailable', '工作簿与发票导入来源不一致。')
      try {
        assertInvoiceWorkbookImport(after.fields as unknown as CentralInvoiceFields, after.items as CentralInvoiceItem[], mapping, actual.row, actual.columns, actual.unsafeFormulaColumns)
      }
      catch { return fail('unavailable', '工作簿导入字段与原表映射不一致。') }
    }
    else if (row.command_kind === 'correction') {
      const [correction] = await tx.select<Row>('SELECT c.request_json,v.snapshot_json FROM invoice_correction_receipts c JOIN invoice_correction_versions v ON v.command_id=c.command_id WHERE c.command_id=? AND c.action=\'submit\'', [row.command_id])
      let proof: unknown
      let snapshot: unknown
      try {
        proof = JSON.parse(String(correction?.request_json))
        snapshot = JSON.parse(String(correction?.snapshot_json))
      }
      catch { return fail('unavailable', '工作簿更正命令损坏。') }
      if (receipt.action !== 'correct' || !object(proof) || !object(proof.workbookSource) || Object.keys(proof.workbookSource).sort().join(',') !== 'mapping,source' || !object(proof.workbookSource.mapping) || !isDeepStrictEqual(proof.workbookSource.source, source) || !isDeepStrictEqual(proof.workbookSource.mapping, mapping) || !object(snapshot) || !object(snapshot.baseline) || !object(snapshot.proposed))
        return fail('unavailable', '工作簿与更正提交来源不一致。')
      try {
        assertInvoiceWorkbookFill(snapshot.baseline as unknown as InvoiceCorrectionContent, snapshot.proposed as unknown as InvoiceCorrectionContent, proof.workbookSource.mapping as Partial<Record<keyof InvoiceCorrectionContent['fields'], string>>, actual.row, actual.columns, actual.unsafeFormulaColumns)
      }
      catch { return fail('unavailable', '工作簿补空来源或票面变动不可核验。') }
    }
    else {
      return fail('unavailable', '工作簿来源类型无效。')
    }
  }
  const required = await tx.select<Row>('SELECT command_id FROM invoice_command_receipts WHERE action=\'import-workbook\'')
  if (required.some(receipt => commands.get(receipt.command_id)?.command_kind !== 'import'))
    return fail('unavailable', '发票导入回执缺少原工作簿。')
  const corrections = await tx.select<Row>('SELECT command_id,request_json FROM invoice_correction_receipts WHERE action=\'submit\'')
  for (const correction of corrections) {
    let proof: unknown
    try {
      proof = JSON.parse(String(correction.request_json))
    }
    catch { return fail('unavailable', '更正提交证明损坏。') }
    if (object(proof) && Object.hasOwn(proof, 'workbookSource') && commands.get(correction.command_id)?.command_kind !== 'correction')
      return fail('unavailable', '发票补空回执缺少原工作簿。')
  }
}
