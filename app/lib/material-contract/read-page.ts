import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  MaterialContractDetailQueryDTO,
  MaterialContractDetailReadDTO,
  MaterialContractDetailSource,
  MaterialContractFactSources,
  MaterialContractListPageDTO,
  MaterialContractListQueryDTO,
  MaterialContractPageSize,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { round2 } from '../util/number'
import { maskBankAccount, maskIdentifier, maskPhone } from '../util/privacy'
import {
  MATERIAL_CONTRACT_PAGE_SIZES,
  materialContractProblem,
  MaterialContractRepositoryProblem,
} from './read-contract'

interface BuildMaterialContractDetailInput {
  contracts: readonly MaterialContractDetailSource[]
  facts: MaterialContractFactSources
  query: MaterialContractDetailQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildMaterialContractListPageInput {
  contracts: readonly MaterialContractDetailSource[]
  query: MaterialContractListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

function dataOrigin(value: unknown) {
  if (value == null || value === '')
    return null
  if (isDataOriginDTO(value))
    return value
  throw new MaterialContractRepositoryProblem(materialContractProblem('invalid-query', '材料采购合同列表来源无效'))
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback
}

export function parseMaterialContractListQuery(
  input: Record<string, unknown> | undefined,
): MaterialContractListQueryDTO {
  const pageSize = positiveInteger(input?.pageSize, 10)
  if (!MATERIAL_CONTRACT_PAGE_SIZES.includes(pageSize as MaterialContractPageSize)) {
    throw new MaterialContractRepositoryProblem(materialContractProblem(
      'invalid-query',
      '材料采购合同列表查询参数无效',
    ))
  }
  const optional = (value: unknown) => typeof value === 'string' && value.trim()
    ? value.trim()
    : null
  return {
    includeDemo: bool(input?.includeDemo),
    origin: dataOrigin(input?.origin),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    projectId: optional(input?.projectId),
    supplierId: optional(input?.supplierId),
    status: optional(input?.status),
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as MaterialContractPageSize,
  }
}

export function parseMaterialContractDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): MaterialContractDetailQueryDTO {
  const origin = input?.origin ?? 'real'
  if (!id.trim() || !isDataOriginDTO(origin)) {
    throw new MaterialContractRepositoryProblem(materialContractProblem(
      'invalid-query',
      '材料采购合同详情查询参数无效',
    ))
  }
  return { id, origin, includeDemo: bool(input?.includeDemo) }
}

function money(value: number): string {
  return round2(value).toFixed(2)
}

function quantity(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function ratio(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function entityRef<T extends 'project' | 'supplier'>(
  entity: T,
  id: string | null,
  label: string,
  permission: 'allowed' | 'forbidden',
): EntityRefDTO & { entity: T } {
  if (!id)
    return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' } as EntityRefDTO & { entity: T }
  if (permission === 'forbidden')
    return { state: 'forbidden', entity, id, label: null, reason: 'permission-denied' } as EntityRefDTO & { entity: T }
  return { state: 'resolved', entity, id, label, no: null } as EntityRefDTO & { entity: T }
}

function detailNavigation(
  reference: EntityRefDTO,
  origin: MaterialContractDetailQueryDTO['origin'],
): NavigationIntentDTO {
  if (reference.state === 'forbidden')
    return { kind: 'unavailable', reason: 'forbidden' }
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: 'missing-id' }
  return {
    kind: 'entity-detail',
    subject: reference,
    variant: 'detail',
    view: null,
    filters: { dataOrigin: origin },
  }
}

function contractNavigation(
  source: MaterialContractDetailSource,
): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: resolvedRef('contract', source.id, source.name, source.no || null),
    variant: 'detail',
    view: null,
    filters: { dataOrigin: source.dataOrigin, contractKind: '材采' },
  }
}

function resolvedRef(
  entity: EntityKindDTO,
  id: string,
  label: string,
  no: string | null,
): Extract<EntityRefDTO, { state: 'resolved' }> {
  return { state: 'resolved', entity, id, label, no }
}

function amounts(source: MaterialContractDetailSource) {
  return {
    contract: money(source.amount),
    changed: money(source.amount + source.supplementAmount),
    settled: money(source.settledAmount),
    invoiced: money(source.invoicedAmount),
    paid: money(source.paidAmount),
    payable: money(source.settledAmount - source.paidAmount),
  }
}

export function buildMaterialContractListPage(
  input: BuildMaterialContractListPageInput,
): MaterialContractListPageDTO {
  const allowedOrigins = input.query.includeDemo
    ? new Set(['real', 'demo'])
    : new Set(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const filtered = input.contracts
    .filter(row => row.kind === '材采' && allowedOrigins.has(row.dataOrigin))
    .filter(row => input.query.origin === null || row.dataOrigin === input.query.origin)
    .filter((row) => {
      if (input.query.projectId && row.projectId !== input.query.projectId)
        return false
      if (input.query.supplierId && row.supplierId !== input.query.supplierId)
        return false
      if (input.query.status && row.status !== input.query.status)
        return false
      return !search || [row.name, row.no].some(value => value.toLocaleLowerCase('zh-CN').includes(search))
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const start = (input.query.page - 1) * input.query.pageSize
  const items = filtered.slice(start, start + input.query.pageSize).map((source) => {
    const project = entityRef('project', source.projectId, source.projectName, source.projectPermission)
    const supplier = entityRef('supplier', source.supplierId, source.supplierName, source.supplierPermission)
    return {
      rowKey: `${source.dataOrigin}:${source.id}`,
      dataOrigin: source.dataOrigin,
      id: source.id,
      no: source.no,
      name: source.name,
      navigation: contractNavigation(source),
      project,
      projectNavigation: detailNavigation(project, source.dataOrigin),
      supplier,
      supplierNavigation: detailNavigation(supplier, source.dataOrigin),
      amounts: amounts(source),
      signDate: source.signDate,
      status: source.status,
      updatedAt: source.updatedAt,
    }
  })
  const originSummary = (origin: 'real' | 'demo') => {
    const rows = filtered.filter(row => row.dataOrigin === origin)
    return {
      contractCount: rows.length,
      changedAmount: money(rows.reduce((sum, row) => sum + row.amount + row.supplementAmount, 0)),
      invoicedAmount: money(rows.reduce((sum, row) => sum + row.invoicedAmount, 0)),
      paidAmount: money(rows.reduce((sum, row) => sum + row.paidAmount, 0)),
    }
  }
  const uniqueOptions = (
    id: (row: MaterialContractDetailSource) => string | null,
    label: (row: MaterialContractDetailSource) => string,
  ) => [...new Map(filtered
    .filter(row => id(row) && label(row))
    .map(row => [id(row)!, { id: id(row)!, label: label(row) }])).values()]
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  const statuses = [...new Set(filtered.map(row => row.status))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({ value, count: filtered.filter(row => row.status === value).length }))
  return {
    items,
    pagination: { page: input.query.page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      projects: uniqueOptions(row => row.projectId, row => row.projectName),
      suppliers: uniqueOptions(row => row.supplierId, row => row.supplierName),
      statuses,
      origins: { real: originSummary('real'), demo: originSummary('demo') },
    },
    empty: filtered.length === 0
      ? { reason: input.contracts.some(row => allowedOrigins.has(row.dataOrigin) && row.kind === '材采') ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function buildMaterialContractDetail(
  input: BuildMaterialContractDetailInput,
): MaterialContractDetailReadDTO {
  if (input.query.origin === 'demo' && !input.query.includeDemo) {
    throw new MaterialContractRepositoryProblem(materialContractProblem(
      'forbidden',
      '测试材料采购合同未授权显示',
    ))
  }
  const source = input.contracts.find(row =>
    row.id === input.query.id && row.dataOrigin === input.query.origin)
  if (!source) {
    const sameId = input.contracts.some(row => row.id === input.query.id)
    throw new MaterialContractRepositoryProblem(materialContractProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '合同来源与地址不匹配' : '材料采购合同不存在或已删除',
    ))
  }
  if (source.kind !== '材采') {
    throw new MaterialContractRepositoryProblem(materialContractProblem(
      'relationship-mismatch',
      '该合同不是材料采购合同',
    ))
  }

  const project = entityRef('project', source.projectId, source.projectName, source.projectPermission)
  const supplier = entityRef('supplier', source.supplierId, source.supplierName, source.supplierPermission)
  const canReadSensitive = input.capabilities.includes('material-contract:sensitive:read')
  const sameContract = <T extends { dataOrigin: string, contractId: string | null }>(rows: readonly T[]) => rows
    .filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
  const facts = input.facts
  const lineItems = facts.lineItems
    .filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((row) => {
      const amount = row.qty == null || row.taxInclusiveUnitPrice == null
        ? null
        : money(row.qty * row.taxInclusiveUnitPrice)
      return {
        id: row.id,
        materialName: row.materialName,
        spec: row.spec,
        brand: row.brand,
        unit: row.unit,
        qty: row.qty == null ? null : quantity(row.qty),
        unitPrice: row.taxInclusiveUnitPrice == null ? null : money(row.taxInclusiveUnitPrice),
        amount,
        plannedArrivalDate: row.plannedArrivalDate,
        note: row.note,
      }
    })
  const mapFacts = (
    rows: readonly (typeof facts.materialRequisitions[number])[],
  ) => sameContract(rows).map(row => ({
    id: row.id,
    no: row.no,
    name: row.name,
    amount: row.amount == null ? null : money(row.amount),
    date: row.date,
    status: row.status,
    navigation: { kind: 'unavailable' as const, reason: 'unverified-target' as const },
  }))
  const confirmedPaymentIds = new Set(facts.paymentRecords
    .filter(row => row.dataOrigin === source.dataOrigin && row.confirmationStatus === 'confirmed')
    .map(row => row.id))
  const paidByApplication = new Map<string, number>()
  for (const allocation of facts.paymentAllocations) {
    if (allocation.dataOrigin !== source.dataOrigin || !confirmedPaymentIds.has(allocation.paymentRecordId))
      continue
    paidByApplication.set(
      allocation.paymentApplicationId,
      round2((paidByApplication.get(allocation.paymentApplicationId) ?? 0) + allocation.allocatedAmount),
    )
  }
  const payments = sameContract(facts.paymentApplications).map(row => ({
    id: row.id,
    no: row.no,
    name: row.name,
    amount: row.amount == null ? null : money(row.amount),
    paidAmount: money(paidByApplication.get(row.id) ?? 0),
    date: row.date,
    status: row.status,
    navigation: { kind: 'unavailable' as const, reason: 'unverified-target' as const },
  }))
  return {
    dataOrigin: source.dataOrigin,
    contract: {
      dataOrigin: source.dataOrigin,
      id: source.id,
      no: source.no,
      name: source.name,
      kind: '材采',
      project,
      supplier,
      amounts: amounts(source),
      content: source.content,
      invoiceType: source.invoiceType,
      contactName: source.contactName,
      contactPhone: canReadSensitive ? source.contactPhone : maskPhone(source.contactPhone),
      taxRate: source.taxRate,
      signDate: source.signDate,
      mainTerms: source.mainTerms,
      paymentTerms: source.paymentTerms,
      brandQualityTerms: source.brandQualityTerms,
      scheduleTerms: source.scheduleTerms,
      warrantyTerms: source.warrantyTerms,
      specialTerms: source.specialTerms,
      retentionRatio: source.retentionRatio == null ? null : ratio(source.retentionRatio),
      retentionAmount: source.retentionAmount == null ? null : money(source.retentionAmount),
      retentionDays: source.retentionDays,
      invoiceName: source.invoiceName,
      invoiceTaxNo: canReadSensitive ? source.invoiceTaxNo : maskIdentifier(source.invoiceTaxNo),
      invoiceAddressPhone: canReadSensitive ? source.invoiceAddressPhone : maskPhone(source.invoiceAddressPhone),
      invoiceBank: source.invoiceBank,
      invoiceBankAccount: canReadSensitive ? source.invoiceBankAccount : maskBankAccount(source.invoiceBankAccount),
      status: source.status,
      note: source.note,
      updatedAt: source.updatedAt,
    },
    projectNavigation: detailNavigation(project, source.dataOrigin),
    supplierNavigation: detailNavigation(supplier, source.dataOrigin),
    sections: {
      lineItems,
      materials: {
        requisitions: mapFacts(facts.materialRequisitions),
        arrivals: mapFacts(facts.materialArrivals),
        directTransfers: [],
        outbound: [],
      },
      invoices: mapFacts(facts.invoices),
      payments,
      settlements: mapFacts(facts.settlements),
      penalties: mapFacts(facts.penalties),
      files: facts.files
        .filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
        .map(row => ({
          id: row.id,
          fileName: row.fileName,
          fileSize: row.fileSize,
          mimeType: row.mimeType,
          category: row.category,
          uploadedAt: row.uploadedAt,
        })),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
