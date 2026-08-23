import type {
  CrewSourceRow,
  CrewWorkerAssignmentSourceRow,
  CrewWorkerPenaltySourceRow,
  CrewWorkerProjectSourceRow,
  CrewWorkerWageSourceRow,
  WorkerSourceRow,
} from '../../app/lib/crew-worker/repository'
import {
  buildCrewDetailRead,
  buildCrewListPage,
  buildWorkerDetailRead,
  buildWorkerListPage,
  crewWorkerProblem,
  CrewWorkerRepositoryProblem,
  parseCrewDetailQuery,
  parseCrewListQuery,
  parseWorkerDetailQuery,
  parseWorkerListQuery,
} from '../../app/lib/crew-worker/repository'
import crewsSeed from '../../app/lib/db/seed/crews.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import workersSeed from '../../app/lib/db/seed/workers.json'
import { crewWorkerCommandTestInstance } from './crew-worker-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'

export type CrewWorkerReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-23T00:00:00.000Z'
const SOURCE_VERSION = 'crew-worker-read-fixture-v1'

const demoCrews: CrewSourceRow[] = crewsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  trade: row.trade,
  tradeCapabilities: [row.trade],
  itemCapabilities: [],
  contactName: row.contact_name,
  contactPhone: row.contact_phone,
  defaultPayRatio: 0.8,
  rentSubsidyEnabled: false,
  rentSubsidyPrice: null,
  mgmtFeeEnabled: false,
  mgmtFeePrice: null,
  assignmentLevel: 'worker',
  note: row.note,
  status: 'submitted',
  updatedAt: row.created_at,
}))

const demoWorkers: WorkerSourceRow[] = workersSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  crewId: row.crew_id || null,
  currentProjectId: row.current_project_id || null,
  linkedWorkerId: 'linked_worker_id' in row ? String(row.linked_worker_id || '') || null : null,
  name: row.name,
  gender: '',
  trade: row.trade,
  tradeCapabilities: [row.trade],
  itemCapabilities: [],
  phone: row.phone,
  idCard: row.id_card,
  hometown: '',
  emergencyContact: '',
  emergencyPhone: '',
  skillLevel: '',
  dailyWage: null,
  familyGroupId: row.id === 'wkr_demo_001' || row.id === 'wkr_demo_002' ? 'family-demo-1' : null,
  projectStatus: row.project_status,
  entryDate: row.entry_date || null,
  exitDate: 'exit_date' in row ? String(row.exit_date || '') || null : null,
  safetyEducation: true,
  bankName: '',
  bankAccount: '',
  bankCode: '',
  note: '',
  status: 'submitted',
  updatedAt: row.updated_at,
}))

const demoProjects: CrewWorkerProjectSourceRow[] = projectsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  code: row.code,
  status: row.status,
  permission: row.id === 'proj_demo_005' ? 'forbidden' : 'allowed',
}))

const demoAssignments: CrewWorkerAssignmentSourceRow[] = [{
  dataOrigin: 'demo',
  id: 'assignment-demo-crew-1',
  crewId: 'crew_demo_001',
  workerId: null,
  projectId: 'proj_demo_001',
  unitId: 'qty_u_1_02_01',
  buildingName: '1栋',
  floorName: '2层',
  unitName: '201户',
  trade: '泥水统筹',
  note: '班组责任户',
  scopes: [{ roomName: '客厅', itemName: '基层验收' }],
  completedStageCount: 1,
}, {
  dataOrigin: 'demo',
  id: 'assignment-demo-worker-1',
  crewId: null,
  workerId: 'wkr_demo_001',
  projectId: 'proj_demo_001',
  unitId: 'qty_u_1_02_01',
  buildingName: '1栋',
  floorName: '2层',
  unitName: '201户',
  trade: '泥水工',
  note: '直接责任户',
  scopes: [{ roomName: '客厅', itemName: '墙砖铺贴' }],
  completedStageCount: 2,
}]

const demoWages: CrewWorkerWageSourceRow[] = [{
  dataOrigin: 'demo',
  id: 'wage-demo-1',
  crewId: 'crew_demo_001',
  projectId: 'proj_demo_001',
  month: '2026-07',
  status: 'released',
  grossAmount: 12600,
  actualAmount: 10080,
  workerFacts: [{ workerId: 'wkr_demo_001', lineAmount: 2800, allocatedAmount: null }],
}]

const demoPenalties: CrewWorkerPenaltySourceRow[] = [{
  dataOrigin: 'demo',
  id: 'penalty-demo-1',
  no: 'FK-DEMO-001',
  crewId: 'crew_demo_001',
  workerId: null,
  responsibleWorkerId: 'wkr_demo_001',
  projectId: 'proj_demo_001',
  source: 'project',
  location: '1栋/2层/201户',
  reason: '成品保护不到位',
  amount: 200,
  penaltyDate: '2026-07-20',
  status: 'deducted',
}]

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new CrewWorkerRepositoryProblem({ ...crewWorkerProblem(code, message, retryable), traceId: `crew-worker-test-${code}` })
}

export function createCrewWorkerReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  resolveFormalCrews: (sessionId?: string | null) => readonly CrewSourceRow[] = id => crewWorkerCommandTestInstance.crewRows(id),
  resolveFormalWorkers: (sessionId?: string | null) => readonly WorkerSourceRow[] = id => crewWorkerCommandTestInstance.workerRows(id),
  resolveFormalSourceVersion: (sessionId?: string | null) => string = id => crewWorkerCommandTestInstance.sourceVersion(id),
) {
  const scenarios = new Map<string, CrewWorkerReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无班组或工人查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '班组与工人中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('crew:list:read') || !capabilities.includes('worker:list:read'))
      throw problem('forbidden', '无班组或工人查看权限')
    const ready = scenario === 'ready'
    return {
      capabilities,
      crews: ready ? [...resolveFormalCrews(sessionId), ...demoCrews] : [],
      workers: ready ? [...resolveFormalWorkers(sessionId), ...demoWorkers] : [],
      projects: ready ? demoProjects : [],
      assignments: ready ? demoAssignments : [],
      wages: ready ? demoWages : [],
      penalties: ready ? demoPenalties : [],
      sourceVersion: `${SOURCE_VERSION}:${resolveFormalSourceVersion(sessionId)}`,
    }
  }

  function assertDemo(includeDemo: boolean, capabilities: readonly string[]) {
    if (includeDemo && !capabilities.includes('demo:read'))
      throw problem('forbidden', '无测试数据查看权限')
  }

  async function relationFactIdentity(kind: string, id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
    const data = context(sessionId)
    const origin = input?.origin
    const includeDemo = input?.includeDemo === true || input?.includeDemo === 'true'
    if (origin !== 'real' && origin !== 'demo')
      throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '关系事实来源无效'))
    assertDemo(includeDemo, data.capabilities)
    if (origin === 'demo' && !includeDemo)
      throw new CrewWorkerRepositoryProblem(crewWorkerProblem('not-found', '关系事实不存在'))

    if (kind === 'assignment') {
      const rows = data.assignments.filter(item => item.unitId === id && item.dataOrigin === origin)
      if (rows.length) {
        const projectIds = [...new Set(rows.map(row => row.projectId))]
        if (projectIds.length !== 1)
          throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', '同一责任单元存在冲突的项目归属'))
        return {
          kind,
          id,
          dataOrigin: origin,
          projectId: projectIds[0]!,
          owners: rows.map(row => row.crewId
            ? { kind: 'crew' as const, id: row.crewId }
            : { kind: 'worker' as const, id: row.workerId }),
        }
      }
    }
    else if (kind === 'wage') {
      const row = data.wages.find(item => item.id === id && item.dataOrigin === origin)
      if (row) {
        return {
          kind,
          id,
          dataOrigin: origin,
          projectId: row.projectId,
          owners: [{ kind: 'crew' as const, id: row.crewId }, ...row.workerFacts.map(fact => ({ kind: 'worker' as const, id: fact.workerId }))],
        }
      }
    }
    else if (kind === 'penalty') {
      const row = data.penalties.find(item => item.id === id && item.dataOrigin === origin)
      if (row) {
        const owners = [
          ...(row.crewId ? [{ kind: 'crew' as const, id: row.crewId }] : []),
          ...(row.workerId ? [{ kind: 'worker' as const, id: row.workerId }] : []),
          ...(row.responsibleWorkerId ? [{ kind: 'worker' as const, id: row.responsibleWorkerId }] : []),
        ].filter((owner, index, all) => all.findIndex(candidate => candidate.kind === owner.kind && candidate.id === owner.id) === index)
        return { kind, id, dataOrigin: origin, projectId: row.projectId, owners }
      }
    }
    else {
      throw new CrewWorkerRepositoryProblem(crewWorkerProblem('invalid-query', '关系事实类型无效'))
    }

    const existsInOtherOrigin = kind === 'assignment'
      ? data.assignments.some(item => item.unitId === id)
      : kind === 'wage'
        ? data.wages.some(item => item.id === id)
        : data.penalties.some(item => item.id === id)
    throw new CrewWorkerRepositoryProblem(crewWorkerProblem(
      existsInOtherOrigin ? 'relationship-mismatch' : 'not-found',
      existsInOtherOrigin ? '关系事实与地址中的来源不匹配' : '关系事实不存在',
    ))
  }

  return {
    reset(next: CrewWorkerReadTestScenario, sessionId?: string | null) {
      if (next === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), next)
    },
    async listCrews(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseCrewListQuery(input)
      assertDemo(query.includeDemo, data.capabilities)
      return buildCrewListPage({ ...data, query, asOf: FIXED_AS_OF })
    },
    async crewDetail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseCrewDetailQuery(id, input)
      assertDemo(query.includeDemo, data.capabilities)
      return buildCrewDetailRead({ ...data, query, asOf: FIXED_AS_OF })
    },
    async listWorkers(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseWorkerListQuery(input)
      assertDemo(query.includeDemo, data.capabilities)
      return buildWorkerListPage({ ...data, query, asOf: FIXED_AS_OF })
    },
    async workerDetail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseWorkerDetailQuery(id, input)
      assertDemo(query.includeDemo, data.capabilities)
      return buildWorkerDetailRead({ ...data, query, asOf: FIXED_AS_OF })
    },
    relationFactIdentity,
  }
}

export const crewWorkerReadTestInstance = createCrewWorkerReadTestInstance()
