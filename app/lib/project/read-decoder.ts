import type { MetricDTO, MoneyDTO } from '../../types/read-model'
import type {
  ProjectDetailReadDTO,
  ProjectListFacetOptionDTO,
  ProjectListItemDTO,
  ProjectListPageDTO,
  ProjectListStatusFacetDTO,
  ProjectPageSize,
} from './read-contract'
import { isDataOriginDTO, isEntityKindDTO, isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import {
  PROJECT_PAGE_SIZES,
  projectProblem,
  ProjectRepositoryProblem,
} from './read-contract'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMoney(value: unknown): value is MoneyDTO {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

const METRIC_STATUSES = new Set<MetricDTO['status']>([
  'complete',
  'partial',
  'pending',
  'not-applicable',
  'undefined',
])

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value)
    && Object.values(value).every(item => typeof item === 'string')
}

function isMetric(value: unknown): value is MetricDTO {
  const drilldown = isObject(value) ? value.drilldown : undefined
  return isObject(value)
    && (value.value === null || isMoney(value.value))
    && value.unit === 'CNY'
    && METRIC_STATUSES.has(value.status as MetricDTO['status'])
    && Array.isArray(value.missingSources)
    && value.missingSources.every(item => typeof item === 'string')
    && isISODateTimeDTO(value.asOf)
    && (value.drilldown === null
      || (isObject(drilldown)
        && isEntityKindDTO(drilldown.entity)
        && isStringRecord(drilldown.filters)))
}

function isCountMetric(value: unknown): value is MetricDTO {
  const drilldown = isObject(value) ? value.drilldown : undefined
  return isObject(value)
    && (value.value === null || (Number.isSafeInteger(value.value) && Number(value.value) >= 0))
    && value.unit === 'count'
    && METRIC_STATUSES.has(value.status as MetricDTO['status'])
    && Array.isArray(value.missingSources)
    && value.missingSources.every(item => typeof item === 'string')
    && isISODateTimeDTO(value.asOf)
    && (value.drilldown === null
      || (isObject(drilldown)
        && drilldown.entity === 'contract'
        && isStringRecord(drilldown.filters)))
}

function isMaterialContractJourney(value: unknown, item: unknown): boolean {
  if (!isObject(value) || !isCountMetric(value.count) || !isObject(item))
    return false
  const navigation = value.navigation
  if (!isObject(navigation))
    return false
  if (navigation.kind === 'unavailable')
    return ['forbidden', 'not-connected', 'missing-id', 'error'].includes(String(navigation.reason)) && value.count.value === null
  return navigation.kind === 'entity-list'
    && navigation.entity === 'contract'
    && navigation.variant === 'material'
    && navigation.view === null
    && isObject(navigation.filters)
    && navigation.filters.projectId === (isObject(item.project) ? item.project.id : undefined)
    && navigation.filters.dataOrigin === item.dataOrigin
}

function isEntityRef(value: unknown, entity: 'project' | 'customer'): boolean {
  if (!isObject(value) || value.entity !== entity || typeof value.state !== 'string')
    return false
  if (value.state === 'resolved') {
    return typeof value.id === 'string'
      && value.id.trim().length > 0
      && typeof value.label === 'string'
      && (value.no === null || typeof value.no === 'string')
  }
  if (value.state === 'missing') {
    return value.id === null
      && value.label === null
      && ['not-configured', 'not-recorded', 'not-applicable'].includes(String(value.reason))
  }
  if (value.state === 'forbidden') {
    return (value.id === null || typeof value.id === 'string')
      && value.label === null
      && value.reason === 'permission-denied'
  }
  return false
}

function isProjectNavigation(
  value: unknown,
  project: unknown,
  dataOrigin: unknown,
): boolean {
  if (!isObject(value)
    || value.kind !== 'entity-detail'
    || value.variant !== 'detail'
    || value.view !== null
    || !isObject(value.filters)
    || Object.keys(value.filters).length !== 1
    || value.filters.dataOrigin !== dataOrigin
    || !isDataOriginDTO(value.filters.dataOrigin)
    || !isObject(project)
    || !isObject(value.subject)) {
    return false
  }
  return value.subject.state === project.state
    && value.subject.entity === project.entity
    && value.subject.id === project.id
    && value.subject.label === project.label
    && value.subject.no === project.no
}

function isNullableISODate(value: unknown): value is string | null {
  return value === null || isISODateDTO(value)
}

function isProjectItem(value: unknown): value is ProjectListItemDTO {
  if (!isObject(value))
    return false
  const stringFields = [
    'code',
    'status',
    'operationType',
    'manager',
    'execManager',
    'builder',
    'contractName',
    'contractor',
    'region',
    'riskLevel',
    'address',
  ]
  return stringFields.every(field => typeof value[field] === 'string')
    && isDataOriginDTO(value.dataOrigin)
    && ['startDate', 'plannedEnd', 'actualEnd'].every(field =>
      isNullableISODate(value[field]),
    )
    && isISODateTimeDTO(value.updatedAt)
    && isEntityRef(value.project, 'project')
    && isProjectNavigation(value.navigation, value.project, value.dataOrigin)
    && isEntityRef(value.customer, 'customer')
    && isEntityRef(value.secondaryCustomer, 'customer')
    && (value.contractAmount === null || isMoney(value.contractAmount))
    && (value.plannedDuration === null
      || (Number.isSafeInteger(value.plannedDuration) && Number(value.plannedDuration) >= 0))
    && isMetric(value.income)
    && isMetric(value.budget)
}

function isStatusCounts(value: unknown): value is Record<string, number> {
  return isObject(value)
    && Object.values(value).every(count => Number.isSafeInteger(count) && Number(count) >= 0)
}

function isFacetOption(value: unknown): value is ProjectListFacetOptionDTO {
  return isObject(value)
    && typeof value.value === 'string'
    && typeof value.label === 'string'
}

function isStatusFacet(value: unknown): value is ProjectListStatusFacetDTO {
  return isObject(value)
    && isFacetOption(value)
    && Number.isSafeInteger(value.count)
    && Number(value.count) >= 0
}

function isFacets(value: unknown): boolean {
  return isObject(value)
    && Array.isArray(value.statuses)
    && value.statuses.every(isStatusFacet)
    && Array.isArray(value.plannedEnds)
    && value.plannedEnds.every(option => isFacetOption(option) && isISODateDTO(option.value))
    && Array.isArray(value.managers)
    && value.managers.every(isFacetOption)
    && Array.isArray(value.customers)
    && value.customers.every(isFacetOption)
}

function isOriginSummary(value: unknown): boolean {
  return isObject(value)
    && Number.isSafeInteger(value.projectCount) && Number(value.projectCount) >= 0
    && isStatusCounts(value.statusCounts)
    && isMetric(value.income)
    && isMetric(value.budget)
}

function isEmpty(value: unknown): boolean {
  return isObject(value)
    && ['no-records', 'no-filter-match', 'missing-relation'].includes(String(value.reason))
    && Array.isArray(value.missingRelations)
    && value.missingRelations.every(isEntityKindDTO)
}

export function decodeProjectListPage(value: unknown): ProjectListPageDTO {
  const valid = isObject(value)
    && Array.isArray(value.items)
    && value.items.every(isProjectItem)
    && isObject(value.pagination)
    && Number.isSafeInteger(value.pagination.page) && Number(value.pagination.page) >= 1
    && PROJECT_PAGE_SIZES.includes(value.pagination.pageSize as ProjectPageSize)
    && Number.isSafeInteger(value.pagination.total) && Number(value.pagination.total) >= 0
    && isObject(value.summary)
    && isFacets(value.summary.facets)
    && isObject(value.summary.origins)
    && isOriginSummary(value.summary.origins.real)
    && isOriginSummary(value.summary.origins.demo)
    && (value.empty === null || isEmpty(value.empty))
    && isISODateTimeDTO(value.asOf)
    && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && Array.isArray(value.capabilities)
    && value.capabilities.every(capability => typeof capability === 'string')
  if (!valid) {
    throw new ProjectRepositoryProblem(projectProblem(
      'internal-error',
      '中央后台返回的项目读模型无效',
    ))
  }
  return value as unknown as ProjectListPageDTO
}

export function decodeProjectDetailRead(value: unknown): ProjectDetailReadDTO {
  const valid = isObject(value)
    && isProjectItem(value.item)
    && isMaterialContractJourney(value.materialContracts, value.item)
    && isISODateTimeDTO(value.asOf)
    && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && Array.isArray(value.capabilities)
    && value.capabilities.every(capability => typeof capability === 'string')
  if (!valid) {
    throw new ProjectRepositoryProblem(projectProblem(
      'internal-error',
      '中央后台返回的项目详情读模型无效',
    ))
  }
  return value as unknown as ProjectDetailReadDTO
}

export function projectProblemFromUnknown(cause: unknown): ProjectRepositoryProblem {
  if (cause instanceof ProjectRepositoryProblem)
    return cause
  return new ProjectRepositoryProblem(
    projectProblem('unavailable', '项目读取服务暂时不可用，请重试', true),
    { cause },
  )
}
