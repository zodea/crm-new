import type { DataOriginDTO } from '../../types/read-model'
import type { SupplierCredentialCommand, SupplierCredentialCommandResult, SupplierCredentialFile, SupplierCredentialFileContent, SupplierCredentialFileQuery, SupplierCredentialRepository, SupplierCredentialSnapshot } from './credential-contract'
import { problemFromHttpFailure } from '../read-model/problem'
import { credentialProblem, SupplierCredentialNotAppliedProblem } from './credential-contract'
import { CREDENTIAL_MASTER_FIELDS } from './credential-domain'
import { CREDENTIAL_OCR_FIELD_KEYS } from './credential-ocr'
import { SUPPLIER_CREDENTIAL_CATEGORIES } from './credentials'
import { SupplierRepositoryProblem } from './read-contract'

export interface SupplierCredentialFetchOptions {
  method?: 'POST'
  body?: SupplierCredentialCommand
  query?: Record<string, unknown>
  signal?: AbortSignal
}
export type SupplierCredentialFetcher = (url: string, options?: SupplierCredentialFetchOptions) => Promise<unknown>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string {
  return typeof value === 'string'
}
function nullableText(value: unknown) {
  return value === null || text(value)
}
function nullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function category(value: unknown) {
  return text(value) && (SUPPLIER_CREDENTIAL_CATEGORIES as readonly string[]).includes(value)
}
function invalid(): never {
  throw credentialProblem('unavailable', '证照服务响应不完整或归属不匹配，请重新读取')
}
function file(value: unknown, credentialId: string): asserts value is SupplierCredentialFile {
  if (!object(value) || !text(value.id) || !value.id || !text(value.fileName) || !text(value.mimeType)
    || !Number.isSafeInteger(value.fileSize) || (value.fileSize as number) < 0
    || value.ownerType !== 'supplier_credential' || value.ownerId !== credentialId
    || !['available', 'missing'].includes(String(value.state))) {
    invalid()
  }
}
function recognition(value: unknown, fileId: unknown) {
  if (!object(value) || !text(value.id) || !value.id || value.fileId !== fileId || !text(value.sha256) || !/^[a-f\d]{64}$/i.test(value.sha256)
    || !text(value.recognizedAt) || ![undefined, true, false].includes(value.historical as never) || !object(value.result) || !object(value.parsed)) {
    invalid()
  }
  const parsed = value.parsed
  if (!text(parsed.rawText) || typeof parsed.longTerm !== 'boolean' || !object(parsed.category) || !category(parsed.category.category)
    || typeof parsed.category.confidence !== 'number' || !Number.isFinite(parsed.category.confidence) || parsed.category.confidence < 0 || parsed.category.confidence > 1
    || !Array.isArray(parsed.category.evidence) || !parsed.category.evidence.every(text) || !Array.isArray(parsed.fields)) {
    invalid()
  }
  const ids = new Set<string>()
  for (const candidate of parsed.fields) {
    if (!object(candidate) || !text(candidate.id) || !candidate.id || ids.has(candidate.id)
      || !(CREDENTIAL_OCR_FIELD_KEYS as readonly string[]).includes(String(candidate.key))
      || !text(candidate.label) || !text(candidate.value) || !text(candidate.sourceLabel)
      || typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      invalid()
    }
    ids.add(candidate.id)
  }
}
function decodeSnapshot(value: unknown, supplierId: string, origin: DataOriginDTO): SupplierCredentialSnapshot {
  if (!object(value) || value.supplierId !== supplierId || value.dataOrigin !== origin
    || !['supplierName', 'supplierVersion', 'credentialVersion', 'workspaceId', 'actorId', 'asOf', 'businessDate'].every(key => text(value[key]) && value[key])
    || !Array.isArray(value.capabilities) || !value.capabilities.every(text)
    || !['incomplete', 'reviewing', 'qualified', 'rejected'].includes(String(value.status))
    || !Array.isArray(value.credentials) || !Array.isArray(value.requirements) || !Array.isArray(value.audits)) {
    invalid()
  }
  if (value.reviewCurrent !== undefined && (typeof value.reviewCurrent !== 'boolean' || (value.reviewCurrent && (!object(value.review) || value.review.decision !== value.status))))
    invalid()
  if (value.reviewHistory !== undefined && !Array.isArray(value.reviewHistory))
    invalid()
  for (const proof of [value.review, ...(Array.isArray(value.reviewHistory) ? value.reviewHistory : [])]) {
    if (proof !== null && (!object(proof) || !['qualified', 'rejected'].includes(String(proof.decision))
      || !text(proof.reviewedAt) || !Number.isFinite(Date.parse(proof.reviewedAt)) || !nullableText(proof.actorId) || !text(proof.note)
      || (proof.decision === 'rejected' && !proof.note.trim())
      || (proof.historyIdentity !== undefined && (!object(proof.historyIdentity) || !text(proof.historyIdentity.id) || !proof.historyIdentity.id
        || !text(proof.historyIdentity.legacyId) || !proof.historyIdentity.legacyId || !text(proof.historyIdentity.archivedAt) || !Number.isFinite(Date.parse(proof.historyIdentity.archivedAt)))))) {
      invalid()
    }
  }
  if (value.masterValues !== undefined && (origin !== 'real' || !value.capabilities.includes('supplier:write') || !object(value.masterValues)
    || Object.entries(value.masterValues).some(([key, entry]) => !(CREDENTIAL_MASTER_FIELDS as readonly string[]).includes(key) || !text(entry)))) {
    invalid()
  }
  const ids = new Set<string>()
  const fileIds = new Set<string>()
  for (const row of value.credentials) {
    if (!object(row) || !text(row.id) || !row.id || ids.has(row.id) || row.supplierId !== supplierId || !category(row.category)
      || !['validFrom', 'expiresAt', 'legacyFilePath'].every(key => text(row[key])) || typeof row.longTerm !== 'boolean'
      || !['ocrConfirmedAt', 'verifiedAt', 'addedAt', 'updatedAt'].every(key => nullableText(row[key]))
      || !['not_started', 'pending', 'confirmed'].includes(String(row.ocrReviewStatus))
      || !nullableNumber(row.ocrConfidence) || !object(row.ocrResult) || !object(row.ocrConfirmedResult)) {
      invalid()
    }
    ids.add(row.id)
    if (row.validity !== undefined && (!object(row.validity) || row.validity.businessDate !== value.businessDate
      || !['expired', 'expiring', 'valid', 'unrecorded'].includes(String(row.validity.state))
      || !['long-term', 'invalid-date', 'missing-date', 'expired', 'within-seven-days', 'outside-warning-window'].includes(String(row.validity.reason)))) {
      invalid()
    }
    if (row.file !== null) {
      file(row.file, row.id)
      if (fileIds.has(row.file.id))
        invalid()
      fileIds.add(row.file.id)
    }
    if (row.recognition !== undefined && row.recognition !== null)
      recognition(row.recognition, object(row.file) ? row.file.id : null)
  }
  const categories = new Set<string>()
  for (const row of value.requirements) {
    if (!object(row) || !category(row.category) || categories.has(String(row.category)) || !nullableText(row.id)
      || !['required', 'optional', 'not_applicable'].includes(String(row.requirement)) || !text(row.reason) || !nullableText(row.updatedAt)) {
      invalid()
    }
    categories.add(String(row.category))
  }
  if (categories.size !== SUPPLIER_CREDENTIAL_CATEGORIES.length)
    invalid()
  const auditIds = new Set<string>()
  for (const row of value.audits) {
    if (!object(row) || !text(row.id) || !row.id || auditIds.has(row.id) || !nullableText(row.credentialId)
      || !['action', 'categoryBefore', 'categoryAfter', 'validFromBefore', 'validFromAfter', 'expiresAtBefore', 'expiresAtAfter', 'createdAt'].every(key => text(row[key]))
      || !['actorId', 'deletionToken'].every(key => nullableText(row[key]))
      || ![row.longTermBefore, row.longTermAfter].every(value => value === null || typeof value === 'boolean')
      || !Array.isArray(row.changedFields) || !row.changedFields.every(text) || !nullableNumber(row.confidence)
      || typeof row.canRestore !== 'boolean' || (row.canRestore && (!row.credentialId || !row.deletionToken))) {
      invalid()
    }
    auditIds.add(row.id)
  }
  return structuredClone(value) as unknown as SupplierCredentialSnapshot
}

export function credentialContentBytes(content: SupplierCredentialFileContent): Uint8Array {
  if (content.state !== 'available')
    throw credentialProblem('not-found', '此证照未保存原件正文，请重新上传')
  return Uint8Array.from(atob(content.payloadBase64), character => character.charCodeAt(0))
}

function failure(cause: unknown, command?: SupplierCredentialCommand): Error {
  if (cause instanceof SupplierRepositoryProblem || (cause instanceof Error && cause.name === 'AbortError'))
    return cause
  const response = object(cause) && object(cause.response) ? cause.response : null
  const body = response?._data ?? (object(cause) ? cause.data : null)
  const problem = object(body) && object(body.data) ? body.data : body
  const remote = problemFromHttpFailure(cause)
  if (remote && !['unauthenticated', 'forbidden'].includes(remote.code) && object(problem) && command && ['ocr-recognize', 'ocr-confirm'].includes(command.action) && problem.commandId === command.commandId && problem.commandOutcome === 'not-applied'
    && ['unavailable', 'conflict', 'not-found', 'validation-failed'].includes(String(problem.code)) && text(problem.message) && typeof problem.retryable === 'boolean' && object(problem.fieldErrors) && nullableText(problem.traceId)) {
    return new SupplierCredentialNotAppliedProblem(command.commandId, problem.message, problem.code as 'unavailable' | 'conflict' | 'not-found' | 'validation-failed')
  }
  if (remote)
    return new SupplierRepositoryProblem(remote, { cause })
  return credentialProblem('unavailable', '证照服务暂时不可用，请保留输入并重试')
}

export function createSupplierCredentialRepository(fetcher: SupplierCredentialFetcher): SupplierCredentialRepository {
  function originQuery(origin: DataOriginDTO) {
    return { origin, ...(origin === 'demo' ? { includeDemo: true } : {}) }
  }
  async function request<T>(url: string, options: SupplierCredentialFetchOptions, decode: (value: unknown) => T | Promise<T>): Promise<T> {
    try {
      options.signal?.throwIfAborted()
      const value = await fetcher(url, options)
      options.signal?.throwIfAborted()
      const result = await decode(value)
      options.signal?.throwIfAborted()
      return result
    }
    catch (cause) { throw failure(cause, options.body) }
  }
  return {
    read: (supplierId, origin, options) => request(`/api/read/supplier-credentials/${encodeURIComponent(supplierId)}`, { ...options, query: originQuery(origin) }, value => decodeSnapshot(value, supplierId, origin)),
    execute: command => request('/api/commands/supplier-credentials', { method: 'POST', body: command }, (value): SupplierCredentialCommandResult => {
      if (!object(value) || value.commandId !== command.commandId || value.supplierId !== command.supplierId
        || !['credentialId', 'auditId', 'deletionToken'].every(key => nullableText(value[key]))
        || !['supplierVersion', 'credentialVersion'].every(key => text(value[key]) && value[key])
        || ('credentialId' in command && value.credentialId !== command.credentialId)) {
        invalid()
      }
      return structuredClone(value) as unknown as SupplierCredentialCommandResult
    }),
    file: (query: SupplierCredentialFileQuery, options) => request(`/api/read/supplier-credentials/${encodeURIComponent(query.supplierId)}/files/${encodeURIComponent(query.fileId)}`, { ...options, query: { ...originQuery(query.origin), credentialId: query.credentialId } }, async (value): Promise<SupplierCredentialFileContent> => {
      file(value, query.credentialId)
      if (!object(value) || value.id !== query.fileId || value.fileId !== query.fileId || value.supplierId !== query.supplierId || value.credentialId !== query.credentialId || value.origin !== query.origin)
        invalid()
      if (value.state === 'missing') {
        if (value.reason !== 'missing-payload')
          invalid()
        return structuredClone(value) as unknown as SupplierCredentialFileContent
      }
      if (!text(value.payloadBase64) || !text(value.sha256) || !/^[a-f\d]{64}$/i.test(value.sha256)
        || value.fileSize > 20 * 1024 * 1024 || !['application/pdf', 'image/png', 'image/jpeg'].includes(value.mimeType)) {
        invalid()
      }
      const content = value as unknown as SupplierCredentialFileContent
      let bytes: Uint8Array
      try {
        bytes = credentialContentBytes(content)
      }
      catch { invalid() }
      if (bytes.length !== value.fileSize)
        invalid()
      const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
      if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== value.sha256.toLowerCase())
        invalid()
      return structuredClone(content)
    }),
  }
}
