import type { ProblemDTO } from '../../types/read-model'
import type {
  OwnerCommercialDocumentCommandContextDTO,
  OwnerCommercialDocumentCommandRepository,
  OwnerCommercialDocumentCommandRequestDTO,
  OwnerCommercialDocumentCommandResultDTO,
  OwnerCommercialDocumentFormReadDTO,
} from './central-command-contract'
import type {
  OwnerCommercialDocumentDetailReadDTO,
  OwnerCommercialDocumentListPageDTO,
  OwnerCommercialDocumentReadRepository,
} from './central-repository'
import {
  isDataOriginDTO,
  isISODateDTO,
  isISODateTimeDTO,
  isProblemCodeDTO,
} from '../../types/read-model'
import {
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
} from './central-repository'

export interface OwnerCommercialDocumentHttpFetchOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, unknown>
  body?: Record<string, any>
}

export type OwnerCommercialDocumentHttpFetcher = (
  url: string,
  options?: OwnerCommercialDocumentHttpFetchOptions,
) => Promise<unknown>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformed(label: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(
    ownerCommercialDocumentProblem('internal-error', `${label}响应格式无效`, true),
  )
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function count(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
}

function quantity(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
}

function nullableMoney(value: unknown): boolean {
  return value === null || money(value)
}

function nullableQuantity(value: unknown): boolean {
  return value === null || quantity(value)
}

function nullableDate(value: unknown): boolean {
  return value === null || isISODateDTO(value)
}

function nullableDateTime(value: unknown): boolean {
  return value === null || isISODateTimeDTO(value)
}

function entityRef(value: unknown): boolean {
  if (!object(value) || typeof value.entity !== 'string' || typeof value.state !== 'string')
    return false
  if (value.state === 'resolved')
    return typeof value.id === 'string' && typeof value.label === 'string' && nullableString(value.no)
  if (value.state === 'missing')
    return value.id === null && value.label === null && typeof value.reason === 'string'
  if (value.state === 'forbidden')
    return nullableString(value.id) && value.label === null && value.reason === 'permission-denied'
  return false
}

function navigation(value: unknown): boolean {
  if (!object(value) || typeof value.kind !== 'string')
    return false
  if (value.kind === 'unavailable')
    return typeof value.reason === 'string'
  if (value.kind === 'same-route-overlay')
    return entityRef(value.subject) && typeof value.view === 'string'
  if (value.kind === 'entity-list') {
    return typeof value.entity === 'string' && nullableString(value.variant)
      && nullableString(value.view) && object(value.filters)
  }
  return ['entity-detail', 'entity-subview', 'source-record'].includes(value.kind)
    && entityRef(value.subject) && nullableString(value.variant)
    && nullableString(value.view) && object(value.filters)
}

function amounts(value: unknown): boolean {
  if (!object(value))
    return false
  if (value.kind === 'owner_change') {
    return money(value.boqChange) && money(value.taxInclusive) && money(value.taxExclusive)
      && money(value.appliedTaxExclusive)
  }
  if (value.kind === 'owner_report') {
    return money(value.reported)
      && nullableMoney(value.audited) && nullableMoney(value.difference)
  }
  if (value.kind === 'final_settlement') {
    return money(value.declared) && nullableMoney(value.audited)
      && nullableMoney(value.changedContract) && nullableMoney(value.cumulativeReceipts)
      && nullableMoney(value.receiptDifference)
  }
  if (value.kind === 'owner_penalty')
    return money(value.amount)
  return value.kind === 'acceptance' && money(value.contractEstimate)
}

function acceptanceView(value: unknown): boolean {
  if (value === null)
    return true
  if (!object(value))
    return false
  if (value.variant === 'acceptance') {
    return typeof value.organization === 'string' && typeof value.person === 'string'
      && nullableDate(value.date) && typeof value.conclusion === 'string'
  }
  return value.variant === 'warranty' && typeof value.owner === 'string'
    && nullableDate(value.startDate) && nullableDate(value.endDate)
    && nullableString(value.confirmationOrganization) && nullableDate(value.confirmationDate)
    && typeof value.confirmationNote === 'string'
}

function lifecycleEvent(value: unknown): boolean {
  return object(value) && typeof value.id === 'string'
    && ['submit', 'accept', 'start-warranty', 'confirm-expiry'].includes(String(value.action))
    && ['draft', 'submitted', 'accepted', 'warranty'].includes(String(value.fromStatus))
    && ['submitted', 'accepted', 'warranty', 'expired'].includes(String(value.toStatus))
    && typeof value.actorId === 'string' && typeof value.actorName === 'string'
    && isISODateTimeDTO(value.occurredAt) && typeof value.note === 'string'
}

function listItem(value: unknown): boolean {
  return object(value) && typeof value.rowKey === 'string'
    && isDataOriginDTO(value.dataOrigin)
    && ['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty'].includes(String(value.kind))
    && ['id', 'no', 'name', 'documentType', 'periodNo', 'status', 'statusLabel', 'updatedAt']
      .every(key => typeof value[key] === 'string')
      && value.rowKey === `${value.dataOrigin}:${value.kind}:${value.id}`
      && nullableDate(value.applicationDate) && isISODateTimeDTO(value.updatedAt) && amounts(value.amounts)
      && entityRef(value.project) && entityRef(value.customer) && entityRef(value.contract)
      && navigation(value.projectNavigation) && navigation(value.customerNavigation)
      && navigation(value.contractNavigation) && navigation(value.navigation)
      && acceptanceView(value.acceptanceView)
      && ownerPenaltyListFacts(value.ownerPenaltyFacts)
      && (value.kind === 'owner_penalty' ? value.ownerPenaltyFacts !== null : value.ownerPenaltyFacts === null)
      && (value.attachmentCount === undefined || count(value.attachmentCount))
}

function ownerPenaltyListFacts(value: unknown): boolean {
  return value === null || (object(value)
    && typeof value.noticeNo === 'string'
    && typeof value.reason === 'string')
}

function summaryOption(value: unknown): boolean {
  return object(value) && typeof value.id === 'string' && typeof value.label === 'string'
}

function summaryFacet(value: unknown): boolean {
  return object(value) && typeof value.value === 'string' && typeof value.label === 'string' && count(value.count)
}

function originSummary(value: unknown): boolean {
  return object(value) && count(value.count)
    && ['reportedAmount', 'auditedAmount', 'taxInclusiveAmount', 'taxExclusiveAmount', 'appliedTaxExclusiveAmount']
      .every(key => money(value[key]))
}

function listSummary(value: unknown): boolean {
  return object(value) && Array.isArray(value.projects) && value.projects.every(summaryOption)
    && Array.isArray(value.contracts) && value.contracts.every(summaryOption)
    && Array.isArray(value.statuses) && value.statuses.every(summaryFacet)
    && Array.isArray(value.documentTypes) && value.documentTypes.every(summaryFacet)
    && object(value.origins) && originSummary(value.origins.real) && originSummary(value.origins.demo)
}

function documentLine(value: unknown): boolean {
  return object(value) && typeof value.id === 'string' && nullableString(value.boqLineId)
    && nullableString(value.operation) && typeof value.itemName === 'string' && typeof value.unit === 'string'
    && nullableQuantity(value.contractQty) && nullableMoney(value.contractUnitPrice)
    && nullableQuantity(value.autoQty) && nullableQuantity(value.reportedQty)
    && nullableQuantity(value.auditedQty) && nullableQuantity(value.deltaQty)
    && nullableMoney(value.newUnitPrice) && nullableMoney(value.auditedAmount)
    && money(value.amount) && typeof value.note === 'string'
}

function detailFile(value: unknown): boolean {
  return object(value) && typeof value.id === 'string' && typeof value.fileName === 'string'
    && finite(value.fileSize) && typeof value.mimeType === 'string' && typeof value.category === 'string'
    && typeof value.uploader === 'string' && nullableDateTime(value.uploadedAt)
}

function detailDocument(value: unknown): boolean {
  if (!object(value) || !['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty'].includes(String(value.kind)))
    return false
  return ['id', 'no', 'name', 'documentType', 'periodNo', 'status', 'note', 'version', 'updatedAt']
    .every(key => typeof value[key] === 'string')
    && nullableDate(value.applicationDate) && nullableDate(value.approvalDate)
    && object(value.source) && typeof value.source.type === 'string' && typeof value.source.id === 'string'
    && typeof value.source.locked === 'boolean'
    && object(value.approval) && typeof value.approval.status === 'string'
    && typeof value.approval.label === 'string' && typeof value.approval.summary === 'string'
    && (value.quantityEvidence === null || (object(value.quantityEvidence)
      && nullableString(value.quantityEvidence.basis) && nullableString(value.quantityEvidence.sourceVersion)
      && nullableDateTime(value.quantityEvidence.sourceUpdatedAt) && typeof value.quantityEvidence.operatorName === 'string'
      && nullableDateTime(value.quantityEvidence.submittedAt)))
    && amounts(value.amounts) && entityRef(value.project) && entityRef(value.customer) && entityRef(value.contract)
    && isISODateTimeDTO(value.updatedAt)
}

function ownerPenaltyFacts(value: unknown): boolean {
  if (value === null)
    return true
  return object(value) && typeof value.noticeNo === 'string'
    && nullableDate(value.penaltyDate)
    && typeof value.reason === 'string'
    && typeof value.appealNote === 'string'
}

function finalSettlementEvidence(value: unknown): boolean {
  if (value === null)
    return true
  return object(value) && typeof value.basis === 'string' && typeof value.differenceNote === 'string'
    && (value.sources === null || (Array.isArray(value.sources) && value.sources.every(source => object(source)
      && ['contract-supplement', 'receipt'].includes(String(source.kind))
      && ['id', 'no', 'name', 'status', 'statusLabel'].every(key => typeof source[key] === 'string')
      && money(source.amount) && nullableDate(source.date) && navigation(source.navigation))))
}

function lookup(value: unknown): boolean {
  return object(value) && typeof value.id === 'string' && typeof value.label === 'string'
    && (value.hint === undefined || typeof value.hint === 'string')
}

function contractLookup(value: unknown): boolean {
  return lookup(value) && object(value) && typeof value.projectId === 'string'
    && nullableString(value.customerId)
    && (value.changedContractAmount === null || finite(value.changedContractAmount))
    && (value.receivedAmount === null || finite(value.receivedAmount))
}

function fileRecord(value: unknown, ownerType?: string, ownerId?: string): boolean {
  return object(value) && ['id', 'ownerType', 'ownerId', 'fileName', 'filePath', 'mimeType', 'category', 'uploader', 'uploadedAt']
    .every(key => typeof value[key] === 'string')
    && finite(value.fileSize) && isISODateTimeDTO(value.uploadedAt)
    && (value.deletedAt === null || isISODateTimeDTO(value.deletedAt))
    && (ownerType === undefined || value.ownerType === ownerType)
    && (ownerId === undefined || value.ownerId === ownerId)
}

function boqLine(value: unknown): boolean {
  return object(value) && typeof value.id === 'string' && typeof value.itemName === 'string'
    && typeof value.unit === 'string' && finite(value.qty) && finite(value.unitPrice)
    && finite(value.autoQty) && finite(value.missingQtyCount)
}

function problemPayload(cause: unknown): ProblemDTO | null {
  if (!object(cause))
    return null
  const response = object(cause.response) ? cause.response : null
  const raw = response?._data ?? cause.data
  const candidate = object(raw) && object(raw.data) ? raw.data : raw
  if (!object(candidate) || !isProblemCodeDTO(candidate.code) || typeof candidate.message !== 'string'
    || typeof candidate.retryable !== 'boolean' || !object(candidate.fieldErrors)
    || !(candidate.traceId === null || typeof candidate.traceId === 'string')) {
    return null
  }
  return candidate as unknown as ProblemDTO
}

async function read<T>(request: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
  try {
    return decode(await request())
  }
  catch (cause) {
    if (cause instanceof OwnerCommercialDocumentRepositoryProblem)
      throw cause
    const remote = problemPayload(cause)
    if (remote)
      throw new OwnerCommercialDocumentRepositoryProblem(remote, { cause })
    throw new OwnerCommercialDocumentRepositoryProblem(
      ownerCommercialDocumentProblem('unavailable', cause instanceof Error ? cause.message : '甲方商务单据服务不可用', true),
      { cause },
    )
  }
}

function decodeList(value: unknown): OwnerCommercialDocumentListPageDTO {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(listItem)
    || !object(value.pagination) || !count(value.pagination.page, 1)
    || !count(value.pagination.pageSize, 1) || !count(value.pagination.total)
    || !listSummary(value.summary) || !strings(value.capabilities)
    || !isISODateTimeDTO(value.asOf) || !nullableString(value.sourceVersion)
    || !(value.empty === null || (object(value.empty) && typeof value.empty.reason === 'string'
      && strings(value.empty.missingRelations)))) {
    return malformed('甲方商务单据列表')
  }
  return value as unknown as OwnerCommercialDocumentListPageDTO
}

function decodeDetail(value: unknown): OwnerCommercialDocumentDetailReadDTO {
  if (!object(value) || !isDataOriginDTO(value.dataOrigin) || !detailDocument(value.document)
    || !Array.isArray(value.lines) || !value.lines.every(documentLine)
    || !Array.isArray(value.files) || !value.files.every(detailFile)
    || !navigation(value.projectNavigation) || !navigation(value.customerNavigation)
    || !navigation(value.contractNavigation) || !navigation(value.sourceNavigation)
    || !navigation(value.documentNavigation) || !acceptanceView(value.acceptanceView)
    || !Array.isArray(value.lifecycleEvents) || !value.lifecycleEvents.every(lifecycleEvent)
    || !finalSettlementEvidence(value.finalSettlementEvidence)
    || !ownerPenaltyFacts(value.ownerPenaltyFacts)
    || !object(value.document)
    || (value.document.kind === 'owner_penalty' ? value.ownerPenaltyFacts === null : value.ownerPenaltyFacts !== null)
    || !strings(value.capabilities) || !isISODateTimeDTO(value.asOf)
    || !nullableString(value.sourceVersion)) {
    return malformed('甲方商务单据详情')
  }
  return value as unknown as OwnerCommercialDocumentDetailReadDTO
}

function decodeContext(value: unknown): OwnerCommercialDocumentCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !Array.isArray(value.projects)
    || !value.capabilities.every(entry => typeof entry === 'string')
    || !value.projects.every(entry => lookup(entry) && object(entry) && nullableString(entry.customerId))
    || !Array.isArray(value.customers) || !value.customers.every(lookup)
    || !Array.isArray(value.contracts) || !value.contracts.every(contractLookup)) {
    return malformed('甲方商务单据命令上下文')
  }
  return value as unknown as OwnerCommercialDocumentCommandContextDTO
}

function draftLine(value: unknown, kind: 'owner_change' | 'owner_report'): boolean {
  if (!object(value) || typeof value.id !== 'string' || !nullableString(value.boqLineId)
    || typeof value.itemName !== 'string' || typeof value.unit !== 'string'
    || typeof value.note !== 'string' || !finite(value.amount)) {
    return false
  }
  const numericFields = [
    'contractQty',
    'contractUnitPrice',
    'qty',
    'unitPrice',
    'autoQty',
    'reportedQty',
    'auditedQty',
    'deltaQty',
    'newUnitPrice',
    'auditedAmount',
  ]
  if (!numericFields.every(field => value[field] === undefined || value[field] === null || finite(value[field])))
    return false
  return kind === 'owner_change'
    ? ['add', 'qty', 'price'].includes(String(value.operation))
    : value.operation === undefined || value.operation === null
}

function formDraft(
  value: unknown,
  kind: 'owner_change' | 'owner_report' | 'acceptance' | 'final_settlement' | 'owner_penalty',
  expectedId: string,
): boolean {
  if (!object(value) || value.id !== expectedId || typeof value.no !== 'string'
    || !nullableString(value.projectId) || !nullableString(value.contractId)
    || typeof value.status !== 'string' || typeof value.statusNote !== 'string'
    || typeof value.sourceType !== 'string' || typeof value.sourceId !== 'string'
    || typeof value.sourceLocked !== 'boolean' || typeof value.note !== 'string'
    || !Array.isArray(value.lines)
    || (kind !== 'acceptance' && kind !== 'final_settlement' && kind !== 'owner_penalty'
      && !value.lines.every(line => draftLine(line, kind)))) {
    return false
  }
  if (kind === 'final_settlement') {
    return typeof value.name === 'string' && typeof value.submissionDate === 'string'
      && (value.submissionDate === '' || isISODateDTO(value.submissionDate))
      && finite(value.settlementAmount)
      && (value.auditedAmount === null || finite(value.auditedAmount))
      && (value.changedContractAmount === null || finite(value.changedContractAmount))
      && (value.receivedAmount === null || finite(value.receivedAmount))
      && (value.settlementReceiptGap === null || finite(value.settlementReceiptGap))
      && typeof value.basis === 'string' && typeof value.differenceNote === 'string'
      && value.lines.length === 0
  }
  if (kind === 'owner_penalty') {
    return typeof value.name === 'string' && typeof value.noticeNo === 'string'
      && finite(value.amount) && typeof value.penaltyDate === 'string'
      && (value.penaltyDate === '' || isISODateDTO(value.penaltyDate))
      && typeof value.reason === 'string' && typeof value.appealNote === 'string'
      && value.lines.length === 0
  }
  if (typeof value.applicationDate !== 'string'
    || !(value.applicationDate === '' || isISODateDTO(value.applicationDate))) {
    return false
  }
  if (kind === 'owner_change') {
    return typeof value.name === 'string' && typeof value.documentType === 'string'
      && nullableDate(value.approvalDate) && typeof value.reason === 'string'
      && finite(value.approvedTaxInclusiveAmount) && finite(value.approvedTaxExclusiveAmount)
      && finite(value.appliedTaxExclusiveAmount) && finite(value.totalAmount)
  }
  if (kind === 'acceptance') {
    return typeof value.name === 'string' && finite(value.contractEstimate)
      && typeof value.acceptanceOrganization === 'string'
      && typeof value.acceptancePerson === 'string'
      && nullableDate(value.acceptanceDate)
      && typeof value.acceptanceConclusion === 'string'
      && typeof value.warrantyOwner === 'string'
      && nullableDate(value.warrantyStartDate) && nullableDate(value.warrantyEndDate)
      && nullableString(value.warrantyConfirmationOrganization)
      && nullableDate(value.warrantyConfirmationDate)
      && typeof value.warrantyConfirmationNote === 'string'
      && Array.isArray(value.lifecycleEvents) && value.lifecycleEvents.every(lifecycleEvent)
  }
  return typeof value.periodNo === 'string'
    && (value.periodNo === '' || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.periodNo))
    && typeof value.operatorName === 'string' && nullableString(value.quantityBasis)
    && nullableString(value.quantitySourceVersion) && nullableDateTime(value.quantitySourceUpdatedAt)
    && nullableDateTime(value.submittedAt) && finite(value.reportedAmount)
    && (value.auditedAmount === null || finite(value.auditedAmount))
    && (value.auditDifference === null || finite(value.auditDifference))
}

function decodeForm(
  value: unknown,
  expectedKind: 'owner_change' | 'owner_report' | 'acceptance' | 'final_settlement' | 'owner_penalty',
  expectedId: string,
): OwnerCommercialDocumentFormReadDTO {
  const expectedOwnerType = expectedKind === 'owner_change'
    ? 'owner_change_order'
    : expectedKind === 'owner_report'
      ? 'monthly_statement'
      : expectedKind === 'final_settlement'
        ? 'owner_final_settlement'
        : expectedKind === 'owner_penalty'
          ? 'owner_penalty'
          : 'project_acceptance'
  if (!object(value) || value.kind !== expectedKind || value.id !== expectedId
    || !formDraft(value.draft, expectedKind, expectedId)
    || !Array.isArray(value.attachments)
    || !value.attachments.every(file => fileRecord(file, expectedOwnerType, expectedId))
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)) {
    return malformed('甲方商务单据表单')
  }
  return value as unknown as OwnerCommercialDocumentFormReadDTO
}

function decodeBoqLines(value: unknown) {
  if (!Array.isArray(value) || !value.every(boqLine))
    return malformed('甲方商务单据 BOQ 行')
  return value as Awaited<ReturnType<OwnerCommercialDocumentCommandRepository['boqLines']>>
}

function decodeResult(value: unknown): OwnerCommercialDocumentCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !strings(value.attachmentIds) || typeof value.deleted !== 'boolean') {
    return malformed('甲方商务单据命令')
  }
  return value as unknown as OwnerCommercialDocumentCommandResultDTO
}

export function createHttpOwnerCommercialDocumentReadRepository(
  options: { fetcher: OwnerCommercialDocumentHttpFetcher },
): OwnerCommercialDocumentReadRepository {
  return {
    list: query => read(
      () => options.fetcher(`/api/read/owner-documents/${encodeURIComponent(query.kind)}`, { query: { ...query } }),
      decodeList,
    ),
    get: query => read(
      () => options.fetcher(`/api/read/owner-documents/${encodeURIComponent(query.kind)}/${encodeURIComponent(query.id)}`, { query: { ...query } }),
      decodeDetail,
    ),
  }
}

export function createHttpOwnerCommercialDocumentCommandRepository(
  options: { fetcher: OwnerCommercialDocumentHttpFetcher },
): OwnerCommercialDocumentCommandRepository {
  return {
    context: () => read(
      () => options.fetcher('/api/commands/owner-documents/context'),
      decodeContext,
    ),
    loadForm: (kind, id) => read(
      () => options.fetcher(`/api/commands/owner-documents/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/form`),
      value => decodeForm(value, kind, id),
    ),
    boqLines: (projectId, contractId, periodNo = '') => read(
      () => options.fetcher('/api/commands/owner-documents/boq-lines', { query: { projectId, contractId, periodNo } }),
      decodeBoqLines,
    ),
    execute: (request: OwnerCommercialDocumentCommandRequestDTO) => read(
      () => options.fetcher('/api/commands/owner-documents', { method: 'POST', body: request }),
      decodeResult,
    ),
  }
}
