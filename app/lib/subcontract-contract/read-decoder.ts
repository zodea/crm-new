import type {
  SubcontractContractDetailQueryDTO,
  SubcontractContractDetailReadDTO,
  SubcontractContractListPageDTO,
  SubcontractContractListQueryDTO,
} from './read-contract'
import { isDataOriginDTO, isEntityRefDTO, isISODateDTO, isISODateTimeDTO, isUnavailableEntityNavigationDTO } from '../../types/read-model'
import { serializeContractListFilter } from '../contract/list-filters'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { subcontractContractProblem, SubcontractContractRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new SubcontractContractRepositoryProblem(subcontractContractProblem('internal-error', message))
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

function entity(value: unknown, kind: 'project' | 'supplier'): boolean {
  return isEntityRefDTO(value, kind)
}

function amounts(value: unknown): boolean {
  return object(value) && ['contract', 'changed', 'settled', 'invoiced', 'paid', 'bySettlementPayable', 'byInvoicePayable', 'completionSettlement'].every(key => value[key] === null || money(value[key]))
    && (value.paid !== null || (value.bySettlementPayable === null && value.byInvoicePayable === null))
    && (value.settled !== null || value.bySettlementPayable === null)
    && (value.invoiced !== null || value.byInvoicePayable === null)
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function summary(value: unknown, items: unknown[], total: number): boolean {
  if (!object(value) || !object(value.origins)
    || !['projects', 'suppliers'].every(key => Array.isArray(value[key]) && value[key].every(row => object(row) && typeof row.id === 'string' && row.id.length > 0 && typeof row.label === 'string'))
    || !['statuses', 'subKinds'].every(key => Array.isArray(value[key]) && value[key].every(row => object(row) && typeof row.value === 'string' && Number.isSafeInteger(row.count) && Number(row.count) >= 0))) {
    return false
  }
  const fields = ['changedAmount', 'settledAmount', 'paidAmount']
  const rowFields = ['changed', 'settled', 'paid']
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

export function decodeSubcontractContractListPage(value: unknown, expected?: SubcontractContractListQueryDTO): SubcontractContractListPageDTO {
  if (!object(value) || !hasConsistentOriginReadMeta(value, 'subcontract-contract-read-v2') || !Array.isArray(value.items) || !object(value.pagination)
    || !isPaginationDTO(value.pagination, value.items.length)
    || (expected !== undefined && (value.pagination.requestedPage !== expected.page || value.pagination.pageSize !== expected.pageSize
      || value.items.some(row => !object(row) || (!expected.includeDemo && row.dataOrigin === 'demo') || (expected.origin !== null && row.dataOrigin !== expected.origin))))
    || !Number.isSafeInteger(value.pagination.total) || !summary(value.summary, value.items, value.pagination.total as number)
    || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)
    || !value.items.every((row) => {
      if (!object(row) || !isDataOriginDTO(row.dataOrigin) || row.rowKey !== `${row.dataOrigin}:${row.id}`)
        return false
      return ['id', 'no', 'name', 'subKind', 'status'].every(key => typeof row[key] === 'string')
        && entity(row.project, 'project') && entity(row.supplier, 'supplier')
        && amounts(row.amounts) && navigation(row.navigation)
        && relationNavigation(row.projectNavigation, row.project, row.dataOrigin) && relationNavigation(row.supplierNavigation, row.supplier, row.dataOrigin)
        && nullableString(row.settlementStatus) && nullableString(row.clearanceStatus)
        && (row.signDate === null || isISODateDTO(row.signDate))
        && isISODateTimeDTO(row.updatedAt)
    })) {
    return invalid('中央后台返回的分包合同列表读模型无效')
  }
  return value as unknown as SubcontractContractListPageDTO
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

export function decodeSubcontractContractDetailRead(value: unknown, expected?: SubcontractContractDetailQueryDTO): SubcontractContractDetailReadDTO {
  const contract = object(value) && object(value.contract) ? value.contract : null
  const sections = object(value) && object(value.sections) ? value.sections : null
  const payments = sections && object(sections.payments) ? sections.payments : null
  const settlements = sections && object(sections.settlements) ? sections.settlements : null
  const materialUses = sections && object(sections.materialUses) ? sections.materialUses : null
  if (!object(value) || !hasConsistentReadMeta(value, 'subcontract-contract-read-v2', value.dataOrigin) || !isDataOriginDTO(value.dataOrigin) || !contract || (expected !== undefined && (contract.id !== expected.id || value.dataOrigin !== expected.origin)) || contract.kind !== '分包'
    || contract.dataOrigin !== value.dataOrigin || !validSignatory(contract.ourSignatorySnapshot) || !(contract.legacyPartyA === null || typeof contract.legacyPartyA === 'string')
    || !['id', 'no', 'name', 'subKind', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'warrantyTerms', 'status', 'note']
      .every(key => typeof contract[key] === 'string')
      || !entity(contract.project, 'project') || !entity(contract.supplier, 'supplier')
      || !amounts(contract.amounts)
      || !nullableString(contract.settlementStatus) || !nullableString(contract.clearanceStatus)
      || (contract.signDate !== null && !isISODateDTO(contract.signDate))
      || !sections || !payments || !settlements || !materialUses
      || ![sections.supplements, sections.changes, sections.invoices, payments.applications, payments.records, settlements.progress, settlements.completion, sections.penalties, materialUses.currentWarehouse, materialUses.legacy]
        .every(rows => Array.isArray(rows) && rows.every(fact))
        || materialUses.emptyReason !== 'missing-relation'
        || !Array.isArray(sections.files)
        || !relationNavigation(value.projectNavigation, contract.project, value.dataOrigin) || !relationNavigation(value.supplierNavigation, contract.supplier, value.dataOrigin)
        || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)) {
    return invalid('中央后台返回的分包合同详情读模型无效')
  }
  return value as unknown as SubcontractContractDetailReadDTO
}

export function serializeSubcontractContractListQuery(query: SubcontractContractListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    origin: query.origin ?? '',
    search: query.search,
    projectId: query.projectId ?? '',
    supplierId: query.supplierId ?? '',
    status: serializeContractListFilter(query.status),
    subKind: serializeContractListFilter(query.subKind),
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeSubcontractContractDetailQuery(query: SubcontractContractDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo), focusId: query.focusId ?? '' }
}

export function subcontractContractUnavailable(cause: unknown): SubcontractContractRepositoryProblem {
  if (cause instanceof SubcontractContractRepositoryProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new SubcontractContractRepositoryProblem(remote, { cause })
  return new SubcontractContractRepositoryProblem(
    subcontractContractProblem('unavailable', '分包合同中央服务暂时不可用，请重试', true),
    { cause },
  )
}
