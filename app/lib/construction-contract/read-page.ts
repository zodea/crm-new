import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  ConstructionContractDetailQueryDTO,
  ConstructionContractDetailReadDTO,
  ConstructionContractDetailSource,
  ConstructionContractFactDTO,
  ConstructionContractFactSource,
  ConstructionContractFactSources,
  ConstructionContractListPageDTO,
  ConstructionContractListQueryDTO,
  ConstructionContractPageSize,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { round2 } from '../util/number'
import { maskBankAccount, maskIdentifier, maskPhone } from '../util/privacy'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import {
  CONSTRUCTION_CONTRACT_PAGE_SIZES,
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
} from './read-contract'

interface BuildConstructionContractListPageInput {
  contracts: readonly ConstructionContractDetailSource[]
  facts: ConstructionContractFactSources
  query: ConstructionContractListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildConstructionContractDetailInput {
  contracts: readonly ConstructionContractDetailSource[]
  facts: ConstructionContractFactSources
  query: ConstructionContractDetailQueryDTO
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

function origin(value: unknown) {
  if (value == null || value === '')
    return null
  if (isDataOriginDTO(value))
    return value
  throw new ConstructionContractRepositoryProblem(constructionContractProblem('invalid-query', '施工合同列表来源无效'))
}

export function parseConstructionContractListQuery(
  input: Record<string, unknown> | undefined,
): ConstructionContractListQueryDTO {
  const pageSize = positiveInteger(input?.pageSize, 10)
  if (!CONSTRUCTION_CONTRACT_PAGE_SIZES.includes(pageSize as ConstructionContractPageSize)) {
    throw new ConstructionContractRepositoryProblem(constructionContractProblem('invalid-query', '施工合同列表查询参数无效'))
  }
  const optional = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  return {
    includeDemo: bool(input?.includeDemo),
    origin: origin(input?.origin),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    projectId: optional(input?.projectId),
    customerId: optional(input?.customerId),
    status: optional(input?.status),
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as ConstructionContractPageSize,
  }
}

export function parseConstructionContractDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): ConstructionContractDetailQueryDTO {
  const dataOrigin = input?.origin ?? 'real'
  if (!id.trim() || !isDataOriginDTO(dataOrigin)) {
    throw new ConstructionContractRepositoryProblem(constructionContractProblem('invalid-query', '施工合同详情查询参数无效'))
  }
  const rawFocusId = input?.focusId
  if (rawFocusId != null && rawFocusId !== '' && !isStableRouteIdentity(rawFocusId)) {
    throw new ConstructionContractRepositoryProblem(constructionContractProblem('invalid-query', '施工合同详情查询参数无效'))
  }
  const focusId = isStableRouteIdentity(rawFocusId) ? rawFocusId : null
  return { id, origin: dataOrigin, includeDemo: bool(input?.includeDemo), focusId }
}

function money(value: number): string {
  return round2(value).toFixed(2)
}

function ratio(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function resolvedRef(entity: EntityKindDTO, id: string, label: string, no: string | null) {
  return { state: 'resolved' as const, entity, id, label, no }
}

function entityRef<T extends 'project' | 'customer'>(
  entity: T,
  id: string | null,
  label: string,
  permission: 'allowed' | 'forbidden',
): EntityRefDTO & { entity: T } {
  if (!id)
    return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' } as EntityRefDTO & { entity: T }
  if (permission === 'forbidden')
    return { state: 'forbidden', entity, id, label: null, reason: 'permission-denied' } as EntityRefDTO & { entity: T }
  return resolvedRef(entity, id, label, null) as EntityRefDTO & { entity: T }
}

function detailNavigation(reference: EntityRefDTO, dataOrigin: ConstructionContractDetailQueryDTO['origin']): NavigationIntentDTO {
  if (reference.state === 'forbidden')
    return { kind: 'unavailable', reason: 'forbidden' }
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: 'missing-id' }
  return { kind: 'entity-detail', subject: reference, variant: 'detail', view: null, filters: { dataOrigin } }
}

function contractNavigation(source: ConstructionContractDetailSource): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: resolvedRef('contract', source.id, source.name, source.no || null),
    variant: 'detail',
    view: null,
    filters: { dataOrigin: source.dataOrigin, contractKind: '施工' },
  }
}

function activeSupplement(row: ConstructionContractFactSource): boolean {
  return !['草稿', '无效', '作废', 'cancelled'].includes(row.status)
}

function approvedChange(row: ConstructionContractFactSource): boolean {
  return ['approved', '已审定', '已签证'].includes(row.status)
}

function sameContract<T extends { dataOrigin: string, contractId: string | null }>(
  rows: readonly T[],
  source: ConstructionContractDetailSource,
): T[] {
  return rows.filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
}

function changedAmount(source: ConstructionContractDetailSource, facts: ConstructionContractFactSources): number {
  const supplements = sameContract(facts.supplements, source)
    .filter(activeSupplement)
    .reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const changes = sameContract(facts.changes, source)
    .filter(approvedChange)
    .reduce((sum, row) => sum + (row.amount ?? 0), 0)
  return round2(source.amount + supplements + changes)
}

function amounts(source: ConstructionContractDetailSource, facts: ConstructionContractFactSources) {
  return {
    contract: money(source.amount),
    changed: money(changedAmount(source, facts)),
    settled: money(source.settledAmount),
    invoiced: money(source.invoicedAmount),
    received: money(source.receivedAmount),
    bySettlementReceivable: money(source.settledAmount - source.receivedAmount),
    invoicedUnreceived: money(source.invoicedAmount - source.receivedAmount),
  }
}

export function buildConstructionContractListPage(
  input: BuildConstructionContractListPageInput,
): ConstructionContractListPageDTO {
  const allowedOrigins = input.query.includeDemo ? new Set(['real', 'demo']) : new Set(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const filtered = input.contracts
    .filter(row => row.kind === '施工' && allowedOrigins.has(row.dataOrigin))
    .filter(row => input.query.origin === null || row.dataOrigin === input.query.origin)
    .filter((row) => {
      if (input.query.projectId && row.projectId !== input.query.projectId)
        return false
      if (input.query.customerId && row.customerId !== input.query.customerId)
        return false
      if (input.query.status && row.status !== input.query.status)
        return false
      return !search || [row.name, row.no].some(value => value.toLocaleLowerCase('zh-CN').includes(search))
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const start = (input.query.page - 1) * input.query.pageSize
  const items = filtered.slice(start, start + input.query.pageSize).map((source) => {
    const project = entityRef('project', source.projectId, source.projectName, source.projectPermission)
    const customer = entityRef('customer', source.customerId, source.customerName, source.customerPermission)
    return {
      rowKey: `${source.dataOrigin}:${source.id}`,
      dataOrigin: source.dataOrigin,
      id: source.id,
      no: source.no,
      name: source.name,
      navigation: contractNavigation(source),
      project,
      projectNavigation: detailNavigation(project, source.dataOrigin),
      customer,
      customerNavigation: detailNavigation(customer, source.dataOrigin),
      amounts: amounts(source, input.facts),
      actualCompletionDate: source.actualCompletionDate,
      signDate: source.signDate,
      status: source.status,
      updatedAt: source.updatedAt,
    }
  })
  const originSummary = (dataOrigin: 'real' | 'demo') => {
    const rows = filtered.filter(row => row.dataOrigin === dataOrigin)
    return {
      contractCount: rows.length,
      changedAmount: money(rows.reduce((sum, row) => sum + changedAmount(row, input.facts), 0)),
      invoicedAmount: money(rows.reduce((sum, row) => sum + row.invoicedAmount, 0)),
      receivedAmount: money(rows.reduce((sum, row) => sum + row.receivedAmount, 0)),
    }
  }
  const options = (id: (row: ConstructionContractDetailSource) => string | null, label: (row: ConstructionContractDetailSource) => string) =>
    [...new Map(filtered.filter(row => id(row) && label(row)).map(row => [id(row)!, { id: id(row)!, label: label(row) }])).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  const statuses = [...new Set(filtered.map(row => row.status))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({ value, count: filtered.filter(row => row.status === value).length }))
  return {
    items,
    pagination: { page: input.query.page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      projects: options(row => row.projectId, row => row.projectName),
      customers: options(row => row.customerId, row => row.customerName),
      statuses,
      origins: { real: originSummary('real'), demo: originSummary('demo') },
    },
    empty: filtered.length === 0
      ? { reason: input.contracts.some(row => allowedOrigins.has(row.dataOrigin) && row.kind === '施工') ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

function factNavigation(
  row: ConstructionContractFactSource,
  source: ConstructionContractDetailSource,
  kind: 'supplement' | 'change' | 'report' | 'final-settlement' | 'invoice-application' | 'receipt' | 'acceptance' | 'warranty' | 'unverified',
): NavigationIntentDTO {
  if (kind === 'unverified')
    return { kind: 'unavailable', reason: 'unverified-target' }
  if (kind === 'supplement') {
    return {
      kind: 'entity-subview',
      subject: resolvedRef('contract', source.id, source.name, source.no || null),
      variant: 'supplement',
      view: row.id,
      filters: { dataOrigin: source.dataOrigin, contractKind: '施工' },
    }
  }
  if (kind === 'receipt') {
    const customerId = row.customerId || source.customerId
    if (!customerId)
      return { kind: 'unavailable', reason: 'missing-id' }
    return {
      kind: 'entity-detail',
      subject: resolvedRef('receipt', row.id, row.name, row.no || null),
      variant: 'detail',
      view: null,
      filters: { dataOrigin: source.dataOrigin, customerId },
    }
  }
  if (kind === 'change' || kind === 'report') {
    return {
      kind: 'entity-detail',
      subject: resolvedRef('owner-document', row.id, row.name, row.no || null),
      variant: kind,
      view: null,
      filters: { dataOrigin: source.dataOrigin },
    }
  }
  // 其他甲方单据和开票申请当前只有写态页面；中央只读目标未闭合前保留事实文本。
  return { kind: 'unavailable', reason: 'unverified-target' }
}

function mapFacts(
  rows: readonly ConstructionContractFactSource[],
  source: ConstructionContractDetailSource,
  kind: Parameters<typeof factNavigation>[2],
): ConstructionContractFactDTO[] {
  return sameContract(rows, source).map(row => ({
    id: row.id,
    no: row.no,
    name: row.name,
    amount: row.amount == null ? null : money(row.amount),
    date: row.date,
    status: row.status,
    navigation: factNavigation(row, source, kind),
  }))
}

export function buildConstructionContractDetail(
  input: BuildConstructionContractDetailInput,
): ConstructionContractDetailReadDTO {
  if (input.query.origin === 'demo' && !input.query.includeDemo) {
    throw new ConstructionContractRepositoryProblem(constructionContractProblem('forbidden', '测试施工合同未授权显示'))
  }
  const source = input.contracts.find(row => row.id === input.query.id && row.dataOrigin === input.query.origin)
  if (!source) {
    const sameId = input.contracts.some(row => row.id === input.query.id)
    throw new ConstructionContractRepositoryProblem(constructionContractProblem(
      sameId ? 'relationship-mismatch' : 'not-found',
      sameId ? '施工合同来源与地址不匹配' : '施工合同不存在或已删除',
    ))
  }
  if (source.kind !== '施工') {
    throw new ConstructionContractRepositoryProblem(constructionContractProblem('relationship-mismatch', '该合同不是施工合同'))
  }
  if (input.query.focusId) {
    const focusFact = [
      input.facts.supplements,
      input.facts.changes,
      input.facts.monthlyStatements,
      input.facts.finalSettlements,
      input.facts.penalties,
      input.facts.invoiceApplications,
      input.facts.invoiceRegistrations,
      input.facts.receipts,
      input.facts.acceptances,
      input.facts.warranties,
    ].flat().find(row => row.dataOrigin === source.dataOrigin && row.id === input.query.focusId)
    if (!focusFact) {
      throw new ConstructionContractRepositoryProblem(constructionContractProblem('not-found', '补充协议不存在或聚焦业务单据已删除'))
    }
    if (focusFact.contractId !== source.id) {
      throw new ConstructionContractRepositoryProblem(constructionContractProblem('relationship-mismatch', '补充协议与施工合同不匹配，或聚焦业务单据不属于当前合同'))
    }
  }
  const project = entityRef('project', source.projectId, source.projectName, source.projectPermission)
  const customer = entityRef('customer', source.customerId, source.customerName, source.customerPermission)
  const canReadSensitive = input.capabilities.includes('construction-contract:sensitive:read')
  return {
    dataOrigin: source.dataOrigin,
    contract: {
      dataOrigin: source.dataOrigin,
      id: source.id,
      no: source.no,
      name: source.name,
      kind: '施工',
      project,
      customer,
      amounts: amounts(source, input.facts),
      actualCompletionDate: source.actualCompletionDate,
      content: source.content,
      invoiceType: source.invoiceType,
      contactName: source.contactName,
      contactPhone: canReadSensitive ? source.contactPhone : maskPhone(source.contactPhone),
      taxRate: source.taxRate,
      signDate: source.signDate,
      mainTerms: source.mainTerms,
      paymentTerms: source.paymentTerms,
      warrantyTerms: source.warrantyTerms,
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
    customerNavigation: detailNavigation(customer, source.dataOrigin),
    sections: {
      supplements: mapFacts(input.facts.supplements, source, 'supplement'),
      changes: mapFacts(input.facts.changes, source, 'change'),
      settlements: {
        monthlyStatements: mapFacts(input.facts.monthlyStatements, source, 'report'),
        finalSettlements: mapFacts(input.facts.finalSettlements, source, 'final-settlement'),
        penalties: mapFacts(input.facts.penalties, source, 'unverified'),
      },
      invoices: {
        applications: mapFacts(input.facts.invoiceApplications, source, 'invoice-application'),
        registrations: mapFacts(input.facts.invoiceRegistrations, source, 'unverified'),
      },
      receipts: mapFacts(input.facts.receipts, source, 'receipt'),
      acceptance: {
        acceptances: mapFacts(input.facts.acceptances, source, 'acceptance'),
        warranties: mapFacts(input.facts.warranties, source, 'warranty'),
      },
      files: input.facts.files
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
