import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  NavigationIntentDTO,
  PageDTO,
  ProblemDTO,
  ReadMetaDTO,
} from '../../types/read-model'
import type { PayrollHostSection } from './payroll-read'

export const CREW_WORKER_PAGE_SIZES = [10, 20, 50, 100] as const
export type CrewWorkerPageSize = typeof CREW_WORKER_PAGE_SIZES[number]

export interface CrewListQueryDTO {
  includeDemo: boolean
  search: string
  trade: string | string[] | null
  status: string | string[] | null
  sort: 'updated-desc' | 'name-asc' | 'name-desc'
  page: number
  pageSize: CrewWorkerPageSize
}

export interface CrewSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  trade: string
  tradeCapabilities: string[]
  itemCapabilities: string[]
  contactName: string
  contactPhone: string
  defaultPayRatio: number | null
  rentSubsidyEnabled: boolean
  rentSubsidyPrice: number | null
  mgmtFeeEnabled: boolean
  mgmtFeePrice: number | null
  assignmentLevel: 'crew' | 'worker'
  note: string
  status: string
  updatedAt: ISODateTimeDTO
}

export interface WorkerSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  crewId: string | null
  currentProjectId: string | null
  linkedWorkerId?: string | null
  name: string
  gender?: string
  trade: string
  tradeCapabilities?: string[]
  itemCapabilities?: string[]
  phone: string
  idCard: string
  hometown?: string
  emergencyContact?: string
  emergencyPhone?: string
  skillLevel?: string
  dailyWage?: number | null
  familyGroupId?: string | null
  projectStatus: string
  entryDate: ISODateDTO | null
  exitDate: ISODateDTO | null
  safetyEducation: boolean
  bankName?: string
  bankAccount?: string
  bankCode?: string
  note?: string
  status: string
  updatedAt: ISODateTimeDTO
}

interface CrewWorkerAssignmentSourceBase {
  dataOrigin: DataOriginDTO
  id: string
  projectId: string
  unitId: string
  buildingName?: string
  floorName?: string
  unitName?: string
  trade?: string
  note?: string
  scopes?: Array<{ roomName: string, itemName: string }>
  completedStageCount: number
}

export type CrewWorkerAssignmentSourceRow = CrewWorkerAssignmentSourceBase & (
  | { crewId: string, workerId: null }
  | { crewId: null, workerId: string }
)

export interface CrewWorkerWageSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  crewId: string
  projectId: string
  month?: string
  status: string
  grossAmount: number
  actualAmount: number | null
  workerFacts: Array<{
    workerId: string
    lineAmount: number
    allocatedAmount: number | null
  }>
}

export interface CrewWorkerProjectSourceRow {
  dataOrigin: DataOriginDTO
  id: string
  name: string
  code: string
  status: string
  permission: 'allowed' | 'forbidden' | 'unavailable'
}

export interface CrewWorkerPenaltySourceRow {
  dataOrigin: DataOriginDTO
  id: string
  no: string
  crewId: string | null
  workerId: string | null
  responsibleWorkerId: string | null
  projectId: string | null
  source: string
  location: string
  reason: string
  amount: number | null
  penaltyDate: ISODateDTO | null
  status: string
}

export interface CrewListItemDTO {
  dataOrigin: DataOriginDTO
  crew: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'crew' }
  navigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }>
  trade: string
  contactName: string
  contactPhone: string
  memberCount: number
  activeMemberCount: number
  projectCount: number | null
  status: string
  updatedAt: ISODateTimeDTO
}

export interface CrewListSummaryDTO {
  trades: Array<{ value: string, label: string, count: number }>
  statuses: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, { crewCount: number, workerCount: number }>
}

export type CrewListPageDTO = PageDTO<CrewListItemDTO, CrewListSummaryDTO> & { meta: ReadMetaDTO, originMeta: Record<DataOriginDTO, ReadMetaDTO> }

export interface CrewWorkerReadRepository {
  listCrews: (query: CrewListQueryDTO) => Promise<CrewListPageDTO>
  getCrew: (query: CrewDetailQueryDTO) => Promise<CrewDetailReadDTO>
  listWorkers: (query: WorkerListQueryDTO) => Promise<WorkerListPageDTO>
  getWorker: (query: WorkerDetailQueryDTO) => Promise<WorkerDetailReadDTO>
  getRelationFactIdentity: (query: CrewWorkerRelationFactQueryDTO) => Promise<CrewWorkerRelationFactIdentityDTO>
}

export type CrewWorkerRelationFactKindDTO = 'assignment' | 'wage' | 'penalty'

export interface CrewWorkerRelationFactQueryDTO {
  kind: CrewWorkerRelationFactKindDTO
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface CrewWorkerRelationFactIdentityDTO {
  meta: ReadMetaDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
  kind: CrewWorkerRelationFactKindDTO
  id: string
  dataOrigin: DataOriginDTO
  projectId: string | null
  owners: Array<{ kind: 'crew' | 'worker', id: string }>
}

export class CrewWorkerRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'CrewWorkerRepositoryProblem'
  }
}

export function crewWorkerProblem(code: ProblemDTO['code'], message: string, retryable = false): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}

export interface WorkerListQueryDTO {
  includeDemo: boolean
  search: string
  trade: string | string[] | null
  crewId: string | null
  projectStatus: string | string[] | null
  status: string | string[] | null
  sort: 'updated-desc' | 'name-asc' | 'name-desc'
  page: number
  pageSize: CrewWorkerPageSize
}

export interface WorkerListItemDTO {
  dataOrigin: DataOriginDTO
  worker: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'worker' }
  navigation: Extract<NavigationIntentDTO, { kind: 'entity-detail' }>
  trade: string
  crew: EntityRefDTO & { entity: 'crew' }
  crewNavigation: NavigationIntentDTO
  currentProject: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  projectStatus: string
  status: string
  phone: string
  idCard: string
  entryDate: ISODateDTO | null
  exitDate: ISODateDTO | null
  safetyEducation: boolean
  updatedAt: ISODateTimeDTO
}

export interface WorkerListSummaryDTO {
  trades: Array<{ value: string, label: string, count: number }>
  projectStatuses: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, { workerCount: number, activeWorkerCount: number }>
}

export type WorkerListPageDTO = PageDTO<WorkerListItemDTO, WorkerListSummaryDTO> & { meta: ReadMetaDTO, originMeta: Record<DataOriginDTO, ReadMetaDTO> }

export interface CrewDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export interface CrewDetailMemberDTO {
  worker: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'worker' }
  navigation: NavigationIntentDTO
  trade: string
  phone: string
  projectStatus: string
  currentProject: EntityRefDTO & { entity: 'project' }
  currentProjectNavigation: NavigationIntentDTO
  entryDate: ISODateDTO | null
  dailyWage: number | null
  linkedWorker: EntityRefDTO & { entity: 'worker' }
  linkedWorkerNavigation: NavigationIntentDTO
}

export type CrewProjectSourceLabel = '在场成员' | '工程量责任' | '工资单'

export interface CrewProjectDTO {
  project: EntityRefDTO & { entity: 'project' }
  navigation: NavigationIntentDTO
  projectCode: string
  projectStatus: string
  sources: CrewProjectSourceLabel[]
  activeMemberCount: number
  assignmentCount: number | null
  assignedUnitCount: number | null
  completedStageCount: number | null
  wageStatementCount: number | null
  wageGrossAmount: string | null
  releasedWageAmount: string | null
}

export interface CrewPenaltyDTO {
  penalty: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'subcontract-document' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  source: string
  location: string
  reason: string
  amount: string | null
  penaltyDate: ISODateDTO | null
  status: string
}

export interface CrewDetailReadDTO {
  meta: ReadMetaDTO
  payrollActual?: PayrollHostSection
  dataOrigin: DataOriginDTO
  crew: CrewSourceRow
  members: CrewDetailMemberDTO[]
  projects: CrewProjectDTO[]
  penalties: CrewPenaltyDTO[]
  summary: {
    memberCount: number
    activeMemberCount: number
    projectCount: number | null
    assignedUnitCount: number | null
    completedStageCount: number | null
    wageStatementCount: number | null
    releasedWageAmount: string | null
    penaltyAmount: string | null
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface WorkerDetailQueryDTO {
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export type WorkerProjectSourceLabel = '当前项目' | '工程量责任' | '考勤' | '签工' | '工资单' | '扣罚'

export interface WorkerCrewDTO {
  crew: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'crew' }
  navigation: NavigationIntentDTO
  trade: string
  contactName: string
  contactPhone: string
}

export interface WorkerRelatedPersonDTO {
  worker: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'worker' }
  navigation: NavigationIntentDTO
  phone: string
  trade: string
  status: string
  source: 'family' | 'legacy'
}

export interface WorkerProjectDTO {
  project: EntityRefDTO & { entity: 'project' }
  navigation: NavigationIntentDTO
  code: string
  status: string
  sources: WorkerProjectSourceLabel[]
}

export interface WorkerAssignmentDTO {
  id: string
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  unit: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'quantity-unit' }
  navigation: NavigationIntentDTO
  buildingName: string
  floorName: string
  trade: string
  note: string
  completedStageCount: number
  scopes: Array<{ roomName: string, itemName: string }>
}

export interface WorkerWageStatementDTO {
  statement: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'wage-statement' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  month: string
  status: string
  statementGrossAmount: string
  statementActualAmount: string | null
  workerLineAmount: string
  allocatedAmount: string | null
  allocationRecorded: boolean
}

export interface WorkerPenaltyDTO {
  penalty: Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'subcontract-document' }
  navigation: NavigationIntentDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  source: string
  location: string
  reason: string
  amount: string | null
  penaltyDate: ISODateDTO | null
  status: string
}

export interface WorkerDetailReadDTO {
  meta: ReadMetaDTO
  payrollActual?: PayrollHostSection
  dataOrigin: DataOriginDTO
  worker: WorkerSourceRow & {
    gender: string
    hometown: string
    emergencyContact: string
    emergencyPhone: string
    skillLevel: string
    dailyWage: number | null
    familyGroupId: string | null
    bankName: string
    bankAccount: string
    bankCode: string
    note: string
  }
  crew: WorkerCrewDTO | null
  capabilitiesDetail: { trades: string[], itemNames: string[] }
  relatedWorkers: WorkerRelatedPersonDTO[]
  projects: WorkerProjectDTO[]
  assignments: WorkerAssignmentDTO[]
  attendance: []
  daywork: []
  wageStatements: WorkerWageStatementDTO[]
  penalties: WorkerPenaltyDTO[]
  summary: {
    projectCount: number | null
    assignedUnitCount: number | null
    completedStageCount: number | null
    attendanceDays: number | null
    attendanceHours: number | null
    overtimeHours: number | null
    confirmedDayworkUnits: number | null
    releasedStatementCount: number | null
    knownAllocatedAmount: string | null
    missingAllocationCount: number | null
    penaltyAmount: string | null
  }
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}
