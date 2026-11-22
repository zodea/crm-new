import type { PaginationDTO, ReadMetaDTO } from '../../types/read-model'
import type { CentralInvoiceCommand, CentralInvoiceCommandResult, CentralInvoiceFields, CentralInvoiceImportSource, CentralInvoiceItem, CentralInvoicePrintCommand, CentralInvoicePrintResult, CentralInvoiceRecord, InvoiceOriginalVerificationRead } from './central-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO, READ_PAGE_SIZES } from '../read-model/pagination'
import { CentralInvoiceProblem, CONFIRM_ORIGINAL_VERIFICATION, INVOICE_ORIGINAL_MAX_BYTES, INVOICE_READ_CAPABILITY, RECORD_ORIGINAL_VERIFICATION } from './central-contract'

interface Identity { workspaceId: string, actorId: string }
type Fetcher = (url: string, options?: { method?: 'GET' | 'POST', query?: Record<string, unknown>, body?: unknown }) => Promise<unknown>
interface ReadEvidence { dataOrigin: 'real', meta: ReadMetaDTO, asOf: string, sourceVersion: string, capabilities: string[] }
export type InvoiceListRead = ReadEvidence & { items: CentralInvoiceRecord[], pagination: PaginationDTO }
export type InvoiceDetailRead = ReadEvidence & { record: CentralInvoiceRecord, verification?: InvoiceOriginalVerificationRead }
export type InvoiceResolution = { outcome: 'applied', result: CentralInvoiceCommandResult } | { outcome: 'not-applied', commandId: string }
export type InvoicePrintResolution = { outcome: 'applied', result: CentralInvoicePrintResult } | { outcome: 'not-applied', commandId: string }
export type InvoiceImportPreview = ReadEvidence & { candidates: Array<{ record: CentralInvoiceRecord, matchedBy: Array<'source-row' | 'invoice-number'>, differences: Array<keyof CentralInvoiceFields>, itemsDiffer: boolean }> }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
const optionalNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000)
const nullableId = (value: unknown) => value === null || id(value)
const member = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value)
const contractCapabilities: Record<string, string> = { construction: 'construction-contract:read', subcontract: 'subcontract-contract:read', material: 'material-contract:read', auxiliary: 'auxiliary-contract:read', company: 'auxiliary-contract:read' }
function validContract(value: unknown) {
  return value === null || (object(value) && Object.keys(value).sort().join(',') === 'domain,id,version' && typeof value.domain === 'string'
    && Object.hasOwn(contractCapabilities, value.domain) && id(value.id) && version(value.version))
}
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (object(value))
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function invalid(): never {
  throw new CentralInvoiceProblem('unavailable', '中央发票读取或回执不完整，请保留原提交编号并重试核对。')
}

function receipt(value: unknown, commandId: string, target?: string): CentralInvoiceCommandResult {
  if (!object(value) || !['commandId,invoiceId,originalId,updatedAt,version', 'commandId,invoiceId,originalId,updatedAt,verificationSha256,version'].includes(Object.keys(value).sort().join(','))
    || value.commandId !== commandId || !id(value.invoiceId) || (target !== undefined && value.invoiceId !== target)
    || !version(value.version) || !isISODateTimeDTO(value.updatedAt) || !nullableId(value.originalId)
    || ('verificationSha256' in value && (typeof value.verificationSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.verificationSha256) || !id(value.originalId)))) {
    return invalid()
  }
  return value as unknown as CentralInvoiceCommandResult
}

function printReceipt(value: unknown, commandId: string, targets?: CentralInvoicePrintCommand['targets']): CentralInvoicePrintResult {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'commandId,records,updatedAt' || value.commandId !== commandId
    || !isISODateTimeDTO(value.updatedAt) || !Array.isArray(value.records) || !value.records.length || value.records.length > 1000
    || (targets !== undefined && targets.length !== value.records.length)) {
    return invalid()
  }
  const ids = new Set<string>()
  for (const [index, item] of value.records.entries()) {
    if (!object(item) || Object.keys(item).sort().join(',') !== 'invoiceId,printCount,printRotation,version' || !id(item.invoiceId)
      || ids.has(item.invoiceId) || !version(item.version) || typeof item.printCount !== 'number' || !Number.isSafeInteger(item.printCount) || item.printCount < 1
      || typeof item.printRotation !== 'number' || ![0, 90, 180, 270].includes(item.printRotation)) {
      return invalid()
    }
    const target = targets?.[index]
    if (target && (item.invoiceId !== target.invoiceId || Number(item.version) !== Number(target.baseVersion) + 1 || item.printRotation !== target.rotation))
      return invalid()
    ids.add(item.invoiceId)
  }
  return value as unknown as CentralInvoicePrintResult
}

function record(value: unknown): value is CentralInvoiceRecord {
  if (!object(value) || !object(value.fields))
    return false
  const fields = value.fields
  if (!id(value.id) || !version(value.version) || !member(value.sourceKind, ['scan', 'manual', 'excel', 'legacy'])
    || !['invoiceNumber', 'invoiceDate', 'invoiceType', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'].every(key => typeof fields[key] === 'string')
    || !['amount', 'taxAmount', 'totalAmount'].every(key => optionalNumber(fields[key]))
    || (fields.invoiceDate !== '' && !isISODateDTO(fields.invoiceDate)) || !Array.isArray(value.items) || value.items.length > 2000
    || value.items.some(item => !object(item) || !['name', 'spec', 'unit', 'taxRate'].every(key => typeof item[key] === 'string') || !['quantity', 'unitPrice', 'amount', 'taxAmount'].every(key => optionalNumber(item[key])))
    || !Array.isArray(value.unrecognizedPageIndexes) || value.unrecognizedPageIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= 10) || new Set(value.unrecognizedPageIndexes).size !== value.unrecognizedPageIndexes.length
    || !member(value.ocrStatus, ['pending', 'failed', 'done']) || !(value.completionMethod === null || member(value.completionMethod, ['ocr', 'manual', 'legacy']))
    || !member(value.reviewStatus, ['unreviewed', 'reviewed']) || !member(value.accountStatus, ['none', 'archived']) || !member(value.duplicateStatus, ['normal', 'duplicate'])
    || typeof value.printCount !== 'number' || !Number.isSafeInteger(value.printCount) || value.printCount < 0
    || typeof value.printRotation !== 'number' || ![0, 90, 180, 270].includes(value.printRotation)
    || !(value.ownerKind === null || value.ownerKind === 'project' || value.ownerKind === 'personal' || value.ownerKind === 'company') || !nullableId(value.projectId) || !nullableId(value.supplierId)
    || !validContract(value.contract)
    || (value.ownerKind === 'project' ? value.projectId === null : value.projectId !== null)
    || (value.ownerKind === 'company' && ((value.contract !== null && (!object(value.contract) || value.contract.domain !== 'company')) || (value.accountStatus === 'archived' && (value.contract === null || value.supplierId === null))))
    || (object(value.contract) && value.contract.domain === 'company' && value.ownerKind !== 'company')
    || !isISODateTimeDTO(value.createdAt) || !isISODateTimeDTO(value.updatedAt) || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt)) || !(value.archivedAt === null || isISODateTimeDTO(value.archivedAt))
    || (value.ocrStatus === 'done' && value.unrecognizedPageIndexes.length > 0) || (value.completionMethod === 'ocr' && value.ocrStatus !== 'done')
    || (value.reviewStatus === 'reviewed' && value.completionMethod === null) || (['manual', 'legacy'].includes(String(value.completionMethod)) && value.reviewStatus !== 'reviewed')
    || (value.completionMethod === 'legacy' && value.sourceKind !== 'legacy')
    || (value.accountStatus === 'archived' && (value.reviewStatus !== 'reviewed' || value.ownerKind === null || value.archivedAt === null))
    || (value.accountStatus === 'none' && value.archivedAt !== null)) {
    return false
  }
  if (value.sourceKind === 'legacy') {
    if (!object(value.legacy) || !member(value.legacy.source, ['scan', 'excel']) || !member(value.legacy.originalState, ['recorded', 'legacy-path-unverified', 'session-original-unavailable', 'no-original-recorded'])
      || typeof value.legacy.ambiguousItemNumbers !== 'boolean' || !Array.isArray(value.legacy.ambiguousZeroFields) || value.legacy.ambiguousZeroFields.some(field => !['amount', 'tax_amount', 'total_amount'].includes(field))
      || new Set(value.legacy.ambiguousZeroFields).size !== value.legacy.ambiguousZeroFields.length) {
      return false
    }
  }
  else if (value.legacy !== undefined) {
    return false
  }
  if ('originalVerificationId' in value && (!id(value.originalVerificationId) || value.sourceKind !== 'excel' || value.accountStatus !== 'archived' || !object(value.original) || value.deletedAt !== null))
    return false
  if (value.original === null)
    return value.sourceKind === 'manual' || value.sourceKind === 'excel' || value.sourceKind === 'legacy'
  return object(value.original) && id(value.original.id) && typeof value.original.fileName === 'string' && !!value.original.fileName.trim()
    && Number.isSafeInteger(value.original.fileSize) && Number(value.original.fileSize) > 0 && typeof value.original.mimeType === 'string'
    && typeof value.original.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.original.sha256)
}

export { record as isCentralInvoiceRecord }

function verificationRead(value: unknown): value is InvoiceOriginalVerificationRead {
  const fieldValue = (input: unknown) => typeof input === 'string' || optionalNumber(input)
  return object(value) && id(value.candidateId) && member(value.source, ['local', 'cloud'])
    && member(value.state, ['incomplete', 'different', 'ready', 'confirmed', 'stale'])
    && Array.isArray(value.unrecognizedPageIndexes) && value.unrecognizedPageIndexes.every(index => Number.isInteger(index) && index >= 0 && index < 10)
    && Array.isArray(value.rows) && value.rows.length >= 9 && value.rows.length <= 16_012
    && value.rows.every(row => object(row) && typeof row.path === 'string' && fieldValue(row.archived) && fieldValue(row.recognized) && member(row.result, ['match', 'missing', 'different']))
}

function referencesReadable(record: CentralInvoiceRecord, capabilities: string[]) {
  return (!record.projectId || capabilities.includes('project:list:read')) && (!record.supplierId || capabilities.includes('supplier:list:read'))
    && (!record.contract || capabilities.includes(contractCapabilities[record.contract.domain]!))
}

function evidence(value: unknown, identity: Identity): value is ReadEvidence & Record<string, unknown> {
  if (!object(value) || value.dataOrigin !== 'real' || !hasConsistentReadMeta(value, 'invoice-read-v1', 'real') || !object(value.meta))
    return false
  const meta = value.meta as unknown as ReadMetaDTO
  return meta.workspaceId === identity.workspaceId && meta.actorId === identity.actorId && meta.authorizedScope.coverage === 'complete'
    && meta.capabilities.includes(INVOICE_READ_CAPABILITY) && meta.sources.length === 1 && meta.sources[0]?.key === 'invoices'
    && meta.sources[0].state === 'readable' && /^invoices:\d+$/.test(meta.sources[0].sourceVersion ?? '') && typeof value.sourceVersion === 'string'
    && Number.isSafeInteger(Number(meta.sources[0].sourceVersion!.slice('invoices:'.length)))
}

/** 已保存与已回读分开；调用方须保留 commandId 直至原提交和同一身份回读均完成。 */
export function createCentralInvoiceHttp(fetcher: Fetcher, authority: Identity, binaryFetch: typeof fetch = fetch) {
  const identity = { workspaceId: authority.workspaceId, actorId: authority.actorId }
  const repository = {
    async list(query: { page: number, pageSize: number, deleted?: boolean }): Promise<InvoiceListRead> {
      if (!Number.isSafeInteger(query.page) || query.page < 1 || !READ_PAGE_SIZES.includes(query.pageSize as typeof READ_PAGE_SIZES[number]))
        return invalid()
      const result = await fetcher('/api/read/invoices', { query: { page: query.page, pageSize: query.pageSize, deleted: query.deleted ? 'true' : 'false' } })
      if (!evidence(result, identity) || !Array.isArray(result.items) || !result.items.every(record)
        || !isPaginationDTO(result.pagination, result.items.length) || result.pagination.requestedPage !== query.page || result.pagination.pageSize !== query.pageSize
        || result.items.some(item => Boolean(item.deletedAt) !== Boolean(query.deleted) || !referencesReadable(item, result.capabilities))) {
        return invalid()
      }
      return { ...result, items: result.items as CentralInvoiceRecord[], pagination: result.pagination }
    },
    async get(invoiceId: string, deleted = false): Promise<InvoiceDetailRead> {
      if (!id(invoiceId))
        return invalid()
      const result = await fetcher(`/api/read/invoices/${encodeURIComponent(invoiceId)}`, { query: { deleted: deleted ? 'true' : 'false' } })
      if (!evidence(result, identity) || !record(result.record) || result.record.id !== invoiceId || !referencesReadable(result.record, result.capabilities) || (!deleted && result.record.deletedAt !== null))
        return invalid()
      const verification = result.verification
      if (verification !== undefined && (!verificationRead(verification) || result.record.sourceKind !== 'excel' || !result.record.original || result.record.deletedAt !== null
        || (verification.state === 'confirmed') !== !!result.record.originalVerificationId)) {
        return invalid()
      }
      return { ...result, record: result.record, ...(verification ? { verification } : {}) }
    },
    async previewImport(input: { fields: CentralInvoiceFields, items: CentralInvoiceItem[], source: CentralInvoiceImportSource }): Promise<InvoiceImportPreview> {
      const result = await fetcher('/api/read/invoices/import-preview', { method: 'POST', body: input })
      if (!evidence(result, identity) || !Array.isArray(result.candidates))
        return invalid()
      const seen = new Set<string>()
      for (const candidate of result.candidates) {
        if (!object(candidate) || !record(candidate.record) || seen.has(candidate.record.id) || !referencesReadable(candidate.record, result.capabilities) || !Array.isArray(candidate.matchedBy) || !candidate.matchedBy.length
          || candidate.matchedBy.some((key: unknown) => key !== 'source-row' && key !== 'invoice-number') || new Set(candidate.matchedBy).size !== candidate.matchedBy.length
          || (candidate.matchedBy.includes('invoice-number') && candidate.record.fields.invoiceNumber.trim() !== input.fields.invoiceNumber.trim())
          || !Array.isArray(candidate.differences) || typeof candidate.itemsDiffer !== 'boolean') {
          return invalid()
        }
        const existing = candidate.record
        const differences = Object.keys(input.fields).filter(key => canonical(input.fields[key as keyof CentralInvoiceFields]) !== canonical(existing.fields[key as keyof CentralInvoiceFields]))
        if (canonical(candidate.differences) !== canonical(differences) || candidate.itemsDiffer !== (canonical(input.items) !== canonical(existing.items)))
          return invalid()
        seen.add(candidate.record.id)
      }
      return result as unknown as InvoiceImportPreview
    },
    async execute(command: CentralInvoiceCommand) {
      if (command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || !id(command.commandId))
        return invalid()
      const result = await fetcher('/api/commands/invoices', { method: 'POST', body: command })
      const response = receipt(result, command.commandId, 'invoiceId' in command ? command.invoiceId : undefined)
      if ((command.action === RECORD_ORIGINAL_VERIFICATION || command.action === CONFIRM_ORIGINAL_VERIFICATION)
        && (!response.verificationSha256 || response.originalId !== command.originalId)) {
        return invalid()
      }
      return response
    },
    async resolve(commandId: string): Promise<InvoiceResolution> {
      if (!id(commandId))
        return invalid()
      const result = await fetcher('/api/commands/invoices/resolve', { method: 'POST', body: { commandId } })
      if (!object(result))
        return invalid()
      if (result.outcome === 'not-applied' && result.commandId === commandId && Object.keys(result).sort().join(',') === 'commandId,outcome')
        return { outcome: 'not-applied', commandId }
      if (result.outcome === 'applied' && Object.keys(result).sort().join(',') === 'outcome,result')
        return { outcome: 'applied', result: receipt(result.result, commandId) }
      return invalid()
    },
    async recordPrinted(command: CentralInvoicePrintCommand): Promise<CentralInvoicePrintResult> {
      if (command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId || !id(command.commandId))
        return invalid()
      return printReceipt(await fetcher('/api/commands/invoices/print', { method: 'POST', body: command }), command.commandId, command.targets)
    },
    async resolvePrinted(commandId: string): Promise<InvoicePrintResolution> {
      if (!id(commandId))
        return invalid()
      const result = await fetcher('/api/commands/invoices/print-resolve', { method: 'POST', body: { commandId } })
      if (!object(result))
        return invalid()
      if (result.outcome === 'not-applied' && result.commandId === commandId && Object.keys(result).sort().join(',') === 'commandId,outcome')
        return { outcome: 'not-applied', commandId }
      if (result.outcome === 'applied' && Object.keys(result).sort().join(',') === 'outcome,result')
        return { outcome: 'applied', result: printReceipt(result.result, commandId) }
      return invalid()
    },
  }
  return {
    ...repository,
    async original(invoiceId: string, expected?: { version: string, original: CentralInvoiceRecord['original'] }): Promise<Blob> {
      const before = await repository.get(invoiceId)
      const original = before.record.original
      const subtle = globalThis.crypto?.subtle
      if (!original || !subtle || (expected && (before.record.version !== expected.version || JSON.stringify(original) !== JSON.stringify(expected.original))))
        return invalid()
      const response = await binaryFetch(`/api/read/invoices/${encodeURIComponent(invoiceId)}/originals/${encodeURIComponent(original.id)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (response.status === 401 || response.status === 403)
        throw new CentralInvoiceProblem(response.status === 401 ? 'unauthenticated' : 'forbidden', '当前身份无原件读取权限，请重新核对登录状态。')
      const length = response.headers.get('Content-Length')
      if (!response.ok || response.headers.get('X-Content-SHA256') !== original.sha256
        || (length !== null && (!/^\d+$/.test(length) || Number(length) !== original.fileSize || Number(length) > INVOICE_ORIGINAL_MAX_BYTES))) {
        return invalid()
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== original.fileSize || bytes.byteLength > INVOICE_ORIGINAL_MAX_BYTES)
        return invalid()
      const hash = Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== original.sha256)
        return invalid()
      const after = await repository.get(invoiceId)
      if (after.record.version !== before.record.version || JSON.stringify(after.record.original) !== JSON.stringify(original))
        return invalid()
      return new Blob([bytes], { type: original.mimeType })
    },
  }
}
