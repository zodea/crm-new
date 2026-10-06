import type { DataOriginDTO } from '../../types/read-model'
import type { CommandResolution } from '../forms/command-recovery'
import type { ReceiptCommand, ReceiptCommandResult, ReceiptContext, ReceiptDetail, ReceiptFileContent, ReceiptPage, ReceiptRecord } from './contract'
import { isDataOriginDTO, isEntityRefDTO, isISODateDTO, isISODateTimeDTO, isProblemCodeDTO } from '../../types/read-model'
import { isCoreMigrationMoney } from '../migration/core-contract'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { isPaginationDTO, parsePageQuery } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { emptyReceiptDraft, receiptProblem, ReceiptRepositoryProblem } from './contract'

export type ReceiptFetcher = (url: string, options?: { method?: 'POST', body?: ReceiptCommand | { commandId: string }, query?: Record<string, unknown>, signal?: AbortSignal }) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw receiptProblem('internal-error', '收款服务响应数据无效', {}, true)
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(row => typeof row === 'string')
}
function nullableMoney(value: unknown) {
  return value === null || isCoreMigrationMoney(value)
}
export function receiptProblemFromUnknown(cause: unknown): ReceiptRepositoryProblem {
  if (cause instanceof ReceiptRepositoryProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new ReceiptRepositoryProblem(remote)
  return receiptProblem('unavailable', '收款服务暂时不可用，请重试', {}, true)
}
function record(value: unknown): asserts value is ReceiptRecord {
  if (!object(value) || !['id', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'].every(key => typeof value[key] === 'string')
    || !value.id || !isDataOriginDTO(value.dataOrigin) || !object(value.draft) || !Array.isArray(value.attachments)) {
    invalid()
  }
  const draft = value.draft
  if (!Object.keys(emptyReceiptDraft()).every(key => key === 'amount' ? nullableMoney(draft[key]) : ['projectId', 'customerId', 'contractId'].includes(key) ? draft[key] === null || typeof draft[key] === 'string' : typeof draft[key] === 'string'))
    invalid()
  if (![draft.receiptDate, draft.billDueDate].every(date => date === '' || isISODateDTO(date)))
    invalid()
  if (!value.attachments.every(file => object(file) && file.ownerId === value.id && file.ownerType === 'receipt_registration'
    && ['id', 'fileName', 'filePath', 'mimeType', 'category', 'uploader', 'uploadedAt'].every(key => typeof file[key] === 'string')
    && file.filePath === '' && Number.isSafeInteger(file.fileSize) && Number(file.fileSize) >= 0 && (file.deletedAt === null || typeof file.deletedAt === 'string'))) {
    invalid()
  }
}
function detail(value: unknown): asserts value is ReceiptDetail {
  if (!object(value) || !hasConsistentReadMeta(value, 'receipt-read-v2') || !object(value.amounts) || !strings(value.capabilities) || typeof value.asOf !== 'string' || !(value.sourceVersion === null || typeof value.sourceVersion === 'string'))
    invalid()
  record(value.record)
  if (!isReadMetaDTO(value.meta) || value.meta.dataOrigin !== value.record.dataOrigin)
    invalid()
  if (value.category !== null || value.receiptType !== null)
    invalid()
  for (const [key, entity] of [['project', 'project'], ['customer', 'customer'], ['contract', 'contract']] as const) {
    const ref = value[key]
    if (!isEntityRefDTO(ref, entity))
      invalid()
    if (ref.state === 'resolved' && (ref.id !== value.record.draft[`${key}Id`] || typeof ref.label !== 'string'))
      invalid()
    if (ref.state !== 'resolved' && (ref.label !== null || ref.id !== null))
      invalid()
    if (['forbidden', 'unavailable'].includes(ref.state) && value.record.draft[`${key}Id`] !== null)
      invalid()
  }
  if (value.contractProblem !== undefined && (!object(value.contractProblem) || !isProblemCodeDTO(value.contractProblem.code) || typeof value.contractProblem.message !== 'string'))
    invalid()
  if (!['contractOriginal', 'contractChange', 'contract', 'cumulativeReceipt', 'cumulativeReceiptExcludingCurrent', 'invoicedUnreceived'].every(key => nullableMoney((value.amounts as Record<string, unknown>)[key]))
    || !(value.amounts.receiptRatio === null || typeof value.amounts.receiptRatio === 'string')) {
    invalid()
  }
}
export function createReceiptRepository(fetcher: ReceiptFetcher) {
  async function request<T>(url: string, options: Parameters<ReceiptFetcher>[1], decode: (value: unknown) => T | Promise<T>): Promise<T> {
    try {
      return await decode(await fetcher(url, options))
    }
    catch (cause) { throw receiptProblemFromUnknown(cause) }
  }
  return {
    detail: (id: string, query: { origin: DataOriginDTO, includeDemo?: boolean }) => request(`/api/read/receipts/${encodeURIComponent(id)}/record`, { query }, (value) => {
      detail(value)
      if (value.record.id !== id || value.record.dataOrigin !== query.origin)
        invalid()
      return value
    }),
    list: (query: Record<string, unknown>) => request('/api/read/receipts', { query }, (value) => {
      const acceptsOrigin = (origin: DataOriginDTO) => (!query.origin || query.origin === origin)
        && (origin === 'real' || query.includeDemo === true || query.includeDemo === 'true')
      const { requestedPage, pageSize } = parsePageQuery(query, () => {
        throw receiptProblem('invalid-query', '收款分页参数无效')
      })
      if (!object(value) || !hasConsistentOriginReadMeta(value, 'receipt-read-v2') || !Array.isArray(value.items) || !object(value.pagination) || !object(value.summary) || !Array.isArray(value.projectOptions) || !strings(value.capabilities))
        invalid()
      value.items.forEach(detail)
      if (!isReadMetaDTO(value.meta))
        invalid()
      const meta = value.meta
      if (!(value.items as ReceiptDetail[]).every(row => acceptsOrigin(row.record.dataOrigin) && row.meta.dataOrigin === row.record.dataOrigin && row.meta.workspaceId === meta.workspaceId && row.meta.actorId === meta.actorId))
        invalid()
      if (!isPaginationDTO(value.pagination, value.items.length) || value.pagination.requestedPage !== requestedPage || value.pagination.pageSize !== pageSize || !object(value.summary.origins)
        || !['real', 'demo'].every((origin) => {
          const summary = (value.summary as Record<string, unknown>).origins as Record<string, unknown>
          const row = summary[origin]
          return object(row) && Number.isSafeInteger(row.count) && Number(row.count) >= 0 && nullableMoney(row.effectiveAmount)
            && (acceptsOrigin(origin as DataOriginDTO) || (row.count === 0 && row.effectiveAmount === '0.00'))
        })
        || !value.projectOptions.every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && isDataOriginDTO(row.dataOrigin) && acceptsOrigin(row.dataOrigin))) {
        invalid()
      }
      return value as unknown as ReceiptPage
    }),
    context: () => request('/api/read/receipts/context', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !strings(value.capabilities)
        || !Array.isArray(value.projects) || !Array.isArray(value.customers) || !Array.isArray(value.contracts)) {
        invalid()
      }
      if (![...value.projects, ...value.customers, ...value.contracts].every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string')
        || !value.projects.every(row => object(row) && (row.customerId === null || typeof row.customerId === 'string'))
        || !value.contracts.every(row => object(row) && typeof row.no === 'string' && typeof row.status === 'string' && nullableMoney(row.amount) && [row.projectId, row.customerId].every(id => id === null || typeof id === 'string'))) {
        invalid()
      }
      return value as unknown as ReceiptContext
    }),
    execute: (body: ReceiptCommand) => request('/api/commands/receipts', { method: 'POST', body }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.version !== 'string' || !value.version.trim() || !isISODateTimeDTO(value.updatedAt) || value.commandId !== body.commandId || !strings(value.attachmentIds) || value.attachmentIds.some(id => !id.trim()) || (body.id && value.id !== body.id))
        invalid()
      return value as unknown as ReceiptCommandResult
    }),
    resolve: (commandId: string): Promise<CommandResolution<ReceiptCommandResult>> => request('/api/commands/receipts/resolve', { method: 'POST', body: { commandId } }, (value) => {
      if (!object(value))
        return invalid()
      if (value.outcome === 'not-applied' && value.commandId === commandId)
        return { outcome: 'not-applied', commandId }
      if (value.outcome !== 'applied' || !object(value.result))
        return invalid()
      const result = value.result
      if (result.commandId !== commandId || typeof result.id !== 'string' || !result.id
        || typeof result.version !== 'string' || !result.version.trim() || !isISODateTimeDTO(result.updatedAt) || !strings(result.attachmentIds) || result.attachmentIds.some(id => !id.trim())) {
        return invalid()
      }
      return { outcome: 'applied', result: result as unknown as ReceiptCommandResult }
    }),
    fileContent: (id: string, fileId: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => request(`/api/read/receipts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: { origin }, signal: options?.signal }, async (value) => {
      if (!object(value) || !['payloadBase64', 'mimeType', 'fileName'].every(key => typeof value[key] === 'string')
        || value.receiptId !== id || value.fileId !== fileId || value.dataOrigin !== origin
        || !Number.isSafeInteger(value.fileSize) || Number(value.fileSize) < 0
        || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
        invalid()
      }
      const payload = value.payloadBase64 as string
      if (payload.length > 20_000_000 || payload.length % 4 || !/^[A-Z0-9+/]*={0,2}$/i.test(payload))
        invalid()
      let binary: string
      try {
        binary = atob(payload)
      }
      catch { return invalid() }
      if (btoa(binary) !== payload || binary.length !== value.fileSize)
        invalid()
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== value.sha256)
        invalid()
      return value as unknown as ReceiptFileContent
    }),
  }
}
export type ReceiptRepository = ReturnType<typeof createReceiptRepository>
