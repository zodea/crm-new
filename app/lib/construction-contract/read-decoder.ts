import type {
  ConstructionContractDetailQueryDTO,
  ConstructionContractDetailReadDTO,
  ConstructionContractListPageDTO,
  ConstructionContractListQueryDTO,
} from './read-contract'
import { isDataOriginDTO, isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import {
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
} from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ConstructionContractRepositoryProblem(constructionContractProblem('internal-error', message))
}

function money(value: unknown): boolean {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function navigation(value: unknown): boolean {
  if (!object(value) || typeof value.kind !== 'string')
    return false
  if (value.kind === 'unavailable')
    return typeof value.reason === 'string'
  return object(value.subject) && typeof value.subject.entity === 'string'
    && (value.subject.state !== 'resolved' || typeof value.subject.id === 'string')
    && object(value.filters)
}

function fact(value: unknown): boolean {
  return object(value)
    && ['id', 'no', 'name', 'status'].every(key => typeof value[key] === 'string')
    && (value.amount === null || money(value.amount))
    && (value.date === null || isISODateDTO(value.date))
    && navigation(value.navigation)
}

function entity(value: unknown, kind: 'project' | 'customer'): boolean {
  if (!object(value) || value.entity !== kind || typeof value.state !== 'string')
    return false
  if (value.state === 'resolved')
    return typeof value.id === 'string' && typeof value.label === 'string'
  return value.state === 'missing' || value.state === 'forbidden'
}

function amounts(value: unknown): boolean {
  return object(value) && ['contract', 'changed', 'settled', 'invoiced', 'received', 'bySettlementReceivable', 'invoicedUnreceived']
    .every(key => money(value[key]))
}

export function decodeConstructionContractListPage(value: unknown): ConstructionContractListPageDTO {
  if (!object(value) || !Array.isArray(value.items) || !object(value.pagination)
    || !Number.isSafeInteger(value.pagination.page) || !Number.isSafeInteger(value.pagination.pageSize)
    || !Number.isSafeInteger(value.pagination.total) || !object(value.summary)
    || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)
    || !value.items.every((row) => {
      if (!object(row) || !isDataOriginDTO(row.dataOrigin) || row.rowKey !== `${row.dataOrigin}:${row.id}`)
        return false
      return ['id', 'no', 'name', 'status'].every(key => typeof row[key] === 'string')
        && entity(row.project, 'project') && entity(row.customer, 'customer')
        && amounts(row.amounts) && navigation(row.navigation)
        && navigation(row.projectNavigation) && navigation(row.customerNavigation)
        && (row.actualCompletionDate === null || isISODateDTO(row.actualCompletionDate))
        && (row.signDate === null || isISODateDTO(row.signDate))
        && isISODateTimeDTO(row.updatedAt)
    })) {
    return invalid('中央后台返回的施工合同列表读模型无效')
  }
  return value as unknown as ConstructionContractListPageDTO
}

export function decodeConstructionContractDetailRead(value: unknown): ConstructionContractDetailReadDTO {
  const contract = object(value) && object(value.contract) ? value.contract : null
  const sections = object(value) && object(value.sections) ? value.sections : null
  if (!object(value) || !isDataOriginDTO(value.dataOrigin) || !contract || contract.kind !== '施工'
    || contract.dataOrigin !== value.dataOrigin
    || !['id', 'no', 'name', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'warrantyTerms', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'status', 'note']
      .every(key => typeof contract[key] === 'string')
      || !entity(contract.project, 'project') || !entity(contract.customer, 'customer')
      || !amounts(contract.amounts)
      || (contract.actualCompletionDate !== null && !isISODateDTO(contract.actualCompletionDate))
      || (contract.signDate !== null && !isISODateDTO(contract.signDate))
      || !sections || !Array.isArray(sections.supplements) || !sections.supplements.every(fact)
      || !Array.isArray(sections.changes) || !sections.changes.every(fact)
      || !object(sections.settlements) || !object(sections.invoices) || !object(sections.acceptance)
      || ![sections.settlements.monthlyStatements, sections.settlements.finalSettlements, sections.settlements.penalties, sections.invoices.applications, sections.invoices.registrations, sections.receipts, sections.acceptance.acceptances, sections.acceptance.warranties]
        .every(rows => Array.isArray(rows) && rows.every(fact))
        || !Array.isArray(sections.files)
        || !navigation(value.projectNavigation) || !navigation(value.customerNavigation)
        || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)) {
    return invalid('中央后台返回的施工合同详情读模型无效')
  }
  return value as unknown as ConstructionContractDetailReadDTO
}

export function serializeConstructionContractListQuery(query: ConstructionContractListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    origin: query.origin ?? '',
    search: query.search,
    projectId: query.projectId ?? '',
    customerId: query.customerId ?? '',
    status: query.status ?? '',
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeConstructionContractDetailQuery(query: ConstructionContractDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo), focusId: query.focusId ?? '' }
}

export function constructionContractProblemFromUnknown(cause: unknown): ConstructionContractRepositoryProblem {
  if (cause instanceof ConstructionContractRepositoryProblem)
    return cause
  return new ConstructionContractRepositoryProblem(
    constructionContractProblem('unavailable', '施工合同中央服务暂时不可用，请重试', true),
    { cause },
  )
}
