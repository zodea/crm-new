import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  SupplierDetailQueryDTO,
  SupplierDetailReadDTO,
  SupplierListPageDTO,
  SupplierListQueryDTO,
  SupplierPageSize,
} from './read-contract'
import {
  isDataOriginDTO,
  isEntityKindDTO,
  isISODateDTO,
  isISODateTimeDTO,
} from '../../types/read-model'
import {
  SUPPLIER_PAGE_SIZES,
  supplierProblem,
  SupplierRepositoryProblem,
} from './read-contract'
import { parseSupplierColumnFilters, serializeSupplierEnumSelection } from './read-query'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function nullableMoney(value: unknown): boolean {
  return value === null || money(value)
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
  return left.state === 'resolved'
    && right.state === 'resolved'
    && left.entity === right.entity
    && left.id === right.id
    && left.label === right.label
}

interface NavigationExpectation {
  kind?: 'entity-detail' | 'entity-subview'
  variant?: string
  view?: string | null
  filters?: Record<string, string>
  unavailableReason?: 'missing-route'
}

const UNAVAILABLE_REASONS = new Set(['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target'])

function exactFilters(value: unknown, expected: Record<string, string>): boolean {
  if (!object(value))
    return false
  const keys = Object.keys(value)
  return keys.length === Object.keys(expected).length
    && keys.every(key => typeof value[key] === 'string' && value[key] === expected[key])
}

function navigation(
  value: unknown,
  reference: EntityRefDTO,
  expectation: NavigationExpectation = {},
): value is NavigationIntentDTO {
  if (!object(value))
    return false
  const unavailableReason = reference.state === 'forbidden'
    ? 'forbidden'
    : reference.state === 'missing'
      ? 'missing-id'
      : expectation.unavailableReason
  if (unavailableReason) {
    return value.kind === 'unavailable'
      && value.reason === unavailableReason
      && UNAVAILABLE_REASONS.has(String(value.reason))
  }
  const filters = expectation.filters ?? {}
  return reference.state === 'resolved'
    && value.kind === (expectation.kind ?? 'entity-detail')
    && value.variant === (expectation.variant ?? 'detail')
    && value.view === (expectation.view ?? null)
    && object(value.subject)
    && sameSubject(reference, value.subject)
    && exactFilters(value.filters, filters)
}

function pageBase(value: unknown): value is Record<string, unknown> {
  return object(value)
    && object(value.pagination)
    && Number.isSafeInteger(value.pagination.page) && Number(value.pagination.page) >= 1
    && SUPPLIER_PAGE_SIZES.includes(value.pagination.pageSize as SupplierPageSize)
    && Number.isSafeInteger(value.pagination.total) && Number(value.pagination.total) >= 0
    && (value.empty === null || (object(value.empty)
      && ['no-records', 'no-filter-match', 'missing-relation'].includes(String(value.empty.reason))
      && Array.isArray(value.empty.missingRelations) && value.empty.missingRelations.every(isEntityKindDTO)))
    && isISODateTimeDTO(value.asOf)
    && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && strings(value.capabilities)
}

function listItem(value: unknown): boolean {
  if (!object(value) || !isDataOriginDTO(value.dataOrigin)
    || !entityRef(value.supplier, 'supplier') || value.supplier.state !== 'resolved') {
    return false
  }
  return navigation(value.navigation, value.supplier, { filters: { dataOrigin: value.dataOrigin } })
    && strings(value.aliases)
    && ['taxNo', 'uniqueCode', 'supplierCategory', 'credentialStatus', 'contact', 'contactPhone', 'paymentAmount', 'updatedAt']
      .every(field => typeof value[field] === 'string')
      && nullableMoney(value.contractAmount) && money(value.paymentAmount)
      && isISODateTimeDTO(value.updatedAt)
      && Number.isSafeInteger(value.projectCount) && Number(value.projectCount) >= 0
      && ['address', 'taxpayerType', 'mainBusiness', 'laborScope', 'bank', 'bankAccount', 'businessType'].every(field => value[field] === undefined || typeof value[field] === 'string')
      && (value.cumulativeContractAmount === undefined || nullableMoney(value.cumulativeContractAmount))
      && (value.settlementAmount === undefined || value.settlementAmount === null || money(value.settlementAmount))
      && (value.businessLicense === undefined || (object(value.businessLicense)
        && ['available', 'missing', 'unavailable'].includes(String(value.businessLicense.state))
        && strings(value.businessLicense.fileIds)
        && value.businessLicense.fileIds.every(id => id.trim().length > 0)
        && new Set(value.businessLicense.fileIds).size === value.businessLicense.fileIds.length
        && (value.businessLicense.state === 'unavailable'
          ? value.businessLicense.fileCount === null && value.businessLicense.fileIds.length === 0
          : Number.isSafeInteger(value.businessLicense.fileCount) && Number(value.businessLicense.fileCount) >= 0
            && Number(value.businessLicense.fileCount) === value.businessLicense.fileIds.length
            && (value.businessLicense.state === 'available' ? value.businessLicense.fileIds.length > 0 : value.businessLicense.fileIds.length === 0))))
}

function summaryCount(value: unknown): boolean {
  return object(value) && typeof value.value === 'string' && typeof value.label === 'string'
    && Number.isSafeInteger(value.count) && Number(value.count) >= 0
}

function originSummary(value: unknown): boolean {
  return object(value) && Number.isSafeInteger(value.supplierCount) && Number(value.supplierCount) >= 0
    && nullableMoney(value.contractAmount) && money(value.paymentAmount)
}

function invalid(message: string): never {
  throw new SupplierRepositoryProblem(supplierProblem('internal-error', message))
}

export function decodeSupplierListPage(value: unknown): SupplierListPageDTO {
  if (!pageBase(value) || !Array.isArray(value.items) || !value.items.every(listItem)
    || !object(value.summary)
    || !Array.isArray(value.summary.categories) || !value.summary.categories.every(summaryCount)
    || !Array.isArray(value.summary.credentialStatuses) || !value.summary.credentialStatuses.every(summaryCount)
    || (value.summary.taxpayerTypes !== undefined && (!Array.isArray(value.summary.taxpayerTypes) || !value.summary.taxpayerTypes.every(summaryCount)))
    || !object(value.summary.origins) || !originSummary(value.summary.origins.real) || !originSummary(value.summary.origins.demo)) {
    return invalid('中央后台返回的分供方列表读模型无效')
  }
  const page = value as unknown as SupplierListPageDTO
  return {
    ...page,
    items: page.items.map(item => ({
      ...item,
      address: item.address ?? '',
      taxpayerType: item.taxpayerType ?? '',
      mainBusiness: item.mainBusiness ?? '',
      laborScope: item.laborScope ?? '',
      bank: item.bank ?? '',
      bankAccount: item.bankAccount ?? '',
      businessType: item.businessType ?? '',
      cumulativeContractAmount: item.cumulativeContractAmount === undefined ? item.contractAmount : item.cumulativeContractAmount,
      settlementAmount: item.settlementAmount ?? null,
      businessLicense: item.businessLicense ?? { state: 'unavailable', fileCount: null, fileIds: [] },
    })),
  }
}

function supplier(value: unknown, origin: unknown): boolean {
  return object(value) && value.dataOrigin === origin
    && ['id', 'name', 'externalRef', 'uniqueCode', 'taxNo', 'businessType', 'supplierCategory', 'rating', 'legalRep', 'address', 'taxpayerType', 'mainBusiness', 'invoiceName', 'invoiceAddress', 'bank', 'bankAccount', 'phone', 'contact', 'contactPhone', 'contactTitle', 'credentialStatus', 'note', 'updatedAt']
      .every(field => typeof value[field] === 'string')
      && strings(value.aliases)
      && (value.laborScope === undefined || typeof value.laborScope === 'string')
      && (value.registeredCapital === null || typeof value.registeredCapital === 'number')
      && nullableDate(value.registeredDate)
      && isISODateTimeDTO(value.updatedAt)
}

function metric(value: unknown, supplierId: string): boolean {
  return object(value) && nullableMoney(value.value) && value.unit === 'CNY'
    && ['complete', 'partial', 'pending', 'not-applicable', 'undefined'].includes(String(value.status))
    && (value.value !== null || value.status !== 'complete')
    && strings(value.missingSources) && isISODateTimeDTO(value.asOf)
    && (value.drilldown === null || (object(value.drilldown) && isEntityKindDTO(value.drilldown.entity)
      && object(value.drilldown.filters) && value.drilldown.filters.supplierId === supplierId))
}

function navigationFilter(value: unknown, key: string, expected: string): boolean {
  return object(value) && object(value.filters) && value.filters[key] === expected
}

function contractNavigation(value: unknown, reference: EntityRefDTO, origin: unknown, kind?: unknown): boolean {
  if (navigation(value, reference))
    return true
  if (!object(value) || !object(value.filters))
    return false
  const contractKind = value.filters.contractKind
  if (!['材采', '施工', '分包', 'other_expense'].includes(String(contractKind)) || (kind !== undefined && contractKind !== kind))
    return false
  return navigation(value, reference, {
    variant: contractKind === 'other_expense' ? 'other_expense' : 'detail',
    filters: { dataOrigin: String(origin), contractKind: String(contractKind) },
  })
}

function project(value: unknown, origin: unknown, supplierId: string): boolean {
  return object(value) && typeof value.relationId === 'string' && entityRef(value.project, 'project')
    && navigation(value.navigation, value.project, {
      kind: 'entity-subview',
      variant: 'supplier-workbench',
      view: 'overview',
      filters: { supplierId, dataOrigin: String(origin) },
    })
    && (value.project.state !== 'resolved' || navigationFilter(value.navigation, 'supplierId', supplierId))
    && typeof value.relationshipStatus === 'string'
}

function contract(value: unknown, origin: unknown): boolean {
  return object(value) && entityRef(value.contract, 'contract') && value.contract.state === 'resolved'
    && contractNavigation(value.navigation, value.contract, origin, value.kind)
    && entityRef(value.project, 'project') && navigation(value.projectNavigation, value.project, { filters: { dataOrigin: String(origin) } })
    && typeof value.kind === 'string' && nullableMoney(value.effectiveAmount) && nullableDate(value.signDate)
    && typeof value.status === 'string' && typeof value.isDraft === 'boolean'
}

function settlement(value: unknown, origin: unknown): boolean {
  return object(value) && entityRef(value.settlement, 'settlement') && value.settlement.state === 'resolved'
    && navigation(value.navigation, value.settlement, { unavailableReason: 'missing-route' })
    && entityRef(value.project, 'project') && navigation(value.projectNavigation, value.project, { filters: { dataOrigin: String(origin) } })
    && entityRef(value.contract, 'contract') && contractNavigation(value.contractNavigation, value.contract, origin)
    && typeof value.settlementType === 'string' && nullableMoney(value.totalAmount) && nullableDate(value.settlementDate)
    && typeof value.status === 'string'
}

function invoice(value: unknown, origin: unknown): boolean {
  return object(value) && entityRef(value.invoice, 'invoice') && value.invoice.state === 'resolved'
    && navigation(value.navigation, value.invoice)
    && entityRef(value.project, 'project') && navigation(value.projectNavigation, value.project, { filters: { dataOrigin: String(origin) } })
    && entityRef(value.contract, 'contract') && contractNavigation(value.contractNavigation, value.contract, origin)
    && typeof value.invoiceType === 'string' && nullableDate(value.invoiceDate)
    && money(value.totalAmount) && money(value.taxAmount) && typeof value.accountStatus === 'string'
}

function payment(value: unknown, origin: unknown): boolean {
  return object(value) && entityRef(value.application, 'payment-application') && value.application.state === 'resolved'
    && navigation(value.navigation, value.application)
    && entityRef(value.project, 'project') && navigation(value.projectNavigation, value.project, { filters: { dataOrigin: String(origin) } })
    && entityRef(value.contract, 'contract') && contractNavigation(value.contractNavigation, value.contract, origin)
    && money(value.applyAmount) && money(value.approvedAmount) && money(value.actualPaidAmount)
    && nullableDate(value.applyDate) && typeof value.status === 'string'
}

export function decodeSupplierDetailRead(value: unknown): SupplierDetailReadDTO {
  const supplierId = object(value) && object(value.supplier) && typeof value.supplier.id === 'string' ? value.supplier.id : null
  const summary = object(value) && object(value.summary) ? value.summary : null
  if (!object(value) || !supplierId || !isDataOriginDTO(value.dataOrigin) || !supplier(value.supplier, value.dataOrigin)
    || !Array.isArray(value.projects) || !value.projects.every(item => project(item, value.dataOrigin, supplierId))
    || !Array.isArray(value.contracts) || !value.contracts.every(item => contract(item, value.dataOrigin))
    || !Array.isArray(value.settlements) || !value.settlements.every(item => settlement(item, value.dataOrigin))
    || !Array.isArray(value.invoices) || !value.invoices.every(item => invoice(item, value.dataOrigin))
    || !Array.isArray(value.payments) || !value.payments.every(item => payment(item, value.dataOrigin))
    || !summary || !['projectCount', 'contractCount', 'settlementCount', 'invoiceCount', 'paymentCount']
    .every(field => Number.isSafeInteger(summary[field]) && Number(summary[field]) >= 0)
    || !['contractAmount', 'settlementAmount', 'invoiceAmount', 'paymentAmount', 'payableAmount']
      .every(field => metric(summary[field], supplierId))
      || !isISODateTimeDTO(value.asOf) || (value.sourceVersion !== null && typeof value.sourceVersion !== 'string')
      || !strings(value.capabilities)) {
    return invalid('中央后台返回的分供方详情读模型无效')
  }
  const detail = value as unknown as SupplierDetailReadDTO
  return { ...detail, supplier: { ...detail.supplier, laborScope: detail.supplier.laborScope ?? '' } }
}

export function serializeSupplierListQuery(query: SupplierListQueryDTO): Record<string, string> {
  const columnFilters = parseSupplierColumnFilters(query.columnFilters)
  return {
    includeDemo: String(query.includeDemo),
    search: query.search,
    category: serializeSupplierEnumSelection(query.category),
    credentialStatus: serializeSupplierEnumSelection(query.credentialStatus),
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
    ...(columnFilters ? { columnFilters: JSON.stringify(columnFilters) } : {}),
  }
}

export function serializeSupplierDetailQuery(query: SupplierDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo) }
}

export function supplierProblemFromUnknown(cause: unknown): SupplierRepositoryProblem {
  if (cause instanceof SupplierRepositoryProblem)
    return cause
  return new SupplierRepositoryProblem(supplierProblem('unavailable', '分供方中央服务暂时不可用，请重试', true), { cause })
}
