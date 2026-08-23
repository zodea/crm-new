import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  CustomerDetailQueryDTO,
  CustomerDetailReadDTO,
  CustomerListPageDTO,
  CustomerListQueryDTO,
  CustomerPageSize,
  CustomerReceiptDetailQueryDTO,
  CustomerReceiptDetailReadDTO,
} from './read-contract'
import { isDataOriginDTO, isEntityKindDTO, isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { CUSTOMER_PAGE_SIZES, customerProblem, CustomerRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function nullableDate(value: unknown): value is string | null {
  return value === null || isISODateDTO(value)
}

function entityRef(value: unknown, kind?: EntityKindDTO): value is EntityRefDTO {
  if (!object(value) || !isEntityKindDTO(value.entity) || (kind && value.entity !== kind))
    return false
  if (value.state === 'resolved')
    return typeof value.id === 'string' && typeof value.label === 'string' && (value.no === null || typeof value.no === 'string')
  if (value.state === 'missing')
    return value.id === null && value.label === null && ['not-configured', 'not-recorded', 'not-applicable'].includes(String(value.reason))
  if (value.state === 'forbidden')
    return (value.id === null || typeof value.id === 'string') && value.label === null && value.reason === 'permission-denied'
  return false
}

function sameSubject(left: EntityRefDTO, right: Record<string, unknown>): boolean {
  return left.state === right.state
    && left.entity === right.entity
    && left.id === right.id
    && left.label === right.label
    && ('no' in left ? left.no : undefined) === right.no
}

function navigationFor(value: unknown, reference: EntityRefDTO, origin?: unknown): value is NavigationIntentDTO {
  if (!object(value))
    return false
  if (reference.state !== 'resolved')
    return value.kind === 'unavailable' && ['missing-id', 'forbidden'].includes(String(value.reason))
  return value.kind === 'entity-detail'
    && value.variant === 'detail'
    && value.view === null
    && object(value.subject)
    && sameSubject(reference, value.subject)
    && object(value.filters)
    && Object.values(value.filters).every(item => item === null || typeof item === 'string')
    && (origin === undefined || (isDataOriginDTO(origin) && value.filters.dataOrigin === origin))
}

function navigationCustomerId(value: unknown): string | null {
  if (!object(value) || value.kind !== 'entity-detail' || !object(value.filters))
    return null
  return typeof value.filters.customerId === 'string' ? value.filters.customerId : null
}

function customer(value: unknown, origin?: unknown): boolean {
  return object(value)
    && isDataOriginDTO(value.dataOrigin)
    && (origin === undefined || value.dataOrigin === origin)
    && ['id', 'name', 'taxNo', 'legalRep', 'registeredAddress', 'invoiceName', 'bank', 'bankAccount', 'contact', 'contactPhone', 'status', 'note', 'updatedAt'].every(field => typeof value[field] === 'string')
    && strings(value.aliases)
    && isISODateTimeDTO(value.updatedAt)
}

function listItem(value: unknown): boolean {
  if (!object(value) || !isDataOriginDTO(value.dataOrigin) || !entityRef(value.customer, 'customer')
    || value.customer.state !== 'resolved') {
    return false
  }
  return navigationFor(value.navigation, value.customer, value.dataOrigin)
    && strings(value.aliases)
    && ['taxNo', 'contact', 'contactPhone', 'status'].every(field => typeof value[field] === 'string')
    && isISODateTimeDTO(value.updatedAt)
}

function pageBase(value: unknown): value is Record<string, unknown> {
  return object(value)
    && object(value.pagination)
    && Number.isSafeInteger(value.pagination.page) && Number(value.pagination.page) >= 1
    && CUSTOMER_PAGE_SIZES.includes(value.pagination.pageSize as CustomerPageSize)
    && Number.isSafeInteger(value.pagination.total) && Number(value.pagination.total) >= 0
    && (value.empty === null || (object(value.empty)
      && ['no-records', 'no-filter-match', 'missing-relation'].includes(String(value.empty.reason))
      && Array.isArray(value.empty.missingRelations)
      && value.empty.missingRelations.every(isEntityKindDTO)))
    && isISODateTimeDTO(value.asOf)
    && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && strings(value.capabilities)
}

function statusSummary(value: unknown): boolean {
  return object(value)
    && typeof value.value === 'string'
    && typeof value.label === 'string'
    && Number.isSafeInteger(value.count)
    && Number(value.count) >= 0
}

function originSummary(value: unknown): boolean {
  return object(value)
    && Number.isSafeInteger(value.customerCount)
    && Number(value.customerCount) >= 0
}

function invalid(message: string): never {
  throw new CustomerRepositoryProblem(customerProblem('internal-error', message))
}

export function decodeCustomerListPage(value: unknown): CustomerListPageDTO {
  if (!pageBase(value)
    || !Array.isArray(value.items) || !value.items.every(listItem)
    || !object(value.summary)
    || !Array.isArray(value.summary.statuses) || !value.summary.statuses.every(statusSummary)
    || !object(value.summary.origins)
    || !originSummary(value.summary.origins.real)
    || !originSummary(value.summary.origins.demo)) {
    return invalid('中央后台返回的客户列表读模型无效')
  }
  return value as unknown as CustomerListPageDTO
}

function project(value: unknown, origin: unknown): boolean {
  if (!object(value) || !entityRef(value.project, 'project'))
    return false
  return navigationFor(value.navigation, value.project, origin)
    && typeof value.code === 'string' && ['主客户', '次客户'].includes(String(value.relationRole))
    && typeof value.status === 'string' && typeof value.manager === 'string'
    && nullableDate(value.startDate) && nullableDate(value.plannedEnd)
    && Number.isSafeInteger(value.contractCount) && Number(value.contractCount) >= 0 && money(value.effectiveContractAmount)
    && Number.isSafeInteger(value.receiptCount) && Number(value.receiptCount) >= 0 && money(value.effectiveReceiptAmount)
}

function contract(value: unknown, origin: unknown): boolean {
  if (!object(value) || !entityRef(value.contract, 'contract') || value.contract.state !== 'resolved'
    || !entityRef(value.project, 'project')) {
    return false
  }
  return navigationFor(value.navigation, value.contract)
    && navigationFor(value.projectNavigation, value.project, origin)
    && money(value.effectiveAmount) && money(value.receiptAmount) && money(value.outstandingAmount)
    && nullableDate(value.signDate)
    && typeof value.status === 'string' && typeof value.isDraft === 'boolean'
}

function receipt(value: unknown, origin: unknown, expectedCustomerId?: string): boolean {
  if (!object(value) || !entityRef(value.receipt, 'receipt') || value.receipt.state !== 'resolved'
    || !entityRef(value.project, 'project') || !entityRef(value.contract, 'contract')) {
    return false
  }
  return navigationFor(value.navigation, value.receipt, origin)
    && (!expectedCustomerId || navigationCustomerId(value.navigation) === expectedCustomerId)
    && navigationFor(value.projectNavigation, value.project, origin)
    && navigationFor(value.contractNavigation, value.contract)
    && typeof value.payerAccount === 'string' && money(value.amount) && money(value.effectiveAmount)
    && nullableDate(value.receiptDate)
    && typeof value.paymentMethod === 'string' && typeof value.status === 'string' && typeof value.isDraft === 'boolean'
}

export function decodeCustomerDetailRead(value: unknown): CustomerDetailReadDTO {
  const summary = object(value) && object(value.summary) ? value.summary : null
  const customerId = object(value) && object(value.customer) && typeof value.customer.id === 'string'
    ? value.customer.id
    : null
  const hasValidSummaryCounts = summary !== null
    && ['projectCount', 'contractCount', 'receiptCount', 'draftReceiptCount']
      .every(field => Number.isSafeInteger(summary[field]) && Number(summary[field]) >= 0)
  if (!object(value) || !customerId || !isDataOriginDTO(value.dataOrigin) || !customer(value.customer, value.dataOrigin)
    || !Array.isArray(value.projects) || !value.projects.every(item => project(item, value.dataOrigin))
    || !Array.isArray(value.contracts) || !value.contracts.every(item => contract(item, value.dataOrigin))
    || !Array.isArray(value.receipts) || !value.receipts.every(item => receipt(item, value.dataOrigin, customerId))
    || !summary
    || !['effectiveContractAmount', 'effectiveReceiptAmount', 'outstandingAmount'].every(field => money(summary[field]))
    || !hasValidSummaryCounts
    || !isISODateTimeDTO(value.asOf)
    || (value.sourceVersion !== null && typeof value.sourceVersion !== 'string')
    || !strings(value.capabilities)) {
    return invalid('中央后台返回的客户详情读模型无效')
  }
  return value as unknown as CustomerDetailReadDTO
}

export function decodeCustomerReceiptDetailRead(value: unknown): CustomerReceiptDetailReadDTO {
  if (!object(value) || !isDataOriginDTO(value.dataOrigin)
    || !receipt(value.receipt, value.dataOrigin)
    || !entityRef(value.customer, 'customer') || value.customer.state !== 'resolved'
    || !object(value.receipt) || !object(value.receipt.navigation)
    || !object(value.receipt.navigation.filters)
    || value.receipt.navigation.filters.customerId !== value.customer.id
    || !navigationFor(value.customerNavigation, value.customer, value.dataOrigin)
    || !isISODateTimeDTO(value.asOf)
    || (value.sourceVersion !== null && typeof value.sourceVersion !== 'string')
    || !strings(value.capabilities)) {
    return invalid('中央后台返回的收款详情读模型无效')
  }
  return value as unknown as CustomerReceiptDetailReadDTO
}

export function serializeCustomerListQuery(query: CustomerListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    search: query.search,
    status: query.status ?? '',
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeCustomerDetailQuery(query: CustomerDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo) }
}

export function serializeCustomerReceiptDetailQuery(query: CustomerReceiptDetailQueryDTO): Record<string, string> {
  return {
    ...serializeCustomerDetailQuery(query),
    customerId: query.customerId,
  }
}

export function customerProblemFromUnknown(cause: unknown): CustomerRepositoryProblem {
  if (cause instanceof CustomerRepositoryProblem)
    return cause
  return new CustomerRepositoryProblem(customerProblem(
    'unavailable',
    '客户中央服务暂时不可用，请重试',
    true,
  ), { cause })
}
