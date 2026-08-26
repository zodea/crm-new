import type {
  CustomerContractSourceRow,
  CustomerListSourceRow,
  CustomerProjectSourceRow,
  CustomerReceiptSourceRow,
} from '../../app/lib/customer/repository'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import {
  buildCustomerDetailRead,
  buildCustomerListPage,
  customerProblem,
  CustomerRepositoryProblem,
  parseCustomerDetailQuery,
  parseCustomerListQuery,
  parseCustomerReceiptDetailQuery,
} from '../../app/lib/customer/repository'
import supplementsSeed from '../../app/lib/db/seed/contract_supplements.json'
import contractsSeed from '../../app/lib/db/seed/contracts.json'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import receiptsSeed from '../../app/lib/db/seed/receipt_registrations.json'
import { ownerFinalSettlementReceiptIsActive } from '../../app/lib/owner-document/central-repository'
import { resolveBusinessSession } from './business-session'
import { coreMigrationTestInstance } from './core-migration-test-instance'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from './owner-commercial-document-fixtures'

export type CustomerReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-23T00:00:00.000Z'
const SOURCE_VERSION = 'customer-read-fixture-v1'

const CONSTRUCTION_CUSTOMER_FIXTURE: CustomerListSourceRow = {
  dataOrigin: 'real',
  id: 'customer-real-320',
  name: '中央正式甲方客户',
  aliases: [],
  taxNo: 'CUSTOMER-CENTRAL-320',
  legalRep: '',
  registeredAddress: '',
  invoiceName: '中央正式甲方客户',
  bank: '',
  bankAccount: '',
  contact: '甲方联系人',
  contactPhone: '',
  status: 'active',
  note: '',
  updatedAt: FIXED_AS_OF,
}

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

const projectById = new Map(projectsSeed.map(project => [project.id, project]))
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

const supplementByContract = new Map<string, number>()
for (const supplement of supplementsSeed) {
  if (supplement.status === 'draft' || supplement.status === '草稿')
    continue
  supplementByContract.set(
    supplement.contract_id,
    (supplementByContract.get(supplement.contract_id) ?? 0) + Number(supplement.amount ?? 0),
  )
}
const receiptByContract = new Map<string, number>()
for (const receipt of receiptsSeed) {
  if (!('contract_id' in receipt) || !receipt.contract_id)
    continue
  receiptByContract.set(
    String(receipt.contract_id),
    (receiptByContract.get(String(receipt.contract_id)) ?? 0) + Number(receipt.amount ?? 0),
  )
}
const demoContracts: CustomerContractSourceRow[] = contractsSeed
  .filter(contract => contract.kind === '施工')
  .map((contract) => {
    const project = contract.project_id ? projectById.get(contract.project_id) : null
    return {
      dataOrigin: 'demo',
      id: contract.id,
      no: contract.no,
      name: contract.name,
      projectId: contract.project_id ?? null,
      customerId: project?.customer_id ?? null,
      amount: Number(contract.amount ?? 0),
      supplementAmount: supplementByContract.get(contract.id) ?? 0,
      receiptAmount: receiptByContract.get(contract.id) ?? 0,
      signDate: contract.sign_date || null,
      status: contract.status,
    }
  })
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
const formalFinalSettlementReceipts: CustomerReceiptSourceRow[] = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS
  .filter(document => document.kind === 'final_settlement' && document.customerId)
  .flatMap(document => (document.finalSettlementEvidence?.receipts ?? [])
    .filter(receipt => ownerFinalSettlementReceiptIsActive(receipt.status))
    .map(receipt => ({
      dataOrigin: 'real' as const,
      id: receipt.id,
      no: receipt.no,
      customerId: document.customerId!,
      projectId: document.projectId,
      contractId: document.contractId,
      payerAccount: document.customerName,
      amount: receipt.amount,
      paymentMethod: '',
      receiptDate: receipt.date,
      status: receipt.status,
    })))

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
      contracts: scenario === 'ready' ? demoContracts : [],
      receipts: scenario === 'ready' ? [...formalFinalSettlementReceipts, ...demoReceipts] : [],
      sourceVersion: `${SOURCE_VERSION}:${resolveFormalSourceVersion(sessionId)}:${
        migrationSnapshot.authority === 'central'
          ? migrationSnapshot.activeBatchId ?? 'migration-central'
          : 'migration-local'
      }`,
    }
  }

  return {
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
      return buildCustomerListPage({
        rows: data.customers,
        query,
        asOf: FIXED_AS_OF,
        sourceVersion: data.sourceVersion,
        capabilities: data.capabilities,
      })
    },
    async detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseCustomerDetailQuery(id, input)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      return buildCustomerDetailRead({ ...data, query, asOf: FIXED_AS_OF })
    },
    async receipt(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseCustomerReceiptDetailQuery(id, input)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      if (query.origin === 'demo' && !query.includeDemo)
        throw problem('forbidden', '测试收款未授权显示')
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
        asOf: FIXED_AS_OF,
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
      return {
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
        asOf: FIXED_AS_OF,
        sourceVersion: data.sourceVersion,
        capabilities: data.capabilities,
      }
    },
  }
}

export const customerReadTestInstance = createCustomerReadTestInstance(
  sessionId => demoWorkspaceTestInstance.capabilities(sessionId),
  sessionId => [CONSTRUCTION_CUSTOMER_FIXTURE, ...customerCommandTestInstance.rows(sessionId)],
  sessionId => customerCommandTestInstance.sourceVersion(sessionId),
  () => coreMigrationTestInstance.snapshot(resolveBusinessSession()),
)
