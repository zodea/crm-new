import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
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
  ProjectSupplierWorkbenchQueryDTO,
  ProjectSupplierWorkbenchReadDTO,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { isConfirmedExpenditureSettlement, isEffectiveExpenditureContract } from '../contract/effective-status'
import { round2 } from '../util/number'
import {
  PROJECT_SUPPLIER_READ_CAPABILITY,
  projectSupplierProblem,
  ProjectSupplierRepositoryProblem,
} from './read-contract'
import { isVerifiedProjectSupplierSourceTarget } from './source-target-policy'

export interface BuildProjectSupplierWorkbenchReadInput {
  projects: readonly ProjectSupplierProjectSourceRow[]
  suppliers: readonly ProjectSupplierSupplierSourceRow[]
  relations: readonly ProjectSupplierRelationSourceRow[]
  contracts: readonly ProjectSupplierContractSourceRow[]
  claims: readonly ProjectSupplierClaimSourceRow[]
  invoices: readonly ProjectSupplierInvoiceSourceRow[]
  paymentRecords: readonly ProjectSupplierPaymentRecordSourceRow[]
  paymentAllocations: readonly ProjectSupplierPaymentAllocationSourceRow[]
  settlements: readonly ProjectSupplierSettlementSourceRow[]
  files: readonly ProjectSupplierFileSourceRow[]
  query: ProjectSupplierWorkbenchQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

export function parseProjectSupplierWorkbenchQuery(
  projectId: string,
  supplierId: string,
  input: Record<string, unknown> | undefined,
): ProjectSupplierWorkbenchQueryDTO {
  const origin = input?.origin ?? 'real'
  if (!projectId.trim() || !supplierId.trim() || !isDataOriginDTO(origin)) {
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem(
      'invalid-query',
      '项目分供方工作台查询参数无效',
    ))
  }
  return { projectId, supplierId, origin, includeDemo: bool(input?.includeDemo) }
}

function money(value: number): string {
  return round2(value).toFixed(2)
}

function resolvedRef<T extends EntityKindDTO>(
  entity: T,
  id: string,
  label: string,
  no: string | null,
): Extract<EntityRefDTO, { state: 'resolved' }> & { entity: T } {
  return { state: 'resolved', entity, id, label, no } as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: T }
}

function sourceNavigation(
  subject: Extract<EntityRefDTO, { state: 'resolved' }>,
  variant: string,
  dataOrigin: ProjectSupplierWorkbenchQueryDTO['origin'],
): NavigationIntentDTO {
  return isVerifiedProjectSupplierSourceTarget({
    dataOrigin,
    entity: subject.entity,
    variant,
  })
    ? { kind: 'source-record', subject, variant, view: null, filters: { dataOrigin } }
    : { kind: 'unavailable', reason: 'unverified-target' }
}

function settlementVariant(type: string): string {
  if (['材料', '材采'].includes(type))
    return 'material-settlement'
  if (['分包', '专业分包', '合同劳务'].includes(type))
    return 'subcontract-settlement'
  return 'other-settlement'
}

function approved(status: string): boolean {
  return ['approved', '已审批', '已批复'].includes(status)
}

function sourceOwnerNavigation(
  file: ProjectSupplierFileSourceRow,
  owners: Map<string, { label: string, navigation: NavigationIntentDTO }>,
): { label: string, navigation: NavigationIntentDTO } {
  return owners.get(`${file.ownerType}:${file.ownerId}`) ?? {
    label: '合作档案',
    navigation: { kind: 'unavailable', reason: 'missing-route' },
  }
}

export function buildProjectSupplierWorkbenchRead(
  input: BuildProjectSupplierWorkbenchReadInput,
): ProjectSupplierWorkbenchReadDTO {
  const { query } = input
  if (!input.capabilities.includes(PROJECT_SUPPLIER_READ_CAPABILITY)) {
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('forbidden', '无项目分供方工作台查看权限'))
  }
  if (query.origin === 'demo' && (!query.includeDemo || !input.capabilities.includes('demo:read'))) {
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('forbidden', '测试数据未开启或无查看权限'))
  }

  const project = input.projects.find(row => row.dataOrigin === query.origin && row.id === query.projectId)
  const supplier = input.suppliers.find(row => row.dataOrigin === query.origin && row.id === query.supplierId)
  if (!project || !supplier) {
    const projectExistsInOtherOrigin = !project
      && input.projects.some(row => row.dataOrigin !== query.origin && row.id === query.projectId)
    const supplierExistsInOtherOrigin = !supplier
      && input.suppliers.some(row => row.dataOrigin !== query.origin && row.id === query.supplierId)
    const existsInOtherOrigin = projectExistsInOtherOrigin || supplierExistsInOtherOrigin
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem(
      existsInOtherOrigin ? 'relationship-mismatch' : 'not-found',
      existsInOtherOrigin ? '项目或分供方来源与地址不匹配' : '项目或分供方不存在或已删除',
    ))
  }

  const relation = input.relations.find(row => row.dataOrigin === query.origin
    && row.projectId === project.id && row.supplierId === supplier.id)
  if (!relation) {
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem(
      'relationship-mismatch',
      '项目与分供方不存在真实合作关系',
    ))
  }

  const samePair = <T extends { dataOrigin: string, projectId: string, supplierId: string }>(row: T) =>
    row.dataOrigin === query.origin && row.projectId === project.id && row.supplierId === supplier.id

  const contracts = input.contracts.filter(samePair).map((row) => {
    const contract = resolvedRef('contract', row.id, row.name, row.no || null)
    return {
      contract,
      navigation: sourceNavigation(contract, 'detail', query.origin),
      kind: row.kind,
      status: row.status,
      amount: money(row.amount),
      effectiveAmount: money(row.amount + row.supplementAmount),
      signDate: row.signDate,
      attachmentCount: row.attachmentCount,
    }
  })
  const claims = input.claims.filter(samePair).map((row) => {
    const application = resolvedRef('payment-application', row.id, row.name, row.no || null)
    return {
      application,
      navigation: sourceNavigation(application, 'detail', query.origin),
      status: row.status,
      applyAmount: money(row.applyAmount),
      approvedAmount: money(row.approvedAmount),
      applyDate: row.applyDate,
      invoiceState: row.invoiceState,
      attachmentCount: row.attachmentCount,
    }
  })
  const invoices = input.invoices.filter(samePair).map((row) => {
    const invoice = resolvedRef('invoice', row.id, row.invoiceNumber || '未编号发票', row.invoiceNumber || null)
    return {
      invoice,
      navigation: sourceNavigation(invoice, 'detail', query.origin),
      invoiceDate: row.invoiceDate,
      invoiceType: row.invoiceType,
      totalAmount: money(row.totalAmount),
      taxAmount: money(row.taxAmount),
      accountStatus: row.accountStatus,
      fileName: row.fileName,
    }
  })
  const claimById = new Map(claims.map(row => [row.application.id, row]))
  const paymentFacts = new Map<string, { row: ProjectSupplierPaymentRecordSourceRow, amount: number, applicationNos: Set<string> }>()
  for (const allocation of input.paymentAllocations) {
    if (allocation.dataOrigin !== query.origin)
      continue
    const claim = claimById.get(allocation.paymentApplicationId)
    const payment = input.paymentRecords.find(row => row.dataOrigin === query.origin && row.id === allocation.paymentRecordId)
    if (!claim || !payment)
      continue
    const fact = paymentFacts.get(payment.id) ?? { row: payment, amount: 0, applicationNos: new Set<string>() }
    fact.amount += allocation.allocatedAmount
    fact.applicationNos.add(claim.application.no || claim.application.label)
    paymentFacts.set(payment.id, fact)
  }
  const payments = [...paymentFacts.values()].map(({ row, amount, applicationNos }) => {
    const payment = resolvedRef('payment-record', row.id, row.no || row.voucherNo || '未编号支付记录', row.no || null)
    return {
      payment,
      navigation: sourceNavigation(payment, 'detail', query.origin),
      paymentDate: row.paymentDate,
      allocatedAmount: money(amount),
      paymentMethod: row.paymentMethod,
      voucherNo: row.voucherNo,
      confirmationStatus: row.confirmationStatus,
      applicationNos: [...applicationNos],
      attachmentCount: row.attachmentCount,
    }
  })
  const settlements = input.settlements.filter(samePair).map((row) => {
    const settlement = resolvedRef('settlement', row.id, row.name, row.no || null)
    return {
      settlement,
      navigation: sourceNavigation(settlement, settlementVariant(row.settlementType), query.origin),
      settlementType: row.settlementType,
      settlementDate: row.settlementDate,
      totalAmount: money(row.totalAmount),
      status: row.status,
      attachmentCount: row.attachmentCount,
    }
  })
  const owners = new Map<string, { label: string, navigation: NavigationIntentDTO }>()
  for (const row of contracts)
    owners.set(`contract:${row.contract.id}`, { label: `合同 · ${row.contract.no || row.contract.label}`, navigation: row.navigation })
  for (const row of claims)
    owners.set(`payment_application:${row.application.id}`, { label: `付款申请 · ${row.application.no || row.application.label}`, navigation: row.navigation })
  for (const row of invoices)
    owners.set(`invoice:${row.invoice.id}`, { label: `发票 · ${row.invoice.no || row.invoice.label}`, navigation: row.navigation })
  for (const row of payments)
    owners.set(`payment_record:${row.payment.id}`, { label: `支付记录 · ${row.payment.no || row.payment.label}`, navigation: row.navigation })
  for (const row of settlements)
    owners.set(`expenditure_settlement:${row.settlement.id}`, { label: `支出结算 · ${row.settlement.no || row.settlement.label}`, navigation: row.navigation })
  const files = input.files
    .filter(row => row.dataOrigin === query.origin && row.relationId === relation.id)
    .map((row) => {
      const owner = sourceOwnerNavigation(row, owners)
      return {
        file: resolvedRef('file', row.id, row.fileName, null),
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        sourceLabel: owner.label,
        navigation: owner.navigation,
        fileSize: row.fileSize,
        mimeType: row.mimeType,
        category: row.category,
        uploader: row.uploader,
        uploadedAt: row.uploadedAt,
        content: {
          state: row.ownerType !== 'project_supplier' || row.ownerId !== relation.id
            ? 'not-connected' as const
            : row.hasPayload ? 'available' as const : 'missing' as const,
          sha256: row.sha256 ?? null,
        },
      }
    })

  const formalContracts = contracts.filter(row => isEffectiveExpenditureContract(row.status))
  const contractTotal = formalContracts.reduce((total, row) => total + Number(row.effectiveAmount), 0)
  const claimedTotal = claims.filter(row => approved(row.status)).reduce((total, row) => total + Number(row.approvedAmount), 0)
  const archivedInvoices = invoices.filter(row => row.accountStatus === 'archived')
  const invoiceTotal = archivedInvoices.reduce((total, row) => total + Number(row.totalAmount), 0)
  const taxTotal = archivedInvoices.reduce((total, row) => total + Number(row.taxAmount), 0)
  const paidTotal = payments.filter(row => row.confirmationStatus === 'confirmed').reduce((total, row) => total + Number(row.allocatedAmount), 0)
  const settlementTotal = settlements.filter(row => isConfirmedExpenditureSettlement(row.status)).reduce((total, row) => total + Number(row.totalAmount), 0)
  const projectRef = resolvedRef('project', project.id, project.name, null)
  const supplierRef = resolvedRef('supplier', supplier.id, supplier.name, null)

  return {
    dataOrigin: query.origin,
    relation: { id: relation.id, status: relation.status, note: relation.note },
    project: projectRef,
    projectNavigation: { kind: 'entity-detail', subject: projectRef, variant: 'detail', view: null, filters: { dataOrigin: query.origin } },
    projectProfile: { status: project.status, developer: project.developer, manager: project.manager },
    supplier: supplierRef,
    supplierNavigation: { kind: 'entity-detail', subject: supplierRef, variant: 'detail', view: null, filters: { dataOrigin: query.origin } },
    supplierProfile: { supplierCategory: supplier.supplierCategory, contact: supplier.contact, contactPhone: supplier.contactPhone },
    contracts,
    claims,
    invoices,
    payments,
    settlements,
    files,
    summary: {
      contractTotal: money(contractTotal),
      claimedTotal: money(claimedTotal),
      invoiceTotal: money(invoiceTotal),
      taxTotal: money(taxTotal),
      paidTotal: money(paidTotal),
      settlementTotal: money(settlementTotal),
      balance: money(contractTotal - paidTotal),
    },
    counts: {
      contracts: contracts.length,
      claims: claims.length,
      invoices: invoices.length,
      payments: payments.length,
      settlements: settlements.length,
      files: files.length,
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
