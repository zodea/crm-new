import type { EntityKindDTO, EntityRefDTO, MetricDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  SupplierContractSourceRow,
  SupplierDetailQueryDTO,
  SupplierDetailReadDTO,
  SupplierInvoiceSourceRow,
  SupplierListPageDTO,
  SupplierListQueryDTO,
  SupplierListSourceRow,
  SupplierPageSize,
  SupplierPaymentAllocationSourceRow,
  SupplierPaymentApplicationSourceRow,
  SupplierPaymentRecordSourceRow,
  SupplierProjectRelationSourceRow,
  SupplierProjectSourceRow,
  SupplierSettlementSourceRow,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { round2 } from '../util/number'
import { maskBankAccount, maskIdentifier, maskPhone } from '../util/privacy'
import { SUPPLIER_PAGE_SIZES, supplierProblem, SupplierRepositoryProblem } from './read-contract'

interface BuildSupplierListPageInput {
  suppliers: readonly SupplierListSourceRow[]
  projectSuppliers: readonly SupplierProjectRelationSourceRow[]
  contracts: readonly SupplierContractSourceRow[]
  paymentApplications: readonly SupplierPaymentApplicationSourceRow[]
  paymentRecords: readonly SupplierPaymentRecordSourceRow[]
  paymentAllocations: readonly SupplierPaymentAllocationSourceRow[]
  query: SupplierListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildSupplierDetailReadInput {
  suppliers: readonly SupplierListSourceRow[]
  projects: readonly SupplierProjectSourceRow[]
  projectSuppliers: readonly SupplierProjectRelationSourceRow[]
  contracts: readonly SupplierContractSourceRow[]
  settlements: readonly SupplierSettlementSourceRow[]
  invoices: readonly SupplierInvoiceSourceRow[]
  paymentApplications: readonly SupplierPaymentApplicationSourceRow[]
  paymentRecords: readonly SupplierPaymentRecordSourceRow[]
  paymentAllocations: readonly SupplierPaymentAllocationSourceRow[]
  query: SupplierDetailQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback
}

export function parseSupplierListQuery(input: Record<string, unknown> | undefined): SupplierListQueryDTO {
  const sort = input?.sort ?? 'updated-desc'
  const pageSize = positiveInteger(input?.pageSize, 10)
  if (!['updated-desc', 'name-asc', 'name-desc', 'category-asc'].includes(String(sort))
    || !SUPPLIER_PAGE_SIZES.includes(pageSize as SupplierPageSize)) {
    throw new SupplierRepositoryProblem(supplierProblem('invalid-query', '分供方列表查询参数无效'))
  }
  return {
    includeDemo: bool(input?.includeDemo),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    category: typeof input?.category === 'string' && input.category.trim() ? input.category.trim() : null,
    credentialStatus: typeof input?.credentialStatus === 'string' && input.credentialStatus.trim() ? input.credentialStatus.trim() : null,
    sort: sort as SupplierListQueryDTO['sort'],
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as SupplierPageSize,
  }
}

export function parseSupplierDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): SupplierDetailQueryDTO {
  const origin = input?.origin ?? 'real'
  if (!id.trim() || !isDataOriginDTO(origin)) {
    throw new SupplierRepositoryProblem(supplierProblem(
      'invalid-query',
      '分供方详情查询参数无效',
    ))
  }
  return { id, origin, includeDemo: bool(input?.includeDemo) }
}

function moneyMetric(
  value: number,
  entity: EntityKindDTO,
  supplierId: string,
  asOf: string,
  drilldown = true,
): MetricDTO {
  return {
    value: value.toFixed(2),
    unit: 'CNY',
    status: 'complete',
    missingSources: [],
    asOf,
    drilldown: drilldown ? { entity, filters: { supplierId } } : null,
  }
}

function visibleSupplier(
  source: SupplierListSourceRow,
  capabilities: readonly string[],
): SupplierListSourceRow {
  if (capabilities.includes('supplier:sensitive:read'))
    return { ...source, aliases: [...source.aliases] }
  return {
    ...source,
    aliases: [...source.aliases],
    uniqueCode: maskIdentifier(source.uniqueCode),
    taxNo: maskIdentifier(source.taxNo),
    bankAccount: maskBankAccount(source.bankAccount),
    phone: maskPhone(source.phone),
    contactPhone: maskPhone(source.contactPhone),
  }
}

function resolvedRef(
  entity: Extract<EntityKindDTO, 'project' | 'supplier' | 'contract' | 'settlement' | 'invoice' | 'payment-application'>,
  id: string,
  label: string,
  no: string | null,
): Extract<EntityRefDTO, { state: 'resolved' }> {
  return { state: 'resolved', entity, id, label, no }
}

function missingRef<const T extends Extract<EntityKindDTO, 'project' | 'contract'>>(entity: T): Extract<EntityRefDTO, { state: 'missing' }> & { entity: T } {
  return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
}

function projectRef(
  id: string | null,
  projects: readonly SupplierProjectSourceRow[],
  origin: SupplierDetailQueryDTO['origin'],
): EntityRefDTO & { entity: 'project' } {
  if (!id)
    return missingRef('project')
  const source = projects.find(row => row.id === id && row.dataOrigin === origin)
  if (!source)
    return missingRef('project')
  if (source.permission === 'forbidden') {
    return { state: 'forbidden', entity: 'project', id, label: null, reason: 'permission-denied' }
  }
  return resolvedRef('project', id, source.name, null) as EntityRefDTO & { entity: 'project' }
}

function contractRef(
  id: string | null,
  contracts: readonly SupplierContractSourceRow[],
  origin: SupplierDetailQueryDTO['origin'],
): EntityRefDTO & { entity: 'contract' } {
  if (!id)
    return missingRef('contract')
  const source = contracts.find(row => row.id === id && row.dataOrigin === origin)
  return source
    ? resolvedRef('contract', source.id, source.name, source.no) as EntityRefDTO & { entity: 'contract' }
    : missingRef('contract')
}

function unavailable(reference: EntityRefDTO): NavigationIntentDTO {
  return {
    kind: 'unavailable',
    reason: reference.state === 'forbidden' ? 'forbidden' : 'missing-id',
  }
}

function detailNavigation(reference: EntityRefDTO, filters: Record<string, string | null> = {}): NavigationIntentDTO {
  if (reference.state !== 'resolved')
    return unavailable(reference)
  return { kind: 'entity-detail', subject: reference, variant: 'detail', view: null, filters }
}

function money(value: number): string {
  return round2(value).toFixed(2)
}

function confirmedSettlement(status: string): boolean {
  return ['confirmed', 'approved', '已确认', '已审批'].includes(status)
}

function paymentBySupplier(input: BuildSupplierListPageInput): Map<string, number> {
  const confirmed = new Set(input.paymentRecords
    .filter(row => row.confirmationStatus === 'confirmed')
    .map(row => `${row.dataOrigin}:${row.id}`))
  const applicationSupplier = new Map(input.paymentApplications
    .filter(row => row.supplierId)
    .map(row => [`${row.dataOrigin}:${row.id}`, row.supplierId!]))
  const totals = new Map<string, number>()
  for (const allocation of input.paymentAllocations) {
    if (!confirmed.has(`${allocation.dataOrigin}:${allocation.paymentRecordId}`))
      continue
    const supplierId = applicationSupplier.get(`${allocation.dataOrigin}:${allocation.paymentApplicationId}`)
    if (!supplierId)
      continue
    const key = `${allocation.dataOrigin}:${supplierId}`
    totals.set(key, round2((totals.get(key) ?? 0) + allocation.allocatedAmount))
  }
  return totals
}

export function buildSupplierListPage(input: BuildSupplierListPageInput): SupplierListPageDTO {
  const query = input.query
  const allowedOrigins = query.includeDemo ? new Set(['real', 'demo']) : new Set(['real'])
  const normalizedSearch = query.search.toLocaleLowerCase('zh-CN')
  const filtered = input.suppliers.filter((row) => {
    if (!allowedOrigins.has(row.dataOrigin))
      return false
    if (query.category && row.supplierCategory !== query.category)
      return false
    if (query.credentialStatus && row.credentialStatus !== query.credentialStatus)
      return false
    if (!normalizedSearch)
      return true
    return [row.name, row.aliases.join(' '), row.uniqueCode, row.taxNo, row.contact]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))
  })
  const paid = paymentBySupplier(input)
  const stats = (row: SupplierListSourceRow) => {
    const relationIds = new Set(input.projectSuppliers
      .filter(item => item.dataOrigin === row.dataOrigin && item.supplierId === row.id)
      .map(item => item.projectId))
    const contractAmount = input.contracts
      .filter(item => item.dataOrigin === row.dataOrigin && item.supplierId === row.id && !['draft', '草稿'].includes(item.status))
      .reduce((sum, item) => sum + item.amount + item.supplementAmount, 0)
    return {
      projectCount: relationIds.size,
      contractAmount: round2(contractAmount),
      paymentAmount: paid.get(`${row.dataOrigin}:${row.id}`) ?? 0,
    }
  }
  const sorted = [...filtered].sort((left, right) => {
    if (query.sort === 'name-asc')
      return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (query.sort === 'name-desc')
      return right.name.localeCompare(left.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (query.sort === 'category-asc')
      return left.supplierCategory.localeCompare(right.supplierCategory, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const start = (query.page - 1) * query.pageSize
  const items = sorted.slice(start, start + query.pageSize).map((source) => {
    const visible = visibleSupplier(source, input.capabilities)
    const supplier = resolvedRef('supplier', source.id, source.name, visible.uniqueCode || null) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'supplier' }
    const summary = stats(source)
    return {
      dataOrigin: source.dataOrigin,
      supplier,
      navigation: {
        kind: 'entity-detail' as const,
        subject: supplier,
        variant: 'detail' as const,
        view: null,
        filters: { dataOrigin: source.dataOrigin },
      },
      aliases: [...source.aliases],
      taxNo: visible.taxNo,
      uniqueCode: visible.uniqueCode,
      supplierCategory: source.supplierCategory,
      credentialStatus: source.credentialStatus,
      contact: source.contact,
      contactPhone: visible.contactPhone,
      projectCount: summary.projectCount,
      contractAmount: money(summary.contractAmount),
      paymentAmount: money(summary.paymentAmount),
      updatedAt: source.updatedAt,
    }
  })
  const countBy = (field: 'supplierCategory' | 'credentialStatus') => [...new Set(filtered.map(row => row[field]))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({ value, label: value, count: filtered.filter(row => row[field] === value).length }))
  const origins = (['real', 'demo'] as const).reduce<SupplierListPageDTO['summary']['origins']>((result, origin) => {
    const rows = filtered.filter(row => row.dataOrigin === origin)
    const totals = rows.map(stats).reduce((sum, item) => ({
      contractAmount: sum.contractAmount + item.contractAmount,
      paymentAmount: sum.paymentAmount + item.paymentAmount,
    }), { contractAmount: 0, paymentAmount: 0 })
    result[origin] = {
      supplierCount: rows.length,
      contractAmount: money(totals.contractAmount),
      paymentAmount: money(totals.paymentAmount),
    }
    return result
  }, { real: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' }, demo: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' } })
  return {
    items,
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length },
    summary: {
      categories: countBy('supplierCategory'),
      credentialStatuses: countBy('credentialStatus'),
      origins,
    },
    empty: filtered.length === 0
      ? { reason: input.suppliers.some(row => allowedOrigins.has(row.dataOrigin)) ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function buildSupplierDetailRead(input: BuildSupplierDetailReadInput): SupplierDetailReadDTO {
  if (input.query.origin === 'demo' && !input.query.includeDemo) {
    throw new SupplierRepositoryProblem(supplierProblem('forbidden', '测试分供方未授权显示'))
  }
  const source = input.suppliers.find(row => row.id === input.query.id && row.dataOrigin === input.query.origin)
  if (!source) {
    const sameId = input.suppliers.some(row => row.id === input.query.id)
    throw new SupplierRepositoryProblem(supplierProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '分供方来源与地址不匹配' : '分供方不存在或已删除',
    ))
  }

  const projectRelations = input.projectSuppliers.filter(row =>
    row.dataOrigin === input.query.origin && row.supplierId === source.id)
  const contracts = input.contracts.filter(row =>
    row.dataOrigin === input.query.origin && row.supplierId === source.id)
  const contractDTOs = contracts.map((row) => {
    const contract = resolvedRef('contract', row.id, row.name, row.no) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'contract' }
    const project = projectRef(row.projectId, input.projects, input.query.origin)
    return {
      contract,
      navigation: detailNavigation(contract),
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      kind: row.kind,
      effectiveAmount: money(row.amount + row.supplementAmount),
      signDate: row.signDate,
      status: row.status,
      isDraft: ['draft', '草稿'].includes(row.status),
    }
  })
  const settlementSources = input.settlements.filter(row =>
    row.dataOrigin === input.query.origin && row.supplierId === source.id)
  const settlementDTOs = settlementSources.map((row) => {
    const settlement = resolvedRef('settlement', row.id, row.name, row.no) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'settlement' }
    const project = projectRef(row.projectId, input.projects, input.query.origin)
    const contract = contractRef(row.contractId, input.contracts, input.query.origin)
    return {
      settlement,
      navigation: { kind: 'unavailable', reason: 'missing-route' } as const,
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      contract,
      contractNavigation: detailNavigation(contract),
      settlementType: row.settlementType,
      totalAmount: money(row.totalAmount),
      settlementDate: row.settlementDate,
      status: row.status,
    }
  })
  const invoiceSources = input.invoices.filter(row =>
    row.dataOrigin === input.query.origin && row.supplierId === source.id && row.accountStatus === 'archived')
  const invoiceDTOs = invoiceSources.map((row) => {
    const invoice = resolvedRef('invoice', row.id, row.invoiceNumber, row.invoiceNumber) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'invoice' }
    const project = projectRef(row.projectId, input.projects, input.query.origin)
    const contract = contractRef(row.contractId, input.contracts, input.query.origin)
    return {
      invoice,
      navigation: detailNavigation(invoice),
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      contract,
      contractNavigation: detailNavigation(contract),
      invoiceType: row.invoiceType,
      invoiceDate: row.invoiceDate,
      totalAmount: money(row.totalAmount),
      taxAmount: money(row.taxAmount),
      accountStatus: row.accountStatus,
    }
  })
  const confirmedPaymentIds = new Set(input.paymentRecords
    .filter(row => row.dataOrigin === input.query.origin && row.confirmationStatus === 'confirmed')
    .map(row => row.id))
  const paidByApplication = new Map<string, number>()
  for (const allocation of input.paymentAllocations) {
    if (allocation.dataOrigin !== input.query.origin || !confirmedPaymentIds.has(allocation.paymentRecordId))
      continue
    paidByApplication.set(
      allocation.paymentApplicationId,
      round2((paidByApplication.get(allocation.paymentApplicationId) ?? 0) + allocation.allocatedAmount),
    )
  }
  const paymentSources = input.paymentApplications.filter(row =>
    row.dataOrigin === input.query.origin && row.supplierId === source.id)
  const paymentDTOs = paymentSources.map((row) => {
    const application = resolvedRef('payment-application', row.id, row.name, row.no) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'payment-application' }
    const project = projectRef(row.projectId, input.projects, input.query.origin)
    const contract = contractRef(row.contractId, input.contracts, input.query.origin)
    return {
      application,
      navigation: detailNavigation(application),
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      contract,
      contractNavigation: detailNavigation(contract),
      applyAmount: money(row.applyAmount),
      approvedAmount: money(row.approvedAmount),
      actualPaidAmount: money(paidByApplication.get(row.id) ?? 0),
      applyDate: row.applyDate,
      status: row.status,
    }
  })
  const effectiveContracts = contractDTOs.filter(row => !row.isDraft)
  const contractAmount = round2(effectiveContracts.reduce((sum, row) => sum + Number(row.effectiveAmount), 0))
  const effectiveSettlements = settlementDTOs.filter(row => confirmedSettlement(row.status))
  const settlementAmount = round2(effectiveSettlements.reduce((sum, row) => sum + Number(row.totalAmount), 0))
  const invoiceAmount = round2(invoiceDTOs.reduce((sum, row) => sum + Number(row.totalAmount), 0))
  const paymentAmount = round2(paymentDTOs.reduce((sum, row) => sum + Number(row.actualPaidAmount), 0))

  return {
    dataOrigin: input.query.origin,
    supplier: visibleSupplier(source, input.capabilities),
    projects: projectRelations.map((row) => {
      const project = projectRef(row.projectId, input.projects, input.query.origin)
      return {
        relationId: row.id,
        project,
        navigation: project.state === 'resolved'
          ? { kind: 'entity-subview', subject: project, variant: 'supplier-workbench', view: 'overview', filters: { supplierId: source.id, dataOrigin: input.query.origin } }
          : unavailable(project),
        relationshipStatus: row.status,
      }
    }),
    contracts: contractDTOs,
    settlements: settlementDTOs,
    invoices: invoiceDTOs,
    payments: paymentDTOs,
    summary: {
      projectCount: projectRelations.length,
      contractCount: contractDTOs.length,
      settlementCount: settlementDTOs.length,
      invoiceCount: invoiceDTOs.length,
      paymentCount: paymentDTOs.length,
      contractAmount: moneyMetric(contractAmount, 'contract', source.id, input.asOf),
      settlementAmount: moneyMetric(settlementAmount, 'settlement', source.id, input.asOf),
      invoiceAmount: moneyMetric(invoiceAmount, 'invoice', source.id, input.asOf),
      paymentAmount: moneyMetric(paymentAmount, 'payment-record', source.id, input.asOf),
      payableAmount: moneyMetric(round2(contractAmount - paymentAmount), 'payment-record', source.id, input.asOf, false),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
