import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ProjectListSourceRow, ProjectSupplierReferenceSourceRow } from '../../app/lib/project/repository'
import type { DataOriginDTO } from '../../app/types/read-model'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import { MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'
import {
  buildProjectDetailRead,
  buildProjectListPage,
  IMPORTED_PROJECT_STATUS,
  parseProjectDetailQuery,
  parseProjectListQuery,
  ProjectRepositoryProblem,
} from '../../app/lib/project/repository'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { materialContractReadTestInstance } from './material-contract-read-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { projectSupplierReadTestInstance } from './project-supplier-read-test-instance'

export type ProjectReadTestScenario
  = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-15T00:00:00.000Z'
const SOURCE_VERSION = 'project-read-fixture-v1'

const customerNames = new Map(customersSeed.map(customer => [customer.id, customer.name]))

// 中央后台测试实例使用与 SQLite 迁移来源同身份的确定性项目夹具。
// 只有这里显式登记的收入/预算事实才是已知值；其余保持 null，不用 0 填满。
export const PROJECT_READ_FIXTURE: readonly ProjectListSourceRow[] = projectsSeed.map(project => ({
  dataOrigin: 'demo',
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
  contractAmount: project.contract_amount ?? null,
  operationType: project.operation_type,
  startDate: project.start_date || null,
  plannedEnd: project.planned_end || null,
  actualEnd: project.actual_end || null,
  plannedDuration: project.planned_duration ?? null,
  manager: project.manager,
  execManager: project.exec_manager,
  builder: project.builder,
  customerId: project.customer_id ?? null,
  customerName: project.customer_id ? customerNames.get(project.customer_id) ?? null : null,
  customerPermission: project.id === 'proj_demo_003' ? 'forbidden' : 'allowed',
  secondaryCustomerId: project.secondary_customer_id ?? null,
  secondaryCustomerName: project.secondary_customer_id
    ? customerNames.get(project.secondary_customer_id) ?? null
    : null,
  secondaryCustomerPermission: project.secondary_customer_id === 'customer_demo_003'
    ? 'forbidden'
    : 'allowed',
  contractName: project.contract_name,
  contractor: project.contractor,
  region: project.region,
  riskLevel: project.risk_level,
  address: project.address,
  income: project.id === 'proj_demo_001' ? 25367027 : project.id === 'proj_demo_003' ? 0 : null,
  budget: project.id === 'proj_demo_001' ? 800000 : project.id === 'proj_demo_002' ? 0 : null,
  updatedAt: project.updated_at,
} satisfies ProjectListSourceRow))

// 施工合同、甲方变洽签与月度报量的中央测试实例共用这一正式项目身份。
// 只读实例必须能按同一稳定 ID 打开项目详情，不能让跨域关系成为死链。

function repositoryProblem(
  code: 'forbidden' | 'unavailable',
  message: string,
  retryable: boolean,
): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem({
    code,
    message,
    retryable,
    fieldErrors: {},
    traceId: `project-test-${code}`,
  })
}

function latestAsOf(rows: readonly ProjectListSourceRow[]): string {
  return rows.reduce(
    (latest, row) => row.updatedAt > latest ? row.updatedAt : latest,
    FIXED_AS_OF,
  )
}

function projectRowsFromMigration(snapshot: CoreMigrationSnapshotDTO): ProjectListSourceRow[] {
  if (snapshot.authority !== 'central')
    return []
  const names = new Map(snapshot.entities.map(entity => [entity.id, entity.name]))
  return snapshot.entities
    .filter(entity => entity.entityType === 'projects' && entity.deletedAt === null)
    .map(entity => ({
      dataOrigin: 'real',
      id: entity.id,
      name: entity.name,
      code: entity.legacyId,
      status: IMPORTED_PROJECT_STATUS,
      contractAmount: entity.amount === null ? null : Number(entity.amount),
      operationType: '',
      startDate: null,
      plannedEnd: null,
      actualEnd: null,
      plannedDuration: null,
      manager: '',
      execManager: '',
      builder: '',
      customerId: entity.references.customerId ?? null,
      customerName: entity.references.customerId
        ? names.get(entity.references.customerId) ?? null
        : null,
      customerPermission: 'allowed',
      secondaryCustomerId: entity.references.secondaryCustomerId ?? null,
      secondaryCustomerName: entity.references.secondaryCustomerId
        ? names.get(entity.references.secondaryCustomerId) ?? null
        : null,
      secondaryCustomerPermission: 'allowed',
      contractName: '',
      contractor: '',
      region: '',
      riskLevel: '',
      address: '',
      income: null,
      budget: null,
      updatedAt: FIXED_AS_OF,
    }))
}

const EMPTY_MIGRATION_SNAPSHOT: CoreMigrationSnapshotDTO = {
  authority: 'local',
  activeBatchId: null,
  entities: [],
}

export function createProjectReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[]
    = sessionId => demoWorkspaceTestInstance.capabilities(sessionId),
  resolveFormalRows: (sessionId?: string | null) => readonly ProjectListSourceRow[]
    = sessionId => projectCommandTestInstance.rows(sessionId),
  resolveFormalSourceVersion: (sessionId?: string | null) => string
    = sessionId => projectCommandTestInstance.sourceVersion(sessionId),
  resolveMigrationSnapshot: (sessionId?: string | null) => CoreMigrationSnapshotDTO
    = () => EMPTY_MIGRATION_SNAPSHOT,
  resolveMaterialContractCount: (projectId: string, origin: 'real' | 'demo', sessionId?: string | null) => Promise<number | null>
    = async (projectId, origin, sessionId) => materialContractReadTestInstance.list({
      includeDemo: String(origin === 'demo'),
      origin,
      projectId,
      page: '1',
      pageSize: '10',
    }, sessionId).pagination.total,
  resolveProjectSupplierRelations: (projectId: string, origin: DataOriginDTO, sessionId?: string | null) => Promise<readonly ProjectSupplierReferenceSourceRow[]>
    = async (projectId, origin, sessionId) => projectSupplierReadTestInstance.references(projectId, origin, sessionId),
) {
  const scenarios = new Map<string, ProjectReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function readContext(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw repositoryProblem('forbidden', '无项目查看权限', false)
    if (scenario === 'unavailable')
      throw repositoryProblem('unavailable', '中央后台测试实例暂时不可用', true)
    const migrationSnapshot = resolveMigrationSnapshot(sessionId)
    const rows = scenario === 'ready'
      ? [
          ...resolveFormalRows(sessionId),
          ...projectRowsFromMigration(migrationSnapshot),
          ...PROJECT_READ_FIXTURE,
        ]
      : []
    return {
      capabilities: resolveCapabilities(sessionId),
      rows,
      asOf: latestAsOf(rows),
      sourceVersion: scenario === 'ready'
        ? `${SOURCE_VERSION}:${resolveFormalSourceVersion(sessionId)}:${
          migrationSnapshot.authority === 'central'
            ? migrationSnapshot.activeBatchId ?? 'migration-central'
            : 'migration-local'
        }`
        : SOURCE_VERSION,
    }
  }

  return {
    reset(next: ProjectReadTestScenario, sessionId?: string | null) {
      const key = keyFor(sessionId)
      if (next === 'ready')
        scenarios.delete(key)
      else
        scenarios.set(key, next)
    },
    currentScenario(sessionId?: string | null) {
      return scenarios.get(keyFor(sessionId)) ?? 'ready'
    },
    async list(
      input: Record<string, unknown> | undefined,
      sessionId?: string | null,
    ) {
      const context = readContext(sessionId)
      const query = parseProjectListQuery(input as Record<string, unknown> | undefined)
      if (query.includeDemo && !context.capabilities.includes('demo:read'))
        throw repositoryProblem('forbidden', '无测试数据查看权限', false)
      return buildProjectListPage({
        rows: context.rows,
        query,
        asOf: context.asOf,
        sourceVersion: context.sourceVersion,
        capabilities: context.capabilities,
      })
    },
    async detail(
      id: string,
      input: Record<string, unknown> | undefined,
      sessionId?: string | null,
    ) {
      const context = readContext(sessionId)
      const query = parseProjectDetailQuery(id, input)
      if (query.includeDemo && !context.capabilities.includes('demo:read'))
        throw repositoryProblem('forbidden', '无测试数据查看权限', false)
      let materialContractCount: number | null = null
      let materialContractAccess: 'allowed' | 'forbidden' | 'unknown' | 'error' = 'unknown'
      let projectSupplierRelations: readonly ProjectSupplierReferenceSourceRow[] = []
      let projectSupplierAccess: 'allowed' | 'forbidden' | 'error' = 'allowed'
      try {
        materialContractCount = await resolveMaterialContractCount(query.id, query.origin, sessionId)
        materialContractAccess = materialContractCount === null ? 'unknown' : 'allowed'
      }
      catch (cause) {
        materialContractAccess = (
          cause instanceof MaterialContractRepositoryProblem
          && cause.problem.code === 'forbidden'
        )
          ? 'forbidden'
          : 'error'
      }
      try {
        projectSupplierRelations = await resolveProjectSupplierRelations(query.id, query.origin, sessionId)
      }
      catch (cause) {
        projectSupplierAccess = (
          cause instanceof ProjectSupplierRepositoryProblem
          && cause.problem.code === 'forbidden'
        )
          ? 'forbidden'
          : 'error'
      }
      return buildProjectDetailRead({
        rows: context.rows,
        query,
        asOf: context.asOf,
        sourceVersion: context.sourceVersion,
        capabilities: context.capabilities,
        materialContractCount,
        materialContractAccess,
        projectSupplierRelations,
        projectSupplierAccess,
      })
    },
  }
}

export const projectReadTestInstance = createProjectReadTestInstance(
  sessionId => demoWorkspaceTestInstance.capabilities(sessionId),
  (sessionId) => {
    const names = new Map(customerCommandTestInstance.rows(sessionId).map(row => [row.id, row.name]))
    return projectCommandTestInstance.rows(sessionId).map(row => ({
      ...row,
      customerName: names.get(row.customerId ?? '') ?? null,
      secondaryCustomerName: names.get(row.secondaryCustomerId ?? '') ?? null,
    }))
  },
  sessionId => projectCommandTestInstance.sourceVersion(sessionId),
  () => EMPTY_MIGRATION_SNAPSHOT,
)
