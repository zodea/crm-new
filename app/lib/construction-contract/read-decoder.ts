import type {
  ConstructionContractDetailQueryDTO,
  ConstructionContractDetailReadDTO,
  ConstructionContractListPageDTO,
  ConstructionContractListQueryDTO,
} from './read-contract'
import { isDataOriginDTO, isEntityRefDTO, isISODateDTO, isISODateTimeDTO, isUnavailableEntityNavigationDTO } from '../../types/read-model'
import { serializeContractListFilter } from '../contract/list-filters'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { decodeConstructionManagementFee } from './management-fee'
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
    return Object.keys(value).length === 2 && ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target', 'error'].includes(String(value.reason))
  return isEntityRefDTO(value.subject) && value.subject.state === 'resolved'
    && object(value.filters)
}

function relationNavigation(value: unknown, reference: unknown, origin: unknown): boolean {
  if (!isEntityRefDTO(reference))
    return false
  if (reference.state !== 'resolved')
    return isUnavailableEntityNavigationDTO(value, reference)
  return object(value) && navigation(value) && value.kind === 'entity-detail'
    && value.variant === 'detail' && value.view === null
    && isEntityRefDTO(value.subject) && value.subject.state === 'resolved'
    && value.subject.entity === reference.entity && value.subject.id === reference.id
    && value.subject.label === reference.label && value.subject.no === reference.no
    && object(value.filters) && Object.keys(value.filters).length === 1 && value.filters.dataOrigin === origin
}

function fact(value: unknown): boolean {
  return object(value)
    && ['id', 'no', 'name', 'status'].every(key => typeof value[key] === 'string')
    && (value.amount === null || money(value.amount))
    && (value.date === null || isISODateDTO(value.date))
    && navigation(value.navigation)
}

function entity(value: unknown, kind: 'project' | 'customer'): boolean {
  return isEntityRefDTO(value, kind)
}

function amounts(value: unknown): boolean {
  return object(value) && ['contract', 'changed', 'settled', 'invoiced', 'received', 'bySettlementReceivable', 'invoicedUnreceived'].every(key => value[key] === null || money(value[key]))
    && (value.received !== null || (value.bySettlementReceivable === null && value.invoicedUnreceived === null))
    && (value.settled !== null || value.bySettlementReceivable === null)
    && (value.invoiced !== null || value.invoicedUnreceived === null)
}

function summary(value: unknown, items: unknown[], total: number): boolean {
  if (!object(value) || !object(value.origins)
    || !['projects', 'customers'].every(key => Array.isArray(value[key]) && value[key].every(row => object(row) && typeof row.id === 'string' && row.id.length > 0 && typeof row.label === 'string'))
    || !['statuses'].every(key => Array.isArray(value[key]) && value[key].every(row => object(row) && typeof row.value === 'string' && Number.isSafeInteger(row.count) && Number(row.count) >= 0))) {
    return false
  }
  const fields = ['changedAmount', 'invoicedAmount', 'receivedAmount']
  const rowFields = ['changed', 'invoiced', 'received']
  let count = 0
  for (const origin of ['real', 'demo']) {
    const originSummary = value.origins[origin]
    if (!object(originSummary) || !Number.isSafeInteger(originSummary.contractCount) || Number(originSummary.contractCount) < 0
      || !fields.every(key => originSummary[key] === null || money(originSummary[key]))) {
      return false
    }
    const rows = items.filter(row => object(row) && row.dataOrigin === origin)
    if (rows.length > Number(originSummary.contractCount)
      || fields.some((key, index) => rows.some(row => object(row) && object(row.amounts) && row.amounts[rowFields[index]!] === null) && originSummary[key] !== null)) {
      return false
    }
    count += Number(originSummary.contractCount)
  }
  return count === total
}

export function decodeConstructionContractListPage(value: unknown, expected?: ConstructionContractListQueryDTO): ConstructionContractListPageDTO {
  if (!object(value) || !hasConsistentOriginReadMeta(value, 'construction-contract-read-v2') || !Array.isArray(value.items) || !object(value.pagination)
    || !isPaginationDTO(value.pagination, value.items.length)
    || (expected !== undefined && (value.pagination.requestedPage !== expected.page || value.pagination.pageSize !== expected.pageSize
      || value.items.some(row => !object(row) || (!expected.includeDemo && row.dataOrigin === 'demo') || (expected.origin !== null && row.dataOrigin !== expected.origin))))
    || !Number.isSafeInteger(value.pagination.total) || !summary(value.summary, value.items, value.pagination.total as number)
    || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)
    || !value.items.every((row) => {
      if (!object(row) || !isDataOriginDTO(row.dataOrigin) || row.rowKey !== `${row.dataOrigin}:${row.id}`)
        return false
      return ['id', 'no', 'name', 'status'].every(key => typeof row[key] === 'string')
        && entity(row.project, 'project') && entity(row.customer, 'customer')
        && amounts(row.amounts) && navigation(row.navigation)
        && relationNavigation(row.projectNavigation, row.project, row.dataOrigin) && relationNavigation(row.customerNavigation, row.customer, row.dataOrigin)
        && (row.actualCompletionDate === null || isISODateDTO(row.actualCompletionDate))
        && (row.signDate === null || isISODateDTO(row.signDate))
        && isISODateTimeDTO(row.updatedAt)
    })) {
    return invalid('中央后台返回的施工合同列表读模型无效')
  }
  return value as unknown as ConstructionContractListPageDTO
}

function validSignatory(value: unknown): boolean {
  if (value === null)
    return true
  try {
    decodeOurSignatorySnapshot(value)
    return true
  }
  catch {
    return false
  }
}

function validManagementFee(value: unknown): boolean {
  try {
    decodeConstructionManagementFee(value)
    return true
  }
  catch { return false }
}

export function decodeConstructionContractDetailRead(value: unknown, expected?: ConstructionContractDetailQueryDTO): ConstructionContractDetailReadDTO {
  const contract = object(value) && object(value.contract) ? value.contract : null
  const sections = object(value) && object(value.sections) ? value.sections : null
  if (object(value) && value.receiptsProblem !== undefined && (!object(value.receiptsProblem)
    || !['forbidden', 'unavailable'].includes(String(value.receiptsProblem.code)) || typeof value.receiptsProblem.message !== 'string'
    || typeof value.receiptsProblem.retryable !== 'boolean' || !Array.isArray(sections?.receipts) || sections.receipts.length !== 0
    || !object(contract?.amounts) || contract.amounts.received !== null)) {
    return invalid('收款问题状态与依赖金额不一致')
  }
  if (!object(value) || !hasConsistentReadMeta(value, 'construction-contract-read-v2', value.dataOrigin) || !isDataOriginDTO(value.dataOrigin) || !contract || (expected !== undefined && (contract.id !== expected.id || value.dataOrigin !== expected.origin)) || contract.kind !== '施工'
    || contract.dataOrigin !== value.dataOrigin || !validSignatory(contract.ourSignatorySnapshot) || !(contract.legacyPartyA === null || typeof contract.legacyPartyA === 'string')
    || !['id', 'no', 'name', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'warrantyTerms', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'status', 'note']
      .every(key => typeof contract[key] === 'string')
      || !entity(contract.project, 'project') || !entity(contract.customer, 'customer')
      || !amounts(contract.amounts) || !validManagementFee(contract.managementFee)
      || (contract.actualCompletionDate !== null && !isISODateDTO(contract.actualCompletionDate))
      || (contract.signDate !== null && !isISODateDTO(contract.signDate))
      || !sections || !Array.isArray(sections.supplements) || !sections.supplements.every(fact)
      || !Array.isArray(sections.changes) || !sections.changes.every(fact)
      || !object(sections.settlements) || !object(sections.invoices) || !object(sections.acceptance)
      || ![sections.settlements.monthlyStatements, sections.settlements.finalSettlements, sections.settlements.penalties, sections.invoices.applications, sections.invoices.registrations, sections.receipts, sections.acceptance.acceptances, sections.acceptance.warranties]
        .every(rows => Array.isArray(rows) && rows.every(fact))
        || !Array.isArray(sections.files)
        || !relationNavigation(value.projectNavigation, contract.project, value.dataOrigin) || !relationNavigation(value.customerNavigation, contract.customer, value.dataOrigin)
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
    status: serializeContractListFilter(query.status),
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeConstructionContractDetailQuery(query: ConstructionContractDetailQueryDTO): Record<string, string> {
  return {
    origin: query.origin,
    includeDemo: String(query.includeDemo),
    focusId: query.focus?.id ?? '',
    focusScope: query.focus?.scope ?? '',
    focusView: query.focus?.scope === 'acceptance' ? query.focus.view ?? '' : '',
  }
}

export function constructionContractProblemFromUnknown(cause: unknown): ConstructionContractRepositoryProblem {
  if (cause instanceof ConstructionContractRepositoryProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new ConstructionContractRepositoryProblem(remote, { cause })
  return new ConstructionContractRepositoryProblem(
    constructionContractProblem('unavailable', '施工合同中央服务暂时不可用，请重试', true),
    { cause },
  )
}
