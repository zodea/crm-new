import type { ProjectListItemDTO } from './repository'
import type { DataOriginDTO, EntityRefDTO, MetricDTO, MoneyDTO } from '~/types/read-model'

export interface ProjectListViewRow {
  dataOrigin: DataOriginDTO
  rowIdentity: string
  id: string
  name: string
  code: string
  status: string
  contractAmount: MoneyDTO | null
  operationType: string
  startDate: string | null
  plannedEnd: string | null
  actualEnd: string | null
  plannedDuration: number | null
  manager: string
  execManager: string
  builder: string
  customer: EntityRefDTO & { entity: 'customer' }
  customerId: string | null
  developer: string
  developer2: string
  contractName: string
  contractor: string
  region: string
  riskLevel: string
  address: string
  income: MetricDTO['value']
  budget: MetricDTO['value']
  updatedAt: string
}

function resolvedLabel(reference: EntityRefDTO): string {
  return reference.state === 'resolved' ? reference.label : ''
}

export function projectListViewRow(item: ProjectListItemDTO): ProjectListViewRow {
  return {
    dataOrigin: item.dataOrigin,
    rowIdentity: `${item.dataOrigin}:${item.project.id}`,
    id: item.project.id,
    name: item.project.label,
    code: item.code,
    status: item.status,
    contractAmount: item.contractAmount,
    operationType: item.operationType,
    startDate: item.startDate,
    plannedEnd: item.plannedEnd,
    actualEnd: item.actualEnd,
    plannedDuration: item.plannedDuration,
    manager: item.manager,
    execManager: item.execManager,
    builder: item.builder,
    customer: item.customer,
    customerId: item.customer.state === 'resolved' ? item.customer.id : null,
    developer: resolvedLabel(item.customer),
    developer2: resolvedLabel(item.secondaryCustomer),
    contractName: item.contractName,
    contractor: item.contractor,
    region: item.region,
    riskLevel: item.riskLevel,
    address: item.address,
    income: item.income.value,
    budget: item.budget.value,
    updatedAt: item.updatedAt,
  }
}

export interface ProjectListFilterable {
  name: string
  code: string
  address: string
  contractName: string
  developer: string
  manager: string
  status: string
}

export interface ProjectListFilters {
  search: string
  status: string
}

export interface ProjectColumnFilter {
  field: string
  values: unknown[]
}

const SEARCH_FIELDS = ['name', 'code', 'address', 'contractName', 'developer', 'manager'] as const

export function filterProjects<T extends ProjectListFilterable>(
  rows: readonly T[],
  filters: ProjectListFilters,
): T[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN')

  return rows.filter((project) => {
    if (filters.status !== 'all' && project.status !== filters.status)
      return false
    if (!query)
      return true

    return SEARCH_FIELDS.some(field => project[field].toLocaleLowerCase('zh-CN').includes(query))
  })
}

export function filterProjectColumns<T extends object>(
  rows: readonly T[],
  filters: readonly ProjectColumnFilter[],
): T[] {
  return rows.filter(row => filters.every((filter) => {
    if (!filter.values.length)
      return true
    return filter.values.includes((row as Record<string, unknown>)[filter.field])
  }))
}
