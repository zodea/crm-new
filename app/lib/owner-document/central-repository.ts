import type {
  DataOriginDTO,
  EntityRefDTO,
  ISODateDTO,
  ISODateTimeDTO,
  MoneyDTO,
  NavigationIntentDTO,
  PageDTO,
  ProblemDTO,
  QuantityDTO,
} from '../../types/read-model'
import { isDataOriginDTO } from '../../types/read-model'
import { round2 } from '../util/number'
import { isStableRouteIdentity } from '../util/stable-route-identity'

export const OWNER_COMMERCIAL_DOCUMENT_KINDS = ['owner_change', 'owner_report'] as const
export type OwnerCommercialDocumentKind = typeof OWNER_COMMERCIAL_DOCUMENT_KINDS[number]
export const OWNER_COMMERCIAL_DOCUMENT_PAGE_SIZES = [10, 20, 50, 100] as const
export type OwnerCommercialDocumentPageSize = typeof OWNER_COMMERCIAL_DOCUMENT_PAGE_SIZES[number]

export interface OwnerCommercialDocumentLineSource {
  id: string
  boqLineId: string | null
  operation: 'add' | 'qty' | 'price' | null
  itemName: string
  unit: string
  contractQty: number | null
  contractUnitPrice: number | null
  autoQty: number | null
  reportedQty: number | null
  auditedQty: number | null
  deltaQty: number | null
  newUnitPrice: number | null
  amount: number
  auditedAmount: number | null
  note: string
}

export interface OwnerCommercialDocumentFileSource {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: ISODateTimeDTO | null
  deletedAt: ISODateTimeDTO | null
}

export interface OwnerCommercialDocumentSource {
  dataOrigin: DataOriginDTO
  kind: OwnerCommercialDocumentKind
  id: string
  no: string
  name: string
  documentType: string
  projectId: string | null
  projectName: string
  projectPermission: 'allowed' | 'forbidden'
  customerId: string | null
  customerName: string
  customerPermission: 'allowed' | 'forbidden'
  contractId: string | null
  contractNo: string
  contractName: string
  contractPermission: 'allowed' | 'forbidden'
  sourceType: 'boq_change_order' | 'manual' | 'monthly_statement'
  sourceId: string
  sourceLocked: boolean
  periodNo: string
  applicationDate: ISODateDTO | null
  approvalDate?: ISODateDTO | null
  approvalSequenceAt?: ISODateTimeDTO | null
  quantityBasis?: string | null
  quantitySourceVersion?: string | null
  quantitySourceUpdatedAt?: ISODateTimeDTO | null
  operatorName?: string
  submittedAt?: ISODateTimeDTO | null
  status: string
  statusNote: string
  amount: number
  boqAmount?: number | null
  taxExclusiveAmount?: number | null
  appliedTaxExclusiveAmount?: number | null
  auditedAmount: number | null
  note: string
  version: number
  createdAt: ISODateTimeDTO
  updatedAt: ISODateTimeDTO
  lines: OwnerCommercialDocumentLineSource[]
  files: OwnerCommercialDocumentFileSource[]
}

export interface OwnerCommercialDocumentListQueryDTO {
  kind: OwnerCommercialDocumentKind
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  contractId: string | null
  status: string | null
  documentType: string | null
  page: number
  pageSize: OwnerCommercialDocumentPageSize
}

export interface OwnerCommercialDocumentDetailQueryDTO {
  kind: OwnerCommercialDocumentKind
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
}

export type OwnerCommercialDocumentAmountsDTO
  = | {
    kind: 'owner_change'
    boqChange: MoneyDTO
    taxInclusive: MoneyDTO
    taxExclusive: MoneyDTO
    appliedTaxExclusive: MoneyDTO
  }
  | {
    kind: 'owner_report'
    reported: MoneyDTO
    audited: MoneyDTO | null
    difference: MoneyDTO | null
  }

export interface OwnerCommercialDocumentListItemDTO {
  rowKey: string
  dataOrigin: DataOriginDTO
  kind: OwnerCommercialDocumentKind
  id: string
  no: string
  name: string
  documentType: string
  periodNo: string
  applicationDate: ISODateDTO | null
  status: string
  statusLabel: string
  amounts: OwnerCommercialDocumentAmountsDTO
  project: EntityRefDTO & { entity: 'project' }
  projectNavigation: NavigationIntentDTO
  customer: EntityRefDTO & { entity: 'customer' }
  customerNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  navigation: NavigationIntentDTO
  updatedAt: ISODateTimeDTO
}

export interface OwnerCommercialDocumentListSummaryDTO {
  projects: Array<{ id: string, label: string }>
  contracts: Array<{ id: string, label: string }>
  statuses: Array<{ value: string, label: string, count: number }>
  documentTypes: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, {
    count: number
    reportedAmount: MoneyDTO
    auditedAmount: MoneyDTO
    taxInclusiveAmount: MoneyDTO
    taxExclusiveAmount: MoneyDTO
    appliedTaxExclusiveAmount: MoneyDTO
  }>
}

export type OwnerCommercialDocumentListPageDTO = PageDTO<
  OwnerCommercialDocumentListItemDTO,
  OwnerCommercialDocumentListSummaryDTO
>

export interface OwnerCommercialDocumentLineDTO {
  id: string
  boqLineId: string | null
  operation: OwnerCommercialDocumentLineSource['operation']
  itemName: string
  unit: string
  contractQty: QuantityDTO | null
  contractUnitPrice: MoneyDTO | null
  autoQty: QuantityDTO | null
  reportedQty: QuantityDTO | null
  auditedQty: QuantityDTO | null
  deltaQty: QuantityDTO | null
  newUnitPrice: MoneyDTO | null
  amount: MoneyDTO
  auditedAmount: MoneyDTO | null
  note: string
}

export interface OwnerCommercialDocumentDetailReadDTO {
  dataOrigin: DataOriginDTO
  document: {
    id: string
    kind: OwnerCommercialDocumentKind
    no: string
    name: string
    documentType: string
    periodNo: string
    applicationDate: ISODateDTO | null
    approvalDate: ISODateDTO | null
    status: string
    source: {
      type: OwnerCommercialDocumentSource['sourceType']
      id: string
      locked: boolean
    }
    approval: {
      status: string
      label: string
      summary: string
    }
    quantityEvidence: {
      basis: string | null
      sourceVersion: string | null
      sourceUpdatedAt: ISODateTimeDTO | null
      operatorName: string
      submittedAt: ISODateTimeDTO | null
    } | null
    amounts: OwnerCommercialDocumentAmountsDTO
    project: EntityRefDTO & { entity: 'project' }
    customer: EntityRefDTO & { entity: 'customer' }
    contract: EntityRefDTO & { entity: 'contract' }
    note: string
    version: string
    updatedAt: ISODateTimeDTO
  }
  lines: OwnerCommercialDocumentLineDTO[]
  files: Array<{
    id: string
    fileName: string
    fileSize: number
    mimeType: string
    category: string
    uploader: string
    uploadedAt: ISODateTimeDTO | null
  }>
  projectNavigation: NavigationIntentDTO
  customerNavigation: NavigationIntentDTO
  contractNavigation: NavigationIntentDTO
  sourceNavigation: NavigationIntentDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: string[]
}

export interface OwnerCommercialDocumentReadRepository {
  list: (query: OwnerCommercialDocumentListQueryDTO) => Promise<OwnerCommercialDocumentListPageDTO>
  get: (query: OwnerCommercialDocumentDetailQueryDTO) => Promise<OwnerCommercialDocumentDetailReadDTO>
}

export class OwnerCommercialDocumentRepositoryProblem extends Error {
  constructor(public readonly problem: ProblemDTO, options: { cause?: unknown } = {}) {
    super(problem.message, options)
    this.name = 'OwnerCommercialDocumentRepositoryProblem'
  }
}

export function ownerCommercialDocumentProblem(
  code: ProblemDTO['code'],
  message: string,
  retryable = false,
): ProblemDTO {
  return { code, message, retryable, fieldErrors: {}, traceId: null }
}

export function ownerCommercialDocumentProblemFromUnknown(
  cause: unknown,
): OwnerCommercialDocumentRepositoryProblem {
  if (cause instanceof OwnerCommercialDocumentRepositoryProblem)
    return cause
  return new OwnerCommercialDocumentRepositoryProblem(
    ownerCommercialDocumentProblem(
      'unavailable',
      cause instanceof Error ? cause.message : '甲方商务单据读取失败',
      true,
    ),
    { cause },
  )
}

function fail(code: ProblemDTO['code'], message: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem(code, message))
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

function parseKind(value: unknown): OwnerCommercialDocumentKind {
  if (OWNER_COMMERCIAL_DOCUMENT_KINDS.includes(value as OwnerCommercialDocumentKind))
    return value as OwnerCommercialDocumentKind
  return fail('invalid-query', '甲方商务单据类型无效')
}

function parseOrigin(value: unknown, nullable: boolean): DataOriginDTO | null {
  if (nullable && (value == null || value === ''))
    return null
  if (isDataOriginDTO(value))
    return value
  return fail('invalid-query', '甲方商务单据来源无效')
}

export function parseOwnerCommercialDocumentListQuery(
  kind: unknown,
  input: Record<string, unknown> | undefined,
): OwnerCommercialDocumentListQueryDTO {
  const pageSize = positiveInteger(input?.pageSize, 20)
  if (!OWNER_COMMERCIAL_DOCUMENT_PAGE_SIZES.includes(pageSize as OwnerCommercialDocumentPageSize))
    fail('invalid-query', '甲方商务单据列表查询参数无效')
  return {
    kind: parseKind(kind),
    includeDemo: bool(input?.includeDemo),
    origin: parseOrigin(input?.origin, true),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    projectId: optional(input?.projectId),
    contractId: optional(input?.contractId),
    status: optional(input?.status),
    documentType: optional(input?.documentType),
    page: positiveInteger(input?.page, 1),
    pageSize: pageSize as OwnerCommercialDocumentPageSize,
  }
}

export function parseOwnerCommercialDocumentDetailQuery(
  kind: unknown,
  id: unknown,
  input: Record<string, unknown> | undefined,
): OwnerCommercialDocumentDetailQueryDTO {
  if (!isStableRouteIdentity(id))
    fail('invalid-query', '甲方商务单据详情查询参数无效')
  return {
    kind: parseKind(kind),
    id,
    origin: parseOrigin(input?.origin ?? 'real', false) as DataOriginDTO,
    includeDemo: bool(input?.includeDemo),
  }
}

function money(value: number): MoneyDTO {
  return round2(value).toFixed(2)
}

function nullableMoney(value: number | null): MoneyDTO | null {
  return value == null ? null : money(value)
}

function quantity(value: number | null): QuantityDTO | null {
  return value == null ? null : String(round2(value))
}

function amounts(source: OwnerCommercialDocumentSource): OwnerCommercialDocumentAmountsDTO {
  return source.kind === 'owner_change'
    ? {
        kind: 'owner_change',
        boqChange: money(source.boqAmount ?? source.lines.reduce((sum, line) => sum + line.amount, 0)),
        taxInclusive: money(source.amount),
        taxExclusive: money(source.taxExclusiveAmount ?? 0),
        appliedTaxExclusive: money(source.appliedTaxExclusiveAmount ?? 0),
      }
    : {
        kind: 'owner_report',
        reported: money(source.amount),
        audited: nullableMoney(source.auditedAmount),
        difference: source.auditedAmount == null ? null : money(source.auditedAmount - source.amount),
      }
}

function statusLabel(kind: OwnerCommercialDocumentKind, status: string): string {
  const labels: Record<string, string> = kind === 'owner_change'
    ? { draft: '草稿', submitted: '已上报', rejected: '已退回', approved: '已签证' }
    : { draft: '草稿', adjusted: '已申报', reported: '已申报', exported: '已审定', audited: '已审定' }
  return labels[status] ?? status
}

function entityRef<T extends 'project' | 'customer' | 'contract'>(
  entity: T,
  id: string | null,
  label: string,
  no: string | null,
  permission: 'allowed' | 'forbidden',
): EntityRefDTO & { entity: T } {
  if (!id)
    return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' } as EntityRefDTO & { entity: T }
  if (permission === 'forbidden')
    return { state: 'forbidden', entity, id, label: null, reason: 'permission-denied' } as EntityRefDTO & { entity: T }
  return { state: 'resolved', entity, id, label, no } as EntityRefDTO & { entity: T }
}

function relationNavigation(reference: EntityRefDTO, origin: DataOriginDTO): NavigationIntentDTO {
  if (reference.state === 'forbidden')
    return { kind: 'unavailable', reason: 'forbidden' }
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: 'missing-id' }
  return {
    kind: 'entity-detail',
    subject: reference,
    variant: 'detail',
    view: null,
    filters: reference.entity === 'contract'
      ? { dataOrigin: origin, contractKind: '施工' }
      : { dataOrigin: origin },
  }
}

function documentNavigation(source: OwnerCommercialDocumentSource): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: {
      state: 'resolved',
      entity: 'owner-document',
      id: source.id,
      label: source.name,
      no: source.no || null,
    },
    variant: source.kind === 'owner_change' ? 'change' : 'report',
    view: null,
    filters: { dataOrigin: source.dataOrigin },
  }
}

function relations(source: OwnerCommercialDocumentSource) {
  const project = entityRef('project', source.projectId, source.projectName, null, source.projectPermission)
  const customer = entityRef('customer', source.customerId, source.customerName, null, source.customerPermission)
  const contract = entityRef('contract', source.contractId, source.contractName, source.contractNo || null, source.contractPermission)
  return { project, customer, contract }
}

interface BuildListInput {
  documents: readonly OwnerCommercialDocumentSource[]
  query: OwnerCommercialDocumentListQueryDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: readonly string[]
}

export function buildOwnerCommercialDocumentListPage(
  input: BuildListInput,
): OwnerCommercialDocumentListPageDTO {
  const allowedOrigins = input.query.includeDemo ? new Set<DataOriginDTO>(['real', 'demo']) : new Set<DataOriginDTO>(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const candidates = input.documents.filter(row => row.kind === input.query.kind && allowedOrigins.has(row.dataOrigin))
  const filtered = candidates
    .filter(row => input.query.origin === null || row.dataOrigin === input.query.origin)
    .filter(row => !input.query.projectId || row.projectId === input.query.projectId)
    .filter(row => !input.query.contractId || row.contractId === input.query.contractId)
    .filter(row => !input.query.status || row.status === input.query.status)
    .filter(row => !input.query.documentType || row.documentType === input.query.documentType)
    .filter(row => !search || [row.no, row.name, row.projectName, row.contractName, row.periodNo]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const start = (input.query.page - 1) * input.query.pageSize
  const items = filtered.slice(start, start + input.query.pageSize).map((source) => {
    const { project, customer, contract } = relations(source)
    return {
      rowKey: `${source.dataOrigin}:${source.kind}:${source.id}`,
      dataOrigin: source.dataOrigin,
      kind: source.kind,
      id: source.id,
      no: source.no,
      name: source.name,
      documentType: source.documentType,
      periodNo: source.periodNo,
      applicationDate: source.applicationDate,
      status: source.status,
      statusLabel: statusLabel(source.kind, source.status),
      amounts: amounts(source),
      project,
      projectNavigation: relationNavigation(project, source.dataOrigin),
      customer,
      customerNavigation: relationNavigation(customer, source.dataOrigin),
      contract,
      contractNavigation: relationNavigation(contract, source.dataOrigin),
      navigation: documentNavigation(source),
      updatedAt: source.updatedAt,
    }
  })
  const options = (id: (row: OwnerCommercialDocumentSource) => string | null, label: (row: OwnerCommercialDocumentSource) => string) =>
    [...new Map(candidates.filter(row => id(row) && label(row)).map(row => [id(row)!, { id: id(row)!, label: label(row) }])).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  const statuses = [...new Set(candidates.map(row => row.status))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({ value, label: statusLabel(input.query.kind, value), count: candidates.filter(row => row.status === value).length }))
  const documentTypes = [...new Set(candidates.map(row => row.documentType).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(value => ({
      value,
      label: value,
      count: candidates.filter(row => row.documentType === value).length,
    }))
  const originSummary = (origin: DataOriginDTO) => {
    const rows = filtered.filter(row => row.dataOrigin === origin)
    return {
      count: rows.length,
      reportedAmount: money(rows.reduce((total, row) => total + row.amount, 0)),
      auditedAmount: money(rows.reduce((total, row) => total + (row.auditedAmount ?? 0), 0)),
      taxInclusiveAmount: money(rows.reduce((total, row) => total + row.amount, 0)),
      taxExclusiveAmount: money(rows.reduce((total, row) => total + (row.taxExclusiveAmount ?? 0), 0)),
      appliedTaxExclusiveAmount: money(rows.reduce((total, row) => total + (row.appliedTaxExclusiveAmount ?? 0), 0)),
    }
  }
  return {
    items,
    pagination: { page: input.query.page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      projects: options(row => row.projectId, row => row.projectName),
      contracts: options(row => row.contractId, row => row.contractName),
      statuses,
      documentTypes,
      origins: { real: originSummary('real'), demo: originSummary('demo') },
    },
    empty: filtered.length === 0
      ? { reason: candidates.length ? 'no-filter-match' : 'no-records', missingRelations: [] }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}

interface BuildDetailInput {
  documents: readonly OwnerCommercialDocumentSource[]
  query: OwnerCommercialDocumentDetailQueryDTO
  asOf: ISODateTimeDTO
  sourceVersion: string | null
  capabilities: readonly string[]
}

export function buildOwnerCommercialDocumentDetail(
  input: BuildDetailInput,
): OwnerCommercialDocumentDetailReadDTO {
  if (input.query.origin === 'demo' && !input.query.includeDemo)
    fail('forbidden', '测试甲方商务单据未授权显示')
  const source = input.documents.find(row => row.id === input.query.id
    && row.kind === input.query.kind
    && row.dataOrigin === input.query.origin)
  if (!source) {
    const sameIdAndKind = input.documents.some(row => row.id === input.query.id && row.kind === input.query.kind)
    if (sameIdAndKind)
      fail('relationship-mismatch', '甲方商务单据来源与地址不匹配')
    const sameId = input.documents.some(row => row.id === input.query.id)
    fail(sameId ? 'relationship-mismatch' : 'not-found', sameId ? '甲方商务单据类型与地址不匹配' : '甲方商务单据不存在或已删除')
  }
  const { project, customer, contract } = relations(source)
  return {
    dataOrigin: source.dataOrigin,
    document: {
      id: source.id,
      kind: source.kind,
      no: source.no,
      name: source.name,
      documentType: source.documentType,
      periodNo: source.periodNo,
      applicationDate: source.applicationDate,
      approvalDate: source.approvalDate ?? null,
      status: source.status,
      source: { type: source.sourceType, id: source.sourceId, locked: source.sourceLocked },
      approval: {
        status: source.status,
        label: statusLabel(source.kind, source.status),
        summary: source.statusNote || statusLabel(source.kind, source.status),
      },
      quantityEvidence: source.kind === 'owner_report'
        ? {
            basis: source.quantityBasis ?? null,
            sourceVersion: source.quantitySourceVersion ?? null,
            sourceUpdatedAt: source.quantitySourceUpdatedAt ?? null,
            operatorName: source.operatorName ?? '',
            submittedAt: source.submittedAt ?? null,
          }
        : null,
      amounts: amounts(source),
      project,
      customer,
      contract,
      note: source.note,
      version: String(source.version),
      updatedAt: source.updatedAt,
    },
    lines: source.lines.map(line => ({
      id: line.id,
      boqLineId: line.boqLineId,
      operation: line.operation,
      itemName: line.itemName,
      unit: line.unit,
      contractQty: quantity(line.contractQty),
      contractUnitPrice: nullableMoney(line.contractUnitPrice),
      autoQty: quantity(line.autoQty),
      reportedQty: quantity(line.reportedQty),
      auditedQty: quantity(line.auditedQty),
      deltaQty: quantity(line.deltaQty),
      newUnitPrice: nullableMoney(line.newUnitPrice),
      amount: money(line.amount),
      auditedAmount: nullableMoney(line.auditedAmount),
      note: line.note,
    })),
    files: source.files
      .filter(file => file.deletedAt === null)
      .map(file => ({
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        category: file.category,
        uploader: file.uploader,
        uploadedAt: file.uploadedAt,
      })),
    projectNavigation: relationNavigation(project, source.dataOrigin),
    customerNavigation: relationNavigation(customer, source.dataOrigin),
    contractNavigation: relationNavigation(contract, source.dataOrigin),
    sourceNavigation: source.sourceId
      ? source.sourceType === 'manual'
        ? { kind: 'unavailable', reason: 'not-connected' }
        : contract.state === 'resolved' && project.state === 'resolved'
          ? {
              kind: 'entity-detail',
              subject: contract,
              variant: 'owner-document-source',
              view: source.sourceId,
              filters: {
                dataOrigin: source.dataOrigin,
                contractKind: '施工',
                ownerTab: source.sourceType === 'monthly_statement' ? 'settlements' : 'changes',
              },
            }
          : { kind: 'unavailable', reason: 'missing-id' }
      : { kind: 'unavailable', reason: 'missing-id' },
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
