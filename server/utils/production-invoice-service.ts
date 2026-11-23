import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceCommand, CentralInvoiceCommandResult, CentralInvoiceFields, CentralInvoiceImportSource, CentralInvoiceItem, CentralInvoiceOriginalInput, CentralInvoicePrintCommand, CentralInvoicePrintResult, CentralInvoiceRecord, InvoiceContractReference } from '../../app/lib/invoice/central-contract'
import type { InvoiceCorrectionContent, InvoiceCorrectionDraft, InvoiceCorrectionSubmitCommand } from '../../app/lib/invoice/correction-contract'
import type { BusinessSession } from './business-session'
import type { VerificationEvidence, VerificationHistory } from './production-invoice-original-verification'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { CentralInvoiceProblem, CONFIRM_ORIGINAL_VERIFICATION, INVOICE_ORIGINAL_MAX_BYTES, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, RECORD_ORIGINAL_VERIFICATION } from '../../app/lib/invoice/central-contract'
import { invoiceCorrectionChanges } from '../../app/lib/invoice/correction-contract'
import { hasPrintableCentralOriginal } from '../../app/lib/invoice/print-layout'
import { resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { parsePageQuery, resolvePagination } from '../../app/lib/read-model/pagination'
import { parseInvoiceTextPreservingUnknowns } from '../../app/lib/recognize/invoice-parse'
import { isISODateDTO } from '../../app/types/read-model'
import { assertInvoiceContractBuyer, invoiceContractCapability, verifyInvoiceCompanyArchiveReference, verifyInvoiceContractReference } from './production-invoice-contracts'
import { requireInvoiceCorrectionEligibility } from './production-invoice-correction-eligibility'
import { validateInvoiceCorrections } from './production-invoice-correction-service'
import { normalizeLegacyInvoiceItems } from './production-invoice-migration-plan'
import { appendVerification, confirmVerification, currentVerificationId, describeVerification, hasOriginalVerificationSchema, invoiceVerificationActions, isInvoiceVerificationAction, loadVerificationAudit, matchesVerificationOriginal, readVerificationHistory } from './production-invoice-original-verification'
import { assertInvoiceWorkbookImport, bindInvoiceWorkbook, prepareInvoiceWorkbook, validateInvoiceWorkbooks } from './production-invoice-workbook'
import { createReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
type Row = Record<string, unknown>
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const idPattern = /^[A-Z0-9][\w-]{2,79}$/i

function fail(code: 'validation-failed' | 'forbidden' | 'conflict' | 'not-found' | 'unavailable', message: string): never {
  throw new CentralInvoiceProblem(code, message)
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

const fieldTextKeys = ['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'] as const
const fieldMoneyKeys = ['amount', 'taxAmount', 'totalAmount'] as const
const itemTextKeys = ['name', 'spec', 'unit', 'taxRate'] as const
const itemNumberKeys = ['quantity', 'unitPrice', 'amount', 'taxAmount'] as const
const validNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000)

export function invoiceFields(input: unknown, errorCode: 'validation-failed' | 'unavailable'): CentralInvoiceFields {
  if (!object(input) || !exactKeys(input, [...fieldTextKeys, ...fieldMoneyKeys])
    || fieldTextKeys.some(key => typeof input[key] !== 'string' || (input[key] as string).length > (key === 'remark' ? 4000 : 500))
    || fieldMoneyKeys.some(key => !validNumber(input[key]))
    || (input.invoiceDate !== '' && !isISODateDTO(input.invoiceDate))) {
    return fail(errorCode, '发票识别字段无效或不完整。')
  }
  return input as unknown as CentralInvoiceFields
}

export function invoiceItems(input: unknown, errorCode: 'validation-failed' | 'unavailable'): CentralInvoiceItem[] {
  if (!Array.isArray(input) || input.length > 2000 || input.some(item => !object(item) || !exactKeys(item, [...itemTextKeys, ...itemNumberKeys])
    || itemTextKeys.some(key => typeof item[key] !== 'string' || (item[key] as string).length > 500)
    || itemNumberKeys.some(key => !validNumber(item[key])))) {
    return fail(errorCode, '发票货物明细无效或不完整。')
  }
  return input as CentralInvoiceItem[]
}

function pageIndexes(input: unknown, errorCode: 'validation-failed' | 'unavailable'): number[] {
  if (!Array.isArray(input) || input.some(index => !Number.isSafeInteger(index) || index < 0 || index >= 10)
    || new Set(input).size !== input.length) {
    return fail(errorCode, '未识别页码无效。')
  }
  return input as number[]
}

function recognitionEvidence(input: Record<string, unknown>, errorCode: 'validation-failed' | 'unavailable') {
  const indexes = pageIndexes(input.unrecognizedPageIndexes, errorCode)
  if ((input.source !== 'local' && input.source !== 'cloud') || !Array.isArray(input.textPages)
    || input.textPages.length < 1 || input.textPages.length > 10
    || input.textPages.some(page => typeof page !== 'string' || page.length > 250_000)
    || indexes.some(index => index >= (input.textPages as string[]).length)
    || input.textPages.some((page, index) => !page.trim() && !indexes.includes(index))) {
    return fail(errorCode, '识别来源、页面文本或缺失页信息无效。')
  }
  return { source: input.source as 'local' | 'cloud', textPages: input.textPages as string[], unrecognizedPageIndexes: indexes }
}

function originalInput(input: unknown): { file: CentralInvoiceOriginalInput, bytes: Uint8Array, sha256: string } {
  if (!object(input) || !exactKeys(input, ['fileName', 'fileSize', 'mimeType', 'contentBase64'])
    || typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 240
    || /[/\\]/.test(input.fileName) || Array.from(input.fileName).some(character => (character.codePointAt(0) ?? 0) < 32)
    || !/\.(?:pdf|png|jpe?g)$/i.test(input.fileName)
    || !Number.isSafeInteger(input.fileSize) || Number(input.fileSize) < 1 || Number(input.fileSize) > INVOICE_ORIGINAL_MAX_BYTES
    || typeof input.mimeType !== 'string' || input.mimeType.length > 120
    || typeof input.contentBase64 !== 'string' || input.contentBase64.length > Math.ceil(INVOICE_ORIGINAL_MAX_BYTES / 3) * 4) {
    return fail('validation-failed', '请选择不超过 10 MiB 的 PDF、PNG 或 JPEG 原件。')
  }
  const bytes = Buffer.from(input.contentBase64, 'base64')
  if (bytes.length !== input.fileSize || bytes.toString('base64') !== input.contentBase64)
    return fail('validation-failed', '发票原件正文、长度或编码不一致。')
  const lower = input.fileName.toLowerCase()
  const pdf = lower.endsWith('.pdf') && bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
  const png = lower.endsWith('.png') && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpg = /\.jpe?g$/.test(lower) && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (!pdf && !png && !jpg)
    return fail('validation-failed', '文件内容与 PDF、PNG 或 JPEG 文件名不一致。')
  const mimeType = pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg'
  return { file: { fileName: input.fileName.trim(), fileSize: bytes.length, mimeType, contentBase64: input.contentBase64 }, bytes, sha256: digest(bytes) }
}

export function validOwner(value: Record<string, unknown>) {
  return (value.ownerKind === 'project' || value.ownerKind === 'personal' || value.ownerKind === 'company')
    && (value.projectId === null || (typeof value.projectId === 'string' && idPattern.test(value.projectId)))
    && (value.supplierId === null || (typeof value.supplierId === 'string' && idPattern.test(value.supplierId)))
    && (value.ownerKind === 'project' ? value.projectId !== null : value.projectId === null)
}
function validTaxVerification(value: unknown) {
  return object(value) && exactKeys(value, ['buyerId', 'buyerVersion', 'supplierVersion']) && typeof value.buyerId === 'string' && idPattern.test(value.buyerId)
    && [value.buyerVersion, value.supplierVersion].every(version => typeof version === 'string' && /^[1-9]\d*$/.test(version) && Number.isSafeInteger(Number(version)))
}

export function contractReference(value: unknown): value is InvoiceContractReference | null {
  return value === null || (object(value) && exactKeys(value, ['domain', 'id', 'version'])
    && typeof value.domain === 'string' && ['construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(value.domain)
    && typeof value.id === 'string' && idPattern.test(value.id)
    && typeof value.version === 'string' && /^[1-9]\d*$/.test(value.version) && Number.isSafeInteger(Number(value.version)))
}

export function importSource(input: unknown): CentralInvoiceImportSource {
  if (!object(input) || !exactKeys(input, ['fileName', 'fileDigest', 'sheetName', 'rowNumber', 'rawSnapshot'])
    || typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 240 || /[/\\]/.test(input.fileName)
    || typeof input.fileDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.fileDigest)
    || typeof input.sheetName !== 'string' || !input.sheetName.trim() || input.sheetName.length > 100
    || typeof input.rowNumber !== 'number' || !Number.isSafeInteger(input.rowNumber) || input.rowNumber < 1 || input.rowNumber > 1_048_576
    || !object(input.rawSnapshot) || Object.keys(input.rawSnapshot).length > 1000 || JSON.stringify(input.rawSnapshot).length > 250_000
    || Object.values(input.rawSnapshot).some(value => !(value === null || typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))))) {
    return fail('validation-failed', '发票导入的文件、工作表、行号或原始快照无效。')
  }
  return input as unknown as CentralInvoiceImportSource
}

function command(value: unknown): CentralInvoiceCommand {
  if (!object(value) || typeof value.action !== 'string' || !['upload', 'manual', 'import', 'import-replace', 'attach-original', 'link-contract', 'confirm-legacy', 'recognize', 'rerecognize', 'edit', 'edit-archived', 'review', 'archive', 'discard', 'restore', ...invoiceVerificationActions].includes(value.action)
    || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || typeof value.commandId !== 'string'
    || !idPattern.test(value.workspaceId) || !idPattern.test(value.actorId) || !idPattern.test(value.commandId)
    || value.requiredCapability !== INVOICE_WRITE_CAPABILITY) {
    return fail('validation-failed', '发票命令或身份无效。')
  }
  const common = ['action', 'workspaceId', 'actorId', 'commandId', 'requiredCapability', 'baseVersion']
  if (value.action === 'upload') {
    if (!(exactKeys(value, [...common, 'original']) || (exactKeys(value, [...common, 'original', 'projectId']) && typeof value.projectId === 'string' && idPattern.test(value.projectId)) || (exactKeys(value, [...common, 'original', 'projectId', 'ownerKind']) && value.projectId === null && value.ownerKind === 'company')) || value.baseVersion !== null)
      return fail('validation-failed', '发票上传命令格式无效。')
    originalInput(value.original)
  }
  else if (value.action === 'manual') {
    if (!exactKeys(value, [...common, 'fields', 'items']) || value.baseVersion !== null)
      return fail('validation-failed', '手工发票命令格式无效。')
    invoiceFields(value.fields, 'validation-failed')
    invoiceItems(value.items, 'validation-failed')
  }
  else if (value.action === 'import') {
    if (!(exactKeys(value, [...common, 'fields', 'items', 'ownerKind', 'projectId', 'supplierId', 'source', 'confirmed']) || (exactKeys(value, [...common, 'fields', 'items', 'ownerKind', 'projectId', 'supplierId', 'source', 'confirmed', 'taxNumbersConfirmed', 'taxVerification']) && value.taxNumbersConfirmed === true && validTaxVerification(value.taxVerification))) || value.baseVersion !== null || value.confirmed !== true || !validOwner(value) || value.ownerKind === 'company')
      return fail('validation-failed', '发票导入须确认有效归属和来源。')
    invoiceFields(value.fields, 'validation-failed')
    invoiceItems(value.items, 'validation-failed')
    importSource(value.source)
  }
  else {
    const verificationKeys = [...common, 'invoiceId', 'originalId', 'originalSha256']
    const keys = value.action === RECORD_ORIGINAL_VERIFICATION
      ? [...verificationKeys, 'source', 'textPages', 'unrecognizedPageIndexes']
      : value.action === CONFIRM_ORIGINAL_VERIFICATION
        ? [...verificationKeys, 'candidateId', 'confirmed']
        : value.action === 'recognize'
          ? [...common, 'invoiceId', 'fields', 'items', 'source', 'textPages', 'unrecognizedPageIndexes']
          : value.action === 'rerecognize'
            ? [...common, 'invoiceId', 'fields', 'items', 'currentFields', 'currentItems', 'source', 'textPages', 'unrecognizedPageIndexes', 'confirmed']
            : value.action === 'import-replace'
              ? [...common, 'invoiceId', 'fields', 'items', 'ownerKind', 'projectId', 'supplierId', 'source', 'confirmed']
              : value.action === 'link-contract' ? [...common, 'invoiceId', 'contract', 'confirmed'] : value.action === 'confirm-legacy' ? [...common, 'invoiceId', 'confirmed'] : value.action === 'attach-original' ? [...common, 'invoiceId', 'original', 'confirmed'] : value.action === 'edit' ? [...common, 'invoiceId', 'fields', 'items'] : value.action === 'edit-archived' ? [...common, 'invoiceId', 'fields', 'items', 'ownerKind', 'projectId', 'supplierId', 'confirmed'] : value.action === 'review' ? [...common, 'invoiceId', 'manualCompletion'] : value.action === 'archive' ? [...common, 'invoiceId', 'ownerKind', 'projectId', 'supplierId'] : [...common, 'invoiceId']
    const supportsTaxConfirmation = value.action === 'archive' || value.action === 'import-replace'
    const contractArchive = value.action === 'archive' && exactKeys(value, [...keys, 'taxNumbersConfirmed', 'taxVerification', 'contract']) && value.taxNumbersConfirmed === true && validTaxVerification(value.taxVerification) && contractReference(value.contract) && object(value.contract)
      && ((value.ownerKind === 'company' && value.contract.domain === 'company') || (value.ownerKind === 'project' && value.contract.domain !== 'company'))
    if (!(exactKeys(value, keys) || (supportsTaxConfirmation && exactKeys(value, [...keys, 'taxNumbersConfirmed', 'taxVerification']) && value.taxNumbersConfirmed === true && validTaxVerification(value.taxVerification)) || contractArchive) || typeof value.invoiceId !== 'string' || !idPattern.test(value.invoiceId)
      || typeof value.baseVersion !== 'string' || !/^[1-9]\d*$/.test(value.baseVersion) || !Number.isSafeInteger(Number(value.baseVersion))) {
      return fail('validation-failed', '发票版本或原始身份无效。')
    }
    if (isInvoiceVerificationAction(value.action)) {
      if (typeof value.originalId !== 'string' || !idPattern.test(value.originalId) || typeof value.originalSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.originalSha256))
        return fail('validation-failed', '发票原件身份或摘要无效。')
      if (value.action === RECORD_ORIGINAL_VERIFICATION)
        recognitionEvidence(value, 'validation-failed')
      else if (value.confirmed !== true || typeof value.candidateId !== 'string' || !idPattern.test(value.candidateId))
        return fail('validation-failed', '请逐项核对当前候选并明确确认。')
    }
    if (value.action === 'recognize' || value.action === 'rerecognize' || value.action === 'edit' || value.action === 'edit-archived' || value.action === 'import-replace') {
      invoiceFields(value.fields, 'validation-failed')
      invoiceItems(value.items, 'validation-failed')
      if (value.action === 'recognize' || value.action === 'rerecognize')
        recognitionEvidence(value, 'validation-failed')
      if (value.action === 'rerecognize') {
        invoiceFields(value.currentFields, 'validation-failed')
        invoiceItems(value.currentItems, 'validation-failed')
        if (value.confirmed !== true)
          fail('validation-failed', '保存重新识别草稿须明确确认。')
      }
    }
    if (value.action === 'review' && typeof value.manualCompletion !== 'boolean')
      return fail('validation-failed', '请明确是否人工补全识别缺口。')
    if (value.action === 'attach-original') {
      if (value.confirmed !== true)
        return fail('validation-failed', '关联原件前须明确确认发票身份。')
      originalInput(value.original)
    }
    if (value.action === 'link-contract' && (value.confirmed !== true || !contractReference(value.contract)))
      return fail('validation-failed', '发票合同关联须明确确认稳定身份和版本。')
    if (value.action === 'confirm-legacy' && value.confirmed !== true)
      return fail('validation-failed', '核对旧发票须明确确认。')
    if (value.action === 'import-replace') {
      if (value.confirmed !== true)
        return fail('validation-failed', '替换已有发票须明确确认。')
      importSource(value.source)
    }
    if ((value.action === 'archive' || value.action === 'edit-archived' || value.action === 'import-replace') && !validOwner(value)) {
      return fail('validation-failed', '请选择有效的发票归属与关联身份。')
    }
    if ((value.action === 'archive' && value.ownerKind === 'company' && !contractArchive)
      || ((value.action === 'edit-archived' || value.action === 'import-replace') && value.ownerKind === 'company')) {
      return fail('validation-failed', '公司开销须归档时明确选择真实公司合同。')
    }
    if (value.action === 'edit-archived' && value.confirmed !== true)
      return fail('validation-failed', '修改已归档发票须明确确认。')
  }
  return value as unknown as CentralInvoiceCommand
}

function parsedReceipt(raw: unknown, commandId: string, invoiceId: string): CentralInvoiceCommandResult {
  try {
    const result: unknown = JSON.parse(String(raw))
    const keys = ['invoiceId', 'commandId', 'version', 'updatedAt', 'originalId']
    if (!object(result) || !(exactKeys(result, keys) || (exactKeys(result, [...keys, 'verificationSha256']) && typeof result.verificationSha256 === 'string' && /^[a-f0-9]{64}$/.test(result.verificationSha256)))
      || result.commandId !== commandId || result.invoiceId !== invoiceId || typeof result.version !== 'string' || !/^[1-9]\d*$/.test(result.version)
      || !(result.originalId === null || (typeof result.originalId === 'string' && idPattern.test(result.originalId))) || typeof result.updatedAt !== 'string' || !Number.isFinite(Date.parse(result.updatedAt))) {
      throw new Error('invalid')
    }
    return result as unknown as CentralInvoiceCommandResult
  }
  catch { return fail('unavailable', '原发票提交回执损坏，不能换号重写。') }
}

function printCommand(value: unknown): CentralInvoicePrintCommand {
  if (!object(value) || !exactKeys(value, ['action', 'workspaceId', 'actorId', 'commandId', 'requiredCapability', 'targets'])
    || value.action !== 'record-printed' || value.requiredCapability !== INVOICE_WRITE_CAPABILITY
    || typeof value.workspaceId !== 'string' || !idPattern.test(value.workspaceId) || typeof value.actorId !== 'string' || !idPattern.test(value.actorId)
    || typeof value.commandId !== 'string' || !idPattern.test(value.commandId) || !Array.isArray(value.targets) || !value.targets.length || value.targets.length > 1000) {
    return fail('validation-failed', '打印回执命令无效。')
  }
  const ids = new Set<string>()
  for (const target of value.targets) {
    if (!object(target) || !exactKeys(target, ['invoiceId', 'baseVersion', 'rotation']) || typeof target.invoiceId !== 'string' || !idPattern.test(target.invoiceId)
      || ids.has(target.invoiceId) || typeof target.baseVersion !== 'string' || !/^[1-9]\d*$/.test(target.baseVersion) || !Number.isSafeInteger(Number(target.baseVersion))
      || typeof target.rotation !== 'number' || ![0, 90, 180, 270].includes(target.rotation)) {
      return fail('validation-failed', '打印发票身份、版本、角度或重复项无效。')
    }
    ids.add(target.invoiceId)
  }
  return value as unknown as CentralInvoicePrintCommand
}

function parsedPrintReceipt(raw: unknown, commandId: string): CentralInvoicePrintResult {
  const invalid = () => fail('unavailable', '原打印提交回执损坏，不能换号重写。')
  let value: unknown
  try {
    value = JSON.parse(String(raw))
  }
  catch { return invalid() }
  if (!object(value) || !exactKeys(value, ['commandId', 'updatedAt', 'records']) || value.commandId !== commandId
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.records) || !value.records.length || value.records.length > 1000) {
    return invalid()
  }
  const ids = new Set<string>()
  for (const row of value.records) {
    if (!object(row) || !exactKeys(row, ['invoiceId', 'version', 'printCount', 'printRotation']) || typeof row.invoiceId !== 'string' || !idPattern.test(row.invoiceId)
      || ids.has(row.invoiceId) || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || !Number.isSafeInteger(Number(row.version))
      || typeof row.printCount !== 'number' || !Number.isSafeInteger(row.printCount) || row.printCount < 1
      || typeof row.printRotation !== 'number' || ![0, 90, 180, 270].includes(row.printRotation)) {
      return invalid()
    }
    ids.add(row.invoiceId)
  }
  return value as unknown as CentralInvoicePrintResult
}

function rowToRecord(row: Row): CentralInvoiceRecord {
  if (typeof row.id !== 'string' || !(row.original_file_id === null || typeof row.original_file_id === 'string')
    || (row.original_file_id !== null && (row.file_id !== row.original_file_id || typeof row.file_name !== 'string'
      || typeof row.file_size !== 'number' || !Number.isSafeInteger(row.file_size) || row.file_size < 1
      || typeof row.mime_type !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)))
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || !['scan', 'manual', 'excel', 'legacy'].includes(String(row.source_kind)) || (row.source_kind === 'scan' && row.original_file_id === null)
    || !['pending', 'failed', 'done'].includes(String(row.ocr_status)) || !(row.completion_method === null || ['ocr', 'manual', 'legacy'].includes(String(row.completion_method))) || !['unreviewed', 'reviewed'].includes(String(row.review_status))
    || !['none', 'archived'].includes(String(row.account_status)) || !['normal', 'duplicate'].includes(String(row.dup_status)) || typeof row.created_at !== 'string' || typeof row.updated_at !== 'string'
    || !Number.isSafeInteger(row.print_count) || Number(row.print_count) < 0 || ![0, 90, 180, 270].includes(Number(row.print_rotation))
    || !(row.owner_kind === null || ['project', 'personal', 'company'].includes(String(row.owner_kind)))
    || !(row.project_id === null || (typeof row.project_id === 'string' && idPattern.test(row.project_id)))
    || !(row.supplier_id === null || (typeof row.supplier_id === 'string' && idPattern.test(row.supplier_id)))
    || !contractReference(row.contract_domain === null && row.contract_id === null && row.contract_version === null ? null : { domain: row.contract_domain, id: row.contract_id, version: row.contract_version })
    || !(row.archived_at === null || (typeof row.archived_at === 'string' && Number.isFinite(Date.parse(row.archived_at))))
    || (row.owner_kind === 'project' ? row.project_id === null : row.project_id !== null)
    || (row.owner_kind === 'company' && ((row.contract_domain !== null && row.contract_domain !== 'company') || (row.account_status === 'archived' && (row.contract_domain !== 'company' || row.supplier_id === null))))
    || (row.contract_domain === 'company' && row.owner_kind !== 'company')
    || (row.account_status === 'archived' && (row.review_status !== 'reviewed' || row.completion_method === null || row.owner_kind === null || row.archived_at === null))
    || (row.account_status === 'none' && row.archived_at !== null)
    || !(row.deleted_at === null || typeof row.deleted_at === 'string')
    || ['amount', 'tax_amount', 'total_amount'].some(key => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key])))) {
    return fail('unavailable', '发票事实或原件元数据不完整，不能推测为空值。')
  }
  const text = (key: string) => typeof row[key] === 'string' ? row[key] as string : fail('unavailable', '发票文字事实损坏。')
  let items: CentralInvoiceItem[]
  let unrecognizedPageIndexes: number[]
  let legacy: CentralInvoiceRecord['legacy']
  try {
    items = invoiceItems(JSON.parse(String(row.items_json)), 'unavailable')
    unrecognizedPageIndexes = pageIndexes(JSON.parse(String(row.unrecognized_pages_json)), 'unavailable')
    if (row.source_kind === 'legacy') {
      const ambiguous: unknown = JSON.parse(String(row.legacy_ambiguous_json))
      if (!['scan', 'excel'].includes(String(row.legacy_source)) || !['recorded', 'legacy-path-unverified', 'session-original-unavailable', 'no-original-recorded'].includes(String(row.legacy_original_state))
        || !Array.isArray(ambiguous) || ambiguous.some(field => !['amount', 'tax_amount', 'total_amount'].includes(String(field))) || new Set(ambiguous).size !== ambiguous.length || (row.legacy_items_ambiguous !== 0 && row.legacy_items_ambiguous !== 1)) {
        return fail('unavailable', '旧发票来源或金额歧义证据损坏。')
      }
      legacy = { source: row.legacy_source as 'scan' | 'excel', originalState: row.legacy_original_state as NonNullable<CentralInvoiceRecord['legacy']>['originalState'], ambiguousZeroFields: ambiguous, ambiguousItemNumbers: row.legacy_items_ambiguous === 1 }
    }
    else if (row.legacy_source !== null || row.legacy_original_state !== null || row.legacy_ambiguous_json !== null || row.legacy_items_ambiguous !== null) {
      return fail('unavailable', '非旧发票包含不匹配的旧来源证据。')
    }
  }
  catch { return fail('unavailable', '发票货物明细或识别页码损坏。') }
  if ((row.ocr_status === 'done' && unrecognizedPageIndexes.length > 0)
    || (row.completion_method === 'ocr' && row.ocr_status !== 'done')
    || (row.review_status === 'reviewed' && row.completion_method === null)
    || (['manual', 'legacy'].includes(String(row.completion_method)) && row.review_status !== 'reviewed')
    || (row.completion_method === 'legacy' && row.source_kind !== 'legacy')) {
    return fail('unavailable', '发票识别和人工核对状态不一致。')
  }
  return {
    id: row.id,
    version: String(row.version),
    sourceKind: row.source_kind as CentralInvoiceRecord['sourceKind'],
    fields: invoiceFields({
      invoiceNumber: text('invoice_number'),
      invoiceDate: text('invoice_date'),
      invoiceType: text('invoice_type'),
      buyer: text('buyer'),
      buyerTaxNo: text('buyer_tax_no'),
      seller: text('seller'),
      sellerTaxNo: text('seller_tax_no'),
      amount: row.amount as number | null,
      taxAmount: row.tax_amount as number | null,
      totalAmount: row.total_amount as number | null,
      taxRate: text('tax_rate'),
      remark: text('remark'),
    }, 'unavailable'),
    items,
    unrecognizedPageIndexes,
    ocrStatus: row.ocr_status as CentralInvoiceRecord['ocrStatus'],
    completionMethod: row.completion_method as CentralInvoiceRecord['completionMethod'],
    reviewStatus: row.review_status as CentralInvoiceRecord['reviewStatus'],
    accountStatus: row.account_status as CentralInvoiceRecord['accountStatus'],
    duplicateStatus: row.dup_status as CentralInvoiceRecord['duplicateStatus'],
    printCount: row.print_count as number,
    printRotation: row.print_rotation as CentralInvoiceRecord['printRotation'],
    ownerKind: row.owner_kind as CentralInvoiceRecord['ownerKind'],
    projectId: row.project_id as string | null,
    supplierId: row.supplier_id as string | null,
    contract: row.contract_domain === null ? null : { domain: row.contract_domain, id: row.contract_id, version: row.contract_version } as InvoiceContractReference,
    archivedAt: row.archived_at as string | null,
    original: row.original_file_id === null ? null : { id: row.file_id as string, fileName: row.file_name as string, fileSize: row.file_size as number, mimeType: row.mime_type as string, sha256: row.sha256 as string },
    ...(legacy ? { legacy } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at as string | null,
  }
}

const SELECT_RECORD = `SELECT i.*, f.id AS file_id, f.file_name, f.file_size, f.mime_type, p.sha256
  FROM invoices i LEFT JOIN file_refs f ON f.id=i.original_file_id AND f.owner_type='invoice' AND f.owner_id=i.id AND f.deleted_at IS NULL
  LEFT JOIN file_payloads p ON p.file_ref_id=f.id`

/** 打印登记时逐块核验当前事务中的原件，避免一次物化整批正文。 */
async function verifyPrintOriginal(tx: TransactionDb, invoice: CentralInvoiceRecord) {
  const original = invoice.original
  if (!original)
    return fail('unavailable', '发票原件正文或摘要不完整，不能登记打印。')
  const [metadata] = await tx.select<{ size: number, type: string }>('SELECT length(content) AS size,typeof(content) AS type FROM file_payloads WHERE file_ref_id=?', [original.id])
  if (metadata?.type !== 'blob' || metadata.size !== original.fileSize)
    return fail('unavailable', '发票原件正文或摘要不完整，不能登记打印。')
  const hash = createHash('sha256')
  const chunkSize = 256 * 1024
  for (let offset = 0; offset < original.fileSize; offset += chunkSize) {
    const size = Math.min(chunkSize, original.fileSize - offset)
    const [row] = await tx.select<{ content: Uint8Array }>('SELECT substr(content,?,?) AS content FROM file_payloads WHERE file_ref_id=?', [offset + 1, size, original.id])
    if (!(row?.content instanceof Uint8Array) || row.content.length !== size)
      return fail('unavailable', '发票原件正文或摘要不完整，不能登记打印。')
    hash.update(row.content)
  }
  if (hash.digest('hex') !== original.sha256)
    return fail('unavailable', '发票原件正文或摘要不完整，不能登记打印。')
}

/** 仅供已经授权的同一事务捕获与核验发票事实。 */
export async function readProductionInvoiceFact(tx: Pick<TransactionDb, 'select'>, invoiceId: string): Promise<CentralInvoiceRecord> {
  const [row] = await tx.select<Row>(`${SELECT_RECORD} WHERE i.id=?`, [invoiceId])
  if (!row)
    return fail('unavailable', '发票事实在当前事务内缺失。')
  return rowToRecord(row)
}

async function readCheckedOriginal(tx: TransactionDb, invoice: CentralInvoiceRecord) {
  if (!invoice.original)
    fail('conflict', '识别前须先保存可核验的发票原件。')
  const [payload] = await tx.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [invoice.original.id])
  if (!(payload?.content instanceof Uint8Array) || payload.content.length !== invoice.original.fileSize || digest(payload.content) !== invoice.original.sha256)
    fail('unavailable', '发票原件正文或摘要损坏。')
  const magic = Buffer.from(payload.content.subarray(0, 8))
  const mime = magic.subarray(0, 5).toString() === '%PDF-'
    ? 'application/pdf'
    : magic.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : magic.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg' : null
  if (mime !== invoice.original.mimeType)
    fail('unavailable', '发票原件格式与已登记 MIME 不一致。')
  return { ...invoice.original, bytes: new Uint8Array(payload.content) }
}

async function verifyRecognitionPages(tx: TransactionDb, invoice: CentralInvoiceRecord, pageCount: number) {
  const original = await readCheckedOriginal(tx, invoice)
  if (original.mimeType !== 'application/pdf') {
    if (pageCount !== 1)
      fail('validation-failed', '图片原件只能提交一页识别结果。')
    return
  }
  let actualCount: number
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: original.bytes, isEvalSupported: false, disableFontFace: true, stopAtErrors: true })
    try {
      const pdf = await task.promise
      actualCount = pdf.numPages
    }
    finally { await task.destroy() }
  }
  catch { return fail('validation-failed', 'PDF 无法解析或已加密，不能确认识别页数。') }
  if (!Number.isSafeInteger(actualCount) || actualCount < 1 || actualCount > 10 || actualCount !== pageCount)
    fail('validation-failed', '识别页数与原 PDF 不一致或超出十页，请重新识别完整原件。')
}

/** 财务只消费已归档的真实票面；缺失金额或权限时不能制造候选。 */
export async function listProductionInvoiceReferences(tx: TransactionDb, actor: BusinessSession, invoiceId?: string, verifyContract = verifyInvoiceContractReference): Promise<Record<string, unknown>[]> {
  if (!actor.capabilities.includes(INVOICE_READ_CAPABILITY))
    fail('forbidden', '当前身份没有发票来源读取权限。')
  if (invoiceId !== undefined && !idPattern.test(invoiceId))
    fail('validation-failed', '发票身份无效。')
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['invoices'])
  if (![1, 2, 3, 4, 5].includes(participant?.schema_version ?? 0))
    fail('unavailable', '发票正式来源尚未接通。')
  const rows = await tx.select<Row>(`${SELECT_RECORD} WHERE i.deleted_at IS NULL AND i.account_status='archived' AND i.dup_status='normal'${invoiceId === undefined ? '' : ' AND i.id=?'} ORDER BY i.id`, invoiceId === undefined ? [] : [invoiceId])
  const references: Record<string, unknown>[] = []
  for (const row of rows) {
    const value = rowToRecord(row)
    if (value.sourceKind === 'legacy' && value.completionMethod === 'legacy' && invoiceId === undefined)
      continue
    if ((value.projectId && !actor.capabilities.includes('project:list:read')) || (value.supplierId && !actor.capabilities.includes('supplier:list:read')))
      return fail('forbidden', '当前身份无发票关联来源读取权限。')
    if (value.projectId && !(await tx.select('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', [value.projectId])).length)
      return fail('unavailable', '发票所属项目已不可核实，不能用于新增付款。')
    if (value.supplierId) {
      const [supplier] = await tx.select<Row>('SELECT id,draft_json,version,updated_at FROM suppliers WHERE id=?', [value.supplierId])
      let draft: unknown
      try {
        draft = supplier ? JSON.parse(String(supplier.draft_json)) : null
      }
      catch { return fail('unavailable', '发票所属分供方资料损坏。') }
      if (!supplier || !object(draft) || draft.id !== value.supplierId || typeof draft.name !== 'string' || !draft.name.trim() || draft.deletedAt
        || typeof supplier.version !== 'number' || !Number.isSafeInteger(supplier.version) || supplier.version < 1 || typeof supplier.updated_at !== 'string' || !Number.isFinite(Date.parse(supplier.updated_at))) {
        return fail('unavailable', '发票所属分供方已不可核实，不能用于新增付款。')
      }
    }
    if (value.contract && !actor.capabilities.includes(invoiceContractCapability(value.contract.domain)))
      return fail('forbidden', '当前身份无发票关联合同读取权限。')
    if (value.contract)
      await verifyContract(tx, actor, value.contract, value.projectId, value.supplierId)
    if (!value.fields.invoiceNumber.trim() || value.fields.totalAmount === null || value.fields.totalAmount <= 0)
      return fail('unavailable', '归档发票金额或票号缺失，不能用于付款。')
    if (value.sourceKind === 'legacy' && value.completionMethod === 'legacy') {
      return fail('unavailable', '旧发票尚未重新核对，不能用于新增付款。')
    }
    references.push({ id: value.id, invoice_number: value.fields.invoiceNumber, total_amount: value.fields.totalAmount, owner_kind: value.ownerKind, project_id: value.projectId, supplier_id: value.supplierId, contract_id: value.contract?.id ?? null, deleted_at: null })
  }
  return references
}

/** 捕获付款采用时的发票版本；仅在真实来源及合同当前核验通过后调用。 */
export async function captureProductionInvoiceAdoption(tx: TransactionDb, actor: BusinessSession, invoiceId: string) {
  const references = await listProductionInvoiceReferences(tx, actor, invoiceId)
  if (references.length !== 1)
    fail('unavailable', '所选发票不再是可采用的正式来源。')
  const [row] = await tx.select<Row>(`${SELECT_RECORD} WHERE i.id=?`, [invoiceId])
  if (!row)
    fail('unavailable', '所选发票来源在事务内缺失。')
  return rowToRecord(row)
}

/** 只读核验中央快照，不能仅凭 SQLite 物理完整性认定发票历史完整。 */
export async function validateProductionInvoiceJournal(tx: TransactionDb, identity: { workspaceId: string, actorId: string }) {
  const invalid = () => fail('unavailable', '发票原回执、审计或识别证据不完整。')
  const parse = (raw: unknown): unknown => {
    try {
      return JSON.parse(String(raw))
    }
    catch { return invalid() }
  }
  const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_revision WHERE singleton=1')
  const heads = await tx.select<Row>(SELECT_RECORD)
  const verificationEnabled = await hasOriginalVerificationSchema(tx)
  const verificationAudit = verificationEnabled ? await loadVerificationAudit(tx) : new Map()
  const receipts = await tx.select<Row>('SELECT * FROM invoice_command_receipts')
  const printReceipts = await tx.select<Row>('SELECT * FROM invoice_print_receipts')
  const printLines = await tx.select<Row>('SELECT * FROM invoice_print_lines')
  const seals = await tx.select<Row>('SELECT * FROM invoice_command_resolutions')
  const legacyBatches = await tx.select<Row>('SELECT * FROM invoice_legacy_batches')
  const legacyMembers = await tx.select<Row>('SELECT * FROM invoice_legacy_members')
  const legacyCommands = await tx.select<Row>('SELECT * FROM invoice_legacy_commands')
  const legacySeals = await tx.select<Row>('SELECT * FROM invoice_legacy_resolutions')
  const legacyRetirements = await tx.select<Row>('SELECT * FROM invoice_legacy_retirements')
  const headIds = new Set(heads.map(head => head.id))
  const receiptIds = new Set([...receipts, ...printReceipts].map(receipt => receipt.command_id))
  const byInvoice = new Map<string, Row[]>()
  const printByInvoice = new Map<string, Array<{ line: Row, receipt: CentralInvoicePrintResult, print: CentralInvoicePrintResult['records'][number] }>>()
  const linesByCommand = new Map<unknown, Row[]>()
  for (const line of printLines) {
    const group = linesByCommand.get(line.command_id) ?? []
    group.push(line)
    linesByCommand.set(line.command_id, group)
  }
  if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision !== receipts.length + printReceipts.length
    || receiptIds.size !== receipts.length + printReceipts.length) {
    return invalid()
  }
  if (seals.some(row => row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || receiptIds.has(row.command_id)))
    return invalid()
  if (legacySeals.some(row => row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || legacyCommands.some(command => command.command_id === row.command_id)))
    return invalid()
  for (const batch of legacyBatches) {
    const evidence = parse(batch.evidence_json)
    const result = parse(batch.result_json)
    const command = legacyCommands.find(row => row.command_id === (object(result) ? result.commandId : null))
    if (!object(evidence) || !object(result) || !command || batch.workspace_id !== identity.workspaceId || batch.actor_id !== identity.actorId
      || command.workspace_id !== identity.workspaceId || command.actor_id !== identity.actorId || command.action !== 'publish'
      || batch.id !== result.batchId || batch.source_sha256 !== result.sourceSha256 || batch.source_sha256 !== evidence.sourceSha256
      || batch.created_at !== result.createdAt || command.created_at !== result.createdAt || command.result_json !== batch.result_json
      || batch.evidence_sha256 !== digest(canonical(evidence)) || batch.fingerprint !== command.fingerprint
      || !Array.isArray(result.invoiceIds) || canonical(result.invoiceIds) !== canonical(evidence.invoiceIds)
      || batch.fingerprint !== digest(canonical({ commandId: result.commandId, workspaceId: identity.workspaceId, actorId: identity.actorId, source: { sha256: batch.source_sha256 }, mappings: evidence.mappings, confirmed: true }))) {
      return invalid()
    }
    const members = legacyMembers.filter(row => row.batch_id === batch.id)
    if (members.length !== result.invoiceIds.length || members.some(row => !(result.invoiceIds as unknown[]).includes(row.invoice_id)))
      return invalid()
  }
  for (const retirement of legacyRetirements) {
    const batch = legacyBatches.find(row => row.id === retirement.batch_id)
    const command = legacyCommands.find(row => row.command_id === retirement.command_id)
    const result = command ? parse(command.result_json) : null
    const members = legacyMembers.filter(row => row.batch_id === retirement.batch_id).map(row => row.invoice_id).sort()
    if (!batch || !command || !object(result) || command.action !== 'retire' || command.workspace_id !== identity.workspaceId || command.actor_id !== identity.actorId
      || result.commandId !== command.command_id || result.batchId !== batch.id || result.sourceSha256 !== batch.source_sha256 || result.retired !== true
      || result.createdAt !== retirement.retired_at || command.created_at !== retirement.retired_at || canonical(result.invoiceIds) !== canonical(members)
      || command.fingerprint !== digest(canonical({ commandId: command.command_id, workspaceId: identity.workspaceId, actorId: identity.actorId, batchId: batch.id, confirmed: true }))) {
      return invalid()
    }
    for (const invoiceId of members) {
      if ((await tx.select('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=?', [invoiceId])).length)
        return invalid()
    }
  }
  if (legacyCommands.length !== legacyBatches.length + legacyRetirements.length || legacyMembers.some(row => !legacyBatches.some(batch => batch.id === row.batch_id)))
    return invalid()
  for (const member of legacyMembers) {
    const head = heads.find(row => row.id === member.invoice_id)
    const receipt = receipts.find(row => row.command_id === member.genesis_command_id)
    if (!head || head.source_kind !== 'legacy' || !receipt || receipt.invoice_id !== member.invoice_id || receipt.action !== 'legacy-adopt')
      return invalid()
  }
  for (const row of receipts) {
    if (row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || typeof row.invoice_id !== 'string'
      || typeof row.command_id !== 'string' || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)
      || !['upload', 'manual', 'import', 'import-workbook', 'import-replace', 'attach-original', 'link-contract', 'confirm-legacy', 'recognize', 'rerecognize', 'edit', 'review', 'archive', 'edit-archived', 'correct', 'discard', 'restore', 'legacy-adopt', 'legacy-retire', ...invoiceVerificationActions].includes(String(row.action))
      || !headIds.has(row.invoice_id)) {
      return invalid()
    }
    const group = byInvoice.get(row.invoice_id) ?? []
    group.push(row)
    byInvoice.set(row.invoice_id, group)
    const result = parsedReceipt(row.result_json, row.command_id, row.invoice_id)
    if (row.created_at !== result.updatedAt || (result.verificationSha256 !== undefined) !== isInvoiceVerificationAction(row.action))
      return invalid()
  }
  for (const row of printReceipts) {
    if (row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId || typeof row.command_id !== 'string'
      || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)) {
      return invalid()
    }
    const receipt = parsedPrintReceipt(row.result_json, row.command_id)
    if (row.created_at !== receipt.updatedAt)
      return invalid()
    const lines = linesByCommand.get(row.command_id) ?? []
    if (lines.length !== receipt.records.length)
      return invalid()
    const targets: CentralInvoicePrintCommand['targets'] = []
    for (const print of receipt.records) {
      const line = lines.find(item => item.invoice_id === print.invoiceId)
      if (!line || !headIds.has(print.invoiceId) || line.actor_id !== identity.actorId || line.created_at !== receipt.updatedAt)
        return invalid()
      const before = parse(line.before_json)
      if (!object(before) || typeof before.version !== 'string' || !/^[1-9]\d*$/.test(before.version))
        return invalid()
      targets.push({ invoiceId: print.invoiceId, baseVersion: before.version, rotation: print.printRotation })
      const group = printByInvoice.get(print.invoiceId) ?? []
      group.push({ line, receipt, print })
      printByInvoice.set(print.invoiceId, group)
    }
    if (digest(canonical({ workspaceId: identity.workspaceId, actorId: identity.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, action: 'record-printed', commandId: row.command_id, targets })) !== row.fingerprint)
      return invalid()
  }
  if (printLines.length !== [...printByInvoice.values()].reduce((sum, entries) => sum + entries.length, 0))
    return invalid()
  for (const headRow of heads) {
    const head = rowToRecord(headRow)
    const ordinary = (byInvoice.get(head.id) ?? []).map(row => ({ row, result: parsedReceipt(row.result_json, String(row.command_id), head.id), printing: null }))
    const printing = (printByInvoice.get(head.id) ?? []).map(item => ({
      row: { command_id: item.receipt.commandId, action: 'record-printed' } as Row,
      result: { invoiceId: head.id, commandId: item.receipt.commandId, version: item.print.version, updatedAt: item.receipt.updatedAt, originalId: head.original?.id ?? null },
      printing: item,
    }))
    const history = [...ordinary, ...printing].sort((a, b) => Number(a.result.version) - Number(b.result.version))
    if (history.length !== Number(head.version) || (head.sourceKind === 'excel' ? !['import', 'import-workbook'].includes(String(history[0]?.row.action)) : history[0]?.row.action !== (head.sourceKind === 'scan' ? 'upload' : head.sourceKind === 'legacy' ? 'legacy-adopt' : 'manual')))
      return invalid()
    let prior: unknown = null
    const verificationHistory: VerificationHistory = {}
    let verifiedPageCount: number | null = null
    for (const [index, entry] of history.entries()) {
      if (Number(entry.result.version) !== index + 1)
        return invalid()
      if (entry.printing) {
        const before = parse(entry.printing.line.before_json)
        const after = parse(entry.printing.line.after_json)
        const verificationId = entry.printing.line.verification_id ?? null
        const verified = verificationId === null
          ? object(before) && before.ocrStatus === 'done'
          : object(before) && typeof verificationId === 'string' && currentVerificationId(before as unknown as CentralInvoiceRecord, verificationHistory) === verificationId
        if (!object(before) || !object(after) || canonical(before) !== canonical(prior) || before.deletedAt !== null
          || !hasPrintableCentralOriginal(before.sourceKind, before.original) || !verified || before.reviewStatus !== 'reviewed' || before.duplicateStatus !== 'normal'
          || !object(before.fields) || typeof before.fields.totalAmount !== 'number' || before.fields.totalAmount <= 0
          || typeof before.printCount !== 'number' || entry.printing.print.printCount !== before.printCount + 1
          || canonical(after) !== canonical({ ...before, version: entry.result.version, updatedAt: entry.result.updatedAt, printCount: entry.printing.print.printCount, printRotation: entry.printing.print.printRotation })) {
          return invalid()
        }
        prior = after
        continue
      }
      const audits = await tx.select<Row>('SELECT * FROM invoice_audits WHERE command_id=? ORDER BY rowid', [entry.row.command_id])
      const expectedActions = entry.row.action === 'rerecognize' && audits.length === 2 ? ['rerecognize', 'edit'] : [entry.row.action]
      if (audits.length !== expectedActions.length)
        return invalid()
      for (const [auditIndex, audit] of audits.entries()) {
        if (audit.invoice_id !== head.id || audit.actor_id !== identity.actorId || audit.action !== expectedActions[auditIndex] || audit.created_at !== entry.result.updatedAt)
          return invalid()
        const before = audit.before_json === null ? null : parse(audit.before_json)
        const after = parse(audit.after_json)
        if (canonical(before) !== canonical(prior) || !object(after) || after.id !== head.id || after.version !== entry.result.version || after.updatedAt !== entry.result.updatedAt)
          return invalid()
        if ((object(after.original) ? after.original.id : null) !== entry.result.originalId)
          return invalid()
        prior = after
      }
      if (isInvoiceVerificationAction(entry.row.action)) {
        const row = verificationAudit.get(entry.result.commandId)
        const before = parse(audits[0]!.before_json) as CentralInvoiceRecord | null
        const evidence: unknown = row && parse(row.evidence_json)
        if (!row || !before || !object(evidence) || !object(evidence.request))
          return invalid()
        const request = command(evidence.request)
        if ((request.action !== RECORD_ORIGINAL_VERIFICATION && request.action !== CONFIRM_ORIGINAL_VERIFICATION)
          || request.action !== entry.row.action || request.workspaceId !== identity.workspaceId || request.actorId !== identity.actorId
          || request.baseVersion !== before.version || !matchesVerificationOriginal(before, request)
          || canonical(prior) !== canonical({ ...before, version: entry.result.version, updatedAt: entry.result.updatedAt })) {
          return invalid()
        }
        if (request.action === RECORD_ORIGINAL_VERIFICATION) {
          if (!exactKeys(evidence, ['request', 'fields', 'items']))
            return invalid()
          invoiceFields(evidence.fields, 'unavailable')
          invoiceItems(evidence.items, 'unavailable')
          await verifyRecognitionPages(tx, before, request.textPages.length)
        }
        else if (canonical(evidence) !== canonical(await confirmVerification(tx, before, request, verificationHistory))) {
          return invalid()
        }
        appendVerification(verificationHistory, row)
        verificationAudit.delete(entry.result.commandId)
      }
      if (entry.row.action === 'legacy-adopt') {
        const member = legacyMembers.find(row => row.invoice_id === head.id && row.genesis_command_id === entry.row.command_id)
        const evidence = member ? parse(member.evidence_json) : null
        const batch = member ? legacyBatches.find(row => row.id === member.batch_id) : null
        const after = parse(audits[0]!.after_json)
        const companyAdoption = object(evidence) && object(evidence.entry) && object(evidence.entry.companyAdoption) ? evidence.entry.companyAdoption : null
        if (!member || !batch || !object(evidence) || !object(evidence.entry) || !object(evidence.entry.sourceHead) || !object(after) || !object(after.fields)
          || evidence.batchId !== member.batch_id || evidence.sourceSha256 !== batch.source_sha256 || evidence.genesisCommandId !== entry.row.command_id || evidence.entry.id !== head.id
          || member.evidence_sha256 !== digest(canonical(evidence)) || entry.row.fingerprint !== member.evidence_sha256
          || !object(evidence.entry.amounts) || after.fields.amount !== evidence.entry.amounts.amount || after.fields.taxAmount !== evidence.entry.amounts.tax_amount || after.fields.totalAmount !== evidence.entry.amounts.total_amount
          || after.projectId !== evidence.entry.projectId || after.supplierId !== evidence.entry.supplierId || canonical(after.contract) !== canonical(evidence.entry.contract)
          || !object(after.legacy) || canonical(after.legacy.ambiguousZeroFields) !== canonical(evidence.entry.ambiguousZeroFields) || after.legacy.originalState !== evidence.entry.originalState
          || after.legacy.source !== evidence.entry.sourceHead.source || after.reviewStatus !== evidence.entry.sourceHead.review_status
          || after.accountStatus !== evidence.entry.sourceHead.account_status || after.duplicateStatus !== evidence.entry.sourceHead.dup_status
          || after.printCount !== evidence.entry.sourceHead.print_count || after.printRotation !== evidence.entry.sourceHead.print_rotation
          || after.ownerKind !== (companyAdoption ? 'company' : evidence.entry.sourceHead.owner_kind === '' ? null : evidence.entry.sourceHead.owner_kind)
          || after.archivedAt !== (evidence.entry.sourceHead.archived_at === '' ? null : evidence.entry.sourceHead.archived_at)
          || after.deletedAt !== (evidence.entry.sourceHead.deleted_at === '' ? null : evidence.entry.sourceHead.deleted_at)) {
          return invalid()
        }
        const sourceHead = evidence.entry.sourceHead
        if (Object.hasOwn(evidence.entry, 'companyAdoption') && !companyAdoption)
          return invalid()
        if (companyAdoption) {
          const batchEvidence = parse(batch.evidence_json)
          if (!object(companyAdoption.target) || companyAdoption.target.domain !== 'company' || companyAdoption.invoiceId !== head.id
            || companyAdoption.legacyContractId !== sourceHead.company_expense_contract_id || after.projectId !== null || after.supplierId !== companyAdoption.supplierId
            || typeof companyAdoption.buyerId !== 'string' || !idPattern.test(companyAdoption.buyerId)
            || typeof companyAdoption.buyerVersion !== 'string' || !/^[1-9]\d*$/.test(companyAdoption.buyerVersion)
            || typeof companyAdoption.supplierVersion !== 'string' || !/^[1-9]\d*$/.test(companyAdoption.supplierVersion)
            || typeof companyAdoption.supplierSourceVersion !== 'string' || !companyAdoption.supplierSourceVersion
            || !(sourceHead.contract_id === null || sourceHead.contract_id === '') || !(sourceHead.project_id === null || sourceHead.project_id === '')
            || canonical(after.contract) !== canonical(companyAdoption.target) || !object(batchEvidence) || !object(batchEvidence.mappings)
            || !Array.isArray(batchEvidence.mappings.companyInvoices) || batchEvidence.mappings.companyInvoices.filter((row: unknown) => canonical(row) === canonical(companyAdoption)).length !== 1) {
            return invalid()
          }
          const targetId = companyAdoption.target.id
          const [source] = await tx.select<Row>('SELECT evidence_json,evidence_sha256 FROM auxiliary_contract_imports WHERE source_sha256=?', [batch.source_sha256])
          const contractEvidence = source ? parse(source.evidence_json) : null
          if (!source || !object(contractEvidence) || source.evidence_sha256 !== digest(canonical(contractEvidence)) || contractEvidence.sourceSha256 !== batch.source_sha256
            || !Array.isArray(contractEvidence.identityMappings) || !contractEvidence.identityMappings.some((row: unknown) => object(row)
              && row.legacyId === `company_expense:${companyAdoption.legacyContractId}` && row.id === targetId)) {
            return invalid()
          }
        }
        for (const [field, column] of [['invoiceNumber', 'invoice_number'], ['invoiceDate', 'invoice_date'], ['invoiceType', 'invoice_type'], ['buyer', 'buyer'], ['buyerTaxNo', 'buyer_tax_no'], ['seller', 'seller'], ['sellerTaxNo', 'seller_tax_no'], ['taxRate', 'tax_rate'], ['remark', 'remark']] as const) {
          if (after.fields[field] !== (sourceHead[column] ?? ''))
            return invalid()
        }
        let sourceItems: ReturnType<typeof normalizeLegacyInvoiceItems>
        try {
          sourceItems = normalizeLegacyInvoiceItems(sourceHead.items)
        }
        catch { return invalid() }
        if (canonical(after.items) !== canonical(sourceItems.values) || after.legacy.ambiguousItemNumbers !== sourceItems.ambiguous)
          return invalid()
        const files = evidence.entry.sourceFiles
        if (!Array.isArray(files))
          return invalid()
        const embedded = files.filter(file => object(file) && file.bodyState === 'embedded')
        if (embedded.length > 1)
          return invalid()
        if (embedded.length) {
          const file = embedded[0]
          if (!object(file) || !object(file.row) || !object(file.payload) || typeof file.payload.content !== 'string' || !object(after.original)
            || after.original.id !== file.row.id || after.original.fileName !== file.row.file_name) {
            return invalid()
          }
          const bytes = Buffer.from(file.payload.content, 'base64')
          if (bytes.toString('base64') !== file.payload.content || after.original.fileSize !== bytes.length || after.original.sha256 !== digest(bytes))
            return invalid()
        }
        else if (after.original !== null) {
          return invalid()
        }
      }
      if (entry.row.action === 'legacy-retire') {
        const member = legacyMembers.find(row => row.invoice_id === head.id)
        const retirement = member ? legacyRetirements.find(row => row.batch_id === member.batch_id) : null
        const before = parse(audits[0]!.before_json)
        const after = parse(audits[0]!.after_json)
        if (!member || !retirement || !object(before) || !object(after) || before.version !== '1'
          || entry.result.version !== '2' || entry.result.updatedAt !== retirement.retired_at
          || entry.row.fingerprint !== digest(canonical({ batchId: member.batch_id, invoiceId: head.id, commandId: entry.row.command_id, retirementCommandId: retirement.command_id }))
          || canonical(after) !== canonical({ ...before, version: '2', updatedAt: retirement.retired_at, deletedAt: before.deletedAt ?? retirement.retired_at })) {
          return invalid()
        }
      }
      if (entry.row.action === 'confirm-legacy') {
        const before = parse(audits[0]!.before_json)
        const after = parse(audits[0]!.after_json)
        if (!object(before) || !object(after) || !object(before.legacy) || !object(before.fields)
          || before.sourceKind !== 'legacy' || before.completionMethod !== 'legacy' || before.accountStatus !== 'archived' || before.deletedAt !== null
          || (before.legacy.source === 'scan' && !object(before.original)) || typeof before.fields.totalAmount !== 'number' || before.fields.totalAmount <= 0
          || typeof before.fields.invoiceNumber !== 'string' || !before.fields.invoiceNumber.trim() || typeof before.fields.invoiceDate !== 'string' || !isISODateDTO(before.fields.invoiceDate)
          || typeof before.fields.seller !== 'string' || !before.fields.seller.trim()
          || canonical(after) !== canonical({ ...before, completionMethod: 'manual', version: entry.result.version, updatedAt: entry.result.updatedAt })
          || entry.row.fingerprint !== digest(canonical({ action: 'confirm-legacy', workspaceId: identity.workspaceId, actorId: identity.actorId, requiredCapability: INVOICE_WRITE_CAPABILITY, commandId: entry.row.command_id, invoiceId: head.id, baseVersion: before.version, confirmed: true }))) {
          return invalid()
        }
      }
      const recognitions = await tx.select<Row>('SELECT * FROM invoice_recognitions WHERE command_id=?', [entry.row.command_id])
      const expectedRecognition = entry.row.action === 'recognize' || entry.row.action === 'rerecognize'
      if (recognitions.length !== (expectedRecognition ? 1 : 0))
        return invalid()
      for (const recognition of recognitions) {
        const evidence = parse(recognition.result_json)
        if (recognition.invoice_id !== head.id || recognition.actor_id !== identity.actorId || recognition.created_at !== entry.result.updatedAt || !object(evidence) || !exactKeys(evidence, ['fields', 'items', 'source', 'textPages', 'unrecognizedPageIndexes']))
          return invalid()
        invoiceFields(evidence.fields, 'unavailable')
        invoiceItems(evidence.items, 'unavailable')
        const recognitionPages = recognitionEvidence(evidence, 'unavailable')
        if (verifiedPageCount === null) {
          await verifyRecognitionPages(tx, head, recognitionPages.textPages.length)
          verifiedPageCount = recognitionPages.textPages.length
        }
        else if (verifiedPageCount !== recognitionPages.textPages.length) {
          return invalid()
        }
        const recognizedSnapshot = parse(audits[0]!.after_json)
        if (!object(recognizedSnapshot) || canonical(recognizedSnapshot.fields) !== canonical(evidence.fields) || canonical(recognizedSnapshot.items) !== canonical(evidence.items)
          || canonical(recognizedSnapshot.unrecognizedPageIndexes) !== canonical(evidence.unrecognizedPageIndexes)) {
          return invalid()
        }
      }
      const archives = await tx.select<Row>('SELECT * FROM invoice_archive_evidence WHERE command_id=?', [entry.row.command_id])
      const expectedArchive = entry.row.action === 'archive' || entry.row.action === 'edit-archived' || entry.row.action === 'import' || entry.row.action === 'import-workbook' || entry.row.action === 'import-replace' || entry.row.action === 'correct'
      if (archives.length !== (expectedArchive ? 1 : 0))
        return invalid()
      for (const archive of archives) {
        const evidence = parse(archive.evidence_json)
        const beforeArchive = parse(audits[0]!.before_json)
        const afterArchive = parse(audits[audits.length - 1]!.after_json)
        if (archive.invoice_id !== head.id || archive.actor_id !== identity.actorId || archive.created_at !== entry.result.updatedAt
          || !object(evidence) || !object(afterArchive) || canonical(evidence.source) !== canonical(beforeArchive)
          || evidence.ownerKind !== afterArchive.ownerKind || evidence.projectId !== afterArchive.projectId || evidence.supplierId !== afterArchive.supplierId
          || !Array.isArray(evidence.originalRecognition)) {
          return invalid()
        }
        if ((entry.row.action === 'edit-archived' || entry.row.action === 'import-replace' || entry.row.action === 'correct') && (!object(evidence.current) || canonical(evidence.current.fields) !== canonical(afterArchive.fields) || canonical(evidence.current.items) !== canonical(afterArchive.items)))
          return invalid()
        if (Object.hasOwn(evidence, 'taxNumbersConfirmed') && (evidence.taxNumbersConfirmed !== true || !object(afterArchive.fields)
          || typeof afterArchive.fields.buyerTaxNo !== 'string' || !afterArchive.fields.buyerTaxNo.trim()
          || typeof afterArchive.fields.sellerTaxNo !== 'string' || !afterArchive.fields.sellerTaxNo.trim())) {
          return invalid()
        }
        if (evidence.taxNumbersConfirmed === true) {
          const proof = evidence.taxVerification
          if (!object(proof) || !object(proof.buyer) || !object(proof.supplier) || !object(afterArchive.fields)
            || typeof proof.buyer.id !== 'string' || typeof proof.buyer.version !== 'string' || !/^[1-9]\d*$/.test(proof.buyer.version)
            || typeof proof.buyer.taxNo !== 'string' || typeof proof.supplier.taxNo !== 'string' || typeof proof.supplier.version !== 'string' || !/^[1-9]\d*$/.test(proof.supplier.version)
            || proof.supplier.id !== afterArchive.supplierId || typeof afterArchive.fields.buyerTaxNo !== 'string' || typeof afterArchive.fields.sellerTaxNo !== 'string'
            || afterArchive.fields.buyerTaxNo.trim().toUpperCase() !== proof.buyer.taxNo.trim().toUpperCase()
            || afterArchive.fields.sellerTaxNo.trim().toUpperCase() !== proof.supplier.taxNo.trim().toUpperCase()) {
            return invalid()
          }
          const [history] = await tx.select<{ draft_json: string }>('SELECT draft_json FROM our_signatory_history WHERE signatory_id=? AND version=?', [proof.buyer.id, Number(proof.buyer.version)])
          if (!history)
            return invalid()
          const { id: _id, version: _version, ...buyerDraft } = proof.buyer
          if (canonical(parse(history.draft_json)) !== canonical({ ...buyerDraft, status: 'active' }))
            return invalid()
        }
      }
      if (entry.row.action === 'correct') {
        const [correctionReceipt] = await tx.select<Row>('SELECT * FROM invoice_correction_receipts WHERE command_id=?', [entry.row.command_id])
        const [correctionVersion] = await tx.select<Row>('SELECT * FROM invoice_correction_versions WHERE command_id=?', [entry.row.command_id])
        const correction = correctionVersion ? parse(correctionVersion.snapshot_json) : null
        const request = correctionReceipt ? parse(correctionReceipt.request_json) : null
        const result = correctionReceipt ? parse(correctionReceipt.result_json) : null
        const before = parse(audits[0]!.before_json)
        const after = parse(audits[0]!.after_json)
        const evidence = archives[0] ? parse(archives[0].evidence_json) : null
        if (!correctionReceipt || !correctionVersion || !object(correction) || !object(request) || !object(result) || !object(before) || !object(after)
          || !object(correction.baseline) || !object(correction.proposed) || !object(evidence) || !object(evidence.taxVerification) || !object(evidence.taxVerification.buyer) || !object(evidence.taxVerification.supplier)
          || correctionReceipt.action !== 'submit' || correctionReceipt.workspace_id !== identity.workspaceId || correctionReceipt.actor_id !== identity.actorId
          || correctionReceipt.fingerprint !== entry.row.fingerprint || digest(canonical(request)) !== entry.row.fingerprint || request.action !== 'submit' || request.confirmed !== true
          || request.commandId !== entry.row.command_id || request.invoiceId !== head.id || request.correctionId !== correction.id || request.baseInvoiceVersion !== before.version
          || correctionVersion.correction_id !== correction.id || String(correctionVersion.version) !== correction.version || correction.state !== 'submitted'
          || correction.invoiceId !== head.id || correction.baseInvoiceVersion !== before.version || correction.resultInvoiceVersion !== after.version || correction.submittedAt !== after.updatedAt
          || result.commandId !== entry.row.command_id || result.correctionId !== correction.id || result.invoiceId !== head.id || result.invoiceVersion !== after.version
          || typeof correction.reason !== 'string' || !correction.reason.trim() || before.accountStatus !== 'archived' || before.deletedAt !== null || before.printCount !== 0
          || (before.ownerKind !== 'personal' && after.ownerKind === 'personal')
          || !object(evidence.eligibility) || !Number.isSafeInteger(evidence.eligibility.financeRevision) || Number(evidence.eligibility.financeRevision) < 0 || evidence.eligibility.printCount !== 0 || evidence.eligibility.paymentAllocations !== 0
          || canonical(correction.baseline.fields) !== canonical(before.fields) || canonical(correction.baseline.items) !== canonical(before.items)
          || correction.baseline.ownerKind !== before.ownerKind || correction.baseline.projectId !== before.projectId || correction.baseline.supplierId !== before.supplierId || canonical(correction.baseline.contract) !== canonical(before.contract)
          || !validOwner(correction.proposed) || !contractReference(correction.proposed.contract) || !object(correction.proposed.buyer) || !validTaxVerification({ buyerId: correction.proposed.buyer.id, buyerVersion: correction.proposed.buyer.version, supplierVersion: correction.proposed.supplierVersion })
          || evidence.taxVerification.buyer.id !== correction.proposed.buyer.id || evidence.taxVerification.buyer.version !== correction.proposed.buyer.version
          || evidence.taxVerification.supplier.id !== correction.proposed.supplierId || evidence.taxVerification.supplier.version !== correction.proposed.supplierVersion
          || (after.ownerKind === 'company' ? !object(after.contract) || after.contract.domain !== 'company' : object(after.contract) && after.contract.domain === 'company')
          || evidence.correctionId !== correction.id || evidence.taxNumbersConfirmed !== true) {
          return invalid()
        }
        invoiceFields(correction.proposed.fields, 'unavailable')
        invoiceItems(correction.proposed.items, 'unavailable')
        if (!invoiceCorrectionChanges(correction.baseline as unknown as InvoiceCorrectionContent, correction.proposed as unknown as InvoiceCorrectionContent).length
          || canonical(after) !== canonical({ ...before, fields: correction.proposed.fields, items: correction.proposed.items, ownerKind: correction.proposed.ownerKind, projectId: correction.proposed.projectId, supplierId: correction.proposed.supplierId, contract: correction.proposed.contract, duplicateStatus: 'normal', version: entry.result.version, updatedAt: entry.result.updatedAt })) {
          return invalid()
        }
        const [financeRevision] = await tx.select<{ revision: number }>('SELECT revision FROM finance_revision WHERE singleton=1')
        if (!financeRevision || !Number.isSafeInteger(financeRevision.revision) || financeRevision.revision < Number(evidence.eligibility.financeRevision))
          return invalid()
      }
      const imports = await tx.select<Row>('SELECT * FROM invoice_import_sources WHERE command_id=?', [entry.row.command_id])
      if (imports.length !== (entry.row.action === 'import' || entry.row.action === 'import-workbook' || entry.row.action === 'import-replace' ? 1 : 0))
        return invalid()
      for (const imported of imports) {
        const source = importSource(parse(imported.source_json))
        const after = parse(audits[0]!.after_json)
        if (imported.invoice_id !== head.id || imported.file_digest !== source.fileDigest || imported.sheet_name !== source.sheetName || imported.row_number !== source.rowNumber || !object(after))
          return invalid()
        const before = parse(audits[0]!.before_json)
        const archiveEvidence = archives[0] ? parse(archives[0].evidence_json) : null
        const proof = object(archiveEvidence) && object(archiveEvidence.taxVerification) ? archiveEvidence.taxVerification : null
        const buyer = proof && object(proof.buyer) ? proof.buyer : null
        const supplier = proof && object(proof.supplier) ? proof.supplier : null
        const common = { workspaceId: identity.workspaceId, actorId: identity.actorId, commandId: entry.row.command_id, requiredCapability: INVOICE_WRITE_CAPABILITY, fields: after.fields, items: after.items, ownerKind: after.ownerKind, projectId: after.projectId, supplierId: after.supplierId, source, confirmed: true, ...(object(archiveEvidence) && archiveEvidence.taxNumbersConfirmed === true && buyer && supplier ? { taxNumbersConfirmed: true, taxVerification: { buyerId: buyer.id, buyerVersion: buyer.version, supplierVersion: supplier.version } } : {}) }
        const request = entry.row.action === 'import' || entry.row.action === 'import-workbook' ? { ...common, action: 'import', baseVersion: null } : object(before) ? { ...common, action: 'import-replace', invoiceId: head.id, baseVersion: before.version } : null
        const [binding] = entry.row.action === 'import-workbook' ? await tx.select<Row>('SELECT mapping_json FROM invoice_import_workbook_rows WHERE command_id=? AND command_kind=\'import\'', [entry.row.command_id]) : []
        const commandProof = entry.row.action === 'import-workbook' && binding && request ? { ...request, workbookMapping: parse(binding.mapping_json) } : request
        if ((entry.row.action === 'import-workbook' && !binding) || digest(canonical(commandProof)) !== entry.row.fingerprint)
          return invalid()
      }
    }
    if (canonical(prior) !== canonical(head))
      return invalid()
  }
  const hasCorrections = (await tx.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'invoice_corrections\'')).length > 0
  const [invoiceParticipant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'invoices\'')
  if (hasCorrections !== [3, 4, 5].includes(invoiceParticipant?.schema_version ?? 0) || verificationAudit.size)
    return invalid()
  if (hasCorrections)
    await validateInvoiceCorrections(tx, identity)
  await validateInvoiceWorkbooks(tx)
}

export function createProductionInvoiceService(storage: ProductionStorage, options: { verifyContract?: typeof verifyInvoiceContractReference } = {}) {
  const verifyContract = options.verifyContract ?? verifyInvoiceContractReference
  function authorize(session: Session, write: boolean) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes(INVOICE_READ_CAPABILITY) || (write && !actor.capabilities.includes(INVOICE_WRITE_CAPABILITY))) {
      fail('forbidden', '当前身份没有该工作区发票操作权限。')
    }
    return actor
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>): Promise<T> {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const result = await work(tx, actor)
      if (canonical(authorize(session, write)) !== canonical(actor))
        fail('forbidden', '操作期间会话或权限已变化，本次提交已撤回。')
      return result
    })
  }
  function ensureReferencesReadable(value: CentralInvoiceRecord, actor: BusinessSession) {
    if ((value.projectId && !actor.capabilities.includes('project:list:read')) || (value.supplierId && !actor.capabilities.includes('supplier:list:read')))
      fail('forbidden', '当前身份无发票关联来源读取权限。')
    if (value.contract && !actor.capabilities.includes(invoiceContractCapability(value.contract.domain)))
      fail('forbidden', '当前身份无发票关联合同读取权限。')
  }
  async function ensureNoFinancialReferences(tx: TransactionDb, invoiceId: string) {
    const [table] = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payment_application_invoice_allocations\'')
    if (!table)
      fail('unavailable', '发票关联来源尚未完整接入，不能修改或删除已归档发票。')
    if ((await tx.select('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=? LIMIT 1', [invoiceId])).length)
      fail('conflict', '此发票存在付款申请关联或历史，不能直接修改或删除。')
  }
  async function correctionCommandOccupied(tx: TransactionDb, commandId: string) {
    if (!(await tx.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'invoice_correction_receipts\'')).length)
      return false
    return (await tx.select('SELECT command_id FROM invoice_correction_receipts WHERE command_id=? UNION ALL SELECT command_id FROM invoice_correction_resolutions WHERE command_id=? LIMIT 1', [commandId, commandId])).length > 0
  }
  async function ensureArchiveReferences(tx: TransactionDb, actor: BusinessSession, projectId: string | null, supplierId: string | null) {
    if (projectId) {
      if (!actor.capabilities.includes('project:list:read'))
        fail('forbidden', '当前身份无项目读取权限。')
      const [project] = await tx.select<Row>('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', [projectId])
      if (!project)
        fail('validation-failed', '所选归属项目不存在或已删除。')
    }
    if (supplierId) {
      if (!actor.capabilities.includes('supplier:list:read'))
        fail('forbidden', '当前身份无分供方读取权限。')
      const [supplier] = await tx.select<Row>('SELECT id,draft_json,version,updated_at FROM suppliers WHERE id=?', [supplierId])
      let draft: unknown
      try {
        draft = supplier && JSON.parse(String(supplier.draft_json))
      }
      catch { fail('unavailable', '所选分供方资料损坏，请先核对来源。') }
      if (!supplier)
        fail('validation-failed', '所选分供方不存在或已删除。')
      if (!object(draft) || draft.id !== supplierId || typeof draft.name !== 'string'
        || !(draft.deletedAt === undefined || draft.deletedAt === null || typeof draft.deletedAt === 'string')
        || typeof supplier.version !== 'number' || !Number.isSafeInteger(supplier.version) || supplier.version < 1 || typeof supplier.updated_at !== 'string' || !Number.isFinite(Date.parse(supplier.updated_at))) {
        fail('unavailable', '所选分供方资料或版本损坏，请先核对来源。')
      }
      if (draft.deletedAt)
        fail('validation-failed', '所选分供方不存在或已删除。')
    }
  }
  async function ensureArchiveFields(tx: TransactionDb, invoiceId: string, fields: CentralInvoiceFields) {
    if (!fields.invoiceNumber.trim() || !fields.invoiceDate || !fields.seller.trim() || fields.totalAmount === null || fields.totalAmount <= 0)
      fail('validation-failed', '发票归档前须补齐票号、日期、销售方和有效价税合计。')
    if ((await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND id<>? AND deleted_at IS NULL AND (account_status=\'archived\' OR dup_status<>\'duplicate\') LIMIT 1', [fields.invoiceNumber.trim(), invoiceId])).length)
      fail('conflict', '发票号码重复，请先核对或处理副本。')
  }
  async function ensureTaxNumbersForArchive(tx: TransactionDb, actor: BusinessSession, fields: CentralInvoiceFields, supplierId: string | null, selection: { buyerId: string, buyerVersion: string, supplierVersion: string } | undefined) {
    if (!fields.buyerTaxNo.trim() || !fields.sellerTaxNo.trim())
      fail('validation-failed', '本业务归档需购销双方税号；请核对票面，缺失时联系开票方处理。原件和草稿仍保留。')
    if (!supplierId || !selection)
      fail('validation-failed', '请选择我方主体和已有分供方，并核对双方税号。')
    if (!actor.capabilities.includes('our-signatory:read') || !actor.capabilities.includes('supplier:list:read'))
      fail('forbidden', '当前身份无我方主体或分供方资料读取权限，不能核对税号。')
    const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['our-signatories'])
    if (participant?.schema_version !== 1)
      fail('unavailable', '我方主体正式来源尚不可用，不能核对税号。')
    const [supplierParticipant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['supplier'])
    if (supplierParticipant?.schema_version !== 1)
      fail('unavailable', '分供方正式来源尚不可用，不能核对税号。')
    let buyer
    try {
      buyer = await resolveContractSignatory(tx, { id: selection.buyerId, version: selection.buyerVersion, required: true })
    }
    catch (cause) {
      const problem = cause && typeof cause === 'object' && 'problem' in cause ? cause.problem : null
      const code = object(problem) && ['validation-failed', 'conflict', 'unavailable', 'forbidden'].includes(String(problem.code)) ? problem.code as 'validation-failed' | 'conflict' | 'unavailable' | 'forbidden' : 'unavailable'
      fail(code, object(problem) && typeof problem.message === 'string' ? problem.message : '我方主体资料无法核验。')
    }
    const [supplier] = await tx.select<Row>('SELECT id,draft_json,version,updated_at FROM suppliers WHERE id=?', [supplierId])
    let supplierDraft: unknown
    try {
      supplierDraft = supplier ? JSON.parse(String(supplier.draft_json)) : null
    }
    catch { return fail('unavailable', '分供方税号来源无法核验。') }
    if (!buyer || !object(supplierDraft) || supplierDraft.id !== supplierId || typeof supplierDraft.name !== 'string' || !supplierDraft.name.trim()
      || typeof supplier?.version !== 'number' || !Number.isSafeInteger(supplier.version) || supplier.version < 1
      || typeof supplier.updated_at !== 'string' || !Number.isFinite(Date.parse(supplier.updated_at))) {
      fail('unavailable', '购销主体资料或版本无法核验。')
    }
    if (String(supplier.version) !== selection.supplierVersion)
      fail('conflict', '分供方资料已变化，请重新读取并核对。')
    const normalized = (value: string) => value.trim().toUpperCase()
    if (typeof buyer.taxNo !== 'string' || !buyer.taxNo.trim() || typeof supplierDraft.taxNo !== 'string' || !supplierDraft.taxNo.trim())
      fail('unavailable', '我方主体或分供方主档缺少税号，不能核对一致性。')
    if (normalized(fields.buyerTaxNo) !== normalized(buyer.taxNo) || normalized(fields.sellerTaxNo) !== normalized(supplierDraft.taxNo))
      fail('validation-failed', '发票税号与所选我方主体或分供方资料不一致，请核对原票与主体资料。')
    return { buyer, supplier: { id: supplierId, version: String(supplier.version), name: supplierDraft.name, taxNo: supplierDraft.taxNo } }
  }
  async function archiveProvenance(tx: TransactionDb, invoiceId: string) {
    const rows = await tx.select<{ result_json: string }>('SELECT result_json FROM invoice_recognitions WHERE invoice_id=? ORDER BY created_at,id', [invoiceId])
    try {
      return rows.map((row) => {
        const value: unknown = JSON.parse(row.result_json)
        if (!object(value) || !exactKeys(value, ['fields', 'items', 'source', 'textPages', 'unrecognizedPageIndexes']))
          return fail('unavailable', '原识别记录损坏，不能归档。')
        const evidence = recognitionEvidence(value, 'unavailable')
        return { fields: invoiceFields(value.fields, 'unavailable'), items: invoiceItems(value.items, 'unavailable'), source: evidence.source, unrecognizedPageIndexes: evidence.unrecognizedPageIndexes }
      })
    }
    catch { return fail('unavailable', '原识别记录损坏，不能归档。') }
  }
  async function record(tx: TransactionDb, invoiceId: string, includeDeleted: boolean, actor: BusinessSession) {
    const found = await tx.select<Row>(`${SELECT_RECORD} WHERE i.id=?`, [invoiceId])
    if (!found.length) {
      const [owner] = await tx.select<Row>('SELECT id FROM invoices WHERE id=?', [invoiceId])
      if (owner)
        fail('unavailable', '发票原件或归属不可核实，不能当作缺失记录。')
      fail('not-found', '发票不存在。')
    }
    const result = rowToRecord(found[0]!)
    ensureReferencesReadable(result, actor)
    if (result.deletedAt && !includeDeleted)
      fail('not-found', '发票已删除。')
    return result
  }
  async function metadata(tx: TransactionDb, actor: BusinessSession, operation: 'list' | 'detail' | 'import-preview', scope: object) {
    const [revision] = await tx.select<{ revision: number }>('SELECT revision FROM invoice_revision WHERE singleton=1')
    if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 0)
      fail('unavailable', '发票来源版本损坏，不能读取不完整结果。')
    const asOf = new Date().toISOString()
    return createReadMeta({ session: actor, schemaVersion: 'invoice-read-v1', operation: `invoice:${operation}`, dataOrigin: 'real', asOf, sources: [{ key: 'invoices', state: 'readable', sourceVersion: `invoices:${revision.revision}`, asOf }], coverage: 'complete', scope })
  }
  async function printableRead(tx: TransactionDb, invoice: CentralInvoiceRecord, enabled: boolean) {
    if (!enabled || invoice.sourceKind !== 'excel' || !invoice.original || invoice.deletedAt !== null)
      return invoice
    const originalVerificationId = currentVerificationId(invoice, await readVerificationHistory(tx, invoice.id))
    return originalVerificationId ? { ...invoice, originalVerificationId } : invoice
  }
  return {
    /** Internal transaction port; correction owner commits its own history in the same transaction. */
    correctionPort: {
      async apply(tx: TransactionDb, actor: BusinessSession, correction: InvoiceCorrectionDraft, request: InvoiceCorrectionSubmitCommand, timestamp: string): Promise<CentralInvoiceCommandResult> {
        const before = await requireInvoiceCorrectionEligibility(tx, actor, correction.invoiceId, correction.baseInvoiceVersion)
        const proposed = correction.proposed
        if (request.invoiceId !== before.id || request.correctionId !== correction.id || request.baseInvoiceVersion !== before.version || request.baseCorrectionVersion !== correction.version)
          return fail('conflict', '更正单与原票基准版本不一致。')
        if (before.ownerKind !== 'personal' && proposed.ownerKind === 'personal')
          return fail('validation-failed', '项目或公司开销发票不能转换为历史个人归属。')
        if (!proposed.buyer || !proposed.supplierId || !proposed.supplierVersion)
          return fail('validation-failed', '请先选择并核对我方主体及分供方。')
        const fields = invoiceFields(proposed.fields, 'validation-failed')
        const items = invoiceItems(proposed.items, 'validation-failed')
        if (!validOwner(proposed as unknown as Row) || !contractReference(proposed.contract))
          return fail('validation-failed', '更正后的归属或合同无效。')
        await ensureArchiveFields(tx, before.id, fields)
        await ensureArchiveReferences(tx, actor, proposed.projectId, proposed.supplierId)
        const taxVerification = await ensureTaxNumbersForArchive(tx, actor, fields, proposed.supplierId, { buyerId: proposed.buyer.id, buyerVersion: proposed.buyer.version, supplierVersion: proposed.supplierVersion })
        if (proposed.ownerKind === 'company') {
          if (!proposed.contract || proposed.contract.domain !== 'company')
            return fail('validation-failed', '公司开销发票必须关联已有公司支出合同。')
          await verifyInvoiceCompanyArchiveReference(tx, actor, proposed.contract, proposed.supplierId, proposed.buyer.id)
        }
        else if (proposed.contract) {
          if (proposed.contract.domain === 'company')
            return fail('validation-failed', '项目或个人发票不能关联公司开销合同。')
          const actual = await verifyContract(tx, actor, proposed.contract, proposed.projectId, proposed.supplierId)
          assertInvoiceContractBuyer(actor, actual, proposed.buyer.id)
        }
        const [finance] = await tx.select<{ revision: number }>('SELECT revision FROM finance_revision WHERE singleton=1')
        if (!finance || !Number.isSafeInteger(finance.revision) || finance.revision < 0)
          return fail('unavailable', '付款来源版本不可核实。')
        const originalRecognition = await archiveProvenance(tx, before.id)
        const archiveEvidence = { source: before, current: { fields, items }, originalRecognition, ownerKind: proposed.ownerKind, projectId: proposed.projectId, supplierId: proposed.supplierId, taxNumbersConfirmed: true, taxVerification, correctionId: correction.id, eligibility: { financeRevision: finance.revision, printCount: 0, paymentAllocations: 0 } }
        const nextVersion = Number(before.version) + 1
        if (!Number.isSafeInteger(nextVersion))
          return fail('unavailable', '发票版本无法可靠递增。')
        await tx.execute(`UPDATE invoices SET invoice_number=?,invoice_date=?,invoice_type=?,buyer=?,buyer_tax_no=?,seller=?,seller_tax_no=?,amount=?,tax_amount=?,total_amount=?,tax_rate=?,remark=?,items_json=?,owner_kind=?,project_id=?,supplier_id=?,contract_domain=?,contract_id=?,contract_version=?,dup_status='normal',version=?,updated_at=? WHERE id=?`, [fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(items), proposed.ownerKind, proposed.projectId, proposed.supplierId, proposed.contract?.domain ?? null, proposed.contract?.id ?? null, proposed.contract?.version ?? null, nextVersion, timestamp, before.id])
        const result: CentralInvoiceCommandResult = { invoiceId: before.id, commandId: request.commandId, version: String(nextVersion), updatedAt: timestamp, originalId: before.original?.id ?? null }
        await tx.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, before.id, 'correct', digest(canonical(request)), JSON.stringify(result), timestamp])
        await tx.execute('INSERT INTO invoice_archive_evidence VALUES(?,?,?,?,?,?)', [randomUUID(), before.id, request.commandId, actor.actorId, JSON.stringify(archiveEvidence), timestamp])
        const after = await record(tx, before.id, true, actor)
        await tx.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), before.id, request.commandId, actor.actorId, 'correct', JSON.stringify(before), JSON.stringify(after), timestamp])
        await tx.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
        return result
      },
    },
    async previewImport(input: unknown, session: Session) {
      if (!object(input) || !exactKeys(input, ['fields', 'items', 'source']))
        return fail('validation-failed', '发票导入预览格式无效。')
      const fields = invoiceFields(input.fields, 'validation-failed')
      const items = invoiceItems(input.items, 'validation-failed')
      const source = importSource(input.source)
      return run(session, false, async (tx, actor) => {
        const found = await tx.select<{ invoice_id: string }>('SELECT invoice_id FROM invoice_import_sources WHERE file_digest=? AND sheet_name=? AND row_number=?', [source.fileDigest, source.sheetName, source.rowNumber])
        const numbered = fields.invoiceNumber.trim() ? await tx.select<{ id: string }>('SELECT id FROM invoices WHERE trim(invoice_number)=? AND deleted_at IS NULL ORDER BY id', [fields.invoiceNumber.trim()]) : []
        const ids = [...new Set([...found.map(row => row.invoice_id), ...numbered.map(row => row.id)])]
        const candidates = []
        for (const invoiceId of ids) {
          const current = await record(tx, invoiceId, true, actor)
          const differences = Object.keys(fields).filter(key => canonical(fields[key as keyof CentralInvoiceFields]) !== canonical(current.fields[key as keyof CentralInvoiceFields]))
          candidates.push({ record: current, matchedBy: [...(found.some(row => row.invoice_id === invoiceId) ? ['source-row'] : []), ...(numbered.some(row => row.id === invoiceId) ? ['invoice-number'] : [])], differences, itemsDiffer: canonical(items) !== canonical(current.items) })
        }
        return withReadMeta({ dataOrigin: 'real' as const, candidates }, await metadata(tx, actor, 'import-preview', { invoiceNumber: fields.invoiceNumber.trim(), fileDigest: source.fileDigest, sheetName: source.sheetName, rowNumber: source.rowNumber }))
      })
    },
    async listRead(input: Record<string, unknown>, session: Session) {
      if (Object.keys(input).some(key => !['page', 'pageSize', 'deleted'].includes(key)))
        fail('validation-failed', '发票列表筛选参数无效。')
      const { requestedPage, pageSize } = parsePageQuery(input, () => fail('validation-failed', '发票分页参数无效。'))
      const includeDeleted = input.deleted === 'true' || input.deleted === true
      if (input.deleted !== undefined && ![true, false, 'true', 'false'].includes(input.deleted as boolean | string))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '发票删除状态筛选无效。'))
      const scope = { requestedPage, pageSize, deleted: includeDeleted }
      return run(session, false, async (tx, actor) => {
        const [count] = await tx.select<{ count: number }>(`SELECT COUNT(*) AS count FROM invoices WHERE deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL`)
        if (!count || !Number.isSafeInteger(count.count) || count.count < 0)
          fail('unavailable', '发票列表数量不可核实。')
        const pagination = resolvePagination(requestedPage, pageSize, count.count)
        const rows = await tx.select<Row>(`${SELECT_RECORD} WHERE i.deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?`, [pageSize, (pagination.page - 1) * pageSize])
        if (rows.length !== Math.min(pageSize, count.count - (pagination.page - 1) * pageSize))
          fail('unavailable', '发票列表与原件关系不完整，不能显示不完整结果。')
        const items = rows.map(rowToRecord)
        items.forEach(value => ensureReferencesReadable(value, actor))
        const enabled = await hasOriginalVerificationSchema(tx)
        const projected = await Promise.all(items.map(invoice => printableRead(tx, invoice, enabled)))
        return withReadMeta({ dataOrigin: 'real' as const, items: projected, pagination }, await metadata(tx, actor, 'list', scope))
      })
    },
    getRead(invoiceId: string, session: Session, includeDeleted = false) {
      if (!idPattern.test(invoiceId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '发票身份无效。'))
      return run(session, false, async (tx, actor) => {
        const invoice = await record(tx, invoiceId, includeDeleted, actor)
        const history = invoice.sourceKind === 'excel' && invoice.original && invoice.deletedAt === null && await hasOriginalVerificationSchema(tx)
          ? await readVerificationHistory(tx, invoiceId)
          : {}
        const originalVerificationId = currentVerificationId(invoice, history)
        const verification = await describeVerification(tx, invoice, history)
        return withReadMeta({
          dataOrigin: 'real' as const,
          record: originalVerificationId ? { ...invoice, originalVerificationId } : invoice,
          ...(verification ? { verification } : {}),
        }, await metadata(tx, actor, 'detail', { invoiceId, deleted: includeDeleted }))
      })
    },
    list(session: Session, includeDeleted = false) {
      return run(session, false, async (tx, actor) => {
        const rows = await tx.select<Row>(`${SELECT_RECORD} WHERE i.deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL ORDER BY i.created_at DESC,i.id`)
        const [count] = await tx.select<{ count: number }>(`SELECT COUNT(*) AS count FROM invoices WHERE deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL`)
        if (count?.count !== rows.length)
          fail('unavailable', '发票与原件的对应关系不完整，不能显示不完整列表。')
        const result = rows.map(rowToRecord)
        result.forEach(value => ensureReferencesReadable(value, actor))
        return result
      })
    },
    get(invoiceId: string, session: Session, includeDeleted = false) {
      if (!idPattern.test(invoiceId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '发票身份无效。'))
      return run(session, false, (tx, actor) => record(tx, invoiceId, includeDeleted, actor))
    },
    original(invoiceId: string, originalId: string, session: Session) {
      if (!idPattern.test(invoiceId) || !idPattern.test(originalId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '发票或原件身份无效。'))
      return run(session, false, async (tx, actor) => {
        const owner = await record(tx, invoiceId, false, actor)
        if (!owner.original || owner.original.id !== originalId)
          fail('not-found', '原件不属于当前发票。')
        return readCheckedOriginal(tx, owner)
      })
    },
    workbook(workbookId: string, session: Session) {
      if (!idPattern.test(workbookId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '工作簿身份无效。'))
      return run(session, false, async (tx) => {
        await validateInvoiceWorkbooks(tx)
        const [row] = await tx.select<Row>('SELECT w.sha256,f.file_name,f.file_size,p.content FROM invoice_import_workbooks w JOIN file_refs f ON f.id=w.file_ref_id JOIN file_payloads p ON p.file_ref_id=f.id WHERE w.id=?', [workbookId])
        if (!row || typeof row.file_name !== 'string' || typeof row.sha256 !== 'string' || !(row.content instanceof Uint8Array) || row.file_size !== row.content.length || digest(row.content) !== row.sha256)
          fail('not-found', '工作簿不存在或正文不可用。')
        return { fileName: row.file_name, sha256: row.sha256, bytes: new Uint8Array(row.content) }
      })
    },
    workbooksForInvoice(invoiceId: string, session: Session) {
      if (!idPattern.test(invoiceId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '发票身份无效。'))
      return run(session, false, async (tx) => {
        await validateInvoiceWorkbooks(tx)
        const rows = await tx.select<Row>('SELECT w.id,w.sha256,r.source_json FROM invoice_import_workbook_rows r JOIN invoice_import_workbooks w ON w.id=r.workbook_id WHERE r.invoice_id=? ORDER BY r.rowid', [invoiceId])
        return rows.map((row) => {
          let source: CentralInvoiceImportSource
          try {
            source = importSource(JSON.parse(String(row.source_json)))
          }
          catch { return fail('unavailable', '工作簿来源行损坏。') }
          return { id: row.id, sha256: row.sha256, fileName: source.fileName, sheetName: source.sheetName, rowNumber: source.rowNumber }
        })
      })
    },
    async execute(value: unknown, session: Session, workbookInput?: unknown, workbookMapping?: unknown): Promise<CentralInvoiceCommandResult> {
      const request = command(value)
      const initialActor = authorize(session, true)
      if (workbookInput !== undefined && request.action !== 'import')
        fail('validation-failed', '工作簿只能随 Excel 导入命令提交。')
      if (workbookInput !== undefined && !initialActor.capabilities.includes('finance-invoice:import'))
        fail('forbidden', '当前身份没有发票导入权限。')
      if (workbookInput === undefined && workbookMapping !== undefined)
        fail('validation-failed', '字段映射必须随原工作簿提交。')
      const workbook = request.action === 'import' && workbookInput !== undefined ? await prepareInvoiceWorkbook(workbookInput, request.source) : null
      if (request.action === 'import' && workbook)
        assertInvoiceWorkbookImport(request.fields, request.items, workbookMapping, workbook.row, workbook.columns, workbook.unsafeFormulaColumns)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          fail('forbidden', '发票命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(workbook ? { ...request, workbookMapping } : request))
        const [sealed] = await tx.select<Row>('SELECT * FROM invoice_command_resolutions WHERE command_id=?', [request.commandId])
        if (sealed)
          fail('conflict', '原提交已封存为未应用，迟到请求不能写入。')
        if ((await tx.select('SELECT command_id FROM invoice_print_receipts WHERE command_id=?', [request.commandId])).length)
          fail('conflict', '原打印提交编号不能用于其他发票命令。')
        const [prior] = await tx.select<Row>('SELECT * FROM invoice_command_receipts WHERE command_id=?', [request.commandId])
        if (prior) {
          if (prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId)
            fail('forbidden', '原发票提交不属于当前身份。')
          if (prior.fingerprint !== fingerprint || typeof prior.invoice_id !== 'string')
            fail('conflict', '原发票提交编号不能用于不同内容。')
          if (workbook && !(await tx.select('SELECT r.command_id FROM invoice_import_workbook_rows r JOIN invoice_import_workbooks w ON w.id=r.workbook_id WHERE r.command_id=? AND r.invoice_id=? AND w.sha256=?', [request.commandId, prior.invoice_id, workbook.sha256])).length)
            fail('conflict', '原提交没有此工作簿正文绑定，不能事后补造。')
          return parsedReceipt(prior.result_json, request.commandId, prior.invoice_id)
        }
        if (await correctionCommandOccupied(tx, request.commandId))
          fail('conflict', '该编号属于更正单，请按更正单核对。')
        if (['edit-archived', 'import-replace', 'link-contract'].includes(request.action))
          fail('conflict', '已归档发票须通过独立更正单修改；该流程尚未开放，请保留原票并稍后处理。')
        if (request.action === 'import') {
          const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'invoices\'')
          if (![1, 2, 3, 4, 5].includes(participant?.schema_version ?? 0))
            fail('unavailable', '发票来源版本不可用。')
          if (participant?.schema_version === 5 && (!workbook || !actor.capabilities.includes('finance-invoice:import')))
            fail('forbidden', '导入发票需要导入权限和原工作簿正文。')
          if (participant?.schema_version !== 5 && workbook)
            fail('unavailable', '当前发票存储尚不支持工作簿原件。')
        }
        if (request.action === 'upload' && !(('ownerKind' in request && request.ownerKind === 'company' && request.projectId === null) || (typeof request.projectId === 'string' && idPattern.test(request.projectId))))
          fail('validation-failed', '上传发票前请选择真实项目。')
        if (['archive', 'import', 'import-replace'].includes(request.action) && (!('taxNumbersConfirmed' in request) || request.taxNumbersConfirmed !== true || !('taxVerification' in request) || !request.taxVerification))
          fail('validation-failed', '归档前请对照原件及真实主体资料确认购销双方税号。')
        if ((request.action === 'archive' || request.action === 'import' || request.action === 'import-replace') && !request.supplierId)
          fail('validation-failed', '归档前请手动选择已有分供方公司。')
        const now = new Date().toISOString()
        let invoiceId: string
        let originalId: string | null
        let version: number
        let before: CentralInvoiceRecord | null = null
        let recognition: { fields: CentralInvoiceFields, items: CentralInvoiceItem[], source: 'local' | 'cloud', textPages: string[], unrecognizedPageIndexes: number[] } | null = null
        let recognitionIntermediate: CentralInvoiceRecord | null = null
        let verification: VerificationEvidence | null = null
        let archiveEvidence: unknown = null
        let imported: CentralInvoiceCommand & { action: 'import' | 'import-replace' } | null = null
        if (request.action === 'upload') {
          await ensureArchiveReferences(tx, actor, request.projectId, null)
          const { file, bytes, sha256 } = originalInput(request.original)
          invoiceId = randomUUID()
          originalId = randomUUID()
          version = 1
          await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'invoice\',?,?,?,?,\'invoice-original\',?,?)', [originalId, invoiceId, file.fileName, file.fileSize, file.mimeType, actor.actorId, now])
          await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [originalId, bytes, sha256])
          await tx.execute('INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,owner_kind,project_id,original_file_id,version,created_at,updated_at) VALUES(?,\'scan\',\'pending\',\'unreviewed\',\'none\',?,?,?,1,?,?)', [invoiceId, 'ownerKind' in request ? request.ownerKind : 'project', request.projectId, originalId, now, now])
        }
        else if (request.action === 'manual') {
          invoiceId = randomUUID()
          originalId = null
          version = 1
          const fields = request.fields
          const duplicate = fields.invoiceNumber.trim() && (await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND deleted_at IS NULL LIMIT 1', [fields.invoiceNumber.trim()])).length > 0
          await tx.execute(`INSERT INTO invoices(id,source_kind,invoice_number,invoice_date,invoice_type,buyer,buyer_tax_no,seller,seller_tax_no,amount,tax_amount,total_amount,tax_rate,remark,items_json,ocr_status,review_status,account_status,dup_status,version,created_at,updated_at) VALUES(?,'manual',?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','unreviewed','none',?,1,?,?)`, [invoiceId, fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(request.items), duplicate ? 'duplicate' : 'normal', now, now])
        }
        else if (request.action === 'import') {
          invoiceId = randomUUID()
          originalId = null
          version = 1
          if ((await tx.select('SELECT invoice_id FROM invoice_import_sources WHERE file_digest=? AND sheet_name=? AND row_number=?', [request.source.fileDigest, request.source.sheetName, request.source.rowNumber])).length)
            fail('conflict', '此 Excel 来源行已导入，请先核对已有发票。')
          await ensureArchiveFields(tx, invoiceId, request.fields)
          await ensureArchiveReferences(tx, actor, request.projectId, request.supplierId)
          const taxVerification = await ensureTaxNumbersForArchive(tx, actor, request.fields, request.supplierId, request.taxVerification)
          const fields = request.fields
          await tx.execute(`INSERT INTO invoices(id,source_kind,invoice_number,invoice_date,invoice_type,buyer,buyer_tax_no,seller,seller_tax_no,amount,tax_amount,total_amount,tax_rate,remark,items_json,ocr_status,completion_method,review_status,account_status,owner_kind,project_id,supplier_id,archived_at,version,created_at,updated_at) VALUES(?,'excel',?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','manual','reviewed','archived',?,?,?,?,1,?,?)`, [invoiceId, fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(request.items), request.ownerKind, request.projectId, request.supplierId, now, now, now])
          imported = request
          archiveEvidence = { source: null, originalRecognition: [], ownerKind: request.ownerKind, projectId: request.projectId, supplierId: request.supplierId, taxNumbersConfirmed: true, taxVerification }
        }
        else {
          invoiceId = request.invoiceId
          if ((await tx.select('SELECT m.invoice_id FROM invoice_legacy_members m JOIN invoice_legacy_retirements r ON r.batch_id=m.batch_id WHERE m.invoice_id=?', [invoiceId])).length)
            fail('conflict', '此旧发票批次已恢复，保留原证据但不能再次修改。')
          before = await record(tx, invoiceId, true, actor)
          if (before.version !== request.baseVersion)
            fail('conflict', '发票版本已变化，请重新读取后再操作。')
          if ((request.action === 'discard' && before.deletedAt) || (request.action === 'restore' && !before.deletedAt))
            fail('conflict', '发票状态已变化，请重新读取。')
          if (before.accountStatus === 'archived' && !['attach-original', 'link-contract', 'confirm-legacy', 'edit-archived', 'import-replace', 'discard', 'restore', ...invoiceVerificationActions].includes(request.action))
            fail('conflict', '已归档发票只能通过归档修改、删除或恢复操作处理。')
          if (before.accountStatus !== 'archived' && request.action === 'edit-archived')
            fail('conflict', '该发票尚未归档，请使用普通编辑。')
          if (before.accountStatus !== 'archived' && request.action === 'import-replace')
            fail('conflict', '只能替换已归档的同号发票。')
          if (before.accountStatus !== 'archived' && request.action === 'link-contract')
            fail('conflict', '请先核对归属并归档，再关联合同。')
          originalId = before.original?.id ?? null
          version = Number(before.version) + 1
          if (!Number.isSafeInteger(version))
            fail('unavailable', '发票版本无法可靠递增。')
          if (request.action === RECORD_ORIGINAL_VERIFICATION || request.action === CONFIRM_ORIGINAL_VERIFICATION) {
            if (!await hasOriginalVerificationSchema(tx))
              fail('unavailable', '当前发票存储尚不支持已归档原件核验。')
            if (!matchesVerificationOriginal(before, request))
              fail('conflict', '只可核验已有同一原件的有效已归档 Excel 发票。')
            await ensureArchiveReferences(tx, actor, before.projectId, before.supplierId)
            if (before.contract)
              await verifyContract(tx, actor, before.contract, before.projectId, before.supplierId)
            if (request.action === RECORD_ORIGINAL_VERIFICATION) {
              await verifyRecognitionPages(tx, before, request.textPages.length)
              const { items, balanced: _balanced, projectHint: _projectHint, calculatedAmounts: _calculatedAmounts, ...fields }
                = parseInvoiceTextPreservingUnknowns(request.textPages.join('\n\n'))
              verification = { request, fields: invoiceFields(fields, 'validation-failed'), items: invoiceItems(items, 'validation-failed') }
            }
            else {
              await readCheckedOriginal(tx, before)
              await ensureArchiveFields(tx, invoiceId, before.fields)
              verification = await confirmVerification(tx, before, request, await readVerificationHistory(tx, invoiceId))
            }
            await tx.execute('UPDATE invoices SET version=?,updated_at=? WHERE id=?', [version, now, invoiceId])
          }
          else if (request.action === 'confirm-legacy') {
            if (before.deletedAt || before.sourceKind !== 'legacy' || before.accountStatus !== 'archived' || before.completionMethod !== 'legacy' || (before.legacy?.source === 'scan' && !before.original))
              fail('validation-failed', '请先补齐扫描发票原件并核对历史票面。')
            await ensureArchiveFields(tx, invoiceId, before.fields)
            await ensureArchiveReferences(tx, actor, before.projectId, before.supplierId)
            if (before.contract)
              await verifyContract(tx, actor, before.contract, before.projectId, before.supplierId)
            await tx.execute('UPDATE invoices SET completion_method=\'manual\',version=?,updated_at=? WHERE id=?', [version, now, invoiceId])
          }
          else if (request.action === 'link-contract') {
            if (before.deletedAt)
              fail('conflict', '已删除发票不能更改合同关联。')
            if (before.ownerKind === 'company' || request.contract?.domain === 'company')
              fail('conflict', '公司开销合同在归档时确定，更正须走独立更正流程。')
            if (canonical(before.contract) === canonical(request.contract))
              fail('conflict', '合同关联没有变化。')
            await ensureNoFinancialReferences(tx, invoiceId)
            if (request.contract)
              await verifyContract(tx, actor, request.contract, before.projectId, before.supplierId)
            await tx.execute('UPDATE invoices SET contract_domain=?,contract_id=?,contract_version=?,version=?,updated_at=? WHERE id=?', [request.contract?.domain ?? null, request.contract?.id ?? null, request.contract?.version ?? null, version, now, invoiceId])
          }
          else if (request.action === 'attach-original') {
            if (before.deletedAt || before.original || !['manual', 'excel', 'legacy'].includes(before.sourceKind))
              fail('conflict', '只有尚无原件的手工、导入或旧发票可关联原件。')
            const { file, bytes, sha256 } = originalInput(request.original)
            originalId = randomUUID()
            await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,\'invoice\',?,?,?,?,\'invoice-original\',?,?)', [originalId, invoiceId, file.fileName, file.fileSize, file.mimeType, actor.actorId, now])
            await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [originalId, bytes, sha256])
            await tx.execute('UPDATE invoices SET original_file_id=?,version=?,updated_at=? WHERE id=?', [originalId, version, now, invoiceId])
          }
          else if (request.action === 'recognize' || request.action === 'rerecognize') {
            if (request.action === 'recognize' && (before.deletedAt || before.reviewStatus !== 'unreviewed' || before.ocrStatus === 'done' || !before.original))
              fail('conflict', '仅未删除、未校对的待识别或失败发票可首次识别；重新识别须经独立确认。')
            if (request.action === 'rerecognize' && (before.deletedAt || before.ocrStatus !== 'done' || !before.original))
              fail('conflict', '仅已识别且未删除的发票可重新识别。')
            await verifyRecognitionPages(tx, before, request.textPages.length)
            const fields = invoiceFields(request.fields, 'validation-failed')
            const items = invoiceItems(request.items, 'validation-failed')
            const hasSignal = Boolean(fields.invoiceNumber.trim() || fields.buyer.trim() || fields.seller.trim() || fields.totalAmount !== null || items.length)
            const complete = hasSignal && request.unrecognizedPageIndexes.length === 0
            if (request.action === 'rerecognize' && !complete)
              fail('validation-failed', '重新识别未完成，保留原有数据，请重试或放弃。')
            const duplicate = fields.invoiceNumber.trim() && (await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND id<>? AND deleted_at IS NULL LIMIT 1', [fields.invoiceNumber.trim(), invoiceId])).length > 0
            await tx.execute(`UPDATE invoices SET invoice_number=?,invoice_date=?,invoice_type=?,buyer=?,buyer_tax_no=?,seller=?,seller_tax_no=?,amount=?,tax_amount=?,total_amount=?,tax_rate=?,remark=?,items_json=?,unrecognized_pages_json=?,ocr_status=?,completion_method=?,review_status='unreviewed',dup_status=?,version=?,updated_at=? WHERE id=?`, [fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(items), JSON.stringify(request.unrecognizedPageIndexes), complete ? 'done' : 'failed', complete ? 'ocr' : null, duplicate ? 'duplicate' : 'normal', version, now, invoiceId])
            recognition = { fields, items, source: request.source, textPages: [...request.textPages], unrecognizedPageIndexes: [...request.unrecognizedPageIndexes] }
            if (request.action === 'rerecognize' && (canonical(fields) !== canonical(request.currentFields) || canonical(items) !== canonical(request.currentItems))) {
              recognitionIntermediate = await record(tx, invoiceId, true, actor)
              const current = request.currentFields
              const currentDuplicate = current.invoiceNumber.trim() && (await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND id<>? AND deleted_at IS NULL LIMIT 1', [current.invoiceNumber.trim(), invoiceId])).length > 0
              await tx.execute(`UPDATE invoices SET invoice_number=?,invoice_date=?,invoice_type=?,buyer=?,buyer_tax_no=?,seller=?,seller_tax_no=?,amount=?,tax_amount=?,total_amount=?,tax_rate=?,remark=?,items_json=?,dup_status=? WHERE id=?`, [current.invoiceNumber, current.invoiceDate, current.invoiceType, current.buyer, current.buyerTaxNo, current.seller, current.sellerTaxNo, current.amount, current.taxAmount, current.totalAmount, current.taxRate, current.remark, JSON.stringify(request.currentItems), currentDuplicate ? 'duplicate' : 'normal', invoiceId])
            }
          }
          else if (request.action === 'edit') {
            if (before.deletedAt)
              fail('not-found', '发票已删除，请先恢复再编辑。')
            const fields = invoiceFields(request.fields, 'validation-failed')
            const items = invoiceItems(request.items, 'validation-failed')
            const duplicate = fields.invoiceNumber.trim() && (await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND id<>? AND deleted_at IS NULL LIMIT 1', [fields.invoiceNumber.trim(), invoiceId])).length > 0
            await tx.execute(`UPDATE invoices SET invoice_number=?,invoice_date=?,invoice_type=?,buyer=?,buyer_tax_no=?,seller=?,seller_tax_no=?,amount=?,tax_amount=?,total_amount=?,tax_rate=?,remark=?,items_json=?,completion_method=CASE WHEN ocr_status='done' THEN 'ocr' ELSE NULL END,review_status='unreviewed',dup_status=?,version=?,updated_at=? WHERE id=?`, [fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(items), duplicate ? 'duplicate' : 'normal', version, now, invoiceId])
          }
          else if (request.action === 'review') {
            if (before.deletedAt || before.reviewStatus === 'reviewed')
              fail('conflict', '只能确认未删除、待核对的发票。')
            const manual = before.ocrStatus !== 'done'
            if (manual && (!request.manualCompletion || (before.sourceKind === 'scan' && !before.original) || !before.fields.invoiceNumber.trim() || !before.fields.invoiceDate || !before.fields.seller.trim() || before.fields.totalAmount === null || before.fields.totalAmount <= 0))
              fail('validation-failed', '识别未完成时，请核对原件、补齐票号、日期、销售方和价税合计，再明确人工补全。')
            if (!manual && request.manualCompletion)
              fail('validation-failed', '识别完整时无需标记人工补全。')
            const duplicate = before.fields.invoiceNumber.trim() && (await tx.select('SELECT id FROM invoices WHERE trim(invoice_number)=? AND id<>? AND deleted_at IS NULL AND (account_status=\'archived\' OR dup_status<>\'duplicate\') LIMIT 1', [before.fields.invoiceNumber.trim(), invoiceId])).length > 0
            if (duplicate)
              fail('conflict', '发票号码重复，请先核对或处理副本。')
            await tx.execute(`UPDATE invoices SET review_status='reviewed',completion_method=?,dup_status='normal',version=?,updated_at=? WHERE id=?`, [manual ? 'manual' : 'ocr', version, now, invoiceId])
          }
          else if (request.action === 'archive') {
            if (before.deletedAt || before.reviewStatus !== 'reviewed' || before.completionMethod === null)
              fail('validation-failed', '请先完成原件核对和发票校对，再归档。')
            if (before.sourceKind === 'manual' && request.ownerKind === 'personal')
              fail('validation-failed', '新手工发票归档须关联真实项目或公司开销。')
            if (before.sourceKind === 'scan' && before.ownerKind === 'project' && request.ownerKind !== 'project')
              fail('validation-failed', '已选择项目的上传发票须按项目归档。')
            if (before.ownerKind === 'company' && request.ownerKind !== 'company')
              fail('validation-failed', '公司开销草稿须按公司开销归档。')
            if (request.ownerKind === 'company' && before.ownerKind !== 'company' && !(before.sourceKind === 'manual' && before.ownerKind === null))
              fail('validation-failed', '公司开销须在上传前选择。')
            await ensureArchiveFields(tx, invoiceId, before.fields)
            await ensureArchiveReferences(tx, actor, request.projectId, request.supplierId)
            const taxVerification = await ensureTaxNumbersForArchive(tx, actor, before.fields, request.supplierId, request.taxVerification)
            const contract = request.contract ?? before.contract
            if (request.ownerKind === 'company') {
              if (!contract)
                fail('validation-failed', '公司开销发票必须关联已有公司支出合同。')
              await verifyInvoiceCompanyArchiveReference(tx, actor, contract, request.supplierId, taxVerification.buyer.id)
            }
            else if (contract) {
              if (contract.domain === 'company')
                fail('validation-failed', '项目或个人发票不能关联公司开销合同。')
              const actual = await verifyContract(tx, actor, contract, request.projectId, request.supplierId)
              assertInvoiceContractBuyer(actor, actual, taxVerification.buyer.id)
            }
            const originalRecognition = await archiveProvenance(tx, invoiceId)
            archiveEvidence = { source: before, originalRecognition, ownerKind: request.ownerKind, projectId: request.projectId, supplierId: request.supplierId, taxNumbersConfirmed: true, taxVerification }
            await tx.execute(`UPDATE invoices SET account_status='archived',owner_kind=?,project_id=?,supplier_id=?,contract_domain=?,contract_id=?,contract_version=?,archived_at=?,dup_status='normal',version=?,updated_at=? WHERE id=?`, [request.ownerKind, request.projectId, request.supplierId, contract?.domain ?? null, contract?.id ?? null, contract?.version ?? null, now, version, now, invoiceId])
          }
          else if (request.action === 'edit-archived' || request.action === 'import-replace') {
            if (before.ownerKind === 'company')
              fail('conflict', '公司开销发票须走独立更正流程。')
            if (before.deletedAt || before.reviewStatus !== 'reviewed' || before.completionMethod === null)
              fail('conflict', '已删除或未完成核对的发票不能按归档状态修改。')
            const fields = invoiceFields(request.fields, 'validation-failed')
            const items = invoiceItems(request.items, 'validation-failed')
            if (request.action === 'import-replace') {
              if (!before.fields.invoiceNumber.trim() || before.fields.invoiceNumber.trim() !== fields.invoiceNumber.trim())
                fail('validation-failed', '替换时须核对与已有记录一致的发票号码。')
              if ((await tx.select('SELECT invoice_id FROM invoice_import_sources WHERE file_digest=? AND sheet_name=? AND row_number=?', [request.source.fileDigest, request.source.sheetName, request.source.rowNumber])).length)
                fail('conflict', '此 Excel 来源行已处理，请先核对已有发票。')
              imported = request
            }
            await ensureNoFinancialReferences(tx, invoiceId)
            await ensureArchiveFields(tx, invoiceId, fields)
            await ensureArchiveReferences(tx, actor, request.projectId, request.supplierId)
            const taxVerification = request.action === 'import-replace' ? await ensureTaxNumbersForArchive(tx, actor, fields, request.supplierId, request.taxVerification) : null
            if (before.contract)
              await verifyContract(tx, actor, before.contract, request.projectId, request.supplierId)
            const originalRecognition = await archiveProvenance(tx, invoiceId)
            archiveEvidence = { source: before, current: { fields, items }, originalRecognition, ownerKind: request.ownerKind, projectId: request.projectId, supplierId: request.supplierId, ...(taxVerification ? { taxNumbersConfirmed: true, taxVerification } : {}) }
            await tx.execute(`UPDATE invoices SET invoice_number=?,invoice_date=?,invoice_type=?,buyer=?,buyer_tax_no=?,seller=?,seller_tax_no=?,amount=?,tax_amount=?,total_amount=?,tax_rate=?,remark=?,items_json=?,owner_kind=?,project_id=?,supplier_id=?,dup_status='normal',version=?,updated_at=? WHERE id=?`, [fields.invoiceNumber, fields.invoiceDate, fields.invoiceType, fields.buyer, fields.buyerTaxNo, fields.seller, fields.sellerTaxNo, fields.amount, fields.taxAmount, fields.totalAmount, fields.taxRate, fields.remark, JSON.stringify(items), request.ownerKind, request.projectId, request.supplierId, version, now, invoiceId])
          }
          else {
            if (before.accountStatus === 'archived') {
              await ensureNoFinancialReferences(tx, invoiceId)
              if (request.action === 'restore') {
                await ensureArchiveFields(tx, invoiceId, before.fields)
                await ensureArchiveReferences(tx, actor, before.projectId, before.supplierId)
                if (before.contract)
                  await verifyContract(tx, actor, before.contract, before.projectId, before.supplierId)
              }
            }
            await tx.execute('UPDATE invoices SET deleted_at=?,version=?,updated_at=? WHERE id=?', [request.action === 'discard' ? now : null, version, now, invoiceId])
          }
        }
        const result: CentralInvoiceCommandResult = { invoiceId, commandId: request.commandId, version: String(version), updatedAt: now, originalId, ...(verification ? { verificationSha256: digest(canonical(verification)) } : {}) }
        const receiptAction = request.action === 'import' && workbook ? 'import-workbook' : request.action
        await tx.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, invoiceId, receiptAction, fingerprint, JSON.stringify(result), now])
        if (imported)
          await tx.execute('INSERT INTO invoice_import_sources VALUES(?,?,?,?,?,?)', [request.commandId, invoiceId, imported.source.fileDigest, imported.source.sheetName, imported.source.rowNumber, JSON.stringify(imported.source)])
        if (imported && workbook)
          await bindInvoiceWorkbook(tx, { workbook, source: imported.source, mapping: workbookMapping, commandId: request.commandId, invoiceId, kind: 'import', actorId: actor.actorId, now })
        if (recognition)
          await tx.execute('INSERT INTO invoice_recognitions VALUES(?,?,?,?,?,?)', [randomUUID(), invoiceId, request.commandId, actor.actorId, JSON.stringify(recognition), now])
        if (verification)
          await tx.execute('INSERT INTO invoice_original_verifications VALUES(?,?,?,?,?,?)', [request.commandId, invoiceId, version, originalId, 'candidateId' in verification.request ? verification.request.candidateId : null, JSON.stringify(verification)])
        if (archiveEvidence)
          await tx.execute('INSERT INTO invoice_archive_evidence VALUES(?,?,?,?,?,?)', [randomUUID(), invoiceId, request.commandId, actor.actorId, JSON.stringify(archiveEvidence), now])
        const after = await record(tx, invoiceId, true, actor)
        if (recognitionIntermediate)
          await tx.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), invoiceId, request.commandId, actor.actorId, request.action, before ? JSON.stringify(before) : null, JSON.stringify(recognitionIntermediate), now])
        await tx.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), invoiceId, request.commandId, actor.actorId, recognitionIntermediate ? 'edit' : receiptAction, recognitionIntermediate ? JSON.stringify(recognitionIntermediate) : before ? JSON.stringify(before) : null, JSON.stringify(after), now])
        await tx.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
        return result
      })
    },
    async recordPrinted(value: unknown, session: Session): Promise<CentralInvoicePrintResult> {
      const request = printCommand(value)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          fail('forbidden', '打印命令身份与当前可信会话不一致。')
        const fingerprint = digest(canonical(request))
        if ((await tx.select('SELECT command_id FROM invoice_command_resolutions WHERE command_id=?', [request.commandId])).length)
          fail('conflict', '原提交已封存为未应用，迟到打印请求不能写入。')
        if ((await tx.select('SELECT command_id FROM invoice_command_receipts WHERE command_id=?', [request.commandId])).length)
          fail('conflict', '原发票提交编号不能用于打印命令。')
        const [prior] = await tx.select<Row>('SELECT * FROM invoice_print_receipts WHERE command_id=?', [request.commandId])
        if (prior) {
          if (prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId)
            fail('forbidden', '原打印提交不属于当前身份。')
          if (prior.fingerprint !== fingerprint)
            fail('conflict', '原打印提交编号不能用于不同内容。')
          return parsedPrintReceipt(prior.result_json, request.commandId)
        }
        if (await correctionCommandOccupied(tx, request.commandId))
          fail('conflict', '该编号属于更正单，不能用于打印。')
        const verificationEnabled = await hasOriginalVerificationSchema(tx)
        const before: Array<{ invoice: CentralInvoiceRecord, verificationId: string | null }> = []
        for (const target of request.targets) {
          const invoice = await record(tx, target.invoiceId, false, actor)
          if (invoice.version !== target.baseVersion)
            fail('conflict', '打印列表中发票版本已变化，请重新核对整批。')
          const requiresVerification = invoice.sourceKind === 'excel'
          const verificationId = requiresVerification && verificationEnabled && invoice.original
            ? currentVerificationId(invoice, await readVerificationHistory(tx, invoice.id)) ?? null
            : null
          if (!hasPrintableCentralOriginal(invoice.sourceKind, invoice.original) || (requiresVerification ? !verificationId : invoice.ocrStatus !== 'done') || invoice.reviewStatus !== 'reviewed' || invoice.duplicateStatus !== 'normal'
            || invoice.fields.totalAmount === null || invoice.fields.totalAmount <= 0) {
            fail('validation-failed', '打印列表包含缺少可打印原件、未完成识别、未核对、重复或缺少有效金额的发票。')
          }
          if (!Number.isSafeInteger(Number(invoice.version) + 1) || !Number.isSafeInteger(invoice.printCount + 1))
            fail('unavailable', '发票版本或打印次数无法可靠递增。')
          await verifyPrintOriginal(tx, invoice)
          if (verificationId)
            await ensureArchiveFields(tx, invoice.id, invoice.fields)
          before.push({ invoice, verificationId })
        }
        const now = new Date().toISOString()
        const records: CentralInvoicePrintResult['records'] = []
        for (const [index, target] of request.targets.entries()) {
          const { invoice: original, verificationId } = before[index]!
          const nextVersion = String(Number(original.version) + 1)
          await tx.execute('UPDATE invoices SET print_count=print_count+1,print_rotation=?,version=?,updated_at=? WHERE id=?', [target.rotation, Number(nextVersion), now, target.invoiceId])
          const after = await record(tx, target.invoiceId, false, actor)
          records.push({ invoiceId: target.invoiceId, version: nextVersion, printCount: after.printCount, printRotation: after.printRotation })
          const values = [request.commandId, target.invoiceId, actor.actorId, JSON.stringify(original), JSON.stringify(after), now]
          if (verificationEnabled)
            await tx.execute('INSERT INTO invoice_print_lines VALUES(?,?,?,?,?,?,?)', [...values, verificationId])
          else
            await tx.execute('INSERT INTO invoice_print_lines VALUES(?,?,?,?,?,?)', values)
        }
        const result = { commandId: request.commandId, updatedAt: now, records }
        await tx.execute('INSERT INTO invoice_print_receipts VALUES(?,?,?,?,?,?)', [request.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(result), now])
        await tx.execute('UPDATE invoice_revision SET revision=revision+1 WHERE singleton=1')
        return result
      })
    },
    resolvePrinted(commandId: string, session: Session) {
      if (!idPattern.test(commandId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '原打印提交编号无效。'))
      return run(session, true, async (tx, actor) => {
        const [prior] = await tx.select<Row>('SELECT * FROM invoice_print_receipts WHERE command_id=?', [commandId])
        if (prior) {
          if (prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId)
            fail('forbidden', '原打印提交不属于当前身份。')
          return { outcome: 'applied' as const, result: parsedPrintReceipt(prior.result_json, commandId) }
        }
        if (await correctionCommandOccupied(tx, commandId))
          fail('conflict', '该编号属于更正单，请按更正单核对。')
        if ((await tx.select('SELECT command_id FROM invoice_command_receipts WHERE command_id=?', [commandId])).length)
          fail('conflict', '原编号属于其他发票命令。')
        const [sealed] = await tx.select<Row>('SELECT * FROM invoice_command_resolutions WHERE command_id=?', [commandId])
        if (sealed && (sealed.workspace_id !== actor.workspaceId || sealed.actor_id !== actor.actorId))
          fail('forbidden', '原打印核对不属于当前身份。')
        if (!sealed)
          await tx.execute('INSERT INTO invoice_command_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
    resolve(commandId: string, session: Session) {
      if (!idPattern.test(commandId))
        return Promise.reject(new CentralInvoiceProblem('validation-failed', '原提交编号无效。'))
      return run(session, true, async (tx, actor) => {
        if ((await tx.select('SELECT command_id FROM invoice_print_receipts WHERE command_id=?', [commandId])).length)
          fail('conflict', '原编号属于打印任务，请按打印任务核对。')
        const [prior] = await tx.select<Row>('SELECT * FROM invoice_command_receipts WHERE command_id=?', [commandId])
        if (prior) {
          if (prior.workspace_id !== actor.workspaceId || prior.actor_id !== actor.actorId || typeof prior.invoice_id !== 'string')
            fail('forbidden', '原提交不属于当前身份。')
          if (prior.action === 'correct')
            fail('conflict', '该编号属于更正单，请按更正单核对。')
          return { outcome: 'applied' as const, result: parsedReceipt(prior.result_json, commandId, prior.invoice_id) }
        }
        if (await correctionCommandOccupied(tx, commandId))
          fail('conflict', '该编号属于更正单，请按更正单核对。')
        const [sealed] = await tx.select<Row>('SELECT * FROM invoice_command_resolutions WHERE command_id=?', [commandId])
        if (sealed && (sealed.workspace_id !== actor.workspaceId || sealed.actor_id !== actor.actorId))
          fail('forbidden', '原提交核对不属于当前身份。')
        if (!sealed)
          await tx.execute('INSERT INTO invoice_command_resolutions VALUES(?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
  }
}
