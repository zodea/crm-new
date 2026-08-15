import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import {
  buildProjectListPage,
  parseProjectListQuery,
  ProjectRepositoryProblem,
} from '../../app/lib/project/repository'

export type ProjectReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-15T00:00:00.000Z'
const SOURCE_VERSION = 'project-read-fixture-v1'

const customerNames = new Map(customersSeed.map(customer => [customer.id, customer.name]))

// 中央后台测试实例使用与 SQLite 迁移来源同身份的确定性项目夹具。
// 只有这里显式登记的收入/预算事实才是已知值；其余保持 null，不用 0 填满。
export const PROJECT_READ_FIXTURE: readonly ProjectListSourceRow[] = projectsSeed.map(project => ({
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

export function createProjectReadTestInstance() {
  const scenarios = new Map<string, ProjectReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

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
      const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
      if (scenario === 'forbidden')
        throw repositoryProblem('forbidden', '无项目查看权限', false)
      if (scenario === 'unavailable')
        throw repositoryProblem('unavailable', '中央后台测试实例暂时不可用', true)
      const query = parseProjectListQuery(input as Record<string, unknown> | undefined)
      return buildProjectListPage({
        rows: scenario === 'ready' ? PROJECT_READ_FIXTURE : [],
        query,
        asOf: FIXED_AS_OF,
        sourceVersion: SOURCE_VERSION,
      })
    },
  }
}

export const projectReadTestInstance = createProjectReadTestInstance()
