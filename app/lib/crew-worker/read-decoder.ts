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
import { isDataOriginDTO, isISODateTimeDTO } from '../../types/read-model'
import { serializeEnumSelection } from '../util/enum-selection'
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
  return object(value) && value.state === 'resolved' && value.entity === 'crew'
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.label === 'string' && (value.no === null || typeof value.no === 'string')
}

function resolvedEntity(value: unknown, entity: string): boolean {
  return object(value) && value.state === 'resolved' && value.entity === entity
    && typeof value.id === 'string' && value.id.length > 0 && typeof value.label === 'string'
}

function entityReference(value: unknown, entity: string): boolean {
  return resolvedEntity(value, entity) || (object(value) && value.entity === entity
    && ((value.state === 'missing' && value.id === null && value.label === null)
      || (value.state === 'forbidden' && (value.id === null || typeof value.id === 'string') && value.label === null)))
}

function navigation(value: unknown): boolean {
  return object(value) && (value.kind === 'unavailable'
    || (value.kind === 'entity-detail' && object(value.subject) && typeof value.variant === 'string'
      && object(value.filters)))
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
    && count(value.activeMemberCount) && count(value.projectCount)
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

function pagination(value: unknown): boolean {
  return object(value) && count(value.page) && Number(value.page) >= 1
    && count(value.pageSize) && Number(value.pageSize) >= 1 && count(value.total)
}

function emptyState(value: unknown): boolean {
  return value === null || (object(value)
    && ['no-records', 'no-filter-match', 'missing-relation'].includes(String(value.reason))
    && Array.isArray(value.missingRelations) && value.missingRelations.every(item => typeof item === 'string'))
}

export function decodeCrewListPage(value: unknown): CrewListPageDTO {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(crewListItem)
    || !pagination(value.pagination) || !crewSummary(value.summary) || !emptyState(value.empty)
    || !isISODateTimeDTO(value.asOf) || !(value.sourceVersion === null || typeof value.sourceVersion === 'string')
    || !stringList(value.capabilities)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的班组列表无效'))
  }
  return value as unknown as CrewListPageDTO
}

function workerListItem(value: unknown): boolean {
  return object(value) && isDataOriginDTO(value.dataOrigin) && resolvedEntity(value.worker, 'worker')
    && navigation(value.navigation) && entityReference(value.crew, 'crew') && navigation(value.crewNavigation)
    && entityReference(value.currentProject, 'project') && navigation(value.projectNavigation)
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

function decodePage<T>(value: unknown, item: (candidate: unknown) => boolean, summary: (candidate: unknown) => boolean, message: string): T {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(item)
    || !pagination(value.pagination) || !summary(value.summary) || !emptyState(value.empty)
    || !isISODateTimeDTO(value.asOf) || !(value.sourceVersion === null || typeof value.sourceVersion === 'string')
    || !stringList(value.capabilities)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', message))
  }
  return value as T
}

export function decodeWorkerListPage(value: unknown): WorkerListPageDTO {
  return decodePage(value, workerListItem, workerSummary, '中央后台返回的工人列表无效')
}

function detailEnvelope(value: unknown, entity: 'crew' | 'worker'): boolean {
  return object(value) && isDataOriginDTO(value.dataOrigin) && object(value[entity])
    && typeof (value[entity] as Record<string, unknown>).id === 'string'
    && Array.isArray(value.projects) && Array.isArray(value.penalties) && object(value.summary)
    && isISODateTimeDTO(value.asOf) && (value.sourceVersion === null || typeof value.sourceVersion === 'string')
    && stringList(value.capabilities)
}

export function decodeCrewDetailRead(value: unknown): CrewDetailReadDTO {
  if (!detailEnvelope(value, 'crew') || !Array.isArray((value as Record<string, unknown>).members))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的班组详情无效'))
  return value as CrewDetailReadDTO
}

export function decodeWorkerDetailRead(value: unknown): WorkerDetailReadDTO {
  if (!detailEnvelope(value, 'worker'))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的工人详情无效'))
  const detail = value as Record<string, unknown>
  if (!Array.isArray(detail.relatedWorkers) || !Array.isArray(detail.assignments)
    || !Array.isArray(detail.wageStatements) || !Array.isArray(detail.attendance) || !Array.isArray(detail.daywork)) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '中央后台返回的工人关系详情无效'))
  }
  return value as WorkerDetailReadDTO
}

export function decodeCrewWorkerRelationFactIdentity(value: unknown): CrewWorkerRelationFactIdentityDTO {
  if (!object(value) || !['assignment', 'wage', 'penalty'].includes(String(value.kind))
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
  return new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', '班组与工人中央服务暂时不可用，请重试', true), { cause })
}
