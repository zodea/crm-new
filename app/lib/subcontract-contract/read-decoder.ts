import type {
  SubcontractContractDetailQueryDTO,
  SubcontractContractDetailReadDTO,
  SubcontractContractListPageDTO,
  SubcontractContractListQueryDTO,
} from './read-contract'
import { isDataOriginDTO, isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { serializeContractListFilter } from '../contract/list-filters'
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

function entity(value: unknown, kind: 'project' | 'supplier'): boolean {
  if (!object(value) || value.entity !== kind || typeof value.state !== 'string')
    return false
  if (value.state === 'resolved')
    return typeof value.id === 'string' && typeof value.label === 'string'
  return value.state === 'missing' || value.state === 'forbidden'
}

function amounts(value: unknown): boolean {
  return object(value) && ['contract', 'changed', 'settled', 'invoiced', 'paid', 'bySettlementPayable', 'byInvoicePayable', 'completionSettlement']
    .every(key => money(value[key]))
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

export function decodeSubcontractContractListPage(value: unknown): SubcontractContractListPageDTO {
  if (!object(value) || !Array.isArray(value.items) || !object(value.pagination)
    || !Number.isSafeInteger(value.pagination.page) || !Number.isSafeInteger(value.pagination.pageSize)
    || !Number.isSafeInteger(value.pagination.total) || !object(value.summary)
    || !isISODateTimeDTO(value.asOf) || !Array.isArray(value.capabilities)
    || !value.items.every((row) => {
      if (!object(row) || !isDataOriginDTO(row.dataOrigin) || row.rowKey !== `${row.dataOrigin}:${row.id}`)
        return false
      return ['id', 'no', 'name', 'subKind', 'status'].every(key => typeof row[key] === 'string')
        && entity(row.project, 'project') && entity(row.supplier, 'supplier')
        && amounts(row.amounts) && navigation(row.navigation)
        && navigation(row.projectNavigation) && navigation(row.supplierNavigation)
        && nullableString(row.settlementStatus) && nullableString(row.clearanceStatus)
        && (row.signDate === null || isISODateDTO(row.signDate))
        && isISODateTimeDTO(row.updatedAt)
    })) {
    return invalid('中央后台返回的分包合同列表读模型无效')
  }
  return value as unknown as SubcontractContractListPageDTO
}

export function decodeSubcontractContractDetailRead(value: unknown): SubcontractContractDetailReadDTO {
  const contract = object(value) && object(value.contract) ? value.contract : null
  const sections = object(value) && object(value.sections) ? value.sections : null
  const payments = sections && object(sections.payments) ? sections.payments : null
  const settlements = sections && object(sections.settlements) ? sections.settlements : null
  const materialUses = sections && object(sections.materialUses) ? sections.materialUses : null
  if (!object(value) || !isDataOriginDTO(value.dataOrigin) || !contract || contract.kind !== '分包'
    || contract.dataOrigin !== value.dataOrigin
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
        || !navigation(value.projectNavigation) || !navigation(value.supplierNavigation)
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
  return new SubcontractContractRepositoryProblem(
    subcontractContractProblem('unavailable', '分包合同中央服务暂时不可用，请重试', true),
    { cause },
  )
}
