import type { PayrollHostScope, PayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ProjectManagementFeeRead } from '../../app/lib/project/management-fee'
import type { ProjectListSourceRow, ProjectSupplierReferenceSourceRow } from '../../app/lib/project/repository'
import type { DataOriginDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import { unavailablePayrollHostSection } from '../../app/lib/crew-worker/payroll-read'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import { MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'
import { projectConstructionManagementFees, unavailableProjectConstructionManagementFees } from '../../app/lib/project/construction-management-fee'
import { managementFeeSource, projectManagementFees } from '../../app/lib/project/management-fee'
import {
  buildProjectDetailRead,
  buildProjectListPage,
  IMPORTED_PROJECT_STATUS,
  parseProjectDetailQuery,
  parseProjectListQuery,
  ProjectRepositoryProblem,
} from '../../app/lib/project/repository'
import { resolveBusinessSession } from './business-session'
import { constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { materialContractReadTestInstance } from './material-contract-read-test-instance'
import { ownerCommercialDocumentReadTestInstance } from './owner-commercial-document-read-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { projectSupplierReadTestInstance } from './project-supplier-read-test-instance'
import { createReadMeta, readQueryScope, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'

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
  resolveMaterialContractCount: (projectId: string, origin: 'real' | 'demo', sessionId?: string | null) => Promise<number | null | { count: number | null, source: SourceEvidenceDTO }>
    = async (projectId, origin, sessionId) => {
      const page = await materialContractReadTestInstance.list({
        includeDemo: String(origin === 'demo'),
        origin,
        projectId,
        page: '1',
        pageSize: '10',
      }, sessionId)
      return { count: page.pagination.total, source: { key: 'material-contracts', state: 'readable', sourceVersion: page.meta.sourceVersion, asOf: page.meta.asOf } }
    },
  resolveProjectSupplierRelations: (projectId: string, origin: DataOriginDTO, sessionId?: string | null) => Promise<readonly ProjectSupplierReferenceSourceRow[] | { rows: readonly ProjectSupplierReferenceSourceRow[], source: SourceEvidenceDTO }>
    = async (projectId, origin, sessionId) => projectSupplierReadTestInstance.referencesRead(projectId, origin, sessionId),
  resolveCustomerReferences: (rows: readonly ProjectListSourceRow[], sessionId?: string | null) => Promise<readonly ProjectListSourceRow[] | { rows: readonly ProjectListSourceRow[], source: SourceEvidenceDTO }>
    = async rows => rows,
  resolveReceiptIncome: (rows: readonly ProjectListSourceRow[], sessionId?: string | null) => Promise<{ rows: readonly ProjectListSourceRow[], sourceVersion?: string, asOf?: string, source?: SourceEvidenceDTO }>
    = async rows => ({ rows }),
  resolvePayrollActual: (scope: PayrollHostScope, sessionId: string | null | undefined, asOf: string) => Promise<PayrollHostSection | { payrollActual: PayrollHostSection, managementFees: ProjectManagementFeeRead } | undefined>
    = async () => undefined,
  resolveOwnerJourneys?: typeof ownerCommercialDocumentReadTestInstance.projectJourneys,
) {
  const scenarios = new Map<string, ProjectReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  // 未富化的同一项目事实快照；关联读面不得经 list/detail 回调客户读取。
  function facts(sessionId?: string | null, requireRead = true) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden' && requireRead)
      throw repositoryProblem('forbidden', '无项目查看权限', false)
    if (scenario === 'unavailable')
      throw repositoryProblem('unavailable', '中央后台测试实例暂时不可用', true)
    const capabilities = resolveCapabilities(sessionId)
    if (requireRead && !capabilities.includes('project:list:read'))
      throw repositoryProblem('forbidden', '无项目查看权限', false)
    const migrationSnapshot = resolveMigrationSnapshot(sessionId)
    const rows = scenario === 'ready' || scenario === 'forbidden'
      ? [
          ...resolveFormalRows(sessionId),
          ...projectRowsFromMigration(migrationSnapshot),
          ...PROJECT_READ_FIXTURE,
        ]
      : []
    return {
      capabilities,
      rows,
      asOf: new Date().toISOString(),
      sourceVersion: readSourceVersion('projects', { scenario, formalVersion: resolveFormalSourceVersion(sessionId), migrationSnapshot, rows: rows.filter(row => row.dataOrigin === 'real') }),
    }
  }

  function assertUnchanged(context: ReturnType<typeof facts>, sessionId?: string | null) {
    const latest = facts(sessionId)
    if (context.sourceVersion !== latest.sourceVersion || JSON.stringify(context.capabilities) !== JSON.stringify(latest.capabilities))
      throw repositoryProblem('unavailable', '读取期间项目档案或权限已变化，请重新读取', true)
  }

  async function readContext(sessionId?: string | null) {
    const context = facts(sessionId)
    const references = await resolveCustomerReferences(context.rows, sessionId)
    const referencedRows = Array.isArray(references) ? references : (references as { rows: readonly ProjectListSourceRow[] }).rows
    const income = await resolveReceiptIncome(referencedRows, sessionId)
    assertUnchanged(context, sessionId)
    const asOf = new Date().toISOString()
    const customerSource: SourceEvidenceDTO = Array.isArray(references)
      ? { key: 'customers', state: referencedRows.some(row => row.dataOrigin === 'real' && (row.customerId || row.secondaryCustomerId)) ? 'readable' : 'not-requested', sourceVersion: null, asOf: referencedRows.some(row => row.dataOrigin === 'real' && (row.customerId || row.secondaryCustomerId)) ? asOf : null }
      : (references as { source: SourceEvidenceDTO }).source
    const receiptSource: SourceEvidenceDTO = income.source ?? (income.sourceVersion
      ? { key: 'receipts', state: 'readable', sourceVersion: income.sourceVersion, asOf }
      : { key: 'receipts', state: 'not-requested', sourceVersion: null, asOf: null })
    const sources: SourceEvidenceDTO[] = [
      { key: 'projects', state: 'readable', sourceVersion: context.sourceVersion, asOf },
      customerSource,
      receiptSource,
      { key: 'target-costs', state: 'not-requested', sourceVersion: null, asOf: null },
    ]
    return { ...context, rows: income.rows, asOf, sources }
  }

  function meta(context: Awaited<ReturnType<typeof readContext>>, origin: DataOriginDTO, operation: string, scope: unknown, extra: SourceEvidenceDTO[] = []) {
    return createReadMeta({ session: { ...resolveBusinessSession(), capabilities: context.capabilities }, schemaVersion: 'project-read-v2', operation, dataOrigin: origin, asOf: context.asOf, coverage: 'complete', scope, sources: origin === 'demo' ? [{ key: 'projects', state: 'readable', sourceVersion: SOURCE_VERSION, asOf: context.asOf }, { key: 'customers', state: 'readable', sourceVersion: SOURCE_VERSION, asOf: context.asOf }, { key: 'receipts', state: 'readable', sourceVersion: SOURCE_VERSION, asOf: context.asOf }, { key: 'target-costs', state: 'readable', sourceVersion: SOURCE_VERSION, asOf: context.asOf }, ...extra] : [...context.sources, ...extra] })
  }

  return {
    facts: (sessionId?: string | null) => facts(sessionId),
    /** 领域事务的完整资格快照。不得直接作为无权限用户的项目目录返回。 */
    identities: (sessionId?: string | null) => facts(sessionId, false),
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
      const context = await readContext(sessionId)
      const query = parseProjectListQuery(input as Record<string, unknown> | undefined)
      if (query.includeDemo && !context.capabilities.includes('demo:read'))
        throw repositoryProblem('forbidden', '无测试数据查看权限', false)
      const scope = { query: readQueryScope(query), testSession: sessionId ?? null }
      const real = meta(context, 'real', 'project:list', scope)
      const demo = query.includeDemo ? meta(context, 'demo', 'project:list', scope) : createReadMeta({ session: { ...resolveBusinessSession(), capabilities: context.capabilities }, schemaVersion: 'project-read-v2', operation: 'project:list', dataOrigin: 'demo', asOf: context.asOf, coverage: 'unknown', scope, sources: [{ key: 'projects', state: 'not-requested', sourceVersion: null, asOf: null }] })
      return withOriginReadMeta(buildProjectListPage({
        rows: context.rows,
        query,
        asOf: context.asOf,
        sourceVersion: context.sourceVersion,
        capabilities: context.capabilities,
      }), { real, demo })
    },
    async detail(
      id: string,
      input: Record<string, unknown> | undefined,
      sessionId?: string | null,
    ) {
      const before = facts(sessionId)
      const context = await readContext(sessionId)
      const query = parseProjectDetailQuery(id, input)
      if (query.includeDemo && !context.capabilities.includes('demo:read'))
        throw repositoryProblem('forbidden', '无测试数据查看权限', false)
      // 先验证原目标存在，不能借另一个项目地址读取工资来源。
      buildProjectDetailRead({ rows: context.rows, query, asOf: context.asOf, sourceVersion: context.sourceVersion, capabilities: context.capabilities })
      const extra: SourceEvidenceDTO[] = []
      let materialContractCount: number | null = null
      let materialContractAccess: 'allowed' | 'forbidden' | 'unknown' | 'error' = 'unknown'
      let projectSupplierRelations: readonly ProjectSupplierReferenceSourceRow[] = []
      let projectSupplierAccess: 'allowed' | 'forbidden' | 'error' = 'allowed'
      try {
        const read = await resolveMaterialContractCount(query.id, query.origin, sessionId)
        materialContractCount = typeof read === 'object' && read !== null ? read.count : read
        extra.push(typeof read === 'object' && read !== null ? read.source : { key: 'material-contracts', state: materialContractCount === null ? 'unavailable' : 'readable', sourceVersion: null, asOf: materialContractCount === null ? null : new Date().toISOString() })
        materialContractAccess = materialContractCount === null ? 'unknown' : 'allowed'
      }
      catch (cause) {
        materialContractAccess = (
          cause instanceof MaterialContractRepositoryProblem
          && cause.problem.code === 'forbidden'
        )
          ? 'forbidden'
          : 'error'
        extra.push({ key: 'material-contracts', state: materialContractAccess === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null })
      }
      try {
        const read = await resolveProjectSupplierRelations(query.id, query.origin, sessionId)
        projectSupplierRelations = Array.isArray(read) ? read : (read as { rows: readonly ProjectSupplierReferenceSourceRow[] }).rows
        extra.push(Array.isArray(read) ? { key: 'project-suppliers', state: 'readable', sourceVersion: null, asOf: new Date().toISOString() } : (read as { source: SourceEvidenceDTO }).source)
      }
      catch (cause) {
        projectSupplierAccess = (
          cause instanceof ProjectSupplierRepositoryProblem
          && cause.problem.code === 'forbidden'
        )
          ? 'forbidden'
          : 'error'
        extra.push({ key: 'project-suppliers', state: projectSupplierAccess === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null })
      }
      const detail = buildProjectDetailRead({
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
      if (query.origin === 'demo') {
        assertUnchanged(before, sessionId)
        return withReadMeta(detail, meta(context, query.origin, 'project:detail', { query, testSession: sessionId ?? null }, extra))
      }
      const payrollRead = context.capabilities.includes('payroll:read')
        ? await resolvePayrollActual({ kind: 'project', id: query.id }, sessionId, context.asOf)
        : unavailablePayrollHostSection({ kind: 'project', id: query.id }, 'forbidden', '无工资收付查看权限')
      const combined = payrollRead && 'payrollActual' in payrollRead ? payrollRead : null
      const payrollActual = combined?.payrollActual ?? (payrollRead && 'scope' in payrollRead ? payrollRead : undefined)
      const managementFees = combined?.managementFees ?? projectManagementFees(query.id, 'real', context.asOf, context.capabilities.includes('payroll:read') ? undefined : managementFeeSource({ key: 'management-payroll', state: 'forbidden', sourceVersion: null, asOf: null, reasons: ['无项目或工资实际来源查看权限'], missingCount: null, rows: [] }, context.asOf))
      const constructionManagementFees = context.capabilities.includes('construction-contract:read')
        ? projectConstructionManagementFees({ projectId: query.id, dataOrigin: 'real', sourceVersion: constructionContractCommandTestInstance.sourceVersion(sessionId), asOf: new Date().toISOString(), contracts: constructionContractCommandTestInstance.rows(sessionId) })
        : unavailableProjectConstructionManagementFees(query.id, 'real', 'forbidden')
      const latest = facts(sessionId)
      if (before.sourceVersion !== latest.sourceVersion || JSON.stringify(context.capabilities) !== JSON.stringify(latest.capabilities))
        throw repositoryProblem('unavailable', '读取期间项目档案或权限已变化，请重新读取', true)
      if (!latest.rows.some(row => row.id === query.id && row.dataOrigin === query.origin))
        throw repositoryProblem('unavailable', '原项目已变化，请重新读取', true)
      const commercial = resolveOwnerJourneys?.(query.id, context.asOf, sessionId)
      if (commercial)
        extra.push(commercial.source)
      extra.push(payrollActual ? { key: 'payroll', state: payrollActual.status === 'forbidden' ? 'forbidden' : payrollActual.status === 'unavailable' ? 'unavailable' : 'readable', sourceVersion: ['forbidden', 'unavailable'].includes(payrollActual.status) ? null : payrollActual.sourceVersion, asOf: ['forbidden', 'unavailable'].includes(payrollActual.status) ? null : new Date().toISOString() } : { key: 'payroll', state: 'not-requested', sourceVersion: null, asOf: null })
      extra.push({ key: 'construction-management-fee-configurations', state: constructionManagementFees.state === 'complete' ? 'readable' : constructionManagementFees.state, sourceVersion: constructionManagementFees.sourceVersion, asOf: constructionManagementFees.asOf })
      extra.push(...managementFees.sources.map(source => ({ key: source.key, state: source.state === 'complete' || source.state === 'partial' ? 'readable' as const : source.state, sourceVersion: source.sourceVersion, asOf: source.asOf })))
      const evidence = meta(context, query.origin, 'project:detail', { query, testSession: sessionId ?? null }, extra)
      return withReadMeta({ ...detail, constructionManagementFees, managementFees, ...(payrollActual ? { payrollActual } : {}), ...(commercial ? { ownerJourneys: commercial.journeys } : {}) }, evidence)
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
  undefined,
  undefined,
  async (rows, sessionId) => (await import('./project-import-customers')).resolveProjectCustomerReferences(rows, sessionId),
  async (rows, sessionId) => (await import('./project-receipt-income')).projectReceiptIncome(rows, sessionId),
  async (scope, sessionId, asOf) => (await import('./project-management-fee')).readProjectPayrollEvidence(scope.id, sessionId, asOf),
  ownerCommercialDocumentReadTestInstance.projectJourneys,
)
