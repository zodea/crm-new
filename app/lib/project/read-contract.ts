import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MetricDTO,
  MoneyDTO,
  NavigationIntentDTO,
  OpaqueIdDTO,
  PageDTO,
  ProblemDTO,
} from '../../types/read-model'

export const PROJECT_PAGE_SIZES = [10, 20, 50, 100] as const
export const IMPORTED_PROJECT_STATUS = '__unrecognized__'

export type ProjectPageSize = typeof PROJECT_PAGE_SIZES[number]
export type ProjectListSort = 'updated-desc' | 'name-asc'

export interface ProjectListColumnFiltersDTO {
  statuses: string[]
  plannedEnds: ISODateDTO[]
  managers: string[]
  customerIds: OpaqueIdDTO[]
}

export interface ProjectListQueryDTO {
  includeDemo: boolean
  search: string
  status: string | null
  filters: ProjectListColumnFiltersDTO
  sort: ProjectListSort
  page: number
  pageSize: ProjectPageSize
}

export interface ProjectDetailQueryDTO {
  id: OpaqueIdDTO
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface ProjectListSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  code: string
  status: string
  contractAmount: number | null
  operationType: string
  startDate: ISODateDTO | null
  plannedEnd: ISODateDTO | null
  actualEnd: ISODateDTO | null
  plannedDuration: number | null
  manager: string
  execManager: string
  builder: string
  customerId: string | null
  customerName: string | null
  customerPermission: 'allowed' | 'forbidden'
  secondaryCustomerId: string | null
  secondaryCustomerName: string | null
  secondaryCustomerPermission: 'allowed' | 'forbidden'
  contractName: string
  contractor: string
  region: string
  riskLevel: string
  address: string
  income: number | null
  budget: number | null
  updatedAt: string
}

export interface ProjectListItemDTO {
  dataOrigin: DataOriginDTO
  project: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'project' }
  navigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }> & {
    subject: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'project' }
    variant: 'detail'
  }
  code: string
  status: string
  contractAmount: MoneyDTO | null
  operationType: string
  startDate: ISODateDTO | null
  plannedEnd: ISODateDTO | null
  actualEnd: ISODateDTO | null
  plannedDuration: number | null
  manager: string
  execManager: string
  builder: string
  customer: EntityRefDTO & { entity: 'customer' }
  secondaryCustomer: EntityRefDTO & { entity: 'customer' }
  contractName: string
  contractor: string
  region: string
  riskLevel: string
  address: string
  income: MetricDTO
  budget: MetricDTO
  updatedAt: string
}

export interface ProjectListFacetOptionDTO {
  value: string
  label: string
}

export interface ProjectListStatusFacetDTO extends ProjectListFacetOptionDTO {
  count: number
}

export interface ProjectListFacetsDTO {
  statuses: ProjectListStatusFacetDTO[]
  plannedEnds: ProjectListFacetOptionDTO[]
  managers: ProjectListFacetOptionDTO[]
  customers: ProjectListFacetOptionDTO[]
}

export interface ProjectListOriginSummaryDTO {
  projectCount: number
  statusCounts: Record<string, number>
  income: MetricDTO
  budget: MetricDTO
}

export interface ProjectListSummaryDTO {
  facets: ProjectListFacetsDTO
  origins: Record<DataOriginDTO, ProjectListOriginSummaryDTO>
}

export type ProjectListPageDTO = PageDTO<ProjectListItemDTO, ProjectListSummaryDTO>

export interface ProjectDetailReadDTO {
  item: ProjectListItemDTO
  materialContracts: {
    count: MetricDTO
    navigation: NavigationIntentDTO
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface ProjectListRepository {
  list: (query: ProjectListQueryDTO) => Promise<ProjectListPageDTO>
  get: (query: ProjectDetailQueryDTO) => Promise<ProjectDetailReadDTO>
}

export class ProjectRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'ProjectRepositoryProblem'
  }
}

export function projectProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}
