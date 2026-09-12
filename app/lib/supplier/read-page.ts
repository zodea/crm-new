import type { EntityKindDTO, EntityRefDTO, MetricDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  SupplierContractSourceRow,
  SupplierDetailQueryDTO,
  SupplierDetailReadDTO,
  SupplierInvoiceSourceRow,
  SupplierListNumericField,
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
import { isConfirmedExpenditureSettlement as confirmedSettlement, isEffectiveExpenditureContract as effectiveContract } from '../contract/effective-status'
import { readApprovalAmount } from '../finance/approval-amount'
import { round2 } from '../util/number'
import { maskBankAccount, maskIdentifier, maskPhone } from '../util/privacy'
import { SUPPLIER_LIST_NUMERIC_FIELDS, SUPPLIER_PAGE_SIZES, supplierProblem, SupplierRepositoryProblem } from './read-contract'
import { normalizeSupplierEnumSelection, parseSupplierColumnFilters } from './read-query'

interface BuildSupplierListPageInput {
  suppliers: readonly SupplierListSourceRow[]
  projectSuppliers: readonly SupplierProjectRelationSourceRow[]
  contracts: readonly SupplierContractSourceRow[]
  paymentApplications: readonly SupplierPaymentApplicationSourceRow[]
  paymentRecords: readonly SupplierPaymentRecordSourceRow[]
  paymentAllocations: readonly SupplierPaymentAllocationSourceRow[]
  settlements?: readonly SupplierSettlementSourceRow[]
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
  const columnFilters = parseSupplierColumnFilters(input?.columnFilters)
  const categories = normalizeSupplierEnumSelection(input?.category)
  const credentialStatuses = normalizeSupplierEnumSelection(input?.credentialStatus)
  if (!['updated-desc', 'name-asc', 'name-desc', 'category-asc', ...SUPPLIER_LIST_NUMERIC_FIELDS.flatMap(field => [`${field}-asc`, `${field}-desc`])].includes(String(sort))
    || !SUPPLIER_PAGE_SIZES.includes(pageSize as SupplierPageSize)) {
    throw new SupplierRepositoryProblem(supplierProblem('invalid-query', '分供方列表查询参数无效'))
  }
  return {
    includeDemo: bool(input?.includeDemo),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    category: categories.length ? categories : null,
    credentialStatus: credentialStatuses.length ? credentialStatuses : null,
    sort: sort as SupplierListQueryDTO['sort'],
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as SupplierPageSize,
    ...(columnFilters ? { columnFilters } : {}),
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
  value: number | null,
  entity: EntityKindDTO,
  supplierId: string,
  asOf: string,
  drilldown = true,
): MetricDTO {
  return {
    value: value === null ? null : value.toFixed(2),
    unit: 'CNY',
    status: value === null ? 'partial' : 'complete',
    missingSources: value === null ? [entity] : [],
    asOf,
    drilldown: drilldown ? { entity, filters: { supplierId } } : null,
  }
}

function visibleSupplier(
  source: SupplierListSourceRow,
  capabilities: readonly string[],
): SupplierListSourceRow {
  const businessLicense = capabilities.includes('supplier-credential:read')
    ? source.businessLicense ?? { state: 'unavailable' as const, fileCount: null, fileIds: [] }
    : { state: 'unavailable' as const, fileCount: null, fileIds: [] }
  if (capabilities.includes('supplier:sensitive:read'))
    return { ...source, businessLicense, laborScope: source.laborScope ?? '', aliases: [...source.aliases] }
  return {
    ...source,
    businessLicense,
    laborScope: source.laborScope ?? '',
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

function money(value: number): string
function money(value: number | null): string | null
function money(value: number | null): string | null {
  return value === null ? null : round2(value).toFixed(2)
}

function contractSourceNavigation(reference: EntityRefDTO, contracts: readonly SupplierContractSourceRow[], origin: SupplierDetailQueryDTO['origin']): NavigationIntentDTO {
  const source = reference.state === 'resolved' ? contracts.find(row => row.id === reference.id && row.dataOrigin === origin) : null
  if (!source || reference.state !== 'resolved')
    return detailNavigation(reference)
  if (source.kind === 'other_expense')
    return { kind: 'entity-detail', subject: reference, variant: 'other_expense', view: null, filters: { dataOrigin: origin, contractKind: source.kind } }
  return detailNavigation(reference, ['材采', '施工', '分包'].includes(source.kind) ? { dataOrigin: origin, contractKind: source.kind } : {})
}

function sumKnown(values: readonly (number | null)[]): number | null {
  return values.includes(null) ? null : round2(values.reduce<number>((sum, value) => sum + value!, 0))
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
  const normalizedSearch = query.search.trim().toLocaleLowerCase('zh-CN')
  const columnFilters = parseSupplierColumnFilters(query.columnFilters)
  const categories = normalizeSupplierEnumSelection(query.category)
  const credentialStatuses = normalizeSupplierEnumSelection(query.credentialStatus)
  const taxpayerTypes = normalizeSupplierEnumSelection(columnFilters?.taxpayerType)
  const paid = paymentBySupplier(input)
  const visibleRows = input.suppliers.filter(row => allowedOrigins.has(row.dataOrigin)).map(row => visibleSupplier(row, input.capabilities))
  const summaryById = new Map(visibleRows.map((row) => {
    const relationIds = new Set(input.projectSuppliers
      .filter(item => item.dataOrigin === row.dataOrigin && item.supplierId === row.id)
      .map(item => item.projectId))
    const contractAmount = sumKnown(input.contracts
      .filter(item => item.dataOrigin === row.dataOrigin && item.supplierId === row.id && effectiveContract(item.status))
      .map(item => sumKnown([item.amount, item.supplementAmount])))
    const settlementAmount = input.settlements === undefined
      ? null
      : sumKnown(input.settlements
          .filter(item => item.dataOrigin === row.dataOrigin && item.supplierId === row.id && confirmedSettlement(item.status))
          .map(item => item.totalAmount))
    return [`${row.dataOrigin}:${row.id}`, {
      projectCount: relationIds.size,
      contractAmount,
      cumulativeContractAmount: contractAmount,
      settlementAmount,
      paymentAmount: paid.get(`${row.dataOrigin}:${row.id}`) ?? 0,
    }] as const
  }))
  const stats = (row: SupplierListSourceRow) => summaryById.get(`${row.dataOrigin}:${row.id}`)!
  const contains = (value: string, text: string) => value.toLocaleLowerCase('zh-CN').includes(text.toLocaleLowerCase('zh-CN'))
  function matches(row: SupplierListSourceRow, except?: 'supplierCategory' | 'credentialStatus' | 'taxpayerType') {
    if (columnFilters?.businessLicense?.length && !columnFilters.businessLicense.includes(row.businessLicense?.state ?? 'unavailable'))
      return false
    if (except !== 'supplierCategory' && categories.length && !categories.includes(row.supplierCategory))
      return false
    if (except !== 'credentialStatus' && credentialStatuses.length && !credentialStatuses.includes(row.credentialStatus))
      return false
    if (except !== 'taxpayerType' && taxpayerTypes.length && !taxpayerTypes.includes(row.taxpayerType))
      return false
    if (normalizedSearch && ![row.name, row.aliases.join(' '), row.uniqueCode, row.taxNo, row.contact, row.laborScope ?? '']
      .some(value => contains(value, normalizedSearch))) {
      return false
    }
    for (const [field, text] of Object.entries(columnFilters?.contains ?? {})) {
      const value = row[field as keyof SupplierListSourceRow]
      if (!contains(Array.isArray(value) ? value.join(' ') : String(value ?? ''), text))
        return false
    }
    for (const [field, range] of Object.entries(columnFilters?.ranges ?? {})) {
      const value = stats(row)[field as SupplierListNumericField]
      if (value === null || (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max))
        return false
    }
    return true
  }
  const filtered = visibleRows.filter(row => matches(row))
  const sorted = [...filtered].sort((left, right) => {
    if (query.sort === 'name-asc')
      return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (query.sort === 'name-desc')
      return right.name.localeCompare(left.name, 'zh-CN') || left.id.localeCompare(right.id)
    if (query.sort === 'category-asc')
      return left.supplierCategory.localeCompare(right.supplierCategory, 'zh-CN') || left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
    const numericField = SUPPLIER_LIST_NUMERIC_FIELDS.find(field => query.sort === `${field}-asc` || query.sort === `${field}-desc`)
    if (numericField) {
      const a = stats(left)[numericField]
      const b = stats(right)[numericField]
      if (a === null || b === null)
        return a === b ? left.id.localeCompare(right.id) : a === null ? 1 : -1
      return (a - b) * (query.sort.endsWith('-desc') ? -1 : 1) || left.id.localeCompare(right.id) || left.dataOrigin.localeCompare(right.dataOrigin)
    }
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  })
  const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / query.pageSize)))
  const start = (page - 1) * query.pageSize
  const items = sorted.slice(start, start + query.pageSize).map((source) => {
    // 排序结果已经过权限脱敏；输出必须复用查询时的同一可见值。
    const visible = source
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
      address: source.address,
      taxpayerType: source.taxpayerType,
      mainBusiness: source.mainBusiness,
      laborScope: source.laborScope ?? '',
      bank: source.bank,
      bankAccount: visible.bankAccount,
      businessType: source.businessType,
      businessLicense: source.businessLicense ?? { state: 'unavailable' as const, fileCount: null, fileIds: [] },
      projectCount: summary.projectCount,
      cumulativeContractAmount: money(summary.cumulativeContractAmount),
      settlementAmount: summary.settlementAmount === null ? null : money(summary.settlementAmount),
      contractAmount: money(summary.contractAmount),
      paymentAmount: money(summary.paymentAmount),
      updatedAt: source.updatedAt,
    }
  })
  const countBy = (field: 'supplierCategory' | 'credentialStatus' | 'taxpayerType') => {
    const scope = visibleRows.filter(row => matches(row, field))
    return [...new Set(scope.map(row => row[field]))].filter(Boolean).sort((left, right) => left.localeCompare(right, 'zh-CN')).map(value => ({ value, label: value, count: scope.filter(row => row[field] === value).length }))
  }
  const origins = (['real', 'demo'] as const).reduce<SupplierListPageDTO['summary']['origins']>((result, origin) => {
    const rows = filtered.filter(row => row.dataOrigin === origin)
    const totals = {
      contractAmount: sumKnown(rows.map(row => stats(row).contractAmount)),
      paymentAmount: rows.reduce((sum, row) => sum + stats(row).paymentAmount, 0),
    }
    result[origin] = {
      supplierCount: rows.length,
      contractAmount: money(totals.contractAmount),
      paymentAmount: money(totals.paymentAmount),
    }
    return result
  }, { real: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' }, demo: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' } })
  return {
    items,
    pagination: { page, pageSize: query.pageSize, total: filtered.length },
    summary: {
      categories: countBy('supplierCategory'),
      credentialStatuses: countBy('credentialStatus'),
      taxpayerTypes: countBy('taxpayerType'),
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
      navigation: contractSourceNavigation(contract, input.contracts, input.query.origin),
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      kind: row.kind,
      effectiveAmount: money(sumKnown([row.amount, row.supplementAmount])),
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
      contractNavigation: contractSourceNavigation(contract, input.contracts, input.query.origin),
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
      contractNavigation: contractSourceNavigation(contract, input.contracts, input.query.origin),
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
    const approval = readApprovalAmount(row.approvedAmount, row.approvedAmountOrigin)
    const application = resolvedRef('payment-application', row.id, row.name, row.no) as Extract<EntityRefDTO, { state: 'resolved' }> & { entity: 'payment-application' }
    const project = projectRef(row.projectId, input.projects, input.query.origin)
    const contract = contractRef(row.contractId, input.contracts, input.query.origin)
    return {
      application,
      navigation: detailNavigation(application),
      project,
      projectNavigation: detailNavigation(project, { dataOrigin: input.query.origin }),
      contract,
      contractNavigation: contractSourceNavigation(contract, input.contracts, input.query.origin),
      applyAmount: money(row.applyAmount),
      approvedAmount: money(approval.amount),
      approvedAmountState: approval.state,
      actualPaidAmount: money(paidByApplication.get(row.id) ?? 0),
      applyDate: row.applyDate,
      status: row.status,
    }
  })
  const effectiveContracts = contractDTOs.filter(row => effectiveContract(row.status))
  const contractAmount = sumKnown(effectiveContracts.map(row => row.effectiveAmount === null ? null : Number(row.effectiveAmount)))
  const effectiveSettlements = settlementDTOs.filter(row => confirmedSettlement(row.status))
  const settlementAmount = sumKnown(effectiveSettlements.map(row => row.totalAmount === null ? null : Number(row.totalAmount)))
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
      payableAmount: moneyMetric(contractAmount === null ? null : round2(contractAmount - paymentAmount), 'payment-record', source.id, input.asOf, false),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
