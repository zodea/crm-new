import type { EmptyDTO, EntityRefDTO, MetricDTO, MoneyDTO } from '../../types/read-model'
import type {
  ProjectListColumnFiltersDTO,
  ProjectListFacetOptionDTO,
  ProjectListPageDTO,
  ProjectListQueryDTO,
  ProjectListSourceRow,
  ProjectListStatusFacetDTO,
  ProjectPageSize,
} from './read-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import {
  IMPORTED_PROJECT_STATUS,
  PROJECT_PAGE_SIZES,
  projectProblem,
  ProjectRepositoryProblem,
} from './read-contract'
import { PROJECT_STATUSES } from './status'

function invalidQuery(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('invalid-query', message))
}

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function integer(value: unknown, label: string): number {
  const parsed = Number(one(value))
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    invalidQuery(`${label}必须是从 1 开始的整数`)
  return parsed
}

function stringList(value: unknown, label: string): string[] {
  const raw = one(value)
  if (raw == null || raw === '')
    return []
  if (typeof raw !== 'string')
    invalidQuery(`${label}格式无效`)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string'))
      invalidQuery(`${label}格式无效`)
    return [...new Set(parsed.map(item => item.trim()).filter(Boolean))]
  }
  catch (cause) {
    if (cause instanceof ProjectRepositoryProblem)
      throw cause
    invalidQuery(`${label}格式无效`)
  }
}

export function parseProjectListQuery(input: Record<string, unknown> = {}): ProjectListQueryDTO {
  const search = String(one(input.search) ?? '').trim()
  const statusValue = String(one(input.status) ?? '').trim()
  const sortValue = String(one(input.sort) ?? 'updated-desc')
  const page = input.page == null ? 1 : integer(input.page, '页码')
  const pageSizeValue = input.pageSize == null ? 10 : integer(input.pageSize, '每页条数')
  if (!PROJECT_PAGE_SIZES.includes(pageSizeValue as ProjectPageSize))
    invalidQuery('每页条数只支持 10、20、50 或 100')
  if (sortValue !== 'updated-desc' && sortValue !== 'name-asc')
    invalidQuery('不支持的项目排序')
  const plannedEnds = stringList(input.filterPlannedEnds, '计划竣工筛选')
  if (!plannedEnds.every(isISODateDTO))
    invalidQuery('计划竣工筛选必须使用 ISO 日期')
  return {
    search,
    status: statusValue || null,
    filters: {
      statuses: stringList(input.filterStatuses, '业务阶段筛选'),
      plannedEnds,
      managers: stringList(input.filterManagers, '项目经理筛选'),
      customerIds: stringList(input.filterCustomerIds, '客户筛选'),
    },
    sort: sortValue,
    page,
    pageSize: pageSizeValue as ProjectPageSize,
  }
}

export function serializeProjectListQuery(
  query: ProjectListQueryDTO,
): Record<string, unknown> {
  return {
    search: query.search,
    status: query.status,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
    filterStatuses: JSON.stringify(query.filters.statuses),
    filterPlannedEnds: JSON.stringify(query.filters.plannedEnds),
    filterManagers: JSON.stringify(query.filters.managers),
    filterCustomerIds: JSON.stringify(query.filters.customerIds),
  }
}

function roundMoney(value: number): MoneyDTO {
  if (!Number.isFinite(value)) {
    throw new ProjectRepositoryProblem(
      projectProblem('internal-error', '项目读模型包含无效金额'),
    )
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return rounded.toFixed(2)
}

function customerRef(
  id: string | null,
  label: string | null,
  permission: 'allowed' | 'forbidden' = 'allowed',
): EntityRefDTO & { entity: 'customer' } {
  if (permission === 'forbidden') {
    return {
      state: 'forbidden',
      entity: 'customer',
      id,
      label: null,
      reason: 'permission-denied',
    }
  }
  if (!id) {
    return {
      state: 'missing',
      entity: 'customer',
      id: null,
      label: null,
      reason: 'not-configured',
    }
  }
  if (!label) {
    return {
      state: 'missing',
      entity: 'customer',
      id: null,
      label: null,
      reason: 'not-recorded',
    }
  }
  return { state: 'resolved', entity: 'customer', id, label, no: null }
}

function projectMetric(
  value: number | null,
  projectId: string,
  source: string,
  entity: 'receipt' | 'target-cost',
  asOf: string,
): MetricDTO {
  return {
    value: value == null ? null : roundMoney(value),
    unit: 'CNY',
    status: value == null ? 'pending' : 'complete',
    missingSources: value == null ? [source] : [],
    asOf,
    drilldown: { entity, filters: { projectId } },
  }
}

function summaryMetric(
  rows: readonly ProjectListSourceRow[],
  field: 'income' | 'budget',
  entity: 'receipt' | 'target-cost',
  asOf: string,
): MetricDTO {
  const missingSources = rows.filter(row => row[field] == null).map(row => row.id)
  const value = rows.length > 0 && missingSources.length === 0
    ? roundMoney(rows.reduce((total, row) => total + (row[field] ?? 0), 0))
    : null
  return {
    value,
    unit: 'CNY',
    status: rows.length === 0 ? 'undefined' : missingSources.length ? 'partial' : 'complete',
    missingSources,
    asOf,
    drilldown: { entity, filters: {} },
  }
}

const SEARCH_FIELDS = [
  'name',
  'code',
  'address',
  'contractName',
  'customerName',
  'manager',
  'execManager',
  'builder',
] as const satisfies readonly (keyof ProjectListSourceRow)[]

function searchableValue(
  row: ProjectListSourceRow,
  field: typeof SEARCH_FIELDS[number],
): string {
  if (field === 'customerName' && row.customerPermission === 'forbidden')
    return ''
  return String(row[field] ?? '')
}

function isKnownProjectStatus(status: string): boolean {
  return PROJECT_STATUSES.includes(status as typeof PROJECT_STATUSES[number])
}

function matchesStatus(row: ProjectListSourceRow, status: string | null): boolean {
  if (!status)
    return true
  if (status === IMPORTED_PROJECT_STATUS)
    return !isKnownProjectStatus(row.status)
  return row.status === status
}

type FilterKey = keyof ProjectListColumnFiltersDTO

function matchesColumnFilters(
  row: ProjectListSourceRow,
  filters: ProjectListColumnFiltersDTO,
  omit?: FilterKey,
): boolean {
  if (omit !== 'statuses' && filters.statuses.length && !filters.statuses.includes(row.status))
    return false
  if (omit !== 'plannedEnds'
    && filters.plannedEnds.length
    && (!row.plannedEnd || !filters.plannedEnds.includes(row.plannedEnd))) {
    return false
  }
  if (omit !== 'managers' && filters.managers.length && !filters.managers.includes(row.manager))
    return false
  if (omit !== 'customerIds' && filters.customerIds.length) {
    if (row.customerPermission === 'forbidden'
      || !row.customerId
      || !filters.customerIds.includes(row.customerId)) {
      return false
    }
  }
  return true
}

function textFacets(
  rows: readonly ProjectListSourceRow[],
  value: (row: ProjectListSourceRow) => string | null,
): ProjectListFacetOptionDTO[] {
  const options = new Map<string, string>()
  for (const row of rows) {
    const item = value(row)
    if (item)
      options.set(item, item)
  }
  return [...options].map(([optionValue, label]) => ({ value: optionValue, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

function customerFacets(rows: readonly ProjectListSourceRow[]): ProjectListFacetOptionDTO[] {
  const options = new Map<string, string>()
  for (const row of rows) {
    if (row.customerPermission === 'allowed' && row.customerId && row.customerName)
      options.set(row.customerId, row.customerName)
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

function statusFacets(rows: readonly ProjectListSourceRow[]): ProjectListStatusFacetDTO[] {
  const counts = new Map<string, number>()
  for (const row of rows)
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([value, count]) => ({ value, label: value, count }))
}

function preserveSelectedFacets<T extends ProjectListFacetOptionDTO>(
  options: readonly T[],
  selected: readonly string[],
  createMissing: (value: string) => T,
): T[] {
  const merged = new Map(options.map(option => [option.value, option]))
  for (const value of selected) {
    if (!merged.has(value))
      merged.set(value, createMissing(value))
  }
  return [...merged.values()].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

function toItem(row: ProjectListSourceRow, asOf: string): ProjectListPageDTO['items'][number] {
  return {
    project: {
      state: 'resolved',
      entity: 'project',
      id: row.id,
      label: row.name,
      no: row.code || null,
    },
    code: row.code,
    status: row.status,
    contractAmount: row.contractAmount == null ? null : roundMoney(row.contractAmount),
    operationType: row.operationType,
    startDate: row.startDate,
    plannedEnd: row.plannedEnd,
    actualEnd: row.actualEnd,
    plannedDuration: row.plannedDuration,
    manager: row.manager,
    execManager: row.execManager,
    builder: row.builder,
    customer: customerRef(row.customerId, row.customerName, row.customerPermission),
    secondaryCustomer: customerRef(
      row.secondaryCustomerId,
      row.secondaryCustomerName,
      row.secondaryCustomerPermission,
    ),
    contractName: row.contractName,
    contractor: row.contractor,
    region: row.region,
    riskLevel: row.riskLevel,
    address: row.address,
    income: projectMetric(row.income, row.id, 'receipt-registrations', 'receipt', asOf),
    budget: projectMetric(row.budget, row.id, 'target-cost-baseline', 'target-cost', asOf),
    updatedAt: row.updatedAt,
  }
}

export function buildProjectListPage(input: {
  rows: readonly ProjectListSourceRow[]
  query: ProjectListQueryDTO
  asOf: string
  sourceVersion: string | null
}): ProjectListPageDTO {
  if (!isISODateTimeDTO(input.asOf)
    || input.rows.some(row => !isISODateTimeDTO(row.updatedAt)
      || ![row.startDate, row.plannedEnd, row.actualEnd].every(value => value === null || isISODateDTO(value)))) {
    throw new ProjectRepositoryProblem(projectProblem(
      'internal-error',
      '项目读模型来源包含无效 ISO 日期或时间',
    ))
  }
  const queryText = input.query.search.toLocaleLowerCase('zh-CN')
  const searched = input.rows.filter(row => !queryText || SEARCH_FIELDS.some(field =>
    searchableValue(row, field).toLocaleLowerCase('zh-CN').includes(queryText),
  ))
  const columnFiltered = searched.filter(row =>
    matchesColumnFilters(row, input.query.filters),
  )
  const filtered = columnFiltered.filter(row => matchesStatus(row, input.query.status))
  const sorted = [...filtered].sort((a, b) => {
    const primary = input.query.sort === 'name-asc'
      ? a.name.localeCompare(b.name, 'zh-CN')
      : b.updatedAt.localeCompare(a.updatedAt)
    return primary || a.id.localeCompare(b.id)
  })
  const offset = (input.query.page - 1) * input.query.pageSize
  const empty: EmptyDTO | null = filtered.length > 0
    ? null
    : {
        reason: input.rows.length === 0 ? 'no-records' : 'no-filter-match',
        missingRelations: [],
      }
  const statusFacetRows = searched.filter(row =>
    matchesColumnFilters(row, input.query.filters, 'statuses'),
  )
  const filteredStatusFacets = statusFacets(filtered)
  const statusCounts = Object.fromEntries(filteredStatusFacets.map(facet => [facet.value, facet.count]))
  const facetRows = (omit: FilterKey) => searched.filter(row =>
    matchesStatus(row, input.query.status)
    && matchesColumnFilters(row, input.query.filters, omit),
  )
  return {
    items: sorted.slice(offset, offset + input.query.pageSize).map(row => toItem(row, input.asOf)),
    pagination: {
      page: input.query.page,
      pageSize: input.query.pageSize,
      total: filtered.length,
    },
    summary: {
      projectCount: filtered.length,
      statusCounts,
      facets: {
        statuses: preserveSelectedFacets(
          statusFacets(statusFacetRows),
          input.query.filters.statuses,
          value => ({ value, label: value, count: 0 }),
        ),
        plannedEnds: preserveSelectedFacets(
          textFacets(facetRows('plannedEnds'), row => row.plannedEnd),
          input.query.filters.plannedEnds,
          value => ({ value, label: value }),
        ),
        managers: preserveSelectedFacets(
          textFacets(facetRows('managers'), row => row.manager || null),
          input.query.filters.managers,
          value => ({ value, label: value }),
        ),
        customers: preserveSelectedFacets(
          customerFacets(facetRows('customerIds')),
          input.query.filters.customerIds,
          (value) => {
            const visible = input.rows.find(row => row.customerId === value
              && row.customerPermission === 'allowed'
              && row.customerName)
            return { value, label: visible?.customerName ?? '已选客户（当前不可见）' }
          },
        ),
      },
      income: summaryMetric(filtered, 'income', 'receipt', input.asOf),
      budget: summaryMetric(filtered, 'budget', 'target-cost', input.asOf),
    },
    empty,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: ['project:list:read'],
  }
}
