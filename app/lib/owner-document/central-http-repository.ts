import type { ProblemDTO } from '../../types/read-model'
import type {
  OwnerCommercialDocumentCommandContextDTO,
  OwnerCommercialDocumentCommandRepository,
  OwnerCommercialDocumentCommandRequestDTO,
  OwnerCommercialDocumentCommandResultDTO,
  OwnerCommercialDocumentFormReadDTO,
} from './central-command-contract'
import type {
  OwnerCommercialDocumentDetailQueryDTO,
  OwnerCommercialDocumentDetailReadDTO,
  OwnerCommercialDocumentListPageDTO,
  OwnerCommercialDocumentListQueryDTO,
  OwnerCommercialDocumentReadRepository,
} from './central-repository'
import {
  isDataOriginDTO,
  isEntityRefDTO,
  isISODateDTO,
  isISODateTimeDTO,
  isUnavailableEntityNavigationDTO,
} from '../../types/read-model'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '../read-model/meta'
import { isPaginationDTO } from '../read-model/pagination'
import { problemFromHttpFailure } from '../read-model/problem'
import { serializeEnumSelection } from '../util/enum-selection'
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
  return isEntityRefDTO(value)
}

function navigation(value: unknown): boolean {
  if (!object(value) || typeof value.kind !== 'string')
    return false
  if (value.kind === 'unavailable')
    return Object.keys(value).length === 2 && ['missing-id', 'missing-route', 'not-connected', 'forbidden', 'unverified-target', 'error'].includes(String(value.reason))
  if (value.kind === 'same-route-overlay')
    return isEntityRefDTO(value.subject) && value.subject.state === 'resolved' && typeof value.view === 'string'
  if (value.kind === 'entity-list') {
    return typeof value.entity === 'string' && nullableString(value.variant)
      && nullableString(value.view) && object(value.filters)
  }
  return ['entity-detail', 'entity-subview', 'source-record'].includes(value.kind)
    && isEntityRefDTO(value.subject) && value.subject.state === 'resolved' && nullableString(value.variant)
    && nullableString(value.view) && object(value.filters)
}

function relationNavigation(value: unknown, reference: unknown, origin: unknown): boolean {
  if (!isEntityRefDTO(reference))
    return false
  if (reference.state !== 'resolved')
    return isUnavailableEntityNavigationDTO(value, reference)
  return object(value) && navigation(value) && isEntityRefDTO(value.subject) && value.subject.state === 'resolved'
    && value.subject.entity === reference.entity && value.subject.id === reference.id
    && value.subject.label === reference.label && value.subject.no === reference.no
    && object(value.filters) && value.filters.dataOrigin === origin
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
  if (value.kind === 'project_penalty')
    return money(value.amount) && money(value.deducted) && money(value.remaining)
  if (value.kind === 'owner_penalty')
    return money(value.amount)
  if (value.kind === 'sub_settlement')
    return money(value.total) && ['contractAmount', 'priorSettled', 'cumulativeSettled', 'deductions', 'netSettlement', 'cumulativeApplied', 'remainingApplicable', 'cumulativePaid', 'remainingUnpaid'].every(key => value[key] === null || money(value[key]))
  if (value.kind === 'sub_change') {
    return money(value.approved) && nullableQuantity(value.changedArea)
      && nullableMoney(value.actualApproved)
  }
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
    && ['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'].includes(String(value.kind))
    && ['id', 'no', 'name', 'documentType', 'periodNo', 'status', 'statusLabel', 'updatedAt']
      .every(key => typeof value[key] === 'string')
      && value.rowKey === `${value.dataOrigin}:${value.kind}:${value.id}`
      && nullableDate(value.applicationDate) && isISODateTimeDTO(value.updatedAt) && amounts(value.amounts)
      && entityRef(value.project) && entityRef(value.customer) && entityRef(value.supplier) && entityRef(value.contract)
      && relationNavigation(value.projectNavigation, value.project, value.dataOrigin) && relationNavigation(value.customerNavigation, value.customer, value.dataOrigin)
      && relationNavigation(value.supplierNavigation, value.supplier, value.dataOrigin) && relationNavigation(value.contractNavigation, value.contract, value.dataOrigin) && navigation(value.navigation)
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

function subcontractActualApprovedSummary(value: unknown): boolean {
  if (!object(value))
    return false
  if (value.status === 'missing')
    return value.value === null
  return (value.status === 'complete' || value.status === 'partial') && money(value.value)
}

function originSummary(value: unknown): boolean {
  return object(value) && count(value.count)
    && ['reportedAmount', 'auditedAmount', 'taxInclusiveAmount', 'taxExclusiveAmount', 'appliedTaxExclusiveAmount', 'subcontractApprovedAmount']
      .every(key => money(value[key]))
      && subcontractActualApprovedSummary(value.subcontractActualApproved)
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
  if (!object(value) || !['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'].includes(String(value.kind)))
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
    && amounts(value.amounts) && entityRef(value.project) && entityRef(value.customer)
    && entityRef(value.supplier) && entityRef(value.contract)
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
    && nullableString(value.customerId) && nullableString(value.supplierId)
    && ['construction', 'subcontract'].includes(String(value.kind))
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
    && typeof value.unit === 'string' && (value.qty === null || finite(value.qty)) && (value.unitPrice === null || finite(value.unitPrice))
    && finite(value.autoQty) && finite(value.missingQtyCount)
}

function problemPayload(cause: unknown): ProblemDTO | null {
  return problemFromHttpFailure(cause)
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

function decodeList(value: unknown, expected: OwnerCommercialDocumentListQueryDTO): OwnerCommercialDocumentListPageDTO {
  const requiredCapability = (expected.kind === 'sub_change' || expected.kind === 'sub_settlement' || expected.kind === 'project_penalty') ? 'subcontract-document:read' : 'owner-document:read'
  if (!object(value) || !hasConsistentOriginReadMeta(value, 'owner-document-read-v2') || !Array.isArray(value.items) || !value.items.every(listItem)
    || !isPaginationDTO(value.pagination, value.items.length)
    || !listSummary(value.summary) || !strings(value.capabilities)
    || !isISODateTimeDTO(value.asOf) || !nullableString(value.sourceVersion)
    || !(value.empty === null || (object(value.empty) && typeof value.empty.reason === 'string'
      && strings(value.empty.missingRelations)))
    || value.pagination.requestedPage !== expected.page || value.pagination.pageSize !== expected.pageSize
    || !value.capabilities.includes(requiredCapability)
    || !value.items.every(item => object(item)
      && item.kind === expected.kind
      && (expected.origin ? item.dataOrigin === expected.origin : expected.includeDemo || item.dataOrigin === 'real'))) {
    return malformed('甲方商务单据列表')
  }
  return value as unknown as OwnerCommercialDocumentListPageDTO
}

function projectPenaltyFacts(value: Record<string, unknown>): boolean {
  const facts = value.penaltyFacts
  return navigation(value.crewNavigation) && object(facts) && nullableDate(facts.deadline) && typeof facts.rectificationNote === 'string' && typeof facts.deductionMethod === 'string'
    && Array.isArray(value.penaltyDeductions) && value.penaltyDeductions.every(row => object(row)
      && ['id', 'penaltyId', 'settlementId', 'actorId', 'commandId', 'note', 'settlementName'].every(key => typeof row[key] === 'string')
      && object(value.document) && row.penaltyId === value.document.id && money(row.amount) && Number(row.amount) > 0 && isISODateTimeDTO(row.occurredAt) && navigation(row.navigation))
    && Array.isArray(value.penaltyRectifications) && value.penaltyRectifications.every(row => object(row)
      && typeof row.id === 'string' && typeof row.actorId === 'string' && typeof row.note === 'string'
      && nullableDate(row.deadline) && isISODateTimeDTO(row.occurredAt))
}

function decodeDetail(value: unknown, expected: OwnerCommercialDocumentDetailQueryDTO): OwnerCommercialDocumentDetailReadDTO {
  const requiredCapability = (expected.kind === 'sub_change' || expected.kind === 'sub_settlement' || expected.kind === 'project_penalty') ? 'subcontract-document:read' : 'owner-document:read'
  if (!object(value) || !hasConsistentReadMeta(value, 'owner-document-read-v2', value.dataOrigin) || !isDataOriginDTO(value.dataOrigin) || !detailDocument(value.document)
    || !Array.isArray(value.lines) || !value.lines.every(documentLine)
    || !Array.isArray(value.files) || !value.files.every(detailFile)
    || !object(value.document) || !relationNavigation(value.projectNavigation, value.document.project, value.dataOrigin) || !relationNavigation(value.customerNavigation, value.document.customer, value.dataOrigin)
    || !relationNavigation(value.supplierNavigation, value.document.supplier, value.dataOrigin)
    || !relationNavigation(value.contractNavigation, value.document.contract, value.dataOrigin) || !navigation(value.sourceNavigation)
    || !navigation(value.documentNavigation) || !acceptanceView(value.acceptanceView)
    || !Array.isArray(value.lifecycleEvents) || !value.lifecycleEvents.every(lifecycleEvent)
    || !finalSettlementEvidence(value.finalSettlementEvidence)
    || (expected.kind === 'project_penalty' && !projectPenaltyFacts(value))
    || !ownerPenaltyFacts(value.ownerPenaltyFacts)
    || !object(value.document)
    || (value.document.kind === 'owner_penalty' ? value.ownerPenaltyFacts === null : value.ownerPenaltyFacts !== null)
    || !strings(value.capabilities) || !isISODateTimeDTO(value.asOf)
    || !nullableString(value.sourceVersion)
    || value.dataOrigin !== expected.origin
    || !object(value.document) || value.document.kind !== expected.kind || value.document.id !== expected.id
    || !value.capabilities.includes(requiredCapability)) {
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
    || !Array.isArray(value.suppliers) || !value.suppliers.every(lookup)
    || (value.settlements !== undefined && (!Array.isArray(value.settlements) || !value.settlements.every(row => object(row) && lookup(row) && nullableString(row.projectId) && nullableString(row.supplierId) && nullableString(row.contractId) && finite(row.amount))))
    || (value.crews !== undefined && (!Array.isArray(value.crews) || !value.crews.every(lookup)))
    || (Array.isArray(value.settlements) && !value.settlements.every(row => object(row) && (row.version === undefined || typeof row.version === 'string') && (row.remainingAmount === undefined || (finite(row.remainingAmount) && row.remainingAmount >= 0))))
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
  kind: 'owner_change' | 'owner_report' | 'acceptance' | 'final_settlement' | 'owner_penalty' | 'sub_change' | 'sub_settlement' | 'project_penalty',
  expectedId: string,
): boolean {
  if (!object(value) || value.id !== expectedId || typeof value.no !== 'string'
    || !nullableString(value.projectId) || !nullableString(value.contractId)
    || typeof value.status !== 'string' || typeof value.statusNote !== 'string'
    || typeof value.sourceType !== 'string' || typeof value.sourceId !== 'string'
    || typeof value.sourceLocked !== 'boolean' || typeof value.note !== 'string'
    || !Array.isArray(value.lines)
    || (kind !== 'acceptance' && kind !== 'final_settlement' && kind !== 'owner_penalty' && kind !== 'sub_change' && kind !== 'sub_settlement' && kind !== 'project_penalty'
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
  if (kind === 'project_penalty')
    return finite(value.amount) && typeof value.reason === 'string' && nullableString(value.supplierId) && typeof value.penaltyDate === 'string' && (value.penaltyDate === '' || isISODateDTO(value.penaltyDate)) && typeof value.rectificationNote === 'string' && typeof value.deadline === 'string' && value.lines.length === 0
  if (kind === 'owner_penalty') {
    return typeof value.name === 'string' && typeof value.noticeNo === 'string'
      && finite(value.amount) && typeof value.penaltyDate === 'string'
      && (value.penaltyDate === '' || isISODateDTO(value.penaltyDate))
      && typeof value.reason === 'string' && typeof value.appealNote === 'string'
      && value.lines.length === 0
  }
  if (kind === 'sub_settlement')
    return typeof value.name === 'string' && nullableString(value.supplierId) && typeof value.settlementType === 'string' && typeof value.settlementDate === 'string' && (value.settlementDate === '' || isISODateDTO(value.settlementDate)) && finite(value.totalAmount) && typeof value.deductionNote === 'string' && value.lines.length === 0
  if (kind === 'sub_change') {
    return nullableString(value.supplierId) && typeof value.changeType === 'string'
      && typeof value.changeDate === 'string' && (value.changeDate === '' || isISODateDTO(value.changeDate))
      && finite(value.approvedAmount)
      && (value.changedArea === null || finite(value.changedArea))
      && (value.actualApprovedPrice === null || finite(value.actualApprovedPrice))
      && typeof value.reason === 'string' && value.lines.length === 0
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
  expectedKind: 'owner_change' | 'owner_report' | 'acceptance' | 'final_settlement' | 'owner_penalty' | 'sub_change' | 'sub_settlement' | 'project_penalty',
  expectedId: string,
): OwnerCommercialDocumentFormReadDTO {
  const expectedOwnerType = expectedKind === 'project_penalty'
    ? 'penalty_record'
    : expectedKind === 'owner_change'
      ? 'owner_change_order'
      : expectedKind === 'owner_report'
        ? 'monthly_statement'
        : expectedKind === 'final_settlement'
          ? 'owner_final_settlement'
          : expectedKind === 'owner_penalty'
            ? 'owner_penalty'
            : expectedKind === 'sub_change'
              ? 'subcontract_change_order'
              : expectedKind === 'sub_settlement'
                ? 'expenditure_settlement'
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
      () => options.fetcher(`/api/read/owner-documents/${encodeURIComponent(query.kind)}`, { query: { ...query, status: serializeEnumSelection(query.status) || null, documentType: serializeEnumSelection(query.documentType) || null } }),
      value => decodeList(value, query),
    ),
    get: query => read(
      () => options.fetcher(`/api/read/owner-documents/${encodeURIComponent(query.kind)}/${encodeURIComponent(query.id)}`, { query: { ...query } }),
      value => decodeDetail(value, query),
    ),
  }
}

export function createHttpOwnerCommercialDocumentCommandRepository(
  options: { fetcher: OwnerCommercialDocumentHttpFetcher },
): OwnerCommercialDocumentCommandRepository {
  return {
    context: kind => read(
      () => options.fetcher('/api/commands/owner-documents/context', { query: kind ? { kind } : {} }),
      decodeContext,
    ),
    loadForm: (kind, id) => read(
      () => options.fetcher(`/api/commands/owner-documents/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/form`),
      value => decodeForm(value, kind, id),
    ),
    boqLines: (projectId, contractId, periodNo = '', quantityBasis) => read(
      () => options.fetcher('/api/commands/owner-documents/boq-lines', { query: { projectId, contractId, periodNo, ...(quantityBasis ? { quantityBasis } : {}) } }),
      decodeBoqLines,
    ),
    execute: (request: OwnerCommercialDocumentCommandRequestDTO) => read(
      () => options.fetcher('/api/commands/owner-documents', { method: 'POST', body: request }),
      decodeResult,
    ),
  }
}
