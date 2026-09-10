import type {
  SupplierContractSourceRow,
  SupplierInvoiceSourceRow,
  SupplierListSourceRow,
  SupplierPaymentAllocationSourceRow,
  SupplierPaymentApplicationSourceRow,
  SupplierPaymentRecordSourceRow,
  SupplierProjectRelationSourceRow,
  SupplierProjectSourceRow,
  SupplierSettlementSourceRow,
} from '../../app/lib/supplier/repository'
import supplementsSeed from '../../app/lib/db/seed/contract_supplements.json'
import contractsSeed from '../../app/lib/db/seed/contracts.json'
import invoicesSeed from '../../app/lib/db/seed/invoices.json'
import paymentApplicationsSeed from '../../app/lib/db/seed/payment_applications.json'
import paymentAllocationsSeed from '../../app/lib/db/seed/payment_record_application_allocations.json'
import paymentRecordsSeed from '../../app/lib/db/seed/payment_records.json'
import projectSuppliersSeed from '../../app/lib/db/seed/project_suppliers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import suppliersSeed from '../../app/lib/db/seed/suppliers.json'
import {
  buildSupplierDetailRead,
  buildSupplierListPage,
  parseSupplierDetailQuery,
  parseSupplierListQuery,
  supplierProblem,
  SupplierRepositoryProblem,
} from '../../app/lib/supplier/repository'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { projectSupplierCommandTestInstance } from './project-supplier-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'
import { supplierFactSource } from './supplier-fact-source'

export type SupplierReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-23T00:00:00.000Z'
const SOURCE_VERSION = 'supplier-read-fixture-v1'

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

const demoSuppliers: SupplierListSourceRow[] = suppliersSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  aliases: jsonArray(row.aliases),
  externalRef: '',
  uniqueCode: row.unique_code,
  taxNo: row.tax_no,
  businessType: '',
  supplierCategory: row.supplier_category,
  rating: '',
  legalRep: '',
  registeredCapital: null,
  registeredDate: null,
  address: '',
  taxpayerType: '',
  mainBusiness: row.note,
  invoiceName: row.name,
  invoiceAddress: '',
  bank: row.bank,
  bankAccount: row.bank_account,
  phone: row.contact_phone,
  contact: row.contact,
  contactPhone: row.contact_phone,
  contactTitle: '',
  credentialStatus: row.credential_status,
  note: row.note,
  updatedAt: row.updated_at,
}))

const demoProjects: SupplierProjectSourceRow[] = projectsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  status: row.status,
  permission: row.id === 'proj_demo_005' ? 'forbidden' : 'allowed',
}))

const demoProjectSuppliers: SupplierProjectRelationSourceRow[] = projectSuppliersSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  projectId: row.project_id,
  supplierId: row.supplier_id,
  status: row.status,
}))

const supplementByContract = new Map<string, number>()
for (const row of supplementsSeed) {
  if (['draft', '草稿'].includes(row.status))
    continue
  supplementByContract.set(row.contract_id, (supplementByContract.get(row.contract_id) ?? 0) + Number(row.amount ?? 0))
}

const demoContracts: SupplierContractSourceRow[] = contractsSeed
  .filter(row => row.supplier_id)
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    supplierId: row.supplier_id,
    projectId: row.project_id || null,
    no: row.no,
    name: row.name,
    kind: row.kind,
    amount: Number(row.amount ?? 0),
    supplementAmount: supplementByContract.get(row.id) ?? 0,
    signDate: row.sign_date || null,
    status: row.status,
  }))

const demoInvoices: SupplierInvoiceSourceRow[] = invoicesSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  supplierId: row.supplier_id ?? null,
  projectId: row.project_id ?? null,
  contractId: 'contract_id' in row ? String(row.contract_id || '') || null : null,
  invoiceNumber: row.invoice_number,
  invoiceType: row.invoice_type,
  invoiceDate: row.invoice_date || null,
  totalAmount: Number(row.total_amount ?? 0),
  taxAmount: Number(row.tax_amount ?? 0),
  accountStatus: row.account_status,
}))

const demoPaymentApplications: SupplierPaymentApplicationSourceRow[] = paymentApplicationsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  supplierId: 'supplier_id' in row ? String(row.supplier_id || '') || null : null,
  projectId: row.project_id ?? null,
  contractId: 'contract_id' in row ? String(row.contract_id || '') || null : null,
  no: row.no,
  name: row.name,
  applyAmount: Number(row.apply_amount ?? 0),
  approvedAmount: row.approved_amount == null ? null : Number(row.approved_amount),
  approvedAmountOrigin: 'legacy',
  applyDate: row.apply_date || null,
  status: row.status,
}))

const demoPaymentRecords: SupplierPaymentRecordSourceRow[] = paymentRecordsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  supplierId: 'supplier_id' in row ? String(row.supplier_id || '') || null : null,
  projectId: row.project_id ?? null,
  no: row.no,
  amount: Number(row.amount ?? 0),
  paymentDate: row.payment_date || null,
  confirmationStatus: row.confirmation_status,
}))

const demoPaymentAllocations: SupplierPaymentAllocationSourceRow[] = paymentAllocationsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  paymentRecordId: row.payment_record_id,
  paymentApplicationId: row.payment_application_id,
  allocatedAmount: Number(row.allocated_amount ?? 0),
}))

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new SupplierRepositoryProblem({
    ...supplierProblem(code, message, retryable),
    traceId: `supplier-test-${code}`,
  })
}

export function createSupplierReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  resolveFormalRows: (sessionId?: string | null) => readonly SupplierListSourceRow[] = id => supplierCommandTestInstance.rows(id),
  resolveFormalSourceVersion: (sessionId?: string | null) => string = id => supplierCommandTestInstance.sourceVersion(id),
  resolveImportedRelations: (sessionId?: string | null) => {
    projects: readonly SupplierProjectSourceRow[]
    relations: readonly SupplierProjectRelationSourceRow[]
  } = id => projectSupplierCommandTestInstance.supplierProjectRows(id),
  resolveFormalContractSource: (sessionId?: string | null) => {
    rows: readonly SupplierContractSourceRow[]
    sourceVersion: string
  } = () => ({ rows: [], sourceVersion: 'material-contract-command-0' }),
  resolveFormalProjectSource: (sessionId?: string | null) => {
    rows: readonly SupplierProjectSourceRow[]
    sourceVersion: string
  } = () => ({ rows: [], sourceVersion: 'project-command-0' }),
  resolveSettlementSource?: (sessionId?: string | null) => {
    rows: readonly SupplierSettlementSourceRow[]
    sourceVersion: string
  },
) {
  const scenarios = new Map<string, SupplierReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无分供方查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '分供方中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('supplier:list:read'))
      throw problem('forbidden', '无分供方查看权限')
    const ready = scenario === 'ready'
    const imported = resolveImportedRelations(sessionId)
    const formalContracts = resolveFormalContractSource(sessionId)
    const formalProjects = resolveFormalProjectSource(sessionId)
    const settlementSource = resolveSettlementSource?.(sessionId)
    return {
      capabilities,
      suppliers: ready ? [...resolveFormalRows(sessionId), ...demoSuppliers] : [],
      projects: ready ? [...formalProjects.rows, ...imported.projects, ...demoProjects] : [],
      projectSuppliers: ready ? [...imported.relations, ...demoProjectSuppliers] : [],
      contracts: ready ? [...formalContracts.rows, ...demoContracts] : [],
      settlements: ready ? settlementSource?.rows ?? [] : [],
      settlementSourceConnected: settlementSource !== undefined,
      invoices: ready ? demoInvoices : [],
      paymentApplications: ready ? demoPaymentApplications : [],
      paymentRecords: ready ? demoPaymentRecords : [],
      paymentAllocations: ready ? demoPaymentAllocations : [],
      sourceVersion: `${SOURCE_VERSION}:${resolveFormalSourceVersion(sessionId)}:${formalContracts.sourceVersion}:${formalProjects.sourceVersion}:${settlementSource?.sourceVersion ?? 'settlements-not-connected'}:project-supplier-command-${projectSupplierCommandTestInstance.sourceVersion(sessionId)}`,
    }
  }

  return {
    reset(next: SupplierReadTestScenario, sessionId?: string | null) {
      if (next === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), next)
    },
    async formalOptions(sessionId?: string | null) {
      return context(sessionId).suppliers.filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name, aliases: [...row.aliases] }))
    },
    async list(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseSupplierListQuery(input)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      return buildSupplierListPage({ ...data, settlements: data.settlementSourceConnected ? data.settlements : undefined, query, asOf: FIXED_AS_OF })
    },
    async detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const query = parseSupplierDetailQuery(id, input)
      if (query.includeDemo && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试数据查看权限')
      return buildSupplierDetailRead({ ...data, query, asOf: FIXED_AS_OF })
    },
  }
}

export const supplierReadTestInstance = createSupplierReadTestInstance(
  id => demoWorkspaceTestInstance.capabilities(id),
  id => supplierCommandTestInstance.rows(id),
  id => `${supplierCommandTestInstance.sourceVersion(id)}`,
  id => projectSupplierCommandTestInstance.supplierProjectRows(id),
  (id) => {
    const source = supplierFactSource(id)
    return { rows: source.contracts, sourceVersion: source.sourceVersion }
  },
  id => ({
    rows: projectCommandTestInstance.rows(id).map(row => ({
      dataOrigin: 'real' as const,
      id: row.id,
      name: row.name,
      status: row.status,
      permission: 'allowed' as const,
    })),
    sourceVersion: projectCommandTestInstance.sourceVersion(id),
  }),
  (id) => {
    const source = supplierFactSource(id)
    return { rows: source.settlements, sourceVersion: source.sourceVersion }
  },
)
