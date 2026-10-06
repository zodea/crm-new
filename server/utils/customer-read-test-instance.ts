import type {
  CustomerContractSourceRow,
  CustomerListSourceRow,
  CustomerProjectSourceRow,
  CustomerReceiptSourceRow,
} from '../../app/lib/customer/repository'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { DataOriginDTO, ProblemDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { ConstructionContractRepositoryProblem } from '../../app/lib/construction-contract/repository'
import {
  buildCustomerDetailRead,
  buildCustomerListPage,
  customerProblem,
  CustomerRepositoryProblem,
  parseCustomerDetailQuery,
  parseCustomerListQuery,
  parseCustomerReceiptDetailQuery,
} from '../../app/lib/customer/repository'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import receiptsSeed from '../../app/lib/db/seed/receipt_registrations.json'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { ReceiptRepositoryProblem } from '../../app/lib/receipt/contract'
import { resolveBusinessSession } from './business-session'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { customerConstructionContractFacts } from './customer-construction-contract-facts'
import { customerReceiptFacts } from './customer-receipt-facts'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { createReadMeta, readQueryScope, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'

export type CustomerReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-23T00:00:00.000Z'
const SOURCE_VERSION = 'customer-read-fixture-v1'

const EMPTY_MIGRATION_SNAPSHOT: CoreMigrationSnapshotDTO = {
  authority: 'local',
  activeBatchId: null,
  entities: [],
}

function customerRowsFromMigration(snapshot: CoreMigrationSnapshotDTO): CustomerListSourceRow[] {
  if (snapshot.authority !== 'central')
    return []
  return snapshot.entities
    .filter(entity => entity.entityType === 'customers' && entity.deletedAt === null)
    .map(entity => ({
      dataOrigin: 'real',
      id: entity.id,
      name: entity.name,
      aliases: [],
      taxNo: String(entity.attributes.taxNo ?? ''),
      legalRep: String(entity.attributes.legalRep ?? ''),
      registeredAddress: String(entity.attributes.registeredAddress ?? ''),
      invoiceName: String(entity.attributes.invoiceName ?? entity.name),
      bank: String(entity.attributes.bank ?? ''),
      bankAccount: String(entity.attributes.bankAccount ?? ''),
      contact: String(entity.attributes.contact ?? ''),
      contactPhone: String(entity.attributes.contactPhone ?? ''),
      status: String(entity.attributes.status ?? 'active'),
      note: String(entity.attributes.note ?? ''),
      updatedAt: FIXED_AS_OF,
    }))
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter(item => typeof item === 'string')
  if (typeof value !== 'string')
    return []
  try {
    return jsonArray(JSON.parse(value))
  }
  catch {
    return []
  }
}

const demoCustomers: CustomerListSourceRow[] = customersSeed.map(customer => ({
  dataOrigin: 'demo',
  id: customer.id,
  name: customer.name,
  aliases: jsonArray(customer.aliases),
  taxNo: '',
  legalRep: '',
  registeredAddress: '',
  invoiceName: customer.name,
  bank: '',
  bankAccount: '',
  contact: '',
  contactPhone: '',
  status: 'active',
  note: '',
  updatedAt: customer.updated_at,
}))

const demoProjects: CustomerProjectSourceRow[] = projectsSeed.map(project => ({
  dataOrigin: 'demo',
  id: project.id,
  name: project.name,
  code: project.code,
  customerId: project.customer_id ?? null,
  secondaryCustomerId: 'secondary_customer_id' in project
    ? String(project.secondary_customer_id || '') || null
    : null,
  permission: project.id === 'proj_demo_003' ? 'forbidden' : 'allowed',
  status: project.status,
  startDate: project.start_date || null,
  plannedEnd: project.planned_end || null,
  manager: project.manager,
}))

const demoReceipts: CustomerReceiptSourceRow[] = receiptsSeed.map(receipt => ({
  dataOrigin: 'demo',
  id: receipt.id,
  no: receipt.no,
  customerId: receipt.customer_id,
  projectId: receipt.project_id ?? null,
  contractId: 'contract_id' in receipt ? String(receipt.contract_id || '') || null : null,
  payerAccount: receipt.payer_account,
  amount: Number(receipt.amount ?? 0),
  paymentMethod: receipt.payment_method,
  receiptDate: receipt.receipt_date || null,
  status: receipt.status,
}))

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new CustomerRepositoryProblem({
    ...customerProblem(code, message, retryable),
    traceId: `customer-test-${code}`,
  })
}

export function createCustomerReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  resolveFormalRows: (sessionId?: string | null) => readonly CustomerListSourceRow[] = id => customerCommandTestInstance.rows(id),
  resolveFormalSourceVersion: (sessionId?: string | null) => string = id => customerCommandTestInstance.sourceVersion(id),
  resolveMigrationSnapshot: (sessionId?: string | null) => CoreMigrationSnapshotDTO = () => EMPTY_MIGRATION_SNAPSHOT,
  resolveProjectFacts: (sessionId?: string | null) => Promise<{
    rows: readonly CustomerProjectSourceRow[]
    sourceVersion: string
    asOf: string
  }> = async () => ({ rows: demoProjects, sourceVersion: SOURCE_VERSION, asOf: FIXED_AS_OF }),
  resolveContractFacts: (sessionId?: string | null) => {
    rows: readonly CustomerContractSourceRow[]
    sourceVersion: string
    asOf: string
  } = customerConstructionContractFacts,
  resolveSession: (sessionId?: string | null) => BusinessSession = () => resolveBusinessSession(),
) {
  const scenarios = new Map<string, CustomerReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无客户查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '客户中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('customer:list:read'))
      throw problem('forbidden', '无客户查看权限')
    const migrationSnapshot = resolveMigrationSnapshot(sessionId)
    const customers = scenario === 'ready'
      ? [...resolveFormalRows(sessionId), ...customerRowsFromMigration(migrationSnapshot), ...demoCustomers]
      : []
    return {
      capabilities,
      customers,
      projects: scenario === 'ready' ? demoProjects : [],
      contracts: [] as CustomerContractSourceRow[],
      receipts: scenario === 'ready' ? demoReceipts : [],
      sourceVersion: readSourceVersion('customers', { formalVersion: resolveFormalSourceVersion(sessionId), migrationSnapshot, customers: customers.filter(row => row.dataOrigin === 'real') }),
    }
  }

  async function detailContext(origin: DataOriginDTO, sessionId?: string | null) {
    const data = context(sessionId)
    let projectsProblem: ProblemDTO | undefined
    let contractsProblem: ProblemDTO | undefined
    let receiptsProblem: ProblemDTO | undefined
    let projects: readonly CustomerProjectSourceRow[] = []
    let contracts: readonly CustomerContractSourceRow[] = []
    let sourceVersion = data.sourceVersion
    const sources: SourceEvidenceDTO[] = [{ key: 'customers', state: 'readable', sourceVersion: data.sourceVersion, asOf: new Date().toISOString() }]
    if ((scenarios.get(keyFor(sessionId)) ?? 'ready') !== 'ready')
      return { ...data, projectsProblem, contractsProblem, receiptsProblem, asOf: new Date().toISOString(), sources: [...sources, ...['projects', 'construction-contracts', 'receipts'].map(key => ({ key, state: 'not-requested' as const, sourceVersion: null, asOf: null }))] }
    try {
      const source = await resolveProjectFacts(sessionId)
      projects = source.rows
      sourceVersion += `:${source.sourceVersion}`
      sources.push({ key: 'projects', state: 'readable', sourceVersion: source.sourceVersion, asOf: new Date().toISOString() })
    }
    catch (cause) {
      if (!(cause instanceof ProjectRepositoryProblem)
        || !['forbidden', 'unavailable'].includes(cause.problem.code)) {
        throw cause
      }
      projectsProblem = cause.problem
      sources.push({ key: 'projects', state: cause.problem.code === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null })
    }
    try {
      const source = resolveContractFacts(sessionId)
      contracts = source.rows
      sourceVersion += `:${source.sourceVersion}`
      sources.push({ key: 'construction-contracts', state: 'readable', sourceVersion: source.sourceVersion, asOf: new Date().toISOString() })
    }
    catch (cause) {
      if (!(cause instanceof ConstructionContractRepositoryProblem)
        || !['forbidden', 'unavailable'].includes(cause.problem.code)) {
        throw cause
      }
      contractsProblem = cause.problem
      sources.push({ key: 'construction-contracts', state: cause.problem.code === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null })
    }
    let receipts: readonly CustomerReceiptSourceRow[] = data.receipts
    if (origin === 'demo') {
      sources.push({ key: 'receipts', state: 'readable', sourceVersion: SOURCE_VERSION, asOf: new Date().toISOString() })
      assertUnchanged(data, sessionId)
      return { ...data, receipts, projects, contracts, projectsProblem, contractsProblem, receiptsProblem, asOf: new Date().toISOString(), sourceVersion, sources }
    }
    try {
      const source = customerReceiptFacts(sessionId)
      receipts = [...source.rows, ...data.receipts]
      sourceVersion += `:${source.sourceVersion}`
      sources.push({ key: 'receipts', state: 'readable', sourceVersion: source.sourceVersion, asOf: new Date().toISOString() })
    }
    catch (cause) {
      if (!(cause instanceof ReceiptRepositoryProblem)
        || !['forbidden', 'unavailable'].includes(cause.problem.code)) {
        throw cause
      }
      receiptsProblem = cause.problem
      sources.push({ key: 'receipts', state: cause.problem.code === 'forbidden' ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null })
    }
    assertUnchanged(data, sessionId)
    return { ...data, receipts, projects, contracts, projectsProblem, contractsProblem, receiptsProblem, asOf: new Date().toISOString(), sourceVersion, sources }
  }

  function assertUnchanged(data: ReturnType<typeof context>, sessionId?: string | null) {
    const latest = context(sessionId)
    if (latest.sourceVersion !== data.sourceVersion || JSON.stringify(latest.capabilities) !== JSON.stringify(data.capabilities))
      throw problem('unavailable', '读取期间客户档案或权限已变化，请重新读取', true)
  }

  return {
    facts(sessionId?: string | null) {
      const data = context(sessionId)
      return { rows: data.customers, capabilities: data.capabilities, sourceVersion: data.sourceVersion }
    },
    reset(next: CustomerReadTestScenario, sessionId?: string | null) {
      if (next === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), next)
    },
    async list(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseCustomerListQuery(input)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      const asOf = new Date().toISOString()
      const session = { ...resolveSession(sessionId), capabilities: data.capabilities }
      const common = { session, schemaVersion: 'customer-read-v2', operation: 'customer:list', asOf, scope: { query: readQueryScope(query), testSession: sessionId ?? null } }
      const real = createReadMeta({ ...common, dataOrigin: 'real', coverage: 'complete', sources: [{ key: 'customers', state: 'readable', sourceVersion: data.sourceVersion, asOf }] })
      const demo = createReadMeta({ ...common, dataOrigin: 'demo', coverage: query.includeDemo ? 'complete' : 'unknown', sources: [{ key: 'customers', state: query.includeDemo ? 'readable' : 'not-requested', sourceVersion: query.includeDemo ? SOURCE_VERSION : null, asOf: query.includeDemo ? asOf : null }] })
      return withOriginReadMeta(buildCustomerListPage({
        rows: data.customers,
        query,
        asOf,
        sourceVersion: data.sourceVersion,
        capabilities: data.capabilities,
      }), { real, demo })
    },
    async detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const query = parseCustomerDetailQuery(id, input)
      const data = await detailContext(query.origin, sessionId)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      const meta = createReadMeta({ session: { ...resolveSession(sessionId), capabilities: data.capabilities }, schemaVersion: 'customer-read-v2', operation: 'customer:detail', dataOrigin: query.origin, asOf: data.asOf, scope: { query, testSession: sessionId ?? null }, coverage: 'complete', sources: data.sources ?? [{ key: 'customers', state: 'readable', sourceVersion: data.sourceVersion, asOf: data.asOf }] })
      return withReadMeta(buildCustomerDetailRead({ ...data, query }), meta)
    },
    async receipt(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const query = parseCustomerReceiptDetailQuery(id, input)
      const data = await detailContext(query.origin, sessionId)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      if (query.origin === 'demo' && !query.includeDemo)
        throw problem('forbidden', '测试收款未授权显示')
      if (data.receiptsProblem)
        throw new CustomerRepositoryProblem(data.receiptsProblem)
      const source = data.receipts.find(row => row.id === id && row.dataOrigin === query.origin)
      if (!source) {
        const sameId = data.receipts.some(row => row.id === id)
        throw new CustomerRepositoryProblem(customerProblem(
          sameId ? 'relationship-mismatch' : 'not-found',
          sameId ? '收款来源与地址不匹配' : '收款记录不存在或已删除',
        ))
      }
      if (source.customerId !== query.customerId) {
        throw new CustomerRepositoryProblem(customerProblem(
          'relationship-mismatch',
          '收款记录与父客户不匹配',
        ))
      }
      const customerDetail = buildCustomerDetailRead({
        ...data,
        query: parseCustomerDetailQuery(source.customerId, {
          origin: query.origin,
          includeDemo: String(query.includeDemo),
        }),
        asOf: data.asOf,
      })
      const receipt = customerDetail.receipts.find(item => item.receipt.id === id)
      if (!receipt)
        throw new CustomerRepositoryProblem(customerProblem('not-found', '收款记录不存在或已删除'))
      const customer = {
        state: 'resolved' as const,
        entity: 'customer' as const,
        id: customerDetail.customer.id,
        label: customerDetail.customer.name,
        no: customerDetail.customer.taxNo || null,
      }
      const meta = createReadMeta({ session: { ...resolveSession(sessionId), capabilities: data.capabilities }, schemaVersion: 'customer-read-v2', operation: 'customer:receipt', dataOrigin: query.origin, asOf: data.asOf, scope: { query, testSession: sessionId ?? null }, coverage: 'complete', sources: data.sources ?? [{ key: 'customers', state: 'readable', sourceVersion: data.sourceVersion, asOf: data.asOf }] })
      return withReadMeta({
        dataOrigin: query.origin,
        receipt,
        customer,
        customerNavigation: {
          kind: 'entity-detail' as const,
          subject: customer,
          variant: 'detail' as const,
          view: null,
          filters: { dataOrigin: query.origin },
        },
        asOf: data.asOf,
        sourceVersion: data.sourceVersion,
        capabilities: data.capabilities,
      }, meta)
    },
  }
}

export const customerReadTestInstance = createCustomerReadTestInstance(
  sessionId => demoWorkspaceTestInstance.capabilities(sessionId),
  sessionId => customerCommandTestInstance.rows(sessionId),
  sessionId => customerCommandTestInstance.sourceVersion(sessionId),
  () => EMPTY_MIGRATION_SNAPSHOT,
  async (sessionId) => {
    const facts = (await import('./project-read-test-instance')).projectReadTestInstance.facts(sessionId)
    return {
      rows: facts.rows.map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        name: row.name,
        code: row.code,
        customerId: row.customerId,
        secondaryCustomerId: row.secondaryCustomerId,
        permission: demoProjects.find(project => row.dataOrigin === 'demo' && project.id === row.id)?.permission ?? 'allowed',
        status: row.status,
        startDate: row.startDate,
        plannedEnd: row.plannedEnd,
        manager: row.manager,
      })),
      sourceVersion: facts.sourceVersion,
      asOf: facts.asOf,
    }
  },
)
