import type { EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '../../types/read-model'
import type {
  SubcontractContractDetailQueryDTO,
  SubcontractContractDetailReadDTO,
  SubcontractContractDetailSource,
  SubcontractContractFactDTO,
  SubcontractContractFactKind,
  SubcontractContractFactSource,
  SubcontractContractFactSources,
  SubcontractContractListPageDTO,
  SubcontractContractListQueryDTO,
  SubcontractContractPageSize,
} from './read-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { round2 } from '../util/number'
import { maskPhone } from '../util/privacy'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import {
  SUBCONTRACT_CONTRACT_PAGE_SIZES,
  subcontractContractProblem,
  SubcontractContractRepositoryProblem,
} from './read-contract'

interface BuildListInput {
  contracts: readonly SubcontractContractDetailSource[]
  facts: SubcontractContractFactSources
  query: SubcontractContractListQueryDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
}

interface BuildDetailInput {
  contracts: readonly SubcontractContractDetailSource[]
  facts: SubcontractContractFactSources
  query: SubcontractContractDetailQueryDTO
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

function optional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function origin(value: unknown) {
  if (value == null || value === '')
    return null
  if (isDataOriginDTO(value))
    return value
  throw new SubcontractContractRepositoryProblem(subcontractContractProblem('invalid-query', '分包合同列表来源无效'))
}

export function parseSubcontractContractListQuery(
  input: Record<string, unknown> | undefined,
): SubcontractContractListQueryDTO {
  const pageSize = positiveInteger(input?.pageSize, 10)
  if (!SUBCONTRACT_CONTRACT_PAGE_SIZES.includes(pageSize as SubcontractContractPageSize))
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem('invalid-query', '分包合同列表查询参数无效'))
  return {
    includeDemo: bool(input?.includeDemo),
    origin: origin(input?.origin),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    projectId: optional(input?.projectId),
    supplierId: optional(input?.supplierId),
    status: optional(input?.status),
    subKind: optional(input?.subKind),
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as SubcontractContractPageSize,
  }
}

export function parseSubcontractContractDetailQuery(
  id: string,
  input: Record<string, unknown> | undefined,
): SubcontractContractDetailQueryDTO {
  const dataOrigin = input?.origin ?? 'real'
  if (!id.trim() || !isDataOriginDTO(dataOrigin))
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem('invalid-query', '分包合同详情查询参数无效'))
  const rawFocusId = input?.focusId
  if (rawFocusId != null && rawFocusId !== '' && !isStableRouteIdentity(rawFocusId)) {
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem('invalid-query', '分包合同详情查询参数无效'))
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
  return resolvedRef(entity, id, label, null) as EntityRefDTO & { entity: T }
}

function detailNavigation(reference: EntityRefDTO, dataOrigin: SubcontractContractDetailQueryDTO['origin']): NavigationIntentDTO {
  if (reference.state === 'forbidden')
    return { kind: 'unavailable', reason: 'forbidden' }
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: 'missing-id' }
  return { kind: 'entity-detail', subject: reference, variant: 'detail', view: null, filters: { dataOrigin } }
}

function contractNavigation(source: SubcontractContractDetailSource): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: resolvedRef('contract', source.id, source.name, source.no || null),
    variant: 'detail',
    view: null,
    filters: { dataOrigin: source.dataOrigin, contractKind: '分包' },
  }
}

function sameContract<T extends { dataOrigin: string, contractId: string | null }>(rows: readonly T[], source: SubcontractContractDetailSource): T[] {
  return rows.filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
}

function validFact(row: SubcontractContractFactSource): boolean {
  return !['草稿', '无效', '作废', 'cancelled'].includes(row.status)
}

function total(rows: readonly SubcontractContractFactSource[], source: SubcontractContractDetailSource, filter: (row: SubcontractContractFactSource) => boolean = validFact): number {
  return round2(sameContract(rows, source).filter(filter).reduce((sum, row) => sum + (row.amount ?? 0), 0))
}

function amounts(source: SubcontractContractDetailSource, facts: SubcontractContractFactSources) {
  const settled = total(facts.settlements, source)
  const invoiced = total(facts.invoices, source, row => row.status === '已归档')
  const paid = total(facts.paymentRecords, source, row => ['已确认', 'confirmed'].includes(row.status))
  const changed = round2(source.amount + total(facts.supplements, source))
  const completionSettlement = total(facts.settlements, source, row => validFact(row) && row.settlementKind === 'completion')
  return {
    contract: money(source.amount),
    changed: money(changed),
    settled: money(settled),
    invoiced: money(invoiced),
    paid: money(paid),
    bySettlementPayable: money(settled - paid),
    byInvoicePayable: money(invoiced - paid),
    completionSettlement: money(completionSettlement),
  }
}

export function buildSubcontractContractListPage(input: BuildListInput): SubcontractContractListPageDTO {
  const allowedOrigins = input.query.includeDemo ? new Set(['real', 'demo']) : new Set(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const filtered = input.contracts
    .filter(row => row.kind === '分包' && allowedOrigins.has(row.dataOrigin))
    .filter(row => input.query.origin === null || row.dataOrigin === input.query.origin)
    .filter((row) => {
      if (input.query.projectId && row.projectId !== input.query.projectId)
        return false
      if (input.query.supplierId && row.supplierId !== input.query.supplierId)
        return false
      if (input.query.status && row.status !== input.query.status)
        return false
      if (input.query.subKind && row.subKind !== input.query.subKind)
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
      subKind: source.subKind,
      project,
      projectNavigation: detailNavigation(project, source.dataOrigin),
      supplier,
      supplierNavigation: detailNavigation(supplier, source.dataOrigin),
      amounts: amounts(source, input.facts),
      signDate: source.signDate,
      status: source.status,
      settlementStatus: source.settlementStatus,
      clearanceStatus: source.clearanceStatus,
      updatedAt: source.updatedAt,
    }
  })
  const option = (id: (row: SubcontractContractDetailSource) => string | null, label: (row: SubcontractContractDetailSource) => string) =>
    [...new Map(filtered.filter(row => id(row) && label(row)).map(row => [id(row)!, { id: id(row)!, label: label(row) }])).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  const counted = (value: (row: SubcontractContractDetailSource) => string) => [...new Set(filtered.map(value).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(entry => ({ value: entry, count: filtered.filter(row => value(row) === entry).length }))
  const originSummary = (dataOrigin: 'real' | 'demo') => {
    const rows = filtered.filter(row => row.dataOrigin === dataOrigin)
    return {
      contractCount: rows.length,
      changedAmount: money(rows.reduce((sum, row) => sum + Number(amounts(row, input.facts).changed), 0)),
      settledAmount: money(rows.reduce((sum, row) => sum + Number(amounts(row, input.facts).settled), 0)),
      paidAmount: money(rows.reduce((sum, row) => sum + Number(amounts(row, input.facts).paid), 0)),
    }
  }
  return {
    items,
    pagination: { page: input.query.page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      projects: option(row => row.projectId, row => row.projectName),
      suppliers: option(row => row.supplierId, row => row.supplierName),
      statuses: counted(row => row.status),
      subKinds: counted(row => row.subKind),
      origins: { real: originSummary('real'), demo: originSummary('demo') },
    },
    empty: filtered.length === 0
      ? { reason: input.contracts.some(row => allowedOrigins.has(row.dataOrigin) && row.kind === '分包') ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

function factNavigation(
  row: SubcontractContractFactSource,
  source: SubcontractContractDetailSource,
  kind: SubcontractContractFactKind,
  capabilities: readonly string[],
): NavigationIntentDTO {
  if (kind === 'change') {
    if (source.dataOrigin !== 'real' || row.dataOrigin !== 'real')
      return { kind: 'unavailable', reason: 'unverified-target' }
    if (!capabilities.includes('subcontract-document:read'))
      return { kind: 'unavailable', reason: 'forbidden' }
    return {
      kind: 'entity-detail',
      subject: resolvedRef('subcontract-document', row.id, row.name, row.no || null),
      variant: 'change',
      view: null,
      filters: {
        dataOrigin: source.dataOrigin,
        projectId: source.projectId,
        supplierId: source.supplierId,
        contractId: source.id,
      },
    }
  }
  if (kind === 'supplement') {
    return {
      kind: 'entity-subview',
      subject: resolvedRef('contract', source.id, source.name, source.no || null),
      variant: 'supplement',
      view: row.id,
      filters: { dataOrigin: source.dataOrigin, contractKind: '分包' },
    }
  }
  if (kind === 'invoice') {
    return {
      kind: 'entity-detail',
      subject: resolvedRef('invoice', row.id, row.name, row.no || null),
      variant: 'detail',
      view: null,
      filters: { dataOrigin: source.dataOrigin },
    }
  }
  if (kind === 'payment-application') {
    return {
      kind: 'entity-detail',
      subject: resolvedRef('payment-application', row.id, row.name, row.no || null),
      variant: 'detail',
      view: null,
      filters: { dataOrigin: source.dataOrigin },
    }
  }
  return { kind: 'unavailable', reason: 'unverified-target' }
}

function mapFacts(
  rows: readonly SubcontractContractFactSource[],
  source: SubcontractContractDetailSource,
  kind: SubcontractContractFactKind,
  capabilities: readonly string[],
): SubcontractContractFactDTO[] {
  return sameContract(rows, source).map(row => ({
    id: row.id,
    no: row.no,
    name: row.name,
    amount: row.amount == null ? null : money(row.amount),
    date: row.date,
    status: row.status,
    navigation: factNavigation(row, source, kind, capabilities),
  }))
}

export function buildSubcontractContractDetail(input: BuildDetailInput): SubcontractContractDetailReadDTO {
  if (input.query.origin === 'demo' && !input.query.includeDemo)
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem('forbidden', '测试分包合同未授权显示'))
  const source = input.contracts.find(row => row.id === input.query.id && row.dataOrigin === input.query.origin)
  if (!source) {
    const sameId = input.contracts.some(row => row.id === input.query.id)
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem(sameId ? 'relationship-mismatch' : 'not-found', sameId ? '分包合同来源与请求不一致' : '未找到分包合同'))
  }
  if (source.kind !== '分包')
    throw new SubcontractContractRepositoryProblem(subcontractContractProblem('relationship-mismatch', '合同类型与分包合同详情不一致'))
  if (input.query.focusId) {
    const supplement = input.facts.supplements.find(row => row.dataOrigin === source.dataOrigin && row.id === input.query.focusId)
    const change = input.facts.changes.find(row => row.dataOrigin === source.dataOrigin && row.id === input.query.focusId)
    const focus = supplement ?? change
    if (!focus)
      throw new SubcontractContractRepositoryProblem(subcontractContractProblem('not-found', '聚焦的分包合同事实不存在或已删除'))
    if (focus.contractId !== source.id) {
      throw new SubcontractContractRepositoryProblem(subcontractContractProblem(
        'relationship-mismatch',
        change ? '分包变洽签与分包合同不匹配' : '补充协议与分包合同不匹配',
      ))
    }
  }
  const project = entityRef('project', source.projectId, source.projectName, source.projectPermission)
  const supplier = entityRef('supplier', source.supplierId, source.supplierName, source.supplierPermission)
  return {
    dataOrigin: source.dataOrigin,
    contract: {
      dataOrigin: source.dataOrigin,
      id: source.id,
      no: source.no,
      name: source.name,
      kind: '分包',
      subKind: source.subKind,
      project,
      supplier,
      amounts: amounts(source, input.facts),
      settlementStatus: source.settlementStatus,
      clearanceStatus: source.clearanceStatus,
      content: source.content,
      invoiceType: source.invoiceType,
      contactName: source.contactName,
      contactPhone: maskPhone(source.contactPhone),
      taxRate: source.taxRate,
      signDate: source.signDate,
      mainTerms: source.mainTerms,
      paymentTerms: source.paymentTerms,
      warrantyTerms: source.warrantyTerms,
      retentionRatio: source.retentionRatio == null ? null : ratio(source.retentionRatio),
      retentionAmount: source.retentionAmount == null ? null : money(source.retentionAmount),
      retentionDays: source.retentionDays,
      status: source.status,
      note: source.note,
      updatedAt: source.updatedAt,
    },
    projectNavigation: detailNavigation(project, source.dataOrigin),
    supplierNavigation: detailNavigation(supplier, source.dataOrigin),
    sections: {
      supplements: mapFacts(input.facts.supplements, source, 'supplement', input.capabilities),
      changes: mapFacts(input.facts.changes, source, 'change', input.capabilities),
      invoices: mapFacts(input.facts.invoices, source, 'invoice', input.capabilities),
      payments: {
        applications: mapFacts(input.facts.paymentApplications, source, 'payment-application', input.capabilities),
        records: mapFacts(input.facts.paymentRecords, source, 'payment-record', input.capabilities),
      },
      settlements: {
        progress: mapFacts(input.facts.settlements.filter(row => row.settlementKind === 'progress'), source, 'settlement', input.capabilities),
        completion: mapFacts(input.facts.settlements.filter(row => row.settlementKind === 'completion'), source, 'settlement', input.capabilities),
      },
      penalties: mapFacts(input.facts.penalties, source, 'penalty', input.capabilities),
      materialUses: { currentWarehouse: [], legacy: [], emptyReason: 'missing-relation' },
      files: input.facts.files
        .filter(row => row.dataOrigin === source.dataOrigin && row.contractId === source.id)
        .map(({ dataOrigin: _dataOrigin, contractId: _contractId, ...row }) => row),
    },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

export function subcontractContractProblemFromUnknown(cause: unknown): SubcontractContractRepositoryProblem {
  if (cause instanceof SubcontractContractRepositoryProblem)
    return cause
  return new SubcontractContractRepositoryProblem(subcontractContractProblem('internal-error', cause instanceof Error ? cause.message : '分包合同读取失败', true), { cause })
}
