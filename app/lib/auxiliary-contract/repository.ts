import type { AuxiliaryContractCommand, AuxiliaryContractDetail, AuxiliaryContractPage } from './contract'
import { isEntityRefDTO, isISODateTimeDTO } from '../../types/read-model'
import { isCoreMigrationMoney } from '../migration/core-contract'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO, parsePageQuery } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { AuxiliaryContractProblem, auxiliaryProblem } from './contract'

export interface AuxiliaryContractContext { workspaceId: string, actorId: string, capabilities: readonly string[], projects: Array<{ id: string, label: string }>, suppliers: Array<{ id: string, label: string }> }
export interface AuxiliaryContractResult { id: string, commandId: string, version: string }
export type AuxiliaryFetcher = (url: string, options?: { method?: 'POST', body?: AuxiliaryContractCommand, query?: Record<string, unknown> }) => Promise<unknown>
export function auxiliaryProblemFromUnknown(cause: unknown): AuxiliaryContractProblem {
  if (cause instanceof AuxiliaryContractProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new AuxiliaryContractProblem(remote)
  return auxiliaryProblem('unavailable', '合同服务暂时不可用，请重试')
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw auxiliaryProblem('internal-error', '合同服务返回无效数据')
}
function validateContract(value: unknown) {
  if (!object(value) || typeof value.id !== 'string' || typeof value.version !== 'string' || !object(value.draft) || !object(value.amounts)
    || !['other_expense', 'company_expense'].includes(String(value.kind)) || !['real', 'demo'].includes(String(value.dataOrigin))
    || !Object.values(value.amounts).every(amount => amount === null || isCoreMigrationMoney(amount))) {
    invalid()
  }
  const amounts = value.amounts
  if (!['contract', 'changed', 'taxExclusive', 'tax', 'invoiced', 'paid', 'settled', 'byInvoicePayable', 'bySettlementPayable'].every(key => amounts[key] === null || isCoreMigrationMoney(amounts[key])))
    invalid()
  if (!object(value.audit) || !object(value.attachmentCategories) || !Number.isSafeInteger(value.attachmentCount) || value.draft.id !== value.id || value.draft.kind !== value.kind)
    invalid()
  const audit = value.audit
  if (!['createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'responsible', 'department'].every(key => audit[key] === null || typeof audit[key] === 'string'))
    invalid()
  if (value.kind === 'company_expense' ? value.project !== null || value.supplier !== null : !object(value.project) || !object(value.supplier))
    invalid()
  for (const key of ['project', 'supplier'] as const) {
    const ref = value[key]
    if (ref === null)
      continue
    if (!isEntityRefDTO(ref, key))
      invalid()
    if (ref.state === 'resolved' && (typeof ref.id !== 'string' || typeof ref.label !== 'string' || ref.id !== value.draft[`${key}Id`]))
      invalid()
    if (['forbidden', 'unavailable'].includes(ref.state) && value.draft[`${key}Id`] !== null)
      invalid()
  }
  if (!object(value.navigation) || value.navigation.kind !== 'entity-detail' || value.navigation.variant !== value.kind
    || !object(value.navigation.subject) || value.navigation.subject.id !== value.id || value.navigation.subject.state !== 'resolved' || value.navigation.subject.entity !== 'contract'
    || !object(value.navigation.filters) || value.navigation.filters.dataOrigin !== value.dataOrigin || value.navigation.filters.contractKind !== value.kind) {
    invalid()
  }
}
export function createAuxiliaryContractRepository(fetcher: AuxiliaryFetcher) {
  async function read<T>(url: string, options: Parameters<AuxiliaryFetcher>[1], decode: (value: unknown) => T): Promise<T> {
    try {
      return decode(await fetcher(url, options))
    }
    catch (cause) {
      throw auxiliaryProblemFromUnknown(cause)
    }
  }
  return {
    list: (query: Record<string, unknown>) => read('/api/read/auxiliary-contracts', { query }, (value) => {
      const { requestedPage, pageSize } = parsePageQuery(query, () => {
        throw auxiliaryProblem('invalid-query', '合同分页参数无效')
      })
      if (!object(value) || !hasConsistentOriginReadMeta(value, 'auxiliary-contract-read-v2') || !Array.isArray(value.items) || !isPaginationDTO(value.pagination, value.items.length) || value.pagination.requestedPage !== requestedPage || value.pagination.pageSize !== pageSize || !object(value.summary) || !Array.isArray(value.capabilities) || typeof value.asOf !== 'string')
        return invalid()
      value.items.forEach(validateContract)
      if (!isISODateTimeDTO(value.asOf) || !Array.isArray(value.projectOptions) || !value.projectOptions.every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string'))
        invalid()
      if (!value.items.every(row => row.kind === query.kind && row.dataOrigin === (query.origin ?? 'real')))
        invalid()
      for (const origin of ['real', 'demo']) {
        const summary = value.summary[origin]
        if (!object(summary) || !Number.isSafeInteger(summary.count) || !(summary.amount === null || isCoreMigrationMoney(summary.amount)))
          invalid()
      }
      return value as unknown as AuxiliaryContractPage
    }),
    detail: (id: string, query: Record<string, unknown>) => read(`/api/read/auxiliary-contracts/${encodeURIComponent(id)}`, { query }, (value) => {
      if (!object(value) || !hasConsistentReadMeta(value, 'auxiliary-contract-read-v2', query.origin ?? 'real') || !object(value.contract) || value.contract.id !== id || value.contract.kind !== query.kind || (query.origin && value.contract.dataOrigin !== query.origin) || !Array.isArray(value.facts) || !Array.isArray(value.attachments) || !Array.isArray(value.capabilities))
        return invalid()
      validateContract(value.contract)
      const contract = value.contract
      if (!value.facts.every(fact => object(fact) && fact.contractId === id && fact.contractKind === contract.kind && fact.dataOrigin === contract.dataOrigin && ['invoice', 'payment', 'settlement', 'supplement'].includes(String(fact.kind)) && typeof fact.id === 'string' && typeof fact.effective === 'boolean' && (fact.amount === null || isCoreMigrationMoney(fact.amount))))
        invalid()
      if (!value.attachments.every(file => object(file) && file.ownerId === id && file.ownerType === (contract.kind === 'company_expense' ? 'company_expense_contract' : 'contract') && typeof file.id === 'string' && typeof file.fileName === 'string' && Number.isSafeInteger(file.fileSize) && file.filePath === ''))
        invalid()
      return value as unknown as AuxiliaryContractDetail
    }),
    context: () => read('/api/read/auxiliary-contracts/context', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !Array.isArray(value.capabilities) || !Array.isArray(value.projects) || !Array.isArray(value.suppliers)
        || ![...value.projects, ...value.suppliers].every(row => object(row) && typeof row.id === 'string' && typeof row.label === 'string')) {
        return invalid()
      }
      return value as unknown as AuxiliaryContractContext
    }),
    execute: (body: AuxiliaryContractCommand) => read('/api/commands/auxiliary-contracts', { method: 'POST', body }, (value) => {
      if (!object(value) || typeof value.id !== 'string' || typeof value.version !== 'string' || value.commandId !== body.commandId)
        return invalid()
      return value as unknown as AuxiliaryContractResult
    }),
  }
}
