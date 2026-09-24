import type { DataOriginDTO } from '../../types/read-model'
import type { DeliveryCentralRecord, DeliveryCommand, DeliveryCommandResult, DeliveryContext, DeliveryList, DeliveryRevision } from './contract'
import { isDataOriginDTO, isProblemCodeDTO } from '../../types/read-model'
import { ProjectRepositoryProblem } from '../project/repository'
import { deliveryProblem } from './contract'

export interface DeliveryFetchOptions { method?: 'POST', body?: DeliveryCommand, query?: Record<string, unknown>, signal?: AbortSignal }
export type DeliveryFetcher = (url: string, options?: DeliveryFetchOptions) => Promise<unknown>
export interface DeliveryFileQuery { id: string, assetId: string, origin: DataOriginDTO, projectId: string, supplierId: string | null }
export interface DeliveryOriginal { assetId: string, fileName: string, mimeType: string, fileSize: number, sha256: string, bytes: Uint8Array }

function originQuery(origin: DataOriginDTO) {
  return origin === 'demo' ? { origin, includeDemo: true } : { origin }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function active(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('送货读取已取消', 'AbortError')
}
function invalid(): never {
  throw deliveryProblem('unavailable', '送货服务响应无效，请重新读取')
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
function nullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function record(value: unknown): asserts value is DeliveryCentralRecord {
  if (!object(value) || !isDataOriginDTO(value.dataOrigin) || !value.id
    || !['id', 'version', 'uploadBatchId', 'projectId', 'projectName', 'supplierName', 'orderNo', 'deliveryDate', 'note', 'rawSiteText', 'reviewFlag', 'fileName', 'filePath', 'ocrStatus', 'printBatchId', 'printedAt', 'printExcludedAt', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'].every(key => typeof value[key] === 'string')
    || value.filePath !== '' || 'payloadBase64' in value || !/^\d+$/.test(String(value.version))
    || !['supplierId', 'assetId', 'deletedAt', 'migrationBatchId', 'legacyAudit'].every(key => value[key] === null || typeof value[key] === 'string')
    || !['hasSourceFile', 'currentValuesConfirmed', 'naturalKeyDuplicate', 'archived', 'stored'].every(key => typeof value[key] === 'boolean')
    || value.hasSourceFile !== (value.assetId !== null) || !['reviewed', 'unreviewed'].includes(String(value.reviewStatus))
    || !['pending', 'printed', 'excluded'].includes(String(value.printDisposition)) || typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || !Array.isArray(value.lines)) {
    invalid()
  }
  const ids = new Set<string>()
  for (const line of value.lines) {
    if (!object(line) || !line.id || typeof line.id !== 'string' || ids.has(line.id) || line.deliveryRecordId !== value.id
      || !['materialName', 'spec', 'unit', 'note'].every(key => typeof line[key] === 'string')
      || ![line.qty, line.unitPrice, line.amount].every(nullableNumber) || !['manual', 'calculated', 'ocr'].includes(String(line.amountSource))
      || typeof line.currentValueConfirmed !== 'boolean' || !Number.isSafeInteger(line.sortOrder)) {
      invalid()
    }
    ids.add(line.id)
  }
}
function failure(cause: unknown): Error {
  if (cause instanceof ProjectRepositoryProblem || (cause instanceof Error && cause.name === 'AbortError'))
    return cause
  const raw = object(cause) && object(cause.data) ? (object(cause.data.data) ? cause.data.data : cause.data) : null
  if (raw && isProblemCodeDTO(raw.code) && typeof raw.message === 'string')
    return deliveryProblem(raw.code, raw.message)
  return deliveryProblem('unavailable', '送货中央服务暂时不可用，请重试')
}
function invalidOriginal(): never {
  throw deliveryProblem('unavailable', '送货原件身份、正文或摘要校验失败')
}

export function createDeliveryRepository(fetcher: DeliveryFetcher) {
  async function request<T>(url: string, options: DeliveryFetchOptions | undefined, decode: (value: unknown) => T | Promise<T>): Promise<T> {
    try {
      active(options?.signal)
      const value = await fetcher(url, options)
      active(options?.signal)
      return await decode(value)
    }
    catch (cause) { throw failure(cause) }
  }
  return {
    context: (origin: DataOriginDTO = 'real', options?: { signal?: AbortSignal }) => request('/api/read/deliveries/context', { ...options, query: originQuery(origin) }, (value): DeliveryContext => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !strings(value.capabilities)
        || ![value.projects, value.suppliers].every(rows => Array.isArray(rows) && rows.every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && row.dataOrigin === origin && (row.aliases === undefined || strings(row.aliases))))) {
        invalid()
      }
      return value as unknown as DeliveryContext
    }),
    list: (origin: DataOriginDTO = 'real', options?: { signal?: AbortSignal }) => request('/api/read/deliveries', { ...options, query: originQuery(origin) }, (value): DeliveryList => {
      if (!object(value) || !Array.isArray(value.records) || typeof value.sourceVersion !== 'string' || !strings(value.capabilities))
        invalid()
      for (const row of value.records) {
        record(row)
        if (row.dataOrigin !== origin)
          invalid()
      }
      return value as unknown as DeliveryList
    }),
    detail: (id: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => request(`/api/read/deliveries/${encodeURIComponent(id)}/record`, { ...options, query: originQuery(origin) }, (value) => {
      record(value)
      if (value.id !== id || value.dataOrigin !== origin)
        invalid()
      return value
    }),
    history: (id: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => request(`/api/read/deliveries/${encodeURIComponent(id)}/history`, { ...options, query: originQuery(origin) }, (value): DeliveryRevision[] => {
      if (!Array.isArray(value))
        invalid()
      for (const revision of value) {
        if (!object(revision) || revision.recordId !== id || !['id', 'version', 'action', 'reason', 'actorId', 'createdAt'].every(key => typeof revision[key] === 'string') || !Array.isArray(revision.changes))
          invalid()
        record(revision.after)
        if (revision.after.id !== id || revision.after.dataOrigin !== origin || revision.after.version !== revision.version)
          invalid()
        if (revision.before !== null) {
          record(revision.before)
          if (revision.before.id !== id || revision.before.dataOrigin !== origin)
            invalid()
        }
      }
      return value as DeliveryRevision[]
    }),
    execute: (body: DeliveryCommand) => request('/api/commands/deliveries', { method: 'POST', body }, (value): DeliveryCommandResult => {
      if (!object(value) || !['id', 'version', 'revisionId', 'updatedAt'].every(key => typeof value[key] === 'string' && !!value[key]) || value.commandId !== body.commandId)
        invalid()
      if ('id' in body && value.id !== body.id)
        invalid()
      return value as unknown as DeliveryCommandResult
    }),
    fileContent: (query: DeliveryFileQuery, options?: { signal?: AbortSignal }) => request(`/api/read/deliveries/${encodeURIComponent(query.id)}/files/${encodeURIComponent(query.assetId)}`, { ...options, query: { ...originQuery(query.origin), projectId: query.projectId, supplierId: query.supplierId } }, async (value): Promise<DeliveryOriginal> => {
      if (!object(value) || value.recordId !== query.id || value.id !== query.assetId || value.origin !== query.origin
        || value.ownerType !== 'delivery_record' || value.projectId !== query.projectId || value.supplierId !== query.supplierId
        || typeof value.fileName !== 'string' || !value.fileName || !['application/pdf', 'image/png', 'image/jpeg'].includes(String(value.mimeType))
        || typeof value.sourceVersion !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
        || typeof value.payloadBase64 !== 'string' || value.payloadBase64.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(value.payloadBase64)
        || !Number.isSafeInteger(value.fileSize) || Number(value.fileSize) <= 0) {
        invalidOriginal()
      }
      let binary: string
      try {
        binary = atob(value.payloadBase64)
      }
      catch { return invalidOriginal() }
      if (btoa(binary) !== value.payloadBase64 || binary.length !== value.fileSize)
        invalidOriginal()
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      active(options?.signal)
      const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (sha256 !== value.sha256)
        invalidOriginal()
      return { assetId: query.assetId, fileName: value.fileName as string, fileSize: Number(value.fileSize), mimeType: value.mimeType as string, sha256, bytes }
    }),
  }
}
export type DeliveryRepository = ReturnType<typeof createDeliveryRepository>
