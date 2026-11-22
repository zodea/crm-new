import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO, ReadProjection } from '../../types/read-model'

import type {
  CrewDetailQueryDTO,
  CrewDetailReadDTO,
  CrewListPageDTO,
  CrewListQueryDTO,
  CrewSourceRow,
  CrewWorkerAssignmentSourceRow,
  CrewWorkerPageSize,
  CrewWorkerPenaltySourceRow,
  CrewWorkerProjectSourceRow,
  CrewWorkerWageSourceRow,
  WorkerDetailQueryDTO,
  WorkerDetailReadDTO,
  WorkerListPageDTO,
  WorkerListQueryDTO,
  WorkerProjectSourceLabel,
  WorkerSourceRow,
} from './read-contract'
import { parsePageQuery, resolvePagination } from '../read-model/pagination'
import { normalizeEnumSelection } from '../util/enum-selection'
import { maskIdentifier, maskPhone } from '../util/privacy'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from './read-contract'

interface BuildCrewListPageInput {
  crews: readonly CrewSourceRow[]
  workers: readonly WorkerSourceRow[]
  assignments: readonly CrewWorkerAssignmentSourceRow[]
  wages: readonly CrewWorkerWageSourceRow[]
  query: CrewListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildCrewDetailReadInput {
  crews: readonly CrewSourceRow[]
  workers: readonly WorkerSourceRow[]
  projects: readonly CrewWorkerProjectSourceRow[]
  assignments: readonly CrewWorkerAssignmentSourceRow[]
  wages: readonly CrewWorkerWageSourceRow[]
  penalties: readonly CrewWorkerPenaltySourceRow[]
  query: CrewDetailQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildWorkerListPageInput {
  crews: readonly CrewSourceRow[]
  workers: readonly WorkerSourceRow[]
  projects: readonly CrewWorkerProjectSourceRow[]
  query: WorkerListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildWorkerDetailReadInput {
  crews: readonly CrewSourceRow[]
  workers: readonly WorkerSourceRow[]
  projects: readonly CrewWorkerProjectSourceRow[]
  assignments: readonly CrewWorkerAssignmentSourceRow[]
  wages: readonly CrewWorkerWageSourceRow[]
  penalties: readonly CrewWorkerPenaltySourceRow[]
  query: WorkerDetailQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

function crewRef(source: CrewSourceRow): Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'crew' } {
  return {
    state: 'resolved',
    entity: 'crew',
    id: source.id,
    label: source.name,
    no: null,
  }
}

function resolvedRef<const T extends EntityKindDTO>(entity: T, id: string, label: string, no: string | null = null): Extract<EntityRefDTO, { state: 'resolved' }> & { entity: T } {
  return { state: 'resolved', entity, id, label, no }
}

function missingRef<const T extends EntityKindDTO>(entity: T): Extract<EntityRefDTO, { state: 'missing' }> & { entity: T } {
  return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
}

function detailNavigation(reference: EntityRefDTO, origin: 'real' | 'demo', variant = 'detail', filters: Record<string, string | null> = {}): NavigationIntentDTO {
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: reference.state === 'forbidden' ? 'forbidden' : reference.state === 'unavailable' ? 'not-connected' : 'missing-id' }
  return {
    kind: 'entity-detail',
    subject: reference,
    variant,
    view: null,
    filters: { dataOrigin: origin, ...filters },
  }
}

function projectReference(projectId: string | null, projects: readonly CrewWorkerProjectSourceRow[], origin: 'real' | 'demo'): EntityRefDTO & { entity: 'project' } {
  if (!projectId)
    return missingRef('project')
  const project = projects.find(row => row.dataOrigin === origin && row.id === projectId)
  if (!project)
    return missingRef('project')
  if (project.permission === 'forbidden')
    return { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' }
  if (project.permission === 'unavailable')
    return { state: 'unavailable', entity: 'project', id: null, label: null, reason: 'source-unavailable' }
  return resolvedRef('project', project.id, project.name)
}

function crewReference(crewId: string | null, crews: readonly CrewSourceRow[], origin: 'real' | 'demo'): EntityRefDTO & { entity: 'crew' } {
  if (!crewId)
    return missingRef('crew')
  const crew = crews.find(row => row.dataOrigin === origin && row.id === crewId)
  return crew ? resolvedRef('crew', crew.id, crew.name) : missingRef('crew')
}

function money(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)
}

function maskPersonName(value: string): string {
  const name = value.trim()
  return name ? `${name.slice(0, 1)}${'*'.repeat(Math.max(1, name.length - 1))}` : ''
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

function parseCommonListQuery(input: Record<string, unknown> | undefined) {
  const { requestedPage, pageSize } = parsePageQuery(input ?? {}, () => {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '分页参数无效'))
  }, 10)
  const sort = String(input?.sort ?? 'updated-desc')
  if (![10, 20, 50, 100].includes(pageSize) || !['updated-desc', 'name-asc', 'name-desc'].includes(sort))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '班组或工人列表查询参数无效'))
  return {
    includeDemo: bool(input?.includeDemo),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    sort: sort as 'updated-desc' | 'name-asc' | 'name-desc',
    page: requestedPage,
    pageSize: pageSize as CrewWorkerPageSize,
  }
}

export function parseCrewListQuery(input: Record<string, unknown> | undefined): CrewListQueryDTO {
  return {
    ...parseCommonListQuery(input),
    trade: enumSelection(input?.trade),
    status: enumSelection(input?.status),
  }
}

export function parseWorkerListQuery(input: Record<string, unknown> | undefined): WorkerListQueryDTO {
  return {
    ...parseCommonListQuery(input),
    trade: enumSelection(input?.trade),
    crewId: typeof input?.crewId === 'string' && input.crewId.trim() ? input.crewId.trim() : null,
    projectStatus: enumSelection(input?.projectStatus),
    status: enumSelection(input?.status),
  }
}

function enumSelection(value: unknown): string[] | null {
  try {
    const values = normalizeEnumSelection(value)
    return values.length ? values : null
  }
  catch {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '班组或工人列表选项筛选无效'))
  }
}

function parseDetailQuery(id: string, input: Record<string, unknown> | undefined) {
  const rawOrigin = input?.origin ?? 'real'
  if (!id.trim() || (rawOrigin !== 'real' && rawOrigin !== 'demo'))
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '班组或工人详情查询参数无效'))
  const origin: 'real' | 'demo' = rawOrigin
  return { id, origin, includeDemo: bool(input?.includeDemo) }
}

export function parseCrewDetailQuery(id: string, input: Record<string, unknown> | undefined): CrewDetailQueryDTO {
  return parseDetailQuery(id, input)
}

export function parseWorkerDetailQuery(id: string, input: Record<string, unknown> | undefined): WorkerDetailQueryDTO {
  return parseDetailQuery(id, input)
}

export function buildCrewListPage(input: BuildCrewListPageInput): ReadProjection<CrewListPageDTO> {
  const allowedOrigins = input.query.includeDemo
    ? new Set(['real', 'demo'])
    : new Set(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const trades = enumSelection(input.query.trade) ?? []
  const statuses = enumSelection(input.query.status) ?? []
  function matches(crew: CrewSourceRow, except?: 'trade' | 'status') {
    if (!allowedOrigins.has(crew.dataOrigin))
      return false
    if (except !== 'trade' && trades.length && !trades.includes(crew.trade))
      return false
    if (except !== 'status' && statuses.length && !statuses.includes(crew.status))
      return false
    if (!search)
      return true
    return [crew.name, crew.trade, crew.contactName]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search))
  }
  const filtered = input.crews.filter(crew => matches(crew))
  const sorted = [...filtered].sort((left, right) => {
    if (input.query.sort === 'name-asc')
      return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (input.query.sort === 'name-desc')
      return right.name.localeCompare(left.name, 'zh-CN') || left.id.localeCompare(right.id)
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const stats = (crew: CrewSourceRow) => {
    const members = input.workers.filter(worker =>
      worker.dataOrigin === crew.dataOrigin && worker.crewId === crew.id)
    const projectIds = new Set<string>()
    for (const member of members) {
      if (member.currentProjectId)
        projectIds.add(member.currentProjectId)
    }
    for (const assignment of input.assignments) {
      if (assignment.dataOrigin === crew.dataOrigin && assignment.crewId === crew.id)
        projectIds.add(assignment.projectId)
    }
    for (const wage of input.wages) {
      if (wage.dataOrigin === crew.dataOrigin && wage.crewId === crew.id)
        projectIds.add(wage.projectId)
    }
    return {
      memberCount: members.length,
      activeMemberCount: members.filter(worker => worker.projectStatus === '在场').length,
      projectCount: projectIds.size,
    }
  }
  const { page } = resolvePagination(input.query.page, input.query.pageSize, filtered.length)
  const start = (page - 1) * input.query.pageSize
  const items = sorted.slice(start, start + input.query.pageSize).map((source) => {
    const crew = crewRef(source)
    return {
      dataOrigin: source.dataOrigin,
      crew,
      navigation: {
        kind: 'entity-detail' as const,
        subject: crew,
        variant: 'detail' as const,
        view: null,
        filters: { dataOrigin: source.dataOrigin },
      },
      trade: source.trade,
      contactName: source.contactName,
      contactPhone: maskPhone(source.contactPhone),
      ...stats(source),
      status: source.status,
      updatedAt: source.updatedAt,
    }
  })
  const countBy = (field: 'trade' | 'status') => {
    const candidates = input.crews.filter(row => matches(row, field))
    return [...new Set(candidates.map(row => row[field]))].filter(Boolean).sort((left, right) => left.localeCompare(right, 'zh-CN')).map(value => ({ value, label: value, count: candidates.filter(row => row[field] === value).length }))
  }
  const origins = (['real', 'demo'] as const).reduce<CrewListPageDTO['summary']['origins']>((result, origin) => {
    const crews = filtered.filter(row => row.dataOrigin === origin)
    const crewIds = new Set(crews.map(row => row.id))
    result[origin] = {
      crewCount: crews.length,
      workerCount: input.workers.filter(row => row.dataOrigin === origin && row.crewId != null && crewIds.has(row.crewId)).length,
    }
    return result
  }, { real: { crewCount: 0, workerCount: 0 }, demo: { crewCount: 0, workerCount: 0 } })
  return {
    items,
    pagination: { requestedPage: input.query.page, page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      trades: countBy('trade'),
      statuses: countBy('status'),
      origins,
    },
    empty: filtered.length === 0
      ? { reason: input.crews.some(row => allowedOrigins.has(row.dataOrigin)) ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function buildWorkerListPage(input: BuildWorkerListPageInput): ReadProjection<WorkerListPageDTO> {
  const allowedOrigins = input.query.includeDemo ? new Set(['real', 'demo']) : new Set(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const canReadSensitive = input.capabilities.includes('worker:sensitive:read')
  const trades = enumSelection(input.query.trade) ?? []
  const statuses = enumSelection(input.query.status) ?? []
  const projectStatuses = enumSelection(input.query.projectStatus) ?? []
  function matches(worker: WorkerSourceRow, except?: 'trade' | 'projectStatus') {
    if (!allowedOrigins.has(worker.dataOrigin))
      return false
    if (except !== 'trade' && trades.length && !trades.includes(worker.trade))
      return false
    if (input.query.crewId && worker.crewId !== input.query.crewId)
      return false
    if (except !== 'projectStatus' && projectStatuses.length && !projectStatuses.includes(worker.projectStatus))
      return false
    if (statuses.length && !statuses.includes(worker.status))
      return false
    if (!search)
      return true
    const crew = crewReference(worker.crewId, input.crews, worker.dataOrigin)
    const project = projectReference(worker.currentProjectId, input.projects, worker.dataOrigin)
    const searchablePhone = canReadSensitive ? worker.phone : maskPhone(worker.phone)
    const searchableIdCard = canReadSensitive ? worker.idCard : maskIdentifier(worker.idCard)
    return [worker.name, worker.trade, searchablePhone, searchableIdCard, crew.state === 'resolved' ? crew.label : '', project.state === 'resolved' ? project.label : '']
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search))
  }
  const filtered = input.workers.filter(worker => matches(worker))
  const sorted = [...filtered].sort((left, right) => {
    if (input.query.sort === 'name-asc')
      return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (input.query.sort === 'name-desc')
      return right.name.localeCompare(left.name, 'zh-CN') || left.id.localeCompare(right.id)
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const { page } = resolvePagination(input.query.page, input.query.pageSize, filtered.length)
  const start = (page - 1) * input.query.pageSize
  const items = sorted.slice(start, start + input.query.pageSize).map((source) => {
    const worker = resolvedRef('worker', source.id, source.name)
    const crew = crewReference(source.crewId, input.crews, source.dataOrigin)
    const currentProject = projectReference(source.currentProjectId, input.projects, source.dataOrigin)
    return {
      dataOrigin: source.dataOrigin,
      worker,
      navigation: {
        kind: 'entity-detail' as const,
        subject: worker,
        variant: 'detail' as const,
        view: null,
        filters: { dataOrigin: source.dataOrigin },
      },
      trade: source.trade,
      crew,
      crewNavigation: detailNavigation(crew, source.dataOrigin),
      currentProject,
      projectNavigation: detailNavigation(currentProject, source.dataOrigin),
      projectStatus: source.projectStatus,
      status: source.status,
      phone: maskPhone(source.phone),
      idCard: maskIdentifier(source.idCard),
      entryDate: source.entryDate,
      exitDate: source.exitDate,
      safetyEducation: source.safetyEducation,
      updatedAt: source.updatedAt,
    }
  })
  const countBy = (field: 'trade' | 'projectStatus') => {
    const candidates = input.workers.filter(row => matches(row, field))
    return [...new Set(candidates.map(row => row[field]))].filter(Boolean).sort((left, right) => left.localeCompare(right, 'zh-CN')).map(value => ({ value, label: value, count: candidates.filter(row => row[field] === value).length }))
  }
  const origins = (['real', 'demo'] as const).reduce<WorkerListPageDTO['summary']['origins']>((result, origin) => {
    const rows = filtered.filter(row => row.dataOrigin === origin)
    result[origin] = {
      workerCount: rows.length,
      activeWorkerCount: rows.filter(row => row.projectStatus === '在场').length,
    }
    return result
  }, { real: { workerCount: 0, activeWorkerCount: 0 }, demo: { workerCount: 0, activeWorkerCount: 0 } })
  return {
    items,
    pagination: { requestedPage: input.query.page, page, pageSize: input.query.pageSize, total: filtered.length },
    summary: { trades: countBy('trade'), projectStatuses: countBy('projectStatus'), origins },
    empty: filtered.length === 0
      ? { reason: input.workers.some(row => allowedOrigins.has(row.dataOrigin)) ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function buildWorkerDetailRead(input: BuildWorkerDetailReadInput): ReadProjection<WorkerDetailReadDTO> {
  if (input.query.origin === 'demo' && !input.query.includeDemo) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('forbidden', '测试工人未授权显示'))
  }
  const source = input.workers.find(row => row.dataOrigin === input.query.origin && row.id === input.query.id)
  if (!source) {
    const sameId = input.workers.some(row => row.id === input.query.id)
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '工人来源与地址不匹配' : '工人不存在或已删除',
    ))
  }
  const origin = input.query.origin
  const crewSource = source.crewId
    ? input.crews.find(row => row.dataOrigin === origin && row.id === source.crewId)
    : null
  const crew = crewSource
    ? {
        crew: resolvedRef('crew', crewSource.id, crewSource.name),
        navigation: detailNavigation(resolvedRef('crew', crewSource.id, crewSource.name), origin),
        trade: crewSource.trade,
        contactName: crewSource.contactName,
        contactPhone: maskPhone(crewSource.contactPhone),
      }
    : null
  const relatedWorkers = input.workers
    .filter((row) => {
      if (row.dataOrigin !== origin || row.id === source.id)
        return false
      const sameFamily = Boolean(source.familyGroupId && row.familyGroupId === source.familyGroupId)
      return sameFamily || row.id === source.linkedWorkerId || row.linkedWorkerId === source.id
    })
    .map((row) => {
      const worker = resolvedRef('worker', row.id, row.name)
      return {
        worker,
        navigation: detailNavigation(worker, origin),
        phone: maskPhone(row.phone),
        trade: row.trade,
        status: row.status,
        source: source.familyGroupId && row.familyGroupId === source.familyGroupId ? 'family' as const : 'legacy' as const,
      }
    })
  const assignments = input.assignments
    .filter(row => row.dataOrigin === origin && row.workerId === source.id)
    .map((row) => {
      const project = projectReference(row.projectId, input.projects, origin)
      const unit = resolvedRef('quantity-unit', row.unitId, row.unitName ?? row.unitId)
      return {
        id: row.id,
        project,
        projectNavigation: detailNavigation(project, origin),
        unit,
        navigation: project.state !== 'resolved'
          ? detailNavigation(project, origin)
          : detailNavigation(unit, origin, 'detail', {
              projectId: row.projectId,
              ownerKind: 'worker',
              ownerId: source.id,
            }),
        buildingName: row.buildingName ?? '',
        floorName: row.floorName ?? '',
        trade: row.trade ?? '',
        note: row.note ?? '',
        completedStageCount: row.completedStageCount,
        scopes: (row.scopes ?? []).map(scope => ({ ...scope })),
      }
    })
  const wageStatements = input.wages.flatMap((row) => {
    if (row.dataOrigin !== origin)
      return []
    const fact = row.workerFacts.find(item => item.workerId === source.id)
    if (!fact)
      return []
    const statement = resolvedRef('wage-statement', row.id, `${row.month ?? ''}工资单`.trim())
    const project = projectReference(row.projectId, input.projects, origin)
    return [{
      statement,
      navigation: detailNavigation(statement, origin, 'detail', {
        ownerKind: 'worker',
        ownerId: source.id,
      }),
      project,
      projectNavigation: detailNavigation(project, origin),
      month: row.month ?? '',
      status: row.status,
      statementGrossAmount: money(row.grossAmount),
      statementActualAmount: row.actualAmount == null ? null : money(row.actualAmount),
      workerLineAmount: money(fact.lineAmount),
      allocatedAmount: fact.allocatedAmount == null ? null : money(fact.allocatedAmount),
      allocationRecorded: fact.allocatedAmount != null,
    }]
  })
  const penalties = input.penalties
    .filter(row => row.dataOrigin === origin && (row.workerId === source.id || row.responsibleWorkerId === source.id))
    .map((row) => {
      const penalty = resolvedRef('subcontract-document', row.id, row.no)
      const project = projectReference(row.projectId, input.projects, origin)
      return {
        penalty,
        navigation: origin === 'real' && row.source === 'project'
          ? detailNavigation(penalty, origin, 'penalty')
          : detailNavigation(penalty, origin, 'penalty-detail', {
              ownerKind: 'worker',
              ownerId: source.id,
            }),
        project,
        projectNavigation: detailNavigation(project, origin),
        source: row.source,
        location: row.location,
        reason: row.reason,
        amount: row.amount === null ? null : money(row.amount),
        penaltyDate: row.penaltyDate,
        status: row.status,
      }
    })
  const projectSources = new Map<string, Set<WorkerProjectSourceLabel>>()
  const addProjectSource = (projectId: string | null, label: WorkerProjectSourceLabel) => {
    if (!projectId)
      return
    const set = projectSources.get(projectId) ?? new Set<WorkerProjectSourceLabel>()
    set.add(label)
    projectSources.set(projectId, set)
  }
  addProjectSource(source.currentProjectId, '当前项目')
  assignments.forEach(row => row.project.state === 'resolved' && addProjectSource(row.project.id, '工程量责任'))
  wageStatements.forEach(row => row.project.state === 'resolved' && addProjectSource(row.project.id, '工资单'))
  penalties.forEach(row => row.project.state === 'resolved' && addProjectSource(row.project.id, '扣罚'))
  const sourceOrder: WorkerProjectSourceLabel[] = ['当前项目', '工程量责任', '考勤', '签工', '工资单', '扣罚']
  const projects = [...projectSources.entries()].map(([projectId, labels]) => {
    const project = projectReference(projectId, input.projects, origin)
    const projectSource = input.projects.find(row => row.dataOrigin === origin && row.id === projectId)
    return {
      project,
      navigation: detailNavigation(project, origin),
      code: project.state === 'resolved' ? projectSource?.code ?? '' : '',
      status: project.state === 'resolved' ? projectSource?.status ?? '' : '',
      sources: sourceOrder.filter(label => labels.has(label)),
    }
  }).sort((left, right) => {
    const leftId = left.project.state === 'resolved' ? left.project.id : ''
    const rightId = right.project.state === 'resolved' ? right.project.id : ''
    return leftId.localeCompare(rightId)
  })
  const released = wageStatements.filter(row => row.status === 'released')
  return {
    dataOrigin: origin,
    worker: {
      ...source,
      currentProjectId: projectReference(source.currentProjectId, input.projects, origin).state === 'resolved' ? source.currentProjectId : null,
      tradeCapabilities: [...(source.tradeCapabilities ?? [])],
      itemCapabilities: [...(source.itemCapabilities ?? [])],
      gender: source.gender ?? '',
      phone: maskPhone(source.phone),
      idCard: maskIdentifier(source.idCard),
      hometown: source.hometown ?? '',
      emergencyContact: maskPersonName(source.emergencyContact ?? ''),
      emergencyPhone: maskPhone(source.emergencyPhone ?? ''),
      skillLevel: source.skillLevel ?? '',
      dailyWage: source.dailyWage ?? null,
      familyGroupId: source.familyGroupId ?? null,
      bankName: source.bankName ?? '',
      bankAccount: maskIdentifier(source.bankAccount ?? ''),
      bankCode: source.bankCode ?? '',
      note: source.note ?? '',
    },
    crew,
    capabilitiesDetail: {
      trades: [...new Set([source.trade, ...(source.tradeCapabilities ?? []), ...(crewSource?.tradeCapabilities ?? [])].filter(Boolean))],
      itemNames: [...new Set([...(source.itemCapabilities ?? []), ...(crewSource?.itemCapabilities ?? [])].filter(Boolean))],
    },
    relatedWorkers,
    projects,
    assignments,
    attendance: [],
    daywork: [],
    wageStatements,
    penalties,
    summary: {
      projectCount: projects.length,
      assignedUnitCount: new Set(assignments.map(row => row.unit.id)).size,
      completedStageCount: assignments.reduce((sum, row) => sum + row.completedStageCount, 0),
      attendanceDays: 0,
      attendanceHours: 0,
      overtimeHours: 0,
      confirmedDayworkUnits: 0,
      releasedStatementCount: released.length,
      knownAllocatedAmount: money(released.reduce((sum, row) => sum + Number(row.allocatedAmount ?? 0), 0)),
      missingAllocationCount: released.filter(row => !row.allocationRecorded).length,
      penaltyAmount: penalties.some(row => row.amount === null) ? null : money(penalties.reduce((sum, row) => sum + Number(row.amount), 0)),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function buildCrewDetailRead(input: BuildCrewDetailReadInput): ReadProjection<CrewDetailReadDTO> {
  if (input.query.origin === 'demo' && !input.query.includeDemo) {
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem('forbidden', '测试班组未授权显示'))
  }
  const source = input.crews.find(row => row.dataOrigin === input.query.origin && row.id === input.query.id)
  if (!source) {
    const sameId = input.crews.some(row => row.id === input.query.id)
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '班组来源与地址不匹配' : '班组不存在或已删除',
    ))
  }
  const origin = input.query.origin
  const members = input.workers
    .filter(row => row.dataOrigin === origin && row.crewId === source.id)
    .map((row) => {
      const worker = resolvedRef('worker', row.id, row.name)
      const currentProject = projectReference(row.currentProjectId, input.projects, origin)
      const linked = row.linkedWorkerId
        ? input.workers.find(candidate => candidate.dataOrigin === origin && candidate.id === row.linkedWorkerId)
        : null
      const linkedWorker = linked ? resolvedRef('worker', linked.id, linked.name) : missingRef('worker')
      return {
        worker,
        navigation: detailNavigation(worker, origin),
        trade: row.trade,
        phone: maskPhone(row.phone),
        projectStatus: row.projectStatus,
        currentProject,
        currentProjectNavigation: detailNavigation(currentProject, origin),
        entryDate: row.entryDate,
        dailyWage: row.dailyWage ?? null,
        linkedWorker,
        linkedWorkerNavigation: detailNavigation(linkedWorker, origin),
      }
    })
  const projectIds = new Set<string>()
  for (const member of members) {
    if (member.projectStatus === '在场' && member.currentProject.state === 'resolved')
      projectIds.add(member.currentProject.id)
  }
  const assignments = input.assignments.filter(row => row.dataOrigin === origin && row.crewId === source.id)
  assignments.forEach(row => projectIds.add(row.projectId))
  const wages = input.wages.filter(row => row.dataOrigin === origin && row.crewId === source.id)
  wages.forEach(row => projectIds.add(row.projectId))
  const projectRows = [...projectIds].map((projectId) => {
    const project = projectReference(projectId, input.projects, origin)
    const sourceRow = input.projects.find(row => row.dataOrigin === origin && row.id === projectId)
    const projectAssignments = assignments.filter(row => row.projectId === projectId)
    const projectWages = wages.filter(row => row.projectId === projectId)
    const activeMemberCount = members.filter(member =>
      member.projectStatus === '在场' && member.currentProject.state === 'resolved' && member.currentProject.id === projectId).length
    const sources = [
      ...(activeMemberCount ? ['在场成员' as const] : []),
      ...(projectAssignments.length ? ['工程量责任' as const] : []),
      ...(projectWages.length ? ['工资单' as const] : []),
    ]
    return {
      project,
      navigation: detailNavigation(project, origin),
      projectCode: project.state === 'resolved' ? sourceRow?.code ?? '' : '',
      projectStatus: project.state === 'resolved' ? sourceRow?.status ?? '' : '',
      sources,
      activeMemberCount,
      assignmentCount: projectAssignments.length,
      assignedUnitCount: new Set(projectAssignments.map(row => row.unitId)).size,
      completedStageCount: projectAssignments.reduce((sum, row) => sum + row.completedStageCount, 0),
      wageStatementCount: projectWages.length,
      wageGrossAmount: money(projectWages.reduce((sum, row) => sum + row.grossAmount, 0)),
      releasedWageAmount: money(projectWages.filter(row => row.status === 'released').reduce((sum, row) => sum + (row.actualAmount ?? 0), 0)),
    }
  }).sort((left, right) => {
    const leftId = left.project.state === 'resolved' ? left.project.id : ''
    const rightId = right.project.state === 'resolved' ? right.project.id : ''
    return leftId.localeCompare(rightId)
  })
  const penalties = input.penalties
    .filter(row => row.dataOrigin === origin && row.crewId === source.id)
    .map((row) => {
      const penalty = resolvedRef('subcontract-document', row.id, row.no)
      const project = projectReference(row.projectId, input.projects, origin)
      return {
        penalty,
        navigation: origin === 'real' && row.source === 'project'
          ? detailNavigation(penalty, origin, 'penalty')
          : detailNavigation(penalty, origin, 'penalty-detail', {
              ownerKind: 'crew',
              ownerId: source.id,
            }),
        project,
        projectNavigation: detailNavigation(project, origin),
        source: row.source,
        location: row.location,
        reason: row.reason,
        amount: row.amount === null ? null : money(row.amount),
        penaltyDate: row.penaltyDate,
        status: row.status,
      }
    })
  return {
    dataOrigin: origin,
    crew: {
      ...source,
      tradeCapabilities: [...source.tradeCapabilities],
      itemCapabilities: [...source.itemCapabilities],
      contactPhone: maskPhone(source.contactPhone),
    },
    members,
    projects: projectRows,
    penalties,
    summary: {
      memberCount: members.length,
      activeMemberCount: members.filter(row => row.projectStatus === '在场').length,
      projectCount: projectRows.length,
      assignedUnitCount: projectRows.reduce((sum, row) => sum + row.assignedUnitCount, 0),
      completedStageCount: projectRows.reduce((sum, row) => sum + row.completedStageCount, 0),
      wageStatementCount: projectRows.reduce((sum, row) => sum + row.wageStatementCount, 0),
      releasedWageAmount: money(projectRows.reduce((sum, row) => sum + Number(row.releasedWageAmount), 0)),
      penaltyAmount: penalties.some(row => row.amount === null) ? null : money(penalties.reduce((sum, row) => sum + Number(row.amount), 0)),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
