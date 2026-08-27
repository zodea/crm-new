import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type {
  ProjectSupplierClaimSourceRow,
  ProjectSupplierContractSourceRow,
  ProjectSupplierFileSourceRow,
  ProjectSupplierInvoiceSourceRow,
  ProjectSupplierPaymentAllocationSourceRow,
  ProjectSupplierPaymentRecordSourceRow,
  ProjectSupplierProjectSourceRow,
  ProjectSupplierRelationSourceRow,
  ProjectSupplierSettlementSourceRow,
  ProjectSupplierSupplierSourceRow,
} from '../../app/lib/project-supplier/repository'
import type { ProjectSupplierReferenceSourceRow } from '../../app/lib/project/repository'
import type { DataOriginDTO } from '../../app/types/read-model'
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
  buildProjectSupplierWorkbenchRead,
  parseProjectSupplierWorkbenchQuery,
  PROJECT_SUPPLIER_READ_CAPABILITY,
  projectSupplierProblem,
  ProjectSupplierRepositoryProblem,
} from '../../app/lib/project-supplier/repository'
import { resolveBusinessSession } from './business-session'
import { coreMigrationTestInstance } from './core-migration-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { projectSupplierCommandTestInstance } from './project-supplier-command-test-instance'

export type ProjectSupplierReadTestScenario = 'ready' | 'formal-ready' | 'zero' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-24T00:00:00.000Z'
const SOURCE_VERSION = 'project-supplier-read-fixture-v1'

const demoProjects: ProjectSupplierProjectSourceRow[] = projectsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  status: row.status,
  developer: row.contractor,
  manager: row.manager,
}))

const demoSuppliers: ProjectSupplierSupplierSourceRow[] = suppliersSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  name: row.name,
  supplierCategory: row.supplier_category,
  contact: row.contact,
  contactPhone: row.contact_phone,
}))

const demoRelations: ProjectSupplierRelationSourceRow[] = projectSuppliersSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  projectId: row.project_id,
  supplierId: row.supplier_id,
  status: row.status,
  note: '',
}))

const supplementByContract = new Map<string, number>()
for (const row of supplementsSeed) {
  if (['draft', '草稿'].includes(row.status))
    continue
  supplementByContract.set(row.contract_id, (supplementByContract.get(row.contract_id) ?? 0) + Number(row.amount ?? 0))
}

const demoContracts: ProjectSupplierContractSourceRow[] = contractsSeed
  .filter(row => row.project_id && row.supplier_id && row.kind !== '施工')
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    projectId: row.project_id!,
    supplierId: row.supplier_id!,
    no: row.no,
    name: row.name,
    kind: row.kind,
    status: row.status,
    amount: Number(row.amount ?? 0),
    supplementAmount: supplementByContract.get(row.id) ?? 0,
    signDate: row.sign_date || null,
    attachmentCount: 0,
  }))

const demoClaims: ProjectSupplierClaimSourceRow[] = paymentApplicationsSeed
  .filter(row => row.project_id && 'supplier_id' in row && row.supplier_id)
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    projectId: row.project_id,
    supplierId: String(row.supplier_id),
    no: row.no,
    name: row.name,
    status: row.status,
    applyAmount: Number(row.apply_amount ?? 0),
    approvedAmount: Number(row.approved_amount ?? 0),
    applyDate: row.apply_date || null,
    invoiceState: row.invoice_state,
    attachmentCount: 0,
  }))

const demoInvoices: ProjectSupplierInvoiceSourceRow[] = invoicesSeed
  .filter(row => row.project_id && row.supplier_id)
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    projectId: row.project_id!,
    supplierId: row.supplier_id!,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date || null,
    invoiceType: row.invoice_type,
    totalAmount: Number(row.total_amount ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    accountStatus: row.account_status,
    fileName: row.file_name,
  }))

const demoPaymentRecords: ProjectSupplierPaymentRecordSourceRow[] = paymentRecordsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  no: row.no,
  paymentDate: row.payment_date || null,
  paymentMethod: row.payment_method,
  voucherNo: row.voucher_no,
  confirmationStatus: row.confirmation_status,
  attachmentCount: 0,
}))

const demoPaymentAllocations: ProjectSupplierPaymentAllocationSourceRow[] = paymentAllocationsSeed.map(row => ({
  dataOrigin: 'demo',
  id: row.id,
  paymentRecordId: row.payment_record_id,
  paymentApplicationId: row.payment_application_id,
  allocatedAmount: Number(row.allocated_amount ?? 0),
}))

const demoSettlements: ProjectSupplierSettlementSourceRow[] = [{
  dataOrigin: 'demo',
  id: 'settlement_demo_sup004_1',
  projectId: 'proj_demo_002',
  supplierId: 'sup_demo_004',
  no: 'JS-2026-CG-004',
  name: '五金机电首期材料结算',
  settlementType: '材料',
  settlementDate: '2026-06-20',
  totalAmount: 80000,
  status: 'confirmed',
  attachmentCount: 1,
}]

const demoFiles: ProjectSupplierFileSourceRow[] = [
  {
    dataOrigin: 'demo',
    id: 'file_demo_sup004_contract',
    relationId: 'ps_demo_005',
    ownerType: 'contract',
    ownerId: 'con_demo_cg07',
    fileName: '五金机电采购合同.pdf',
    fileSize: 248000,
    mimeType: 'application/pdf',
    category: '合同',
    uploader: '资料员',
    uploadedAt: '2026-06-20T08:00:00.000Z',
  },
  {
    dataOrigin: 'demo',
    id: 'file_demo_sup004_invoice',
    relationId: 'ps_demo_005',
    ownerType: 'invoice',
    ownerId: 'inv_demo_004',
    fileName: 'IMG_2026_0610.jpg',
    fileSize: 3560000,
    mimeType: 'image/jpeg',
    category: '收票原件',
    uploader: '财务部',
    uploadedAt: '2026-06-11T17:20:00.000Z',
  },
]

const formalFixture = {
  projects: [{
    dataOrigin: 'real' as const,
    id: 'project-real-317',
    name: '中央正式项目',
    status: '在建',
    developer: '中央建设单位',
    manager: '中央项目经理',
  }] satisfies ProjectSupplierProjectSourceRow[],
  suppliers: [{
    dataOrigin: 'real' as const,
    id: 'supplier-real-317',
    name: '中央正式分供方',
    supplierCategory: '材料供应商',
    contact: '正式联系人',
    contactPhone: '13800000317',
  }] satisfies ProjectSupplierSupplierSourceRow[],
  relations: [{
    dataOrigin: 'real' as const,
    id: 'relation-real-317',
    projectId: 'project-real-317',
    supplierId: 'supplier-real-317',
    status: 'claiming',
    note: '显式中央测试夹具',
  }] satisfies ProjectSupplierRelationSourceRow[],
  contracts: [{
    dataOrigin: 'real' as const,
    id: 'contract-real-317',
    projectId: 'project-real-317',
    supplierId: 'supplier-real-317',
    no: 'HT-REAL-317',
    name: '中央正式采购合同',
    kind: '材采',
    status: 'approved',
    amount: 100000,
    supplementAmount: 20000,
    signDate: '2026-08-01',
    attachmentCount: 1,
  }] satisfies ProjectSupplierContractSourceRow[],
  claims: [{
    dataOrigin: 'real' as const,
    id: 'claim-real-317',
    projectId: 'project-real-317',
    supplierId: 'supplier-real-317',
    no: 'QK-REAL-317',
    name: '中央正式请款',
    status: 'approved',
    applyAmount: 60000,
    approvedAmount: 50000,
    applyDate: '2026-08-02',
    invoiceState: '先票后款',
    attachmentCount: 1,
  }] satisfies ProjectSupplierClaimSourceRow[],
  invoices: [{
    dataOrigin: 'real' as const,
    id: 'invoice-real-317',
    projectId: 'project-real-317',
    supplierId: 'supplier-real-317',
    invoiceNumber: 'INV-REAL-317',
    invoiceDate: '2026-08-03',
    invoiceType: '增值税专用发票',
    totalAmount: 31800,
    taxAmount: 1800,
    accountStatus: 'archived',
    fileName: '中央正式发票.pdf',
  }] satisfies ProjectSupplierInvoiceSourceRow[],
  paymentRecords: [{
    dataOrigin: 'real' as const,
    id: 'payment-real-317',
    no: 'ZF-REAL-317',
    paymentDate: '2026-08-04',
    paymentMethod: '银行转账',
    voucherNo: 'V-REAL-317',
    confirmationStatus: 'confirmed',
    attachmentCount: 1,
  }] satisfies ProjectSupplierPaymentRecordSourceRow[],
  paymentAllocations: [{
    dataOrigin: 'real' as const,
    id: 'allocation-real-317',
    paymentRecordId: 'payment-real-317',
    paymentApplicationId: 'claim-real-317',
    allocatedAmount: 30000,
  }] satisfies ProjectSupplierPaymentAllocationSourceRow[],
  settlements: [{
    dataOrigin: 'real' as const,
    id: 'settlement-real-317',
    projectId: 'project-real-317',
    supplierId: 'supplier-real-317',
    no: 'JS-REAL-317',
    name: '中央正式结算',
    settlementType: '材料',
    settlementDate: '2026-08-05',
    totalAmount: 45000,
    status: 'confirmed',
    attachmentCount: 1,
  }] satisfies ProjectSupplierSettlementSourceRow[],
  files: [{
    dataOrigin: 'real' as const,
    id: 'file-real-317',
    relationId: 'relation-real-317',
    ownerType: 'contract',
    ownerId: 'contract-real-317',
    fileName: '中央正式合同扫描件.pdf',
    fileSize: 2048,
    mimeType: 'application/pdf',
    category: '合同',
    uploader: '中央资料员',
    uploadedAt: '2026-08-06T00:00:00.000Z',
  }] satisfies ProjectSupplierFileSourceRow[],
}

const EMPTY_MIGRATION_SNAPSHOT: CoreMigrationSnapshotDTO = {
  authority: 'local',
  activeBatchId: null,
  entities: [],
}

function formalRows(snapshot: CoreMigrationSnapshotDTO) {
  if (snapshot.authority !== 'central')
    return { projects: [], suppliers: [], relations: [] }
  const projects: ProjectSupplierProjectSourceRow[] = snapshot.entities
    .filter(row => row.entityType === 'projects' && row.deletedAt === null)
    .map(row => ({ dataOrigin: 'real' as const, id: row.id, name: row.name, status: '已迁移', developer: '', manager: '' }))
  const suppliers: ProjectSupplierSupplierSourceRow[] = snapshot.entities
    .filter(row => row.entityType === 'suppliers' && row.deletedAt === null)
    .map(row => ({ dataOrigin: 'real' as const, id: row.id, name: row.name, supplierCategory: '未记录', contact: '', contactPhone: '' }))
  const relations: ProjectSupplierRelationSourceRow[] = snapshot.entities
    .filter(row => row.entityType === 'project_suppliers' && row.deletedAt === null)
    .map(row => ({
      dataOrigin: 'real' as const,
      id: row.id,
      projectId: row.references.projectId ?? '',
      supplierId: row.references.supplierId ?? '',
      status: 'collecting',
      note: '',
    }))
    .filter(row => row.projectId && row.supplierId)
  return { projects, suppliers, relations }
}

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new ProjectSupplierRepositoryProblem({
    ...projectSupplierProblem(code, message, retryable),
    traceId: `project-supplier-test-${code}`,
  })
}

export function createProjectSupplierReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  resolveMigrationSnapshot: (sessionId?: string | null) => CoreMigrationSnapshotDTO = () => EMPTY_MIGRATION_SNAPSHOT,
) {
  const scenarios = new Map<string, ProjectSupplierReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无项目分供方工作台查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '项目分供方中央读取服务暂时不可用', true)
    const migration = resolveMigrationSnapshot(sessionId)
    const formal = formalRows(migration)
    const imported = projectSupplierCommandTestInstance.rows(sessionId)
    const ready = scenario === 'ready'
    const formalReady = scenario === 'formal-ready'
    const zero = scenario === 'zero'
    return {
      projects: zero ? formalFixture.projects : formalReady ? [...formalFixture.projects, ...imported.projects] : ready ? [...formal.projects, ...imported.projects, ...demoProjects] : [],
      suppliers: zero ? formalFixture.suppliers : formalReady ? [...formalFixture.suppliers, ...imported.suppliers] : ready ? [...formal.suppliers, ...imported.suppliers, ...demoSuppliers] : [],
      relations: zero ? formalFixture.relations : formalReady ? [...formalFixture.relations, ...imported.relations] : ready ? [...formal.relations, ...imported.relations, ...demoRelations] : [],
      contracts: formalReady ? formalFixture.contracts : ready ? demoContracts : [],
      claims: formalReady ? formalFixture.claims : ready ? demoClaims : [],
      invoices: formalReady ? formalFixture.invoices : ready ? demoInvoices : [],
      paymentRecords: formalReady ? formalFixture.paymentRecords : ready ? demoPaymentRecords : [],
      paymentAllocations: formalReady ? formalFixture.paymentAllocations : ready ? demoPaymentAllocations : [],
      settlements: formalReady ? formalFixture.settlements : ready ? demoSettlements : [],
      files: zero ? [] : formalReady ? [...formalFixture.files, ...imported.files] : ready ? [...imported.files, ...demoFiles] : [],
      capabilities: [...resolveCapabilities(sessionId)],
      sourceVersion: formalReady
        ? `${SOURCE_VERSION}:explicit-formal:command-${projectSupplierCommandTestInstance.sourceVersion(sessionId)}`
        : zero
          ? `${SOURCE_VERSION}:explicit-zero`
          : `${SOURCE_VERSION}:${migration.authority === 'central' ? migration.activeBatchId ?? 'migration-central' : 'migration-local'}:command-${projectSupplierCommandTestInstance.sourceVersion(sessionId)}`,
    }
  }

  function relationshipReferences(
    projectId: string,
    origin: DataOriginDTO,
    sessionId?: string | null,
  ): ProjectSupplierReferenceSourceRow[] {
    const data = context(sessionId)
    const suppliers = new Map(
      data.suppliers
        .filter(supplier => supplier.dataOrigin === origin)
        .map(supplier => [supplier.id, supplier]),
    )
    return data.relations
      .filter(relation => relation.projectId === projectId && relation.dataOrigin === origin)
      .map(relation => ({
        dataOrigin: relation.dataOrigin,
        relationId: relation.id,
        projectId: relation.projectId,
        supplierId: relation.supplierId || null,
        supplierName: suppliers.get(relation.supplierId)?.name ?? null,
        permission: 'allowed',
      }))
  }

  return {
    sourceVersion(sessionId?: string | null) {
      return projectSupplierCommandTestInstance.sourceVersion(sessionId)
    },
    reset(next: ProjectSupplierReadTestScenario, sessionId?: string | null) {
      if (next === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), next)
    },
    async detail(
      projectId: string,
      supplierId: string,
      input: Record<string, unknown> | undefined,
      sessionId?: string | null,
    ) {
      const data = context(sessionId)
      return buildProjectSupplierWorkbenchRead({
        ...data,
        query: parseProjectSupplierWorkbenchQuery(projectId, supplierId, input),
        asOf: FIXED_AS_OF,
      })
    },
    references(
      projectId: string,
      origin: DataOriginDTO,
      sessionId?: string | null,
    ): ProjectSupplierReferenceSourceRow[] {
      if (!resolveCapabilities(sessionId).includes(PROJECT_SUPPLIER_READ_CAPABILITY))
        throw problem('forbidden', '无项目分供方反向关系查看权限')
      return relationshipReferences(projectId, origin, sessionId)
    },
    commandRelationships(
      projectId: string,
      origin: DataOriginDTO,
      sessionId?: string | null,
    ): ProjectSupplierReferenceSourceRow[] {
      return relationshipReferences(projectId, origin, sessionId)
    },
  }
}

export const projectSupplierReadTestInstance = createProjectSupplierReadTestInstance(
  sessionId => demoWorkspaceTestInstance.capabilities(sessionId),
  () => coreMigrationTestInstance.snapshot(resolveBusinessSession()),
)
