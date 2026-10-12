import type { ProjectListItemDTO } from './repository'
import type { NavigationTargetResolution } from '~/lib/nav/target-registry'
import type { DataOriginDTO, EntityRefDTO, MetricDTO, MoneyDTO } from '~/types/read-model'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

export interface ProjectListViewRow {
  dataOrigin: DataOriginDTO
  rowIdentity: string
  id: string
  name: string
  navigation: ProjectListItemDTO['navigation']
  target: NavigationTargetResolution
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
    navigation: item.navigation,
    target: resolveNavigationTarget(item.navigation),
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
