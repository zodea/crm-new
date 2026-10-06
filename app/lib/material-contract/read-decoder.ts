import type { DataOriginDTO, EntityKindDTO } from '../../types/read-model'
import type {
  MaterialContractDetailQueryDTO,
  MaterialContractDetailReadDTO,
  MaterialContractListPageDTO,
  MaterialContractListQueryDTO,
  MaterialContractPageSize,
} from './read-contract'
import { isDataOriginDTO, isEntityRefDTO, isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { serializeContractListFilter } from '../contract/list-filters'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import {
  MATERIAL_CONTRACT_PAGE_SIZES,
  materialContractProblem,
  MaterialContractRepositoryProblem,
} from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function signatorySnapshot(value: unknown): boolean {
  if (value === null)
    return true

  try {
    decodeOurSignatorySnapshot(value)
    return true
  }
  catch { return false }
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function quantity(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
}

function ratio(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(value))
    return false
  const parsed = Number(value)
  return parsed >= 0 && parsed <= 1
}

function unavailableNavigation(value: unknown, reason?: string): boolean {
  return object(value) && value.kind === 'unavailable'
    && typeof value.reason === 'string'
    && (reason ? value.reason === reason : ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target'].includes(value.reason))
}

function invalid(message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem('internal-error', message))
}

function pageBase(value: unknown): value is Record<string, unknown> {
  return object(value)
    && object(value.pagination)
    && isPaginationDTO(value.pagination, Array.isArray(value.items) ? value.items.length : undefined)
    && MATERIAL_CONTRACT_PAGE_SIZES.includes(value.pagination.pageSize as MaterialContractPageSize)
    && Number.isSafeInteger(value.pagination.total) && Number(value.pagination.total) >= 0
    && isISODateTimeDTO(value.asOf)
    && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && strings(value.capabilities)
}

function amounts(value: unknown): boolean {
  return object(value)
    && ['contract', 'changed'].every(key => value[key] === null || money(value[key]))
    && ['settled', 'invoiced', 'paid', 'payable'].every(key => value[key] === null || money(value[key]))
}

function entityRef(value: unknown, entity: EntityKindDTO): boolean {
  return isEntityRefDTO(value, entity)
}

function resolvedNavigation(
  value: unknown,
  entity: EntityKindDTO,
  id: string,
  origin: DataOriginDTO,
  contractKind?: '材采',
): boolean {
  if (!object(value) || value.kind !== 'entity-detail'
    || !object(value.subject) || value.subject.state !== 'resolved'
    || value.subject.entity !== entity || value.subject.id !== id
    || typeof value.subject.label !== 'string'
    || !(value.subject.no === null || typeof value.subject.no === 'string')
    || value.variant !== 'detail' || value.view !== null
    || !object(value.filters) || value.filters.dataOrigin !== origin
    || Object.keys(value.filters).some(key => !['dataOrigin', 'contractKind'].includes(key))) {
    return false
  }
  return contractKind == null
    ? value.filters.contractKind === undefined
    : value.filters.contractKind === contractKind
}

function referenceNavigation(value: unknown, reference: unknown, origin: DataOriginDTO): boolean {
  if (!object(reference))
    return false
  if (reference.state === 'resolved')
    return resolvedNavigation(value, reference.entity as EntityKindDTO, String(reference.id), origin)
  return unavailableNavigation(value, reference.state === 'forbidden' ? 'forbidden' : reference.state === 'unavailable' ? 'not-connected' : reference.reason === 'not-configured' ? 'unverified-target' : 'missing-id')
}

function fact(value: unknown): boolean {
  if (!object(value)
    || !['id', 'no', 'name', 'status'].every(key => typeof value[key] === 'string')
    || !(value.amount === null || money(value.amount))
    || !(value.paidAmount === undefined || money(value.paidAmount))
    || !(value.date === null || isISODateDTO(value.date))
    || !object(value.navigation)) {
    return false
  }
  return unavailableNavigation(value.navigation, 'unverified-target')
}

function sourceEvidence(value: unknown): boolean {
  return object(value) && ['fileName', 'sheetName', 'sourceHash', 'priceUnit'].every(key => typeof value[key] === 'string')
    && Number.isSafeInteger(value.rowNumber) && Number(value.rowNumber) > 0
    && (value.externalRef === null || typeof value.externalRef === 'string')
    && typeof value.quantityUnitVerified === 'boolean'
}

function line(value: unknown): boolean {
  return object(value)
    && ['id', 'materialName', 'spec', 'brand', 'unit', 'note'].every(key => typeof value[key] === 'string')
    && typeof value.id === 'string' && Boolean(value.id)
    && (value.qty === null || quantity(value.qty))
    && (value.unitPrice === null || money(value.unitPrice))
    && (value.applicableTaxRate === undefined || value.applicableTaxRate === null || (typeof value.applicableTaxRate === 'number' && Number.isFinite(value.applicableTaxRate) && value.applicableTaxRate >= 0))
    && (value.amount === null || money(value.amount))
    && (value.plannedArrivalDate === null || isISODateDTO(value.plannedArrivalDate))
    && (value.materialGrade === undefined || typeof value.materialGrade === 'string')
    && (value.originalLineId === undefined || value.originalLineId === null || typeof value.originalLineId === 'string')
    && (value.changeAmount === undefined || value.changeAmount === null || money(value.changeAmount))
    && (value.changeBasis === undefined || typeof value.changeBasis === 'string')
    && (value.source === undefined || value.source === null || sourceEvidence(value.source))
}

function deduction(value: unknown): boolean {
  return object(value) && ['id', 'name', 'basis'].every(key => typeof value[key] === 'string')
    && Boolean(value.id) && (value.amount === null || (money(value.amount) && Number(value.amount) <= 0))
}

function supplement(value: unknown, parentId: string): boolean {
  return object(value) && ['id', 'contractId', 'no', 'name', 'content', 'status'].every(key => typeof value[key] === 'string')
    && value.contractId === parentId && Boolean(value.id)
    && signatorySnapshot(value.ourSignatorySnapshot)
    && (value.amount === null || (money(value.amount) && Number(value.amount) >= 0))
    && (value.signDate === null || isISODateDTO(value.signDate))
    && Array.isArray(value.lineItems) && value.lineItems.every(line)
    && Array.isArray(value.deductions) && value.deductions.every(deduction)
    && (value.originalLineSnapshots === undefined || (Array.isArray(value.originalLineSnapshots) && value.originalLineSnapshots.every(row => object(row)
      && typeof row.originalLineId === 'string' && Boolean(row.originalLineId)
      && ((Number.isSafeInteger(row.parentVersion) && Number(row.parentVersion) > 0) || (row.parentVersion === null && isISODateTimeDTO(row.sourceUpdatedAt)))
      && (row.sourceUpdatedAt === undefined || isISODateTimeDTO(row.sourceUpdatedAt))
      && typeof row.materialName === 'string' && (row.qty === null || quantity(row.qty)) && (row.unitPrice === null || money(row.unitPrice)))))
}

function file(value: unknown): boolean {
  return object(value)
    && ['id', 'fileName', 'mimeType', 'category'].every(key => typeof value[key] === 'string')
    && Number.isSafeInteger(value.fileSize) && Number(value.fileSize) >= 0
    && (value.uploadedAt === null || isISODateTimeDTO(value.uploadedAt))
    && (value.originalAvailable === undefined || typeof value.originalAvailable === 'boolean')
    && (value.ownerId === undefined || (typeof value.ownerId === 'string' && Boolean(value.ownerId)))
}

function listItem(value: unknown): boolean {
  if (!object(value))
    return false
  if (!isDataOriginDTO(value.dataOrigin))
    return false
  return entityRef(value.project, 'project')
    && entityRef(value.supplier, 'supplier')
    && ['rowKey', 'id', 'no', 'name', 'status'].every(key => typeof value[key] === 'string')
    && value.rowKey === `${value.dataOrigin}:${value.id}`
    && amounts(value.amounts)
    && (value.signDate === null || isISODateDTO(value.signDate))
    && isISODateTimeDTO(value.updatedAt)
    && resolvedNavigation(value.navigation, 'contract', value.id as string, value.dataOrigin, '材采')
    && referenceNavigation(value.projectNavigation, value.project, value.dataOrigin)
    && referenceNavigation(value.supplierNavigation, value.supplier, value.dataOrigin)
}

function originSummary(value: unknown): boolean {
  return object(value)
    && Number.isSafeInteger(value.contractCount) && Number(value.contractCount) >= 0
    && (value.changedAmount === null || money(value.changedAmount))
    && ['invoicedAmount', 'paidAmount'].every(key => value[key] === null || money(value[key]))
}

export function decodeMaterialContractListPage(value: unknown): MaterialContractListPageDTO {
  if (!pageBase(value)
    || !hasConsistentOriginReadMeta(value, 'material-contract-read-v2')
    || !Array.isArray(value.items) || !value.items.every(listItem)
    || !object(value.summary)
    || !Array.isArray(value.summary.projects)
    || !Array.isArray(value.summary.suppliers)
    || !Array.isArray(value.summary.statuses)
    || !value.summary.projects.every(option => object(option) && typeof option.id === 'string' && typeof option.label === 'string')
    || !value.summary.suppliers.every(option => object(option) && typeof option.id === 'string' && typeof option.label === 'string')
    || !value.summary.statuses.every(option => object(option) && typeof option.value === 'string' && Number.isSafeInteger(option.count) && Number(option.count) >= 0)
    || !object(value.summary.origins)
    || !originSummary(value.summary.origins.real)
    || !originSummary(value.summary.origins.demo)) {
    return invalid('中央后台返回的材料采购合同列表读模型无效')
  }
  return value as unknown as MaterialContractListPageDTO
}

export function decodeMaterialContractDetailRead(value: unknown): MaterialContractDetailReadDTO {
  const contract = object(value) && object(value.contract) ? value.contract : null
  const sections = object(value) && object(value.sections) ? value.sections : null
  const materials = sections && object(sections.materials) ? sections.materials : null
  if (!object(value)
    || !isDataOriginDTO(value.dataOrigin)
    || !hasConsistentReadMeta(value, 'material-contract-read-v2', value.dataOrigin)
    || !contract
    || !signatorySnapshot(contract.ourSignatorySnapshot)
    || !(contract.legacyPartyA === null || typeof contract.legacyPartyA === 'string')
    || contract.dataOrigin !== value.dataOrigin
    || contract.kind !== '材采'
    || !['id', 'no', 'name', 'content', 'invoiceType', 'contactName', 'contactPhone', 'mainTerms', 'paymentTerms', 'brandQualityTerms', 'scheduleTerms', 'warrantyTerms', 'specialTerms', 'invoiceName', 'invoiceTaxNo', 'invoiceAddressPhone', 'invoiceBank', 'invoiceBankAccount', 'status', 'note'].every(key => typeof contract[key] === 'string')
    || !isISODateTimeDTO(contract.updatedAt)
    || !entityRef(contract.project, 'project')
    || !entityRef(contract.supplier, 'supplier')
    || !amounts(contract.amounts)
    || !(contract.financialReadStatus === undefined || contract.financialReadStatus === 'unavailable')
    || (contract.signDate !== null && !isISODateDTO(contract.signDate))
    || !(contract.taxRate === null || (typeof contract.taxRate === 'number' && Number.isFinite(contract.taxRate)))
    || !(contract.retentionRatio === null || ratio(contract.retentionRatio))
    || !(contract.retentionAmount === null || money(contract.retentionAmount))
    || !(contract.retentionDays === null || (Number.isSafeInteger(contract.retentionDays) && Number(contract.retentionDays) >= 0))
    || !sections
    || !Array.isArray(sections.lineItems) || !sections.lineItems.every(line)
    || (sections.deductions !== undefined && (!Array.isArray(sections.deductions) || !sections.deductions.every(deduction)))
    || (sections.supplements !== undefined && (!Array.isArray(sections.supplements) || !sections.supplements.every(row => supplement(row, String(contract.id)))))
    || !materials
    || ![materials.requisitions, materials.arrivals, materials.directTransfers, materials.outbound, sections.invoices, sections.payments, sections.settlements, sections.penalties]
      .every(rows => Array.isArray(rows) && rows.every(fact))
      || !Array.isArray(sections.files) || !sections.files.every(file)
      || !referenceNavigation(value.projectNavigation, contract.project, value.dataOrigin)
      || !referenceNavigation(value.supplierNavigation, contract.supplier, value.dataOrigin)
      || !isISODateTimeDTO(value.asOf)
      || (value.sourceVersion !== null && typeof value.sourceVersion !== 'string')
      || !strings(value.capabilities)) {
    return invalid('中央后台返回的材料采购合同详情读模型无效')
  }
  return value as unknown as MaterialContractDetailReadDTO
}

export function serializeMaterialContractListQuery(query: MaterialContractListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    origin: query.origin ?? '',
    search: query.search,
    projectId: query.projectId ?? '',
    supplierId: query.supplierId ?? '',
    status: serializeContractListFilter(query.status),
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeMaterialContractDetailQuery(query: MaterialContractDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo), ...(query.supplementId ? { supplementId: query.supplementId } : {}) }
}

export function materialContractProblemFromUnknown(cause: unknown): MaterialContractRepositoryProblem {
  if (cause instanceof MaterialContractRepositoryProblem)
    return cause
  const problem = problemFromHttpFailure(cause)
  if (problem)
    return new MaterialContractRepositoryProblem(problem, { cause })
  return new MaterialContractRepositoryProblem(
    materialContractProblem('unavailable', '材料采购合同中央服务暂时不可用，请重试', true),
    { cause },
  )
}
