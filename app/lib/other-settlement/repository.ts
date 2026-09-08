import type { OtherSettlementCommand, OtherSettlementContext, OtherSettlementDetail, OtherSettlementDTO, OtherSettlementPage, OtherSettlementSourceDocument } from './contract'
import { auxiliaryProblem } from '../auxiliary-contract/contract'
import { auxiliaryProblemFromUnknown } from '../auxiliary-contract/repository'
import { isCoreMigrationMoney } from '../migration/core-contract'
import { OTHER_SETTLEMENT_AMOUNT_LABELS } from './contract'

export type OtherSettlementFetcher = (url: string, options?: {
  method?: 'POST'
  body?: OtherSettlementCommand
  query?: Record<string, unknown>
}) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw auxiliaryProblem('internal-error', '结算服务返回无效数据')
}
function dto(value: unknown): asserts value is OtherSettlementDTO {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.version !== 'string' || value.dataOrigin !== 'real' || !object(value.draft) || value.draft.id !== value.id || !object(value.amounts) || !object(value.audit))
    invalid()
  const amounts = value.amounts
  if (!Object.keys(OTHER_SETTLEMENT_AMOUNT_LABELS).every(key => amounts[key] === null || isCoreMigrationMoney(amounts[key])))
    invalid()
  for (const key of ['project', 'supplier', 'contract']) {
    const ref = value[key]
    if (!object(ref) || ref.entity !== key || !['resolved', 'missing', 'forbidden'].includes(String(ref.state)))
      invalid()
    if (ref.state === 'resolved' && (typeof ref.id !== 'string' || ref.id !== value.draft[`${key}Id`] || typeof ref.label !== 'string'))
      invalid()
  }
  if (!object(value.navigation) || value.navigation.kind !== 'entity-detail' || value.navigation.variant !== 'other_settlement' || !object(value.navigation.subject) || value.navigation.subject.entity !== 'settlement' || value.navigation.subject.id !== value.id || value.navigation.subject.state !== 'resolved' || !object(value.navigation.filters) || value.navigation.filters.dataOrigin !== 'real')
    invalid()
}
export function createOtherSettlementRepository(fetcher: OtherSettlementFetcher) {
  async function read<T>(url: string, options: Parameters<OtherSettlementFetcher>[1], decode: (value: unknown) => T): Promise<T> {
    try {
      return decode(await fetcher(url, options))
    }
    catch (cause) {
      throw auxiliaryProblemFromUnknown(cause)
    }
  }
  return {
    source: (id: string, factId: string) => read(`/api/read/other-settlements/${encodeURIComponent(id)}/source`, { query: { factId } }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || !value.id || !['penalty', 'application', 'payment'].includes(String(value.kind)) || typeof value.name !== 'string' || typeof value.status !== 'string' || !(value.amount === null || isCoreMigrationMoney(value.amount)) || !Array.isArray(value.fields) || !value.fields.every(f => object(f) && typeof f.label === 'string' && (f.value === null || typeof f.value === 'string')) || !Array.isArray(value.allocations) || !value.allocations.every(a => object(a) && typeof a.id === 'string' && (a.targetId === null || typeof a.targetId === 'string') && ['application', 'settlement'].includes(String(a.kind)) && typeof a.effective === 'boolean' && (a.amount === null || isCoreMigrationMoney(a.amount))) || !Array.isArray(value.files) || !value.files.every(f => object(f) && typeof f.id === 'string' && typeof f.fileName === 'string' && Number.isSafeInteger(f.fileSize)))
        return invalid()
      return value as unknown as OtherSettlementSourceDocument
    }),
    list: (query: Record<string, unknown>) => read('/api/read/other-settlements', { query }, (value) => {
      if (!object(value) || !Array.isArray(value.items) || !object(value.pagination) || !object(value.summary) || !Array.isArray(value.projectOptions) || !Array.isArray(value.capabilities))
        return invalid()
      value.items.forEach(dto)
      if (!['total', 'page', 'pageSize'].every(key => Number.isSafeInteger((value.pagination as Record<string, unknown>)[key])) || !Number.isSafeInteger(value.summary.count) || !(value.summary.amount === null || isCoreMigrationMoney(value.summary.amount)))
        invalid()
      return value as unknown as OtherSettlementPage
    }),
    detail: (id: string, query: Record<string, unknown>) => read(`/api/read/other-settlements/${encodeURIComponent(id)}`, { query }, (value) => {
      if (!object(value) || !Array.isArray(value.attachments) || !Array.isArray(value.capabilities) || !(value.facts === null || Array.isArray(value.facts)))
        return invalid()
      dto(value.settlement)
      if (value.settlement.id !== id || (query.origin && query.origin !== value.settlement.dataOrigin))
        invalid()
      if (!value.attachments.every(f => object(f) && f.ownerId === id && f.ownerType === 'expenditure_settlement' && typeof f.id === 'string' && typeof f.fileName === 'string' && Number.isSafeInteger(f.fileSize) && f.filePath === ''))
        invalid()
      const draft = value.settlement.draft
      if (Array.isArray(value.facts) && !value.facts.every(f => object(f) && f.settlementId === id && f.contractId === draft.contractId && f.projectId === draft.projectId && f.supplierId === draft.supplierId && typeof f.id === 'string' && typeof f.sourceId === 'string' && ['penalty', 'application', 'payment'].includes(String(f.kind)) && ['exact', 'unknown'].includes(String(f.attribution)) && typeof f.effective === 'boolean' && (f.amount === null || isCoreMigrationMoney(f.amount))))
        invalid()
      return value as unknown as OtherSettlementDetail
    }),
    context: () => read('/api/read/other-settlements/context', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.suppliers) || !Array.isArray(value.contracts))
        return invalid()
      if (![...value.projects, ...value.suppliers].every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string') || !value.contracts.every(row => object(row) && row.kind === 'other_expense' && typeof row.id === 'string' && typeof row.projectId === 'string' && typeof row.supplierId === 'string' && !['draft', '草稿'].includes(String(row.status))))
        invalid()
      return value as unknown as OtherSettlementContext
    }),
    execute: (body: OtherSettlementCommand) => read('/api/commands/other-settlements', { method: 'POST', body }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || typeof value.version !== 'string' || value.commandId !== body.commandId)
        return invalid()
      return value as {
        id: string
        version: string
        commandId: string
      }
    }),
  }
}
