import type { OtherSettlementCommand, OtherSettlementContext, OtherSettlementDetail, OtherSettlementDTO, OtherSettlementPage, OtherSettlementSourceDocument } from './contract'
import { isEntityRefDTO } from '../../types/read-model'
import { auxiliaryProblem } from '../auxiliary-contract/contract'
import { auxiliaryProblemFromUnknown } from '../auxiliary-contract/repository'
import { isExpenseClearanceLink, isExpenseClearanceSourceDTO } from '../finance/clearance-verification'
import { decodeContractOriginalContent } from '../forms/original-content'
import { isCoreMigrationMoney } from '../migration/core-contract'
import { hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { OTHER_SETTLEMENT_AMOUNT_LABELS } from './contract'
import { decodeOtherSettlementResult } from './storage'

export type OtherSettlementFetcher = (url: string, options?: {
  method?: 'POST'
  body?: unknown
  query?: Record<string, unknown>
  signal?: AbortSignal
}) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw auxiliaryProblem('internal-error', '结算服务返回无效数据')
}
function attachments(value: unknown, id: string): asserts value is OtherSettlementDetail['attachments'] {
  if (!Array.isArray(value) || value.some(file => !object(file) || !file.id || typeof file.id !== 'string' || file.ownerId !== id || file.ownerType !== 'expenditure_settlement' || typeof file.fileName !== 'string' || !file.fileName || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) < 0 || file.filePath !== '' || typeof file.mimeType !== 'string' || typeof file.category !== 'string' || typeof file.uploader !== 'string' || typeof file.uploadedAt !== 'string' || !(file.deletedAt === null || typeof file.deletedAt === 'string') || !(file.sha256 === undefined || file.sha256 === null || (typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)))) || new Set(value.map(file => file.id)).size !== value.length)
    invalid()
}
function dto(value: unknown): asserts value is OtherSettlementDTO {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.version !== 'string' || value.dataOrigin !== 'real' || !object(value.draft) || value.draft.id !== value.id || !object(value.amounts) || !object(value.audit))
    invalid()
  const amounts = value.amounts
  if (value.expenseAllocations !== undefined && (!Array.isArray(value.expenseAllocations) || value.expenseAllocations.some(row => !object(row) || typeof row.id !== 'string' || !row.id || typeof row.originalExpenseLineId !== 'string' || !row.originalExpenseLineId || !(row.amount === null || (typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0)) || typeof row.sourceVersion !== 'string' || !row.sourceVersion || typeof row.sourceRevision !== 'string' || !row.sourceRevision) || new Set(value.expenseAllocations.map(row => row.id)).size !== value.expenseAllocations.length))
    invalid()
  if (value.clearanceLinks !== undefined && (!Array.isArray(value.clearanceLinks) || value.clearanceLinks.some(row => !isExpenseClearanceLink(row) || row.settlementId !== value.id) || new Set(value.clearanceLinks.map(row => row.id)).size !== value.clearanceLinks.length))
    invalid()
  if (value.qualificationUnavailableReason !== undefined && (typeof value.qualificationUnavailableReason !== 'string' || !value.qualificationUnavailableReason.trim() || amounts.net !== null || amounts.applicable !== null || amounts.unpaid !== null))
    invalid()
  if (!Object.keys(OTHER_SETTLEMENT_AMOUNT_LABELS).every(key => amounts[key] === null || isCoreMigrationMoney(amounts[key])))
    invalid()
  for (const key of ['project', 'supplier', 'contract'] as const) {
    const ref = value[key]
    if (!isEntityRefDTO(ref, key))
      invalid()
    if (ref.state === 'resolved' && (typeof ref.id !== 'string' || ref.id !== value.draft[`${key}Id`] || typeof ref.label !== 'string'))
      invalid()
    if (['forbidden', 'unavailable'].includes(ref.state) && value.draft[`${key}Id`] !== null)
      invalid()
  }
  if (!object(value.navigation) || value.navigation.kind !== 'entity-detail' || value.navigation.variant !== 'other_settlement' || !object(value.navigation.subject) || value.navigation.subject.entity !== 'settlement' || value.navigation.subject.id !== value.id || value.navigation.subject.state !== 'resolved' || !object(value.navigation.filters) || value.navigation.filters.dataOrigin !== 'real')
    invalid()
}
export function createOtherSettlementRepository(fetcher: OtherSettlementFetcher) {
  async function read<T>(url: string, options: Parameters<OtherSettlementFetcher>[1], decode: (value: unknown) => T | Promise<T>): Promise<T> {
    try {
      const value = await fetcher(url, options)
      if (options?.method !== 'POST' && !url.includes('/files/') && !hasConsistentReadMeta(value, 'other-settlement-read-v1', 'real'))
        invalid()
      return await decode(value)
    }
    catch (cause) {
      throw auxiliaryProblemFromUnknown(cause)
    }
  }
  return {
    loadForm: (id: string) => read(`/api/read/other-settlements/${encodeURIComponent(id)}`, { query: { origin: 'real', includeDeleted: 'true' } }, (value) => {
      if (!object(value) || !Array.isArray(value.attachments))
        return invalid()
      dto(value.settlement)
      if (value.settlement.id !== id || typeof value.settlement.audit.updatedAt !== 'string')
        return invalid()
      attachments(value.attachments, id)
      return { draft: { ...value.settlement.draft, id }, version: value.settlement.version, updatedAt: value.settlement.audit.updatedAt, attachments: value.attachments, expenseAllocations: value.settlement.expenseAllocations ?? [], clearanceLinks: value.settlement.clearanceLinks ?? [] }
    }),
    expenses: () => read('/api/read/other-settlements/expenses', undefined, (value) => {
      if (!object(value) || !isReadMetaDTO(value.meta, 'other-settlement-read-v1') || value.workspaceId !== value.meta.workspaceId || value.actorId !== value.meta.actorId || !Array.isArray(value.items) || !value.items.every(isExpenseClearanceSourceDTO))
        return invalid()
      return { workspaceId: String(value.workspaceId), actorId: String(value.actorId), items: value.items }
    }),
    resolve: (commandId: string) => read('/api/commands/other-settlements/resolve', { method: 'POST', body: { commandId } }, (value) => {
      if (!object(value) || Object.keys(value).length !== 2)
        return invalid()
      if (value.outcome === 'not-applied' && value.commandId === commandId)
        return { outcome: 'not-applied' as const, commandId }
      if (value.outcome === 'applied') {
        const result = decodeOtherSettlementResult(value.result)
        if (result.commandId === commandId)
          return { outcome: 'applied' as const, result }
      }
      return invalid()
    }),
    original: (id: string, fileId: string, version?: string, signal?: AbortSignal) => read(`/api/read/other-settlements/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: version ? { version } : {}, signal }, value => decodeContractOriginalContent(value, { ownerId: id, fileId, origin: 'real' }, invalid)),
    source: (id: string, factId: string) => read(`/api/read/other-settlements/${encodeURIComponent(id)}/source`, { query: { factId } }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || !value.id || !['penalty', 'application', 'payment'].includes(String(value.kind)) || typeof value.name !== 'string' || typeof value.status !== 'string' || !(value.amount === null || isCoreMigrationMoney(value.amount)) || !Array.isArray(value.fields) || !value.fields.every(f => object(f) && typeof f.label === 'string' && (f.value === null || typeof f.value === 'string')) || !Array.isArray(value.allocations) || !value.allocations.every(a => object(a) && typeof a.id === 'string' && (a.targetId === null || typeof a.targetId === 'string') && ['application', 'settlement'].includes(String(a.kind)) && typeof a.effective === 'boolean' && (a.amount === null || isCoreMigrationMoney(a.amount))) || !Array.isArray(value.files) || !value.files.every(f => object(f) && typeof f.id === 'string' && typeof f.fileName === 'string' && Number.isSafeInteger(f.fileSize)))
        return invalid()
      return value as unknown as OtherSettlementSourceDocument
    }),
    list: (query: Record<string, unknown>) => read('/api/read/other-settlements', { query }, (value) => {
      if (!object(value) || !Array.isArray(value.items) || !object(value.pagination) || !object(value.summary) || !Array.isArray(value.projectOptions) || !Array.isArray(value.capabilities))
        return invalid()
      value.items.forEach(dto)
      if (!isPaginationDTO(value.pagination, value.items.length) || !Number.isSafeInteger(value.summary.count) || !(value.summary.amount === null || isCoreMigrationMoney(value.summary.amount)))
        invalid()
      return value as unknown as OtherSettlementPage
    }),
    detail: (id: string, query: Record<string, unknown>) => read(`/api/read/other-settlements/${encodeURIComponent(id)}`, { query }, (value) => {
      if (!object(value) || !Array.isArray(value.attachments) || !Array.isArray(value.capabilities) || !(value.facts === null || Array.isArray(value.facts)))
        return invalid()
      dto(value.settlement)
      if (value.settlement.id !== id || (query.origin && query.origin !== value.settlement.dataOrigin))
        invalid()
      attachments(value.attachments, id)
      const actualAttachments = value.attachments
      if (value.history !== undefined) {
        if (!Array.isArray(value.history) || value.history.length !== Number(value.settlement.version) || value.history.some((row, index) => !object(row) || row.version !== String(index + 1) || !object(row.record) || row.record.id !== id || row.record.version !== index + 1 || typeof row.commandId !== 'string' || !row.commandId || !(row.actorId === null || typeof row.actorId === 'string') || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))))
          invalid()
        for (const row of value.history) {
          attachments(row.record.attachments, id)
          if (row.record.attachments.some((file: OtherSettlementDetail['attachments'][number]) => !actualAttachments.some(actual => actual.id === file.id && actual.sha256 === file.sha256)))
            invalid()
        }
      }
      if (value.sourceHistory !== undefined && (!Array.isArray(value.sourceHistory) || value.sourceHistory.some(row => !object(row) || typeof row.sourceBytesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceBytesSha256) || !object(row.rawHead) || row.rawHead.id !== id || !Array.isArray(row.history) || !Array.isArray(row.commands) || !Array.isArray(row.audit) || (row.retained !== undefined && (!object(row.retained) || Object.entries(row.retained).some(([key, lines]) => !['penalty_settlement_deductions', 'penalty_records', 'payment_application_settlement_allocations'].includes(key) || !Array.isArray(lines) || lines.some(line => !object(line) || typeof line.id !== 'string' || (key !== 'penalty_records' && line.settlement_id !== id))))))))
        invalid()
      const draft = value.settlement.draft
      if (Array.isArray(value.facts) && !value.facts.every(f => object(f) && f.settlementId === id && f.contractId === draft.contractId && f.projectId === draft.projectId && f.supplierId === draft.supplierId && typeof f.id === 'string' && typeof f.sourceId === 'string' && ['penalty', 'application', 'payment'].includes(String(f.kind)) && ['exact', 'unknown'].includes(String(f.attribution)) && typeof f.effective === 'boolean' && (f.unavailableReason === undefined || (typeof f.unavailableReason === 'string' && f.unavailableReason.length > 0)) && (f.amount === null || isCoreMigrationMoney(f.amount))))
        invalid()
      return value as unknown as OtherSettlementDetail
    }),
    context: () => read('/api/read/other-settlements/context', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.suppliers) || !Array.isArray(value.contracts))
        return invalid()
      if (![...value.projects, ...value.suppliers].every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string') || !value.contracts.every(row => object(row) && row.kind === 'other_expense' && typeof row.id === 'string' && typeof row.projectId === 'string' && typeof row.supplierId === 'string' && !['draft', '草稿'].includes(String(row.status))))
        invalid()
      if (!isReadMetaDTO(value.meta, 'other-settlement-read-v1') || value.workspaceId !== value.meta.workspaceId || value.actorId !== value.meta.actorId)
        invalid()
      return value as unknown as OtherSettlementContext
    }),
    execute: (body: OtherSettlementCommand) => read('/api/commands/other-settlements', { method: 'POST', body }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || typeof value.version !== 'string' || value.commandId !== body.commandId)
        return invalid()
      return decodeOtherSettlementResult(value)
    }),
  }
}
