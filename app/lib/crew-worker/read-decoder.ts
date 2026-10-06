import type { EntityKindDTO } from '../../types/read-model'
import type {
  CrewDetailQueryDTO,
  CrewDetailReadDTO,
  CrewListPageDTO,
  CrewListQueryDTO,
  CrewWorkerRelationFactIdentityDTO,
  CrewWorkerRelationFactQueryDTO,
  WorkerDetailQueryDTO,
  WorkerDetailReadDTO,
  WorkerListPageDTO,
  WorkerListQueryDTO,
} from './read-contract'
import { isDataOriginDTO, isEntityRefDTO, isISODateTimeDTO, isUnavailableEntityNavigationDTO } from '../../types/read-model'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { serializeEnumSelection } from '../util/enum-selection'
import { decodePayrollHostSection } from './payroll-read'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function resolvedCrew(value: unknown): boolean {
  return isEntityRefDTO(value, 'crew') && value.state === 'resolved'
}

function resolvedEntity(value: unknown, entity: EntityKindDTO): boolean {
  return isEntityRefDTO(value, entity) && value.state === 'resolved'
}

function entityReference(value: unknown, entity: EntityKindDTO): boolean {
  return isEntityRefDTO(value, entity)
}

function navigation(value: unknown): boolean {
  return object(value) && ((value.kind === 'unavailable' && Object.keys(value).length === 2 && ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target', 'error'].includes(String(value.reason)))
    || (value.kind === 'entity-detail' && isEntityRefDTO(value.subject) && value.subject.state === 'resolved' && typeof value.variant === 'string'
      && object(value.filters)))
}

function relationNavigation(value: unknown, reference: unknown, origin: unknown): boolean {
  if (!isEntityRefDTO(reference))
    return false
  if (reference.state !== 'resolved')
    return isUnavailableEntityNavigationDTO(value, reference)
  return object(value) && navigation(value) && isEntityRefDTO(value.subject) && value.subject.state === 'resolved'
    && value.subject.entity === reference.entity && value.subject.id === reference.id
    && value.subject.label === reference.label && value.subject.no === reference.no
    && object(value.filters) && value.filters.dataOrigin === origin
}

function projectRecord(value: unknown, navigationKey: 'navigation' | 'projectNavigation', origin: unknown): boolean {
  return object(value) && isEntityRefDTO(value.project, 'project')
    && relationNavigation(value[navigationKey], value.project, origin)
    && (value.project.state === 'resolved' || ['code', 'status', 'projectCode', 'projectStatus'].every(key => !Object.hasOwn(value, key) || value[key] === ''))
}

function crewNavigation(value: unknown): boolean {
  return object(value) && value.kind === 'entity-detail' && resolvedCrew(value.subject)
    && value.variant === 'detail' && value.view === null && object(value.filters)
    && isDataOriginDTO(value.filters.dataOrigin)
}

function crewListItem(value: unknown): boolean {
  return object(value) && isDataOriginDTO(value.dataOrigin)
    && resolvedCrew(value.crew) && crewNavigation(value.navigation)
    && typeof value.trade === 'string' && typeof value.contactName === 'string'
    && typeof value.contactPhone === 'string' && count(value.memberCount)
    && count(value.activeMemberCount) && (value.projectCount === null || count(value.projectCount))
    && typeof value.status === 'string' && isISODateTimeDTO(value.updatedAt)
}

function countOptions(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => object(item)
    && typeof item.value === 'string' && typeof item.label === 'string' && count(item.count))
}

function crewSummary(value: unknown): boolean {
  if (!object(value) || !countOptions(value.trades) || !countOptions(value.statuses) || !object(value.origins))
    return false
  const origins = value.origins
  return (['real', 'demo'] as const).every((origin) => {
    const item = origins[origin]
    return object(item) && count(item.crewCount) && count(item.workerCount)
  })
}

function emptyState(value: unknown): boolean {
  return value === null || (object(value)
    && ['no-records', 'no-filter-match', 'missing-relation'].includes(String(value.reason))
    && Array.isArray(value.missingRelations) && value.missingRelations.every(item => typeof item === 'string'))
}

export function decodeCrewListPage(value: unknown, expected?: CrewListQueryDTO): CrewListPageDTO {
  if (!object(value) || !hasConsistentOriginReadMeta(value, 'crew-worker-read-v2') || !Array.isArray(value.items) || !value.items.every(crewListItem)
    || (expected !== undefined && (!object(value.pagination) || value.pagination.requestedPage !== expected.page || value.pagination.pageSize !== expected.pageSize || (!expected.includeDemo && value.items.some(item => object(item) && item.dataOrigin === 'demo'))))
    || !isPaginationDTO(value.pagination, value.items.length) || !crewSummary(value.summary) || !emptyState(value.empty)
    || !isISODateTimeDTO(value.asOf) || !(value.sourceVersion === null || typeof value.sourceVersion === 'string')
    || !stringList(value.capabilities)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的班组列表无效'))
  }
  return value as unknown as CrewListPageDTO
}

function workerListItem(value: unknown): boolean {
  return object(value) && isDataOriginDTO(value.dataOrigin) && resolvedEntity(value.worker, 'worker')
    && navigation(value.navigation) && entityReference(value.crew, 'crew') && relationNavigation(value.crewNavigation, value.crew, value.dataOrigin)
    && entityReference(value.currentProject, 'project') && relationNavigation(value.projectNavigation, value.currentProject, value.dataOrigin)
    && typeof value.trade === 'string' && typeof value.projectStatus === 'string'
    && typeof value.status === 'string' && typeof value.phone === 'string' && typeof value.idCard === 'string'
    && (value.entryDate === null || typeof value.entryDate === 'string')
    && (value.exitDate === null || typeof value.exitDate === 'string')
    && typeof value.safetyEducation === 'boolean' && isISODateTimeDTO(value.updatedAt)
}

function workerSummary(value: unknown): boolean {
  if (!object(value) || !countOptions(value.trades) || !countOptions(value.projectStatuses) || !object(value.origins))
    return false
  const origins = value.origins
  return (['real', 'demo'] as const).every((origin) => {
    const item = origins[origin]
    return object(item) && count(item.workerCount) && count(item.activeWorkerCount)
  })
}

function decodePage<T>(value: unknown, item: (candidate: unknown) => boolean, summary: (candidate: unknown) => boolean, message: string, expected?: WorkerListQueryDTO): T {
  if (!object(value) || !hasConsistentOriginReadMeta(value, 'crew-worker-read-v2') || !Array.isArray(value.items) || !value.items.every(item)
    || (expected !== undefined && (!object(value.pagination) || value.pagination.requestedPage !== expected.page || value.pagination.pageSize !== expected.pageSize || (!expected.includeDemo && value.items.some(item => object(item) && item.dataOrigin === 'demo'))))
    || !isPaginationDTO(value.pagination, value.items.length) || !summary(value.summary) || !emptyState(value.empty)
    || !isISODateTimeDTO(value.asOf) || !(value.sourceVersion === null || typeof value.sourceVersion === 'string')
    || !stringList(value.capabilities)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', message))
  }
  return value as T
}

export function decodeWorkerListPage(value: unknown, expected?: WorkerListQueryDTO): WorkerListPageDTO {
  return decodePage(value, workerListItem, workerSummary, '中央后台返回的工人列表无效', expected)
}

function detailEnvelope(value: unknown, entity: 'crew' | 'worker'): boolean {
  return object(value) && hasConsistentReadMeta(value, 'crew-worker-read-v2', value.dataOrigin) && isDataOriginDTO(value.dataOrigin) && object(value[entity])
    && typeof (value[entity] as Record<string, unknown>).id === 'string'
    && Array.isArray(value.projects) && value.projects.every(row => projectRecord(row, 'navigation', value.dataOrigin))
    && Array.isArray(value.penalties) && value.penalties.every(row => projectRecord(row, 'projectNavigation', value.dataOrigin)) && object(value.summary)
    && isISODateTimeDTO(value.asOf) && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && stringList(value.capabilities)
}

function detailSummary(value: unknown, entity: 'crew' | 'worker'): boolean {
  if (!object(value) || !object(value.summary) || !isReadMetaDTO(value.meta, 'crew-worker-read-v2'))
    return false
  const summary = value.summary
  const meta = value.meta
  const unknown = (key: string) => meta.sources.some(source => source.key === key && source.state !== 'readable')
  const counts = entity === 'crew'
    ? ['projectCount', 'assignedUnitCount', 'completedStageCount', 'wageStatementCount']
    : ['projectCount', 'assignedUnitCount', 'completedStageCount', 'attendanceDays', 'attendanceHours', 'overtimeHours', 'confirmedDayworkUnits', 'releasedStatementCount', 'missingAllocationCount']
  const amounts = entity === 'crew' ? ['releasedWageAmount', 'penaltyAmount'] : ['knownAllocatedAmount', 'penaltyAmount']
  const sourceFor = (key: string) => key === 'penaltyAmount' ? 'penalties' : ['projectCount', 'assignedUnitCount', 'completedStageCount'].includes(key) ? 'assignments' : 'wages'
  return counts.every(key => (unknown(sourceFor(key)) && summary[key] === null) || count(summary[key]))
    && amounts.every(key => (unknown(sourceFor(key)) && summary[key] === null) || (typeof summary[key] === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(summary[key])))
    && (entity === 'worker' || (count(summary.memberCount) && count(summary.activeMemberCount)))
}

export function decodeCrewDetailRead(value: unknown, expected?: CrewDetailQueryDTO): CrewDetailReadDTO {
  if (!detailEnvelope(value, 'crew') || !detailSummary(value, 'crew') || !object(value) || !object(value.crew) || (expected !== undefined && (value.crew.id !== expected.id || value.dataOrigin !== expected.origin)) || !Array.isArray(value.members)
    || !value.members.every(member => object(member) && resolvedEntity(member.worker, 'worker')
      && relationNavigation(member.navigation, member.worker, value.dataOrigin)
      && isEntityRefDTO(member.currentProject, 'project') && relationNavigation(member.currentProjectNavigation, member.currentProject, value.dataOrigin)
      && isEntityRefDTO(member.linkedWorker, 'worker') && relationNavigation(member.linkedWorkerNavigation, member.linkedWorker, value.dataOrigin))) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的班组详情无效'))
  }
  const detail = value as unknown as CrewDetailReadDTO
  if (detail.payrollActual !== undefined && (detail.dataOrigin !== 'real' || (!detail.capabilities.includes('payroll:read') && detail.payrollActual.status !== 'forbidden')))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '工资收付分区与来源授权不一致'))
  return detail.payrollActual === undefined ? detail : { ...detail, payrollActual: decodePayrollHostSection(detail.payrollActual, { kind: 'crew', id: detail.crew.id }) }
}

export function decodeWorkerDetailRead(value: unknown, expected?: WorkerDetailQueryDTO): WorkerDetailReadDTO {
  if (!detailEnvelope(value, 'worker') || !detailSummary(value, 'worker') || !object(value) || !object(value.worker) || (expected !== undefined && (value.worker.id !== expected.id || value.dataOrigin !== expected.origin)))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的工人详情无效'))
  const detail = value as Record<string, unknown>
  if (!Array.isArray(detail.relatedWorkers) || !Array.isArray(detail.assignments)
    || !detail.relatedWorkers.every(row => object(row) && resolvedEntity(row.worker, 'worker') && relationNavigation(row.navigation, row.worker, detail.dataOrigin))
    || !detail.assignments.every(row => projectRecord(row, 'projectNavigation', detail.dataOrigin) && object(row)
      && isEntityRefDTO(row.project) && (row.project.state === 'resolved' ? navigation(row.navigation) : isUnavailableEntityNavigationDTO(row.navigation, row.project)))
    || !Array.isArray(detail.wageStatements) || !detail.wageStatements.every(row => projectRecord(row, 'projectNavigation', detail.dataOrigin))
    || !Array.isArray(detail.attendance) || !Array.isArray(detail.daywork)
    || !object(detail.worker) || !(detail.worker.currentProjectId === null || (typeof detail.worker.currentProjectId === 'string'
      && Array.isArray(detail.projects) && detail.projects.some(row => object(row) && isEntityRefDTO(row.project, 'project') && row.project.state === 'resolved' && row.project.id === (detail.worker as Record<string, unknown>).currentProjectId)))) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的工人关系详情无效'))
  }
  const result = value as unknown as WorkerDetailReadDTO
  if (result.payrollActual !== undefined && (result.dataOrigin !== 'real' || (!result.capabilities.includes('payroll:read') && result.payrollActual.status !== 'forbidden')))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '工资收付分区与来源授权不一致'))
  return result.payrollActual === undefined ? result : { ...result, payrollActual: decodePayrollHostSection(result.payrollActual, { kind: 'worker', id: result.worker.id }) }
}

export function decodeCrewWorkerRelationFactIdentity(value: unknown, expected?: CrewWorkerRelationFactQueryDTO): CrewWorkerRelationFactIdentityDTO {
  if (!object(value) || !hasConsistentReadMeta(value, 'crew-worker-read-v2', value.dataOrigin) || (expected !== undefined && (value.id !== expected.id || value.kind !== expected.kind || value.dataOrigin !== expected.origin)) || !['assignment', 'wage', 'penalty'].includes(String(value.kind))
    || typeof value.id !== 'string' || !isDataOriginDTO(value.dataOrigin)
    || !(value.projectId === null || typeof value.projectId === 'string')
    || !Array.isArray(value.owners) || !value.owners.every(owner => object(owner)
      && (owner.kind === 'crew' || owner.kind === 'worker') && typeof owner.id === 'string' && owner.id.length > 0)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的关系事实标识无效'))
  }
  return value as unknown as CrewWorkerRelationFactIdentityDTO
}

export function serializeCrewListQuery(query: CrewListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    search: query.search,
    trade: serializeEnumSelection(query.trade),
    status: serializeEnumSelection(query.status),
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeWorkerListQuery(query: WorkerListQueryDTO): Record<string, string> {
  return {
    includeDemo: String(query.includeDemo),
    search: query.search,
    trade: serializeEnumSelection(query.trade),
    crewId: query.crewId ?? '',
    projectStatus: serializeEnumSelection(query.projectStatus),
    status: serializeEnumSelection(query.status),
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  }
}

export function serializeCrewWorkerDetailQuery(query: CrewDetailQueryDTO | WorkerDetailQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo) }
}

export function serializeCrewWorkerRelationFactQuery(query: CrewWorkerRelationFactQueryDTO): Record<string, string> {
  return { origin: query.origin, includeDemo: String(query.includeDemo) }
}

export function crewWorkerProblemFromUnknown(cause: unknown): CrewWorkerRepositoryProblem {
  if (cause instanceof CrewWorkerRepositoryProblem)
    return cause
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new CrewWorkerRepositoryProblem(remote, { cause })
  return new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '班组与工人中央服务暂时不可用，请重试', true), { cause })
}
