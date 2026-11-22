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
  ReadMetaDTO,
  ReadProjection,
} from '../../types/read-model'
import type { PenaltyDeductionDTO, PenaltyDeductionSource, PenaltyRectificationEvent } from './project-penalty'
import type { SubcontractSettlementAmounts, SubcontractSettlementEvidence, SubcontractSettlementEvidenceRead } from './subcontract-settlement'
import { isDataOriginDTO } from '../../types/read-model'
import { parsePageQuery, resolvePagination } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { normalizeEnumSelection } from '../util/enum-selection'
import { round2 } from '../util/number'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { buildSubcontractSettlementEvidenceRead, subcontractSettlementAmounts } from './subcontract-settlement'

export const OWNER_COMMERCIAL_DOCUMENT_KINDS = ['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'] as const
export type OwnerCommercialDocumentKind = typeof OWNER_COMMERCIAL_DOCUMENT_KINDS[number]
export const OWNER_ACCEPTANCE_VIEW_VARIANTS = ['acceptance', 'warranty'] as const
export type OwnerAcceptanceViewVariant = typeof OWNER_ACCEPTANCE_VIEW_VARIANTS[number]
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
  amount: number | null
  auditedAmount: number | null
  note: string
}

export interface OwnerCommercialDocumentFileSource {
  id: string
  fileName: string
  fileSize: number | null
  mimeType: string
  category: string
  uploader: string
  uploadedAt: ISODateTimeDTO | null
  deletedAt: ISODateTimeDTO | null
}

export interface OwnerAcceptanceLifecycleEventSource {
  id: string
  action: 'submit' | 'accept' | 'start-warranty' | 'confirm-expiry'
  fromStatus: 'draft' | 'submitted' | 'accepted' | 'warranty'
  toStatus: 'submitted' | 'accepted' | 'warranty' | 'expired'
  actorId: string
  actorName: string
  occurredAt: ISODateTimeDTO
  note: string
}

export interface OwnerAcceptanceLifecycleSource {
  acceptanceOrganization: string
  acceptancePerson: string
  acceptanceDate: ISODateDTO | null
  acceptanceConclusion: string
  warrantyOwner: string
  warrantyStartDate: ISODateDTO | null
  warrantyEndDate: ISODateDTO | null
  warrantyConfirmationOrganization: string | null
  warrantyConfirmationDate: ISODateDTO | null
  warrantyConfirmationNote: string
  events: OwnerAcceptanceLifecycleEventSource[]
}

export interface OwnerFinalSettlementSupplementSource {
  id: string
  no: string
  name: string
  status: string
  amount: number | null
  date: ISODateDTO | null
}

export interface OwnerFinalSettlementReceiptSource {
  id: string
  no: string
  name: string
  status: string
  amount: number | null
  date: ISODateDTO | null
}

export interface OwnerFinalSettlementChangeSource {
  id: string
  no: string
  name: string
  status: string
  amount: number | null
  date: ISODateDTO | null
  sourceType?: OwnerCommercialDocumentSource['sourceType']
}

export interface OwnerFinalSettlementEvidenceSource {
  receiptsProblem?: ProblemDTO
  originalContractAmount: number | null
  supplements: OwnerFinalSettlementSupplementSource[] | null
  /** Actual signed changes from their original owner; absent evidence stays unknown. */
  changes?: OwnerFinalSettlementChangeSource[] | null
  receipts: OwnerFinalSettlementReceiptSource[] | null
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
  projectAvailability?: 'available' | 'unavailable'
  customerId: string | null
  customerName: string
  customerPermission: 'allowed' | 'forbidden'
  customerAvailability?: 'available' | 'unavailable'
  crewId?: string | null
  crewName?: string
  crewAvailability?: 'available' | 'unavailable'
  crewPermission?: 'allowed' | 'forbidden'
  supplierId?: string | null
  supplierName?: string
  supplierPermission?: 'allowed' | 'forbidden'
  supplierAvailability?: 'available' | 'unavailable'
  contractId: string | null
  contractNo: string
  contractName: string
  contractPermission: 'allowed' | 'forbidden'
  contractAvailability?: 'available' | 'unavailable'
  contractKind?: 'construction' | 'subcontract' | 'other_expense'
  sourceType: 'penalty_record' | 'boq_change_order' | 'manual' | 'monthly_statement' | 'owner_final_settlement' | 'owner_penalty' | 'subcontract_change_order' | 'expenditure_settlement'
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
  amount: number | null
  boqAmount?: number | null
  taxExclusiveAmount?: number | null
  appliedTaxExclusiveAmount?: number | null
  auditedAmount: number | null
  changedArea?: number | null
  actualApprovedPrice?: number | null
  note: string
  version: number
  createdAt: ISODateTimeDTO
  updatedAt: ISODateTimeDTO
  lines: OwnerCommercialDocumentLineSource[]
  files: OwnerCommercialDocumentFileSource[]
  acceptanceLifecycle?: OwnerAcceptanceLifecycleSource
  settlementBasis?: string
  settlementDifferenceNote?: string
  finalSettlementEvidence?: OwnerFinalSettlementEvidenceSource
  noticeNo?: string
  penaltyReason?: string
  appealNote?: string
  deductionNote?: string
  penaltyDeductions?: PenaltyDeductionSource[]
  penaltySettlementSources?: Array<{ id: string, owner: 'business' | 'other', name: string, no: string }>
  penaltyRectifications?: PenaltyRectificationEvent[]
  penaltyFacts?: { deadline: string | null, rectificationNote: string, deductionMethod: string, origin?: string | null }
  subcontractSettlementEvidence?: SubcontractSettlementEvidence
}

export interface OwnerCommercialDocumentListQueryDTO {
  kind: OwnerCommercialDocumentKind
  includeDemo: boolean
  origin: DataOriginDTO | null
  search: string
  projectId: string | null
  contractId: string | null
  supplierId: string | null
  status: string | string[] | null
  documentType: string | string[] | null
  variant?: OwnerAcceptanceViewVariant | null
  page: number
  pageSize: OwnerCommercialDocumentPageSize
}

export interface OwnerCommercialDocumentDetailQueryDTO {
  kind: OwnerCommercialDocumentKind
  id: string
  origin: DataOriginDTO
  includeDemo: boolean
  variant?: OwnerAcceptanceViewVariant | null
}

export type OwnerCommercialDocumentAmountsDTO
  = | SubcontractSettlementAmounts
    | {
      kind: 'owner_change'
      boqChange: MoneyDTO | null
      taxInclusive: MoneyDTO | null
      taxExclusive: MoneyDTO | null
      appliedTaxExclusive: MoneyDTO | null
    }
    | {
      kind: 'owner_report'
      reported: MoneyDTO | null
      audited: MoneyDTO | null
      difference: MoneyDTO | null
    }
    | {
      kind: 'acceptance'
      contractEstimate: MoneyDTO | null
    }
    | {
      kind: 'final_settlement'
      declared: MoneyDTO | null
      audited: MoneyDTO | null
      changedContract: MoneyDTO | null
      cumulativeReceipts: MoneyDTO | null
      receiptDifference: MoneyDTO | null
    }
    | {
      kind: 'project_penalty'
      amount: MoneyDTO | null
      deducted: MoneyDTO
      remaining: MoneyDTO | null
    }
    | {
      kind: 'owner_penalty'
      amount: MoneyDTO | null
    }
    | {
      kind: 'sub_change'
      approved: MoneyDTO | null
      changedArea: QuantityDTO | null
      actualApproved: MoneyDTO | null
    }

export type OwnerAcceptanceViewDTO
  = {
    variant: 'acceptance'
    organization: string
    person: string
    date: ISODateDTO | null
    conclusion: string
  }
  | {
    variant: 'warranty'
    owner: string
    startDate: ISODateDTO | null
    endDate: ISODateDTO | null
    confirmationOrganization: string | null
    confirmationDate: ISODateDTO | null
    confirmationNote: string
  }

export interface OwnerCommercialDocumentListItemDTO {
  recordedRelations?: OwnerDocumentRecordedRelations
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
  supplier: EntityRefDTO & { entity: 'supplier' }
  supplierNavigation: NavigationIntentDTO
  contract: EntityRefDTO & { entity: 'contract' }
  contractNavigation: NavigationIntentDTO
  navigation: NavigationIntentDTO
  acceptanceView: OwnerAcceptanceViewDTO | null
  ownerPenaltyFacts: {
    noticeNo: string
    reason: string
  } | null
  crew?: EntityRefDTO & { entity: 'crew' }
  attachmentCount?: number
  updatedAt: ISODateTimeDTO
}

export interface OwnerDocumentRecordedRelations {
  projectName: string
  customerName: string
  supplierName: string
  contractName: string
  crewName: string
}

export interface OwnerCommercialDocumentListSummaryDTO {
  projects: Array<{ id: string, label: string }>
  contracts: Array<{ id: string, label: string }>
  statuses: Array<{ value: string, label: string, count: number }>
  documentTypes: Array<{ value: string, label: string, count: number }>
  origins: Record<DataOriginDTO, {
    count: number
    reportedAmount: MoneyDTO | null
    auditedAmount: MoneyDTO | null
    taxInclusiveAmount: MoneyDTO | null
    taxExclusiveAmount: MoneyDTO | null
    appliedTaxExclusiveAmount: MoneyDTO | null
    subcontractApprovedAmount: MoneyDTO | null
    differenceAmount: MoneyDTO | null
    amountCompleteness: Record<OwnerDocumentSummaryAmountKey, { knownValue: MoneyDTO, missingCount: number }>
    subcontractActualApproved: {
      value: MoneyDTO | null
      status: 'complete' | 'partial' | 'missing'
    }
  }>
}

export type OwnerDocumentSummaryAmountKey = 'reportedAmount' | 'auditedAmount' | 'taxInclusiveAmount' | 'taxExclusiveAmount' | 'appliedTaxExclusiveAmount' | 'subcontractApprovedAmount' | 'differenceAmount'

export type OwnerCommercialDocumentListPageDTO = PageDTO<
  OwnerCommercialDocumentListItemDTO,
  OwnerCommercialDocumentListSummaryDTO
> & { meta: ReadMetaDTO, originMeta: Record<DataOriginDTO, ReadMetaDTO> }

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
  amount: MoneyDTO | null
  auditedAmount: MoneyDTO | null
  note: string
}

export interface OwnerCommercialDocumentDetailReadDTO {
  subcontractSettlementEvidence?: SubcontractSettlementEvidenceRead
  recordedRelations?: OwnerDocumentRecordedRelations
  meta: ReadMetaDTO
  crewNavigation?: NavigationIntentDTO
  penaltyFacts?: OwnerCommercialDocumentSource['penaltyFacts']
  penaltyDeductions?: PenaltyDeductionDTO[]
  penaltyRectifications?: PenaltyRectificationEvent[]
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
    supplier: EntityRefDTO & { entity: 'supplier' }
    contract: EntityRefDTO & { entity: 'contract' }
    note: string
    deductionNote?: string
    version: string
    updatedAt: ISODateTimeDTO
  }
  lines: OwnerCommercialDocumentLineDTO[]
  files: Array<{
    id: string
    fileName: string
    fileSize: number | null
    mimeType: string
    category: string
    uploader: string
    uploadedAt: ISODateTimeDTO | null
  }>
  projectNavigation: NavigationIntentDTO
  customerNavigation: NavigationIntentDTO
  supplierNavigation: NavigationIntentDTO
  contractNavigation: NavigationIntentDTO
  sourceNavigation: NavigationIntentDTO
  documentNavigation: NavigationIntentDTO
  acceptanceView: OwnerAcceptanceViewDTO | null
  lifecycleEvents: OwnerAcceptanceLifecycleEventSource[]
  finalSettlementEvidence: {
    receiptsProblem?: ProblemDTO
    basis: string
    differenceNote: string
    sourceStates?: Record<'supplements' | 'changes' | 'receipts', 'readable' | 'unavailable' | 'forbidden'>
    sources: Array<{
      kind: 'contract-supplement' | 'owner-change' | 'receipt'
      id: string
      no: string
      name: string
      status: string
      statusLabel: string
      amount: MoneyDTO | null
      date: ISODateDTO | null
      navigation: NavigationIntentDTO
    }> | null
  } | null
  ownerPenaltyFacts: {
    noticeNo: string
    penaltyDate: ISODateDTO | null
    reason: string
    appealNote: string
  } | null
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
  const remote = problemFromHttpFailure(cause)
  if (remote)
    return new OwnerCommercialDocumentRepositoryProblem(remote, { cause })
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

function parseVariant(
  kind: OwnerCommercialDocumentKind,
  value: unknown,
): OwnerAcceptanceViewVariant | null {
  if (kind !== 'acceptance') {
    if (value == null || value === '')
      return null
    return fail('invalid-query', '该甲方商务单据不支持验收视图参数')
  }
  if (value == null || value === '')
    return 'acceptance'
  if (OWNER_ACCEPTANCE_VIEW_VARIANTS.includes(value as OwnerAcceptanceViewVariant))
    return value as OwnerAcceptanceViewVariant
  return fail('invalid-query', '验收视图参数无效')
}

export function parseOwnerCommercialDocumentListQuery(
  kind: unknown,
  input: Record<string, unknown> | undefined,
): OwnerCommercialDocumentListQueryDTO {
  const { requestedPage, pageSize } = parsePageQuery(input ?? {}, () => fail('invalid-query', '分页参数无效'), 20)
  if (!OWNER_COMMERCIAL_DOCUMENT_PAGE_SIZES.includes(pageSize as OwnerCommercialDocumentPageSize))
    fail('invalid-query', '甲方商务单据列表查询参数无效')
  const parsedKind = parseKind(kind)
  let status: string[]
  let documentType: string[]
  try {
    status = normalizeEnumSelection(input?.status)
    documentType = normalizeEnumSelection(input?.documentType)
  }
  catch { return fail('invalid-query', '单据类型或状态筛选无效') }
  return {
    kind: parsedKind,
    includeDemo: bool(input?.includeDemo),
    origin: parseOrigin(input?.origin, true),
    search: typeof input?.search === 'string' ? input.search.trim() : '',
    projectId: optional(input?.projectId),
    contractId: optional(input?.contractId),
    supplierId: optional(input?.supplierId ?? input?.supplier),
    status: status.length > 1 ? status : status[0] ?? null,
    documentType: documentType.length > 1 ? documentType : documentType[0] ?? null,
    variant: parseVariant(parsedKind, input?.variant),
    page: requestedPage,
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
  const parsedKind = parseKind(kind)
  return {
    kind: parsedKind,
    id,
    origin: parseOrigin(input?.origin ?? 'real', false) as DataOriginDTO,
    includeDemo: bool(input?.includeDemo),
    variant: parseVariant(parsedKind, input?.variant),
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

export function ownerFinalSettlementSupplementIsActive(status: string): boolean {
  return !['draft', '草稿'].includes(status)
}

export const INACTIVE_RECEIPT_STATUSES: readonly string[] = ['draft', '草稿', 'void', '作废', '已作废']

export function ownerFinalSettlementReceiptIsActive(status: string): boolean {
  return !INACTIVE_RECEIPT_STATUSES.includes(status)
}

export function ownerFinalSettlementChangeIsActive(source: Pick<OwnerFinalSettlementChangeSource, 'status' | 'date'>): boolean {
  return ['approved', '已签证'].includes(source.status) || Boolean(source.date)
}

function finalSettlementSourceStatusLabel(kind: 'contract-supplement' | 'owner-change' | 'receipt', status: string): string {
  const common: Record<string, string> = {
    draft: '草稿',
    草稿: '草稿',
    submitted: '已提交',
    confirmed: '已确认',
    void: '已作废',
    作废: '已作废',
  }
  if (kind === 'contract-supplement' && status === 'approved')
    return '已生效'
  if (kind === 'owner-change' && status === 'approved')
    return '已签证'
  if (kind === 'receipt' && status === 'approved')
    return '已确认'
  return common[status] ?? status
}

function completeAmountSum(values: readonly (number | null)[] | null): number | null {
  return values === null || values.includes(null) ? null : values.reduce<number>((sum, value) => sum + value!, 0)
}

export function ownerFinalSettlementChangedContractAmount(evidence: OwnerFinalSettlementEvidenceSource | undefined): number | null {
  const activeSupplements = evidence?.supplements?.filter(item => ownerFinalSettlementSupplementIsActive(item.status)) ?? null
  const activeChanges = evidence?.changes?.filter(ownerFinalSettlementChangeIsActive) ?? null
  const supplementAmount = completeAmountSum(activeSupplements?.map(item => item.amount) ?? null)
  const changeAmount = completeAmountSum(activeChanges?.map(item => item.amount) ?? null)
  return evidence?.originalContractAmount == null || supplementAmount == null || changeAmount == null
    ? null
    : round2(evidence.originalContractAmount + supplementAmount + changeAmount)
}

function amounts(source: OwnerCommercialDocumentSource): OwnerCommercialDocumentAmountsDTO {
  if (source.kind === 'sub_settlement')
    return subcontractSettlementAmounts(source, source.subcontractSettlementEvidence)
  if (source.kind === 'sub_change') {
    return {
      kind: 'sub_change',
      approved: nullableMoney(source.amount),
      changedArea: quantity(source.changedArea ?? null),
      actualApproved: nullableMoney(source.actualApprovedPrice ?? null),
    }
  }
  if (source.kind === 'owner_change') {
    return {
      kind: 'owner_change',
      boqChange: nullableMoney(source.boqAmount !== undefined ? source.boqAmount : source.lines.length ? completeAmountSum(source.lines.map(line => line.amount)) : null),
      taxInclusive: nullableMoney(source.amount),
      taxExclusive: nullableMoney(source.taxExclusiveAmount ?? null),
      appliedTaxExclusive: nullableMoney(source.appliedTaxExclusiveAmount ?? null),
    }
  }
  if (source.kind === 'owner_report') {
    return {
      kind: 'owner_report',
      reported: nullableMoney(source.amount),
      audited: nullableMoney(source.auditedAmount),
      difference: source.auditedAmount == null || source.amount == null ? null : money(source.auditedAmount - source.amount),
    }
  }
  if (source.kind === 'final_settlement') {
    const evidence = source.finalSettlementEvidence
    const activeReceipts = evidence?.receipts?.filter(item => ownerFinalSettlementReceiptIsActive(item.status)) ?? null
    const changedContract = ownerFinalSettlementChangedContractAmount(evidence)
    const cumulativeReceipts = completeAmountSum(activeReceipts?.map(item => item.amount) ?? null)
    return {
      kind: 'final_settlement',
      declared: nullableMoney(source.amount),
      audited: nullableMoney(source.auditedAmount),
      changedContract: nullableMoney(changedContract),
      cumulativeReceipts: nullableMoney(cumulativeReceipts),
      receiptDifference: cumulativeReceipts == null || source.amount == null ? null : money(source.amount - cumulativeReceipts),
    }
  }
  if (source.kind === 'project_penalty') {
    const deducted = (source.penaltyDeductions ?? []).reduce((sum, row) => sum + row.amount, 0)
    return { kind: 'project_penalty', amount: nullableMoney(source.amount), deducted: money(deducted), remaining: source.amount == null ? null : money(source.amount - deducted) }
  }
  if (source.kind === 'owner_penalty')
    return { kind: 'owner_penalty', amount: nullableMoney(source.amount) }
  return { kind: 'acceptance', contractEstimate: nullableMoney(source.amount) }
}

function statusLabel(kind: OwnerCommercialDocumentKind, status: string): string {
  if (kind === 'project_penalty')
    return ({ draft: '草稿', pending: '待抵扣', repairing: '整改中', repaired_self: '自行整改完成', repaired_other: '委托整改完成', deducted: '已抵扣' } as Record<string, string>)[status] ?? status
  if (kind === 'sub_settlement')
    return ({ draft: '草稿', confirmed: '已确认' } as Record<string, string>)[status] ?? status
  const labels: Record<string, string> = kind === 'sub_change'
    ? { draft: '草稿', submitted: '已提交', rejected: '已退回', approved: '已审批' }
    : kind === 'owner_change'
      ? { draft: '草稿', submitted: '已上报', rejected: '已退回', approved: '已签证' }
      : kind === 'owner_report'
        ? { draft: '草稿', adjusted: '已申报', reported: '已申报', exported: '已审定', audited: '已审定' }
        : kind === 'acceptance'
          ? { draft: '草稿', submitted: '验收中', accepted: '已验收', warranty: '保修中', expired: '已到期' }
          : kind === 'final_settlement'
            ? { draft: '草稿', submitted: '已提交', audited: '已审定' }
            : { draft: '草稿', submitted: '已提交' }
  return labels[status] ?? status
}

function entityRef<T extends 'project' | 'customer' | 'supplier' | 'contract' | 'crew'>(
  entity: T,
  id: string | null,
  label: string,
  no: string | null,
  permission: 'allowed' | 'forbidden',
  availability: 'available' | 'unavailable' = 'available',
): EntityRefDTO & { entity: T } {
  if (!id)
    return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' } as EntityRefDTO & { entity: T }
  if (permission === 'forbidden')
    return { state: 'forbidden', entity, id: null, label: null, reason: 'permission-denied' } as EntityRefDTO & { entity: T }
  if (availability === 'unavailable')
    return { state: 'unavailable', entity, id: null, label: null, reason: 'source-unavailable' } as EntityRefDTO & { entity: T }
  return { state: 'resolved', entity, id, label, no } as EntityRefDTO & { entity: T }
}

function relationNavigation(
  reference: EntityRefDTO,
  origin: DataOriginDTO,
  contractKind: '施工' | '分包' | 'other_expense' = '施工',
): NavigationIntentDTO {
  if (reference.state === 'forbidden')
    return { kind: 'unavailable', reason: 'forbidden' }
  if (reference.state === 'unavailable')
    return { kind: 'unavailable', reason: 'not-connected' }
  if (reference.state !== 'resolved')
    return { kind: 'unavailable', reason: 'missing-id' }
  return {
    kind: 'entity-detail',
    subject: reference,
    variant: reference.entity === 'contract' && contractKind === 'other_expense' ? 'other_expense' : 'detail',
    view: null,
    filters: reference.entity === 'contract'
      ? { dataOrigin: origin, contractKind }
      : { dataOrigin: origin },
  }
}

function documentNavigation(
  source: OwnerCommercialDocumentSource,
  acceptanceVariant: OwnerAcceptanceViewVariant | null,
): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: {
      state: 'resolved',
      entity: source.kind === 'sub_change' || source.kind === 'sub_settlement' || source.kind === 'project_penalty' ? 'subcontract-document' : 'owner-document',
      id: source.id,
      label: source.name,
      no: source.no || null,
    },
    variant: source.kind === 'project_penalty'
      ? 'penalty'
      : source.kind === 'sub_settlement'
        ? 'settlement'
        : source.kind === 'owner_change'
          ? 'change'
          : source.kind === 'sub_change'
            ? 'change'
            : source.kind === 'owner_report'
              ? 'report'
              : source.kind === 'final_settlement'
                ? 'final-settlement'
                : source.kind === 'owner_penalty'
                  ? 'penalty'
                  : acceptanceVariant ?? 'acceptance',
    view: null,
    filters: { dataOrigin: source.dataOrigin },
  }
}

function acceptanceView(
  source: OwnerCommercialDocumentSource,
  variant: OwnerAcceptanceViewVariant | null,
): OwnerAcceptanceViewDTO | null {
  if (source.kind !== 'acceptance' || !source.acceptanceLifecycle)
    return null
  const lifecycle = source.acceptanceLifecycle
  return variant === 'warranty'
    ? {
        variant: 'warranty',
        owner: lifecycle.warrantyOwner,
        startDate: lifecycle.warrantyStartDate,
        endDate: lifecycle.warrantyEndDate,
        confirmationOrganization: lifecycle.warrantyConfirmationOrganization,
        confirmationDate: lifecycle.warrantyConfirmationDate,
        confirmationNote: lifecycle.warrantyConfirmationNote,
      }
    : {
        variant: 'acceptance',
        organization: lifecycle.acceptanceOrganization,
        person: lifecycle.acceptancePerson,
        date: lifecycle.acceptanceDate,
        conclusion: lifecycle.acceptanceConclusion,
      }
}

function visibleFiles(
  source: OwnerCommercialDocumentSource,
  variant: OwnerAcceptanceViewVariant | null,
): OwnerCommercialDocumentFileSource[] {
  const files = source.files.filter(file => file.deletedAt === null)
  if (source.kind !== 'acceptance')
    return files
  const category = variant === 'warranty' ? 'warranty-confirmation' : 'acceptance-report'
  return files.filter(file => file.category === category)
}

function relations(source: OwnerCommercialDocumentSource) {
  const project = entityRef('project', source.projectId, source.projectName, null, source.projectPermission, source.projectAvailability)
  const customer = entityRef('customer', source.customerId, source.customerName, null, source.customerPermission, source.customerAvailability)
  const supplier = entityRef(
    'supplier',
    source.supplierId ?? null,
    source.supplierName ?? '',
    null,
    source.supplierPermission ?? 'allowed',
    source.supplierAvailability,
  )
  const contract = entityRef('contract', source.contractId, source.contractName, source.contractNo || null, source.contractPermission, source.contractAvailability)
  return { project, customer, supplier, contract }
}

function recordedRelations(source: OwnerCommercialDocumentSource): OwnerDocumentRecordedRelations {
  return { projectName: source.projectPermission === 'forbidden' ? '' : source.projectName, customerName: source.customerPermission === 'forbidden' ? '' : source.customerName, supplierName: source.supplierPermission === 'forbidden' ? '' : source.supplierName ?? '', contractName: source.contractPermission === 'forbidden' ? '' : source.contractName, crewName: source.crewPermission === 'forbidden' ? '' : source.crewName ?? '' }
}

function contractReadKind(source: OwnerCommercialDocumentSource) {
  return source.contractKind === 'other_expense' ? 'other_expense' : (source.kind === 'sub_change' || source.kind === 'sub_settlement' || source.kind === 'project_penalty') ? '分包' : '施工'
}

function statusMatches(source: OwnerCommercialDocumentSource, requested: string | string[] | null): boolean {
  if (Array.isArray(requested))
    return !requested.length || requested.some(value => statusMatches(source, value))
  if (source.kind === 'project_penalty' && requested === 'pending')
    return ['pending', 'repairing', 'repaired_self', 'repaired_other'].includes(source.status)
  if (source.kind === 'project_penalty' && requested === 'done')
    return source.status === 'deducted'
  if (source.kind === 'sub_settlement' && requested === 'pending')
    return source.status === 'draft'
  if (!requested)
    return true
  if (source.kind === 'final_settlement') {
    if (requested === 'doing')
      return source.status !== 'audited'
    if (requested === 'done')
      return source.status === 'audited'
  }
  if (source.kind !== 'acceptance')
    return source.status === requested
  if (requested === 'checking')
    return source.status === 'submitted'
  if (requested === 'done')
    return source.status === 'accepted' || source.status === 'expired'
  return source.status === requested
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
): ReadProjection<OwnerCommercialDocumentListPageDTO> {
  const allowedOrigins = input.query.includeDemo ? new Set<DataOriginDTO>(['real', 'demo']) : new Set<DataOriginDTO>(['real'])
  const search = input.query.search.toLocaleLowerCase('zh-CN')
  const candidates = input.documents
    .filter(row => row.kind === input.query.kind && allowedOrigins.has(row.dataOrigin))
    .filter(row => input.query.kind !== 'acceptance'
      || input.query.variant !== 'warranty'
      || row.status === 'warranty'
      || row.status === 'expired')
  const filtered = candidates
    .filter(row => input.query.origin === null || row.dataOrigin === input.query.origin)
    .filter(row => !input.query.projectId || (row.projectPermission === 'allowed' && row.projectId === input.query.projectId))
    .filter(row => !input.query.contractId || (row.contractPermission === 'allowed' && row.contractId === input.query.contractId))
    .filter(row => !input.query.supplierId || (row.supplierPermission !== 'forbidden' && row.supplierId === input.query.supplierId))
    .filter(row => statusMatches(row, input.query.status))
    .filter(row => !normalizeEnumSelection(input.query.documentType).length || normalizeEnumSelection(input.query.documentType).includes(row.documentType))
    .filter(row => !search || [
      row.no,
      row.name,
      row.projectPermission === 'allowed' ? row.projectName : '',
      row.contractPermission === 'allowed' ? row.contractName : '',
      row.documentType,
      row.supplierPermission !== 'forbidden' ? row.supplierName ?? '' : '',
      row.periodNo,
      row.noticeNo ?? '',
      row.penaltyReason ?? '',
      row.crewName ?? '',
      row.appealNote ?? '',
    ]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const { page } = resolvePagination(input.query.page, input.query.pageSize, filtered.length)
  const start = (page - 1) * input.query.pageSize
  const items = filtered.slice(start, start + input.query.pageSize).map((source) => {
    const { project, customer, supplier, contract } = relations(source)
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
      recordedRelations: recordedRelations(source),
      project,
      projectNavigation: relationNavigation(project, source.dataOrigin),
      customer,
      customerNavigation: relationNavigation(customer, source.dataOrigin),
      supplier,
      supplierNavigation: relationNavigation(supplier, source.dataOrigin),
      contract,
      contractNavigation: relationNavigation(contract, source.dataOrigin, contractReadKind(source)),
      navigation: documentNavigation(source, input.query.variant ?? null),
      acceptanceView: acceptanceView(source, input.query.variant ?? null),
      ownerPenaltyFacts: source.kind === 'owner_penalty'
        ? { noticeNo: source.noticeNo ?? '', reason: source.penaltyReason ?? source.name }
        : null,
      ...(source.kind === 'project_penalty' ? { crew: entityRef('crew', source.crewId ?? null, source.crewName ?? '', null, source.crewPermission ?? 'allowed', source.crewAvailability) } : {}),
      attachmentCount: visibleFiles(source, input.query.variant ?? null).length,
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
    const ownerRows = rows.filter(row => row.kind !== 'sub_change')
    const subcontractActualApprovedRows = rows.filter(row => row.kind === 'sub_change' && row.actualApprovedPrice != null)
    const subcontractRowCount = rows.filter(row => row.kind === 'sub_change').length
    const totals = {
      reportedAmount: ownerRows.map(row => row.amount),
      auditedAmount: ownerRows.map(row => row.auditedAmount),
      taxInclusiveAmount: ownerRows.map(row => row.amount),
      taxExclusiveAmount: ownerRows.map(row => row.taxExclusiveAmount ?? null),
      appliedTaxExclusiveAmount: ownerRows.map(row => row.appliedTaxExclusiveAmount ?? null),
      subcontractApprovedAmount: rows.filter(row => row.kind === 'sub_change').map(row => row.amount),
      differenceAmount: rows.filter(row => row.kind === 'owner_report').map(row => row.auditedAmount === null || row.amount === null ? null : row.auditedAmount - row.amount),
    }
    const totalAmounts = Object.fromEntries(Object.entries(totals).map(([key, values]) => [key, nullableMoney(completeAmountSum(values))])) as Record<OwnerDocumentSummaryAmountKey, MoneyDTO | null>
    const amountCompleteness = Object.fromEntries(Object.entries(totals).map(([key, values]) => [key, { knownValue: money(values.reduce<number>((total, value) => total + (value ?? 0), 0)), missingCount: values.filter(value => value === null).length }])) as OwnerCommercialDocumentListSummaryDTO['origins']['real']['amountCompleteness']
    return {
      count: rows.length,
      ...totalAmounts,
      amountCompleteness,
      subcontractActualApproved: {
        value: subcontractActualApprovedRows.length
          ? money(subcontractActualApprovedRows.reduce((total, row) => total + row.actualApprovedPrice!, 0))
          : null,
        status: subcontractActualApprovedRows.length === 0
          ? 'missing' as const
          : subcontractActualApprovedRows.length === subcontractRowCount
            ? 'complete' as const
            : 'partial' as const,
      },
    }
  }
  return {
    items,
    pagination: { requestedPage: input.query.page, page, pageSize: input.query.pageSize, total: filtered.length },
    summary: {
      projects: options(row => row.projectPermission === 'allowed' ? row.projectId : null, row => row.projectName),
      contracts: options(row => row.contractPermission === 'allowed' ? row.contractId : null, row => row.contractName),
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
): ReadProjection<OwnerCommercialDocumentDetailReadDTO> {
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
  const { project, customer, supplier, contract } = relations(source)
  const settlementSources = source.kind === 'final_settlement'
    && source.finalSettlementEvidence != null
    && (source.finalSettlementEvidence.supplements != null || source.finalSettlementEvidence.changes != null || source.finalSettlementEvidence.receipts != null)
    ? [
        ...(source.finalSettlementEvidence.supplements ?? [])
          .filter(item => ownerFinalSettlementSupplementIsActive(item.status))
          .map(item => ({
            kind: 'contract-supplement' as const,
            id: item.id,
            no: item.no,
            name: item.name,
            status: item.status,
            statusLabel: finalSettlementSourceStatusLabel('contract-supplement', item.status),
            amount: nullableMoney(item.amount),
            date: item.date,
            navigation: contract.state === 'resolved'
              ? {
                  kind: 'entity-detail' as const,
                  subject: contract,
                  variant: 'supplement',
                  view: item.id,
                  filters: { dataOrigin: source.dataOrigin, contractKind: '施工' },
                }
              : { kind: 'unavailable' as const, reason: 'missing-id' as const },
          })),
        ...(source.finalSettlementEvidence.changes ?? [])
          .filter(ownerFinalSettlementChangeIsActive)
          .map(item => ({
            kind: 'owner-change' as const,
            id: item.id,
            no: item.no,
            name: item.name,
            status: item.status,
            statusLabel: finalSettlementSourceStatusLabel('owner-change', item.status),
            amount: nullableMoney(item.amount),
            date: item.date,
            navigation: {
              kind: 'entity-detail' as const,
              subject: { state: 'resolved' as const, entity: 'owner-document' as const, id: item.id, label: item.name, no: item.no || null },
              variant: 'change',
              view: null,
              filters: { dataOrigin: source.dataOrigin },
            },
          })),
        ...(source.finalSettlementEvidence.receipts ?? [])
          .filter(item => ownerFinalSettlementReceiptIsActive(item.status))
          .map(item => ({
            kind: 'receipt' as const,
            id: item.id,
            no: item.no,
            name: item.name,
            status: item.status,
            statusLabel: finalSettlementSourceStatusLabel('receipt', item.status),
            amount: nullableMoney(item.amount),
            date: item.date,
            navigation: customer.state === 'resolved'
              ? {
                  kind: 'entity-detail' as const,
                  subject: {
                    state: 'resolved' as const,
                    entity: 'receipt' as const,
                    id: item.id,
                    label: item.name,
                    no: item.no || null,
                  },
                  variant: 'detail',
                  view: null,
                  filters: { dataOrigin: source.dataOrigin, customerId: customer.id },
                }
              : { kind: 'unavailable' as const, reason: 'missing-id' as const },
          })),
      ]
    : null
  const finalSettlementEvidence = source.kind === 'final_settlement'
    ? {
        ...(source.finalSettlementEvidence?.receiptsProblem ? { receiptsProblem: source.finalSettlementEvidence.receiptsProblem } : {}),
        basis: source.settlementBasis ?? '',
        differenceNote: source.settlementDifferenceNote ?? '',
        sourceStates: {
          supplements: source.finalSettlementEvidence?.supplements == null ? 'unavailable' as const : 'readable' as const,
          changes: source.finalSettlementEvidence?.changes == null ? 'unavailable' as const : 'readable' as const,
          receipts: source.finalSettlementEvidence?.receipts == null
            ? source.finalSettlementEvidence?.receiptsProblem?.code === 'forbidden' ? 'forbidden' as const : 'unavailable' as const
            : 'readable' as const,
        },
        sources: settlementSources,
      }
    : null
  return {
    ...(source.kind === 'sub_settlement' ? { subcontractSettlementEvidence: buildSubcontractSettlementEvidenceRead(source, source.subcontractSettlementEvidence) } : {}),
    ...(source.kind === 'project_penalty'
      ? {
          crewNavigation: relationNavigation(entityRef('crew', source.crewId ?? null, source.crewName ?? '', null, source.crewPermission ?? 'allowed', source.crewAvailability), source.dataOrigin),
          penaltyFacts: source.penaltyFacts,
          penaltyRectifications: source.penaltyRectifications ?? [],
          penaltyDeductions: (source.penaltyDeductions ?? []).map((row) => {
            const settlement = input.documents.find(item => item.kind === 'sub_settlement' && item.id === row.settlementId && item.dataOrigin === source.dataOrigin)
            const other = source.penaltySettlementSources?.find(item => item.id === row.settlementId && item.owner === 'other')
            return { ...row, amount: money(row.amount), settlementName: settlement?.name ?? other?.name ?? '结算不可用', navigation: settlement ? documentNavigation(settlement, null) : other ? { kind: 'entity-detail' as const, subject: { state: 'resolved' as const, entity: 'settlement' as const, id: other.id, label: other.name, no: other.no || null }, variant: 'other_settlement', view: null, filters: { dataOrigin: source.dataOrigin } } : { kind: 'unavailable' as const, reason: 'missing-id' as const } }
          }),
        }
      : {}),
    dataOrigin: source.dataOrigin,
    recordedRelations: recordedRelations(source),
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
      supplier,
      contract,
      note: source.note,
      ...(source.kind === 'sub_settlement' ? { deductionNote: source.deductionNote ?? '' } : {}),
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
      amount: nullableMoney(line.amount),
      auditedAmount: nullableMoney(line.auditedAmount),
      note: line.note,
    })),
    files: visibleFiles(source, input.query.variant ?? null)
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
    supplierNavigation: relationNavigation(supplier, source.dataOrigin),
    contractNavigation: relationNavigation(contract, source.dataOrigin, contractReadKind(source)),
    sourceNavigation: source.sourceId
      ? source.contractKind === 'other_expense'
        ? relationNavigation(contract, source.dataOrigin, 'other_expense')
        : (source.kind === 'sub_change' || source.kind === 'sub_settlement' || source.kind === 'project_penalty')
            ? contract.state === 'resolved' && project.state === 'resolved' && supplier.state === 'resolved'
              ? {
                  kind: 'entity-detail',
                  subject: contract,
                  variant: 'subcontract-document-source',
                  view: source.sourceId,
                  filters: {
                    dataOrigin: source.dataOrigin,
                    contractKind: '分包',
                    subcontractTab: source.kind === 'project_penalty' ? 'penalties' : source.kind === 'sub_settlement' ? 'settlements' : 'changes',
                  },
                }
              : { kind: 'unavailable', reason: 'missing-id' }
            : source.sourceType === 'manual' && source.kind !== 'acceptance'
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
                      ownerTab: source.kind === 'acceptance'
                        ? 'acceptance'
                        : source.sourceType === 'monthly_statement' || source.kind === 'final_settlement'
                          || source.kind === 'owner_penalty'
                          ? 'settlements'
                          : 'changes',
                      ...(source.kind === 'acceptance'
                        ? { ownerView: input.query.variant ?? 'acceptance' }
                        : {}),
                    },
                  }
                : { kind: 'unavailable', reason: 'missing-id' }
      : { kind: 'unavailable', reason: 'missing-id' },
    documentNavigation: documentNavigation(source, input.query.variant ?? null),
    acceptanceView: acceptanceView(source, input.query.variant ?? null),
    lifecycleEvents: source.acceptanceLifecycle?.events.map(event => ({ ...event })) ?? [],
    finalSettlementEvidence,
    ownerPenaltyFacts: source.kind === 'owner_penalty'
      ? {
          noticeNo: source.noticeNo ?? '',
          penaltyDate: source.applicationDate,
          reason: source.penaltyReason ?? source.name,
          appealNote: source.appealNote ?? '',
        }
      : null,
    asOf: input.asOf,
    sourceVersion: input.sourceVersion,
    capabilities: [...input.capabilities],
  }
}
