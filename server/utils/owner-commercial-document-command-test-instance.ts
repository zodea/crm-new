import type { BoqChangeOperation } from '../../app/lib/boq/read-model'
import type { FileRefChanges, FileRefRecord } from '../../app/lib/forms/file-refs'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type {
  OwnerCommercialDocumentCommandContextDTO,
  OwnerCommercialDocumentCommandRequestDTO,
  OwnerCommercialDocumentCommandResultDTO,
  OwnerCommercialDocumentFormReadDTO,
} from '../../app/lib/owner-document/central-command-contract'
import type {
  OwnerCommercialDocumentKind,
  OwnerCommercialDocumentLineSource,
  OwnerCommercialDocumentSource,
} from '../../app/lib/owner-document/central-repository'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
} from '../../app/lib/owner-document/forms'
import type { PenaltyDeductionSource, PenaltyRectificationEvent } from '../../app/lib/owner-document/project-penalty'
import type { QuantityBasis } from '../../app/lib/quantity/basis'
import type { QuantityBoqLine, QuantityBoqWorkspace } from '../../app/lib/quantity/central-boq'
import type { QuantityMonthlyBoqFact } from '../../app/lib/quantity/central-monthly'
import type { ReceiptRecord } from '../../app/lib/receipt/contract'
import type { SubcontractContractDetailSource } from '../../app/lib/subcontract-contract/repository'
import type { ProblemDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { calculateBoqChangeLine } from '../../app/lib/boq/change-calculation'
import {
  OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
  SUBCONTRACT_CHANGE_WRITE_CAPABILITY,
} from '../../app/lib/owner-document/central-command-contract'
import {
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
  ownerFinalSettlementReceiptIsActive,
  ownerFinalSettlementSupplementIsActive,
} from '../../app/lib/owner-document/central-repository'
import { matchesPenaltySettlement } from '../../app/lib/owner-document/project-penalty'
import { isQuantityBasis } from '../../app/lib/quantity/basis'
import { ReceiptRepositoryProblem } from '../../app/lib/receipt/contract'
import { isISODateDTO, isISODateTimeDTO } from '../../app/types/read-model'
import { constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { crewWorkerCommandTestInstance } from './crew-worker-command-test-instance'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { receiptReadTestInstance } from './receipt-read-test-instance'
import { subcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'

interface ProjectSeed {
  id: string
  name: string
  customerId: string | null
}

interface CustomerSeed {
  id: string
  name: string
}

interface SupplierSeed {
  id: string
  name: string
}

interface ContractSeed {
  id: string
  no: string
  name: string
  projectId: string
  customerId: string | null
  amount?: number | null
}

interface SubcontractSeed {
  id: string
  no: string
  name: string
  projectId: string
  supplierId: string
  amount?: number | null
}

interface BoqLineSeed extends OwnerDocumentBoqLine {
  projectId: string
  contractId: string
}

interface MonthlyQuantityFactSeed {
  projectId: string
  contractId: string
  periodNo: string
  boqLineId: string
  autoQty: number
  missingQtyCount: number
  quantityBasis: string
  sourceVersion: string
  sourceUpdatedAt: string | null
}

interface FinalSettlementSupplementSeed {
  contractId: string
  id: string
  no: string
  name: string
  status: string
  amount: number
  date: string | null
}

interface FinalSettlementReceiptSeed {
  contractId: string
  projectId: string
  customerId: string
  id: string
  no: string
  name: string
  status: string
  amount: number
  date: string | null
}

export interface OwnerCommercialDocumentCommandTestInstanceOptions {
  now?: () => string
  createId?: (kind: OwnerCommercialDocumentKind) => string
  createBoqLineId?: (changeId: string, changeLineId: string) => string
  createAttachmentId?: () => string
  crews?: readonly SupplierSeed[]
  crewSource?: Pick<typeof crewWorkerCommandTestInstance, 'crewRows'>
  projects?: readonly ProjectSeed[]
  projectSource?: Pick<typeof projectCommandTestInstance, 'rows'>
  customers?: readonly CustomerSeed[]
  customerSource?: Pick<typeof customerCommandTestInstance, 'rows'>
  suppliers?: readonly SupplierSeed[]
  contracts?: readonly ContractSeed[]
  constructionContractSource?: Pick<typeof constructionContractCommandTestInstance, 'rows' | 'facts'>
  subcontractContracts?: readonly SubcontractSeed[]
  subcontractContractSource?: Pick<typeof subcontractContractCommandTestInstance, 'rows'>
  boqLines?: readonly BoqLineSeed[]
  monthlyQuantityFacts?: readonly MonthlyQuantityFactSeed[]
  withMonthlyQuantity?: <T>(projectId: string, sessionId: string | null | undefined, consume: (facts: readonly QuantityMonthlyBoqFact[]) => T, basis: QuantityBasis) => Promise<T>
  finalSettlementSupplements?: readonly FinalSettlementSupplementSeed[]
  finalSettlementReceipts?: readonly FinalSettlementReceiptSeed[]
  receiptSource?: typeof receiptReadTestInstance.facts
  documents?: readonly OwnerCommercialDocumentSource[]
}

interface WorkspaceState {
  linkedCrewIds: Set<string>
  crews: Map<string, SupplierSeed>
  penaltyDeductions: Map<string, PenaltyDeductionSource>
  penaltyRectifications: Map<string, PenaltyRectificationEvent & { penaltyId: string }>
  sessionId?: string | null
  documents: Map<string, OwnerCommercialDocumentSource>
  commands: Map<string, OwnerCommercialDocumentCommandResultDTO>
  migrationKeys: Set<string>
  projects: Map<string, ProjectSeed>
  customers: Map<string, CustomerSeed>
  suppliers: Map<string, SupplierSeed>
  contracts: Map<string, ContractSeed>
  subcontractContracts: Map<string, SubcontractSeed>
  boqLines: Map<string, BoqLineSeed>
  monthlyQuantityFacts: MonthlyQuantityFactSeed[]
  finalSettlementSupplements: Map<string, FinalSettlementSupplementSeed>
  finalSettlementReceipts: Map<string, FinalSettlementReceiptSeed>
  finalSettlementSupplementsKnownContractIds: Set<string>
  finalSettlementReceiptsKnownContractIds: Set<string>
  sourceVersion: number
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function key(kind: OwnerCommercialDocumentKind, id: string): string {
  return `${kind}\u001F${id}`
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function failure(
  code: 'forbidden' | 'not-found' | 'relationship-mismatch' | 'validation-failed' | 'conflict',
  message: string,
): OwnerCommercialDocumentRepositoryProblem {
  return new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem(code, message))
}

function required(value: unknown, label: string): string {
  const normalized = text(value)
  if (!normalized)
    throw failure('validation-failed', `${label}必填`)
  return normalized
}

function isIsoDate(value: string): boolean {
  return isISODateDTO(value)
}

function isPeriod(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)
}

function approvalSequence(source: OwnerCommercialDocumentSource): string {
  return source.approvalSequenceAt ?? source.updatedAt
}

function approvalBusinessDate(source: OwnerCommercialDocumentSource): string {
  return source.approvalDate ?? approvalSequence(source).slice(0, 10)
}

function fileOwnerType(kind: OwnerCommercialDocumentKind): string {
  if (kind === 'project_penalty')
    return 'penalty_record'
  if (kind === 'sub_settlement')
    return 'expenditure_settlement'
  if (kind === 'sub_change')
    return 'subcontract_change_order'
  if (kind === 'owner_change')
    return 'owner_change_order'
  if (kind === 'owner_report')
    return 'monthly_statement'
  if (kind === 'final_settlement')
    return 'owner_final_settlement'
  return kind === 'owner_penalty' ? 'owner_penalty' : 'project_acceptance'
}

function formDraft(source: OwnerCommercialDocumentSource): OwnerDocumentDraft & { id: string } {
  if (source.kind === 'project_penalty') {
    return { id: source.id, no: source.no, name: source.name, reason: source.name, projectId: source.projectId, supplierId: source.supplierId ?? null, contractId: source.contractId, crewId: source.crewId ?? null, amount: source.amount, penaltyDate: source.applicationDate ?? '', status: source.status, statusNote: source.statusNote, sourceType: source.sourceType, sourceId: source.sourceId, sourceLocked: source.sourceLocked, lines: [], note: source.note, deadline: source.penaltyFacts?.deadline ?? '', rectificationNote: source.penaltyFacts?.rectificationNote ?? '', deductionMethod: source.penaltyFacts?.deductionMethod ?? '' }
  }
  if (source.kind === 'sub_settlement') {
    return { id: source.id, no: source.no, name: source.name, projectId: source.projectId, supplierId: source.supplierId ?? null, contractId: source.contractId, settlementType: source.documentType, settlementDate: source.applicationDate ?? '', sourceType: source.sourceType, sourceId: source.sourceId, sourceLocked: source.sourceLocked, statusNote: source.statusNote, lines: [], totalAmount: source.amount, deductionNote: source.deductionNote ?? '', note: source.note, status: source.status }
  }
  if (source.kind === 'sub_change') {
    return {
      id: source.id,
      no: source.no,
      projectId: source.projectId,
      supplierId: source.supplierId ?? null,
      contractId: source.contractId,
      changeType: source.documentType,
      changeDate: source.applicationDate ?? '',
      approvedAmount: source.amount,
      changedArea: source.changedArea ?? null,
      actualApprovedPrice: source.actualApprovedPrice ?? null,
      reason: source.name,
      status: source.status,
      statusNote: source.statusNote,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLocked: source.sourceLocked,
      note: source.note,
      lines: [],
    }
  }
  if (source.kind === 'owner_change') {
    return {
      id: source.id,
      no: source.no,
      name: source.name,
      projectId: source.projectId,
      contractId: source.contractId,
      documentType: source.documentType,
      applicationDate: source.applicationDate ?? '',
      status: source.status,
      statusNote: source.statusNote,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLocked: source.sourceLocked,
      approvalDate: source.approvalDate ?? null,
      approvedTaxInclusiveAmount: source.amount,
      approvedTaxExclusiveAmount: source.taxExclusiveAmount ?? 0,
      appliedTaxExclusiveAmount: source.appliedTaxExclusiveAmount ?? 0,
      totalAmount: source.boqAmount ?? round(source.lines.reduce((sum, line) => sum + line.amount, 0)),
      reason: source.note,
      note: source.note,
      lines: source.lines.map(line => ({
        id: line.id,
        operation: line.operation,
        boqLineId: line.boqLineId,
        itemName: line.itemName,
        unit: line.unit,
        contractQty: line.contractQty,
        contractUnitPrice: line.contractUnitPrice,
        qty: line.contractQty,
        unitPrice: line.contractUnitPrice,
        deltaQty: line.deltaQty,
        newUnitPrice: line.newUnitPrice,
        amount: line.amount,
        note: line.note,
      })),
    }
  }
  if (source.kind === 'acceptance') {
    const lifecycle = source.acceptanceLifecycle
    return {
      id: source.id,
      no: source.no,
      name: source.name,
      projectId: source.projectId,
      contractId: source.contractId,
      applicationDate: source.applicationDate ?? '',
      contractEstimate: source.amount,
      acceptanceOrganization: lifecycle?.acceptanceOrganization ?? '',
      acceptancePerson: lifecycle?.acceptancePerson ?? '',
      acceptanceDate: lifecycle?.acceptanceDate ?? null,
      acceptanceConclusion: lifecycle?.acceptanceConclusion ?? '',
      warrantyOwner: lifecycle?.warrantyOwner ?? '',
      warrantyStartDate: lifecycle?.warrantyStartDate ?? null,
      warrantyEndDate: lifecycle?.warrantyEndDate ?? null,
      warrantyConfirmationOrganization: lifecycle?.warrantyConfirmationOrganization ?? null,
      warrantyConfirmationDate: lifecycle?.warrantyConfirmationDate ?? null,
      warrantyConfirmationNote: lifecycle?.warrantyConfirmationNote ?? '',
      lifecycleEvents: lifecycle?.events.map(clone) ?? [],
      status: source.status,
      statusNote: source.statusNote,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLocked: source.sourceLocked,
      note: source.note,
      lines: [],
    }
  }
  if (source.kind === 'final_settlement') {
    const amounts = source.finalSettlementEvidence
    const activeSupplements = amounts?.supplements?.filter(item => ownerFinalSettlementSupplementIsActive(item.status)) ?? null
    const activeReceipts = amounts?.receipts?.filter(item => ownerFinalSettlementReceiptIsActive(item.status)) ?? null
    const changedContractAmount = amounts?.originalContractAmount == null || activeSupplements == null
      ? null
      : round(amounts.originalContractAmount + activeSupplements.reduce((sum, item) => sum + item.amount, 0))
    const receivedAmount = activeReceipts == null
      ? null
      : round(activeReceipts.reduce((sum, item) => sum + item.amount, 0))
    return {
      id: source.id,
      no: source.no,
      name: source.name,
      projectId: source.projectId,
      contractId: source.contractId,
      settlementAmount: source.amount,
      auditedAmount: source.auditedAmount,
      submissionDate: source.applicationDate ?? '',
      changedContractAmount,
      receivedAmount,
      settlementReceiptGap: receivedAmount == null ? null : round(source.amount - receivedAmount),
      basis: source.settlementBasis ?? '',
      differenceNote: source.settlementDifferenceNote ?? '',
      status: source.status,
      statusNote: source.statusNote,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLocked: source.sourceLocked,
      note: source.note,
      lines: [],
    }
  }
  if (source.kind === 'owner_penalty') {
    return {
      id: source.id,
      no: source.no,
      name: source.name,
      projectId: source.projectId,
      contractId: source.contractId,
      noticeNo: source.noticeNo ?? '',
      amount: source.amount,
      penaltyDate: source.applicationDate ?? '',
      reason: source.penaltyReason ?? source.name,
      appealNote: source.appealNote ?? '',
      status: source.status,
      statusNote: source.statusNote,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLocked: source.sourceLocked,
      note: source.note,
      lines: [],
    }
  }
  return {
    id: source.id,
    no: source.no,
    projectId: source.projectId,
    contractId: source.contractId,
    periodNo: source.periodNo,
    applicationDate: source.applicationDate ?? '',
    operatorName: source.operatorName ?? '',
    quantityBasis: source.quantityBasis ?? null,
    quantitySourceVersion: source.quantitySourceVersion ?? null,
    quantitySourceUpdatedAt: source.quantitySourceUpdatedAt ?? null,
    submittedAt: source.submittedAt ?? null,
    status: source.status,
    statusNote: source.statusNote,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceLocked: source.sourceLocked,
    reportedAmount: source.amount,
    auditedAmount: source.auditedAmount,
    auditDifference: source.auditedAmount == null ? null : round(source.auditedAmount - source.amount),
    note: source.note,
    lines: source.lines.map(line => ({
      id: line.id,
      boqLineId: line.boqLineId,
      itemName: line.itemName,
      unit: line.unit,
      autoQty: line.autoQty,
      reportedQty: line.reportedQty,
      auditedQty: line.auditedQty,
      unitPrice: line.contractUnitPrice,
      amount: line.amount,
      auditedAmount: line.auditedAmount,
      note: line.note,
    })),
  }
}

function fileRecord(
  kind: OwnerCommercialDocumentKind,
  ownerId: string,
  source: OwnerCommercialDocumentSource['files'][number],
): FileRefRecord {
  return {
    id: source.id,
    ownerType: fileOwnerType(kind),
    ownerId,
    fileName: source.fileName,
    filePath: '',
    fileSize: source.fileSize,
    mimeType: source.mimeType,
    category: source.category,
    uploader: source.uploader,
    uploadedAt: source.uploadedAt ?? '',
    deletedAt: source.deletedAt,
  }
}

function defaultId(kind: OwnerCommercialDocumentKind): string {
  return `${kind}-${crypto.randomUUID()}`
}

function entityAttribute(entity: CoreMigrationServerEntityDTO, name: string): string {
  const value = entity.attributes[name]
  return value == null ? '' : String(value)
}

function entityNumberAttribute(entity: CoreMigrationServerEntityDTO, name: string): number | null {
  const value = entity.attributes[name]
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function jsonRecords(value: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
      : []
  }
  catch {
    throw failure('validation-failed', '甲方商务单据迁移明细 JSON 无效')
  }
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    throw failure('validation-failed', '甲方商务单据迁移生命周期 JSON 无效')
  }
}

export function createOwnerCommercialDocumentCommandTestInstance(
  options: OwnerCommercialDocumentCommandTestInstanceOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? defaultId
  const createBoqLineId = options.createBoqLineId ?? (() => `boq-line-${crypto.randomUUID()}`)
  const createAttachmentId = options.createAttachmentId ?? (() => `owner-file-${crypto.randomUUID()}`)
  const baseProjects = (options.projects ?? []).map(clone)
  const baseCustomers = (options.customers ?? []).map(clone)
  const baseSuppliers = (options.suppliers ?? []).map(clone)
  const baseContracts = (options.contracts ?? []).map(clone)
  const baseSubcontractContracts = (options.subcontractContracts ?? []).map(clone)
  const linkedSubcontractContractSource = options.subcontractContractSource
  const baseBoqLines = (options.boqLines ?? []).map(clone)
  const baseMonthlyQuantityFacts = (options.monthlyQuantityFacts ?? []).map(clone)
  const baseDocuments = (options.documents ?? []).map(clone)
  const embeddedFinalSettlements = baseDocuments.filter(row => row.kind === 'final_settlement')
  const baseFinalSettlementSupplements = options.finalSettlementSupplements !== undefined
    ? options.finalSettlementSupplements.map(clone)
    : embeddedFinalSettlements.flatMap(row => (row.finalSettlementEvidence?.supplements ?? []).map(source => ({
        contractId: row.contractId ?? '',
        ...clone(source),
      }))).filter(source => Boolean(source.contractId))
  const baseFinalSettlementReceipts = options.finalSettlementReceipts !== undefined
    ? options.finalSettlementReceipts.map(clone)
    : embeddedFinalSettlements.flatMap(row => (row.finalSettlementEvidence?.receipts ?? []).map(source => ({
        contractId: row.contractId ?? '',
        projectId: row.projectId ?? '',
        customerId: row.customerId ?? '',
        ...clone(source),
      }))).filter(source => Boolean(source.contractId && source.projectId && source.customerId))
  const projectIds = new Set(baseProjects.map(row => row.id))
  const customerIds = new Set(baseCustomers.map(row => row.id))
  const contractIds = new Set(baseContracts.map(row => row.id))
  for (const row of baseDocuments) {
    if (row.projectId && !projectIds.has(row.projectId)) {
      const project = {
        id: row.projectId,
        name: row.projectName,
        customerId: row.customerId,
      }
      baseProjects.push(clone(project))
      projectIds.add(row.projectId)
    }
    if (row.customerId && !customerIds.has(row.customerId)) {
      const customer = { id: row.customerId, name: row.customerName }
      baseCustomers.push(clone(customer))
      customerIds.add(row.customerId)
    }
    if (row.kind === 'final_settlement' && row.contractId && row.projectId && !contractIds.has(row.contractId)) {
      const contract = {
        id: row.contractId,
        no: row.contractNo,
        name: row.contractName,
        projectId: row.projectId,
        customerId: row.customerId,
        amount: row.finalSettlementEvidence?.originalContractAmount ?? null,
      }
      baseContracts.push(clone(contract))
      contractIds.add(row.contractId)
    }
  }
  const baseFinalSettlementSupplementsKnownContractIds = options.finalSettlementSupplements !== undefined
    ? new Set(baseContracts.map(row => row.id))
    : new Set(embeddedFinalSettlements
        .filter(row => row.contractId && row.finalSettlementEvidence?.supplements != null)
        .map(row => row.contractId!))
  const baseFinalSettlementReceiptsKnownContractIds = options.finalSettlementReceipts !== undefined
    ? new Set(baseContracts.map(row => row.id))
    : new Set(embeddedFinalSettlements
        .filter(row => row.contractId && row.finalSettlementEvidence?.receipts != null)
        .map(row => row.contractId!))
  const workspaces = new Map<string, WorkspaceState>()

  function freshState(): WorkspaceState {
    return {
      linkedCrewIds: new Set(),
      crews: new Map((options.crews ?? []).map(row => [row.id, clone(row)])),
      penaltyDeductions: new Map(),
      penaltyRectifications: new Map(),
      documents: new Map(baseDocuments.map(row => [key(row.kind, row.id), clone(row)])),
      commands: new Map(),
      migrationKeys: new Set(),
      projects: new Map(baseProjects.map(row => [row.id, clone(row)])),
      customers: new Map(baseCustomers.map(row => [row.id, clone(row)])),
      suppliers: new Map(baseSuppliers.map(row => [row.id, clone(row)])),
      contracts: new Map(baseContracts.map(row => [row.id, clone(row)])),
      subcontractContracts: new Map(baseSubcontractContracts.map(row => [row.id, clone(row)])),
      boqLines: new Map(baseBoqLines.map(row => [row.id, clone(row)])),
      monthlyQuantityFacts: baseMonthlyQuantityFacts.map(clone),
      finalSettlementSupplements: new Map(baseFinalSettlementSupplements.map(row => [row.id, clone(row)])),
      finalSettlementReceipts: new Map(baseFinalSettlementReceipts.map(row => [row.id, clone(row)])),
      finalSettlementSupplementsKnownContractIds: new Set(baseFinalSettlementSupplementsKnownContractIds),
      finalSettlementReceiptsKnownContractIds: new Set(baseFinalSettlementReceiptsKnownContractIds),
      sourceVersion: 1,
    }
  }

  function workspaceKey(sessionId?: string | null): string {
    return sessionId || 'default'
  }

  function stateFor(sessionId?: string | null): WorkspaceState {
    const key = workspaceKey(sessionId)
    let state = workspaces.get(key)
    if (!state) {
      state = freshState()
      workspaces.set(key, state)
    }
    if (options.crewSource) {
      for (const id of state.linkedCrewIds) state.crews.delete(id)
      state.linkedCrewIds.clear()
      for (const crew of options.crewSource.crewRows(sessionId)) {
        state.crews.set(crew.id, { id: crew.id, name: crew.name })
        state.linkedCrewIds.add(crew.id)
      }
    }
    state.sessionId = sessionId
    return state
  }

  function linkedSubcontractRows(state: WorkspaceState): SubcontractContractDetailSource[] {
    return linkedSubcontractContractSource?.rows(state.sessionId).map(clone) ?? []
  }

  function effectiveSubcontractContracts(state: WorkspaceState): Map<string, SubcontractSeed> {
    return new Map([
      ...linkedSubcontractRows(state).map(row => [row.id, {
        id: row.id,
        no: row.no,
        name: row.name,
        projectId: row.projectId ?? '',
        supplierId: row.supplierId ?? '',
        amount: row.amount,
      }] as const),
      ...state.subcontractContracts.entries(),
    ])
  }

  function effectiveProjects(state: WorkspaceState): Map<string, ProjectSeed> {
    if (options.projectSource)
      return new Map(options.projectSource.rows(state.sessionId).map(row => [row.id, { id: row.id, name: row.name, customerId: row.customerId }]))
    return new Map([
      ...linkedSubcontractRows(state)
        .filter(row => row.projectId)
        .map(row => [row.projectId!, { id: row.projectId!, name: row.projectName, customerId: null }] as const),
      ...state.projects.entries(),
    ])
  }

  function effectiveCustomers(state: WorkspaceState): Map<string, CustomerSeed> {
    return options.customerSource
      ? new Map(options.customerSource.rows(state.sessionId).map(row => [row.id, { id: row.id, name: row.name }]))
      : state.customers
  }

  function effectiveConstructionContracts(state: WorkspaceState): Map<string, ContractSeed> {
    return options.constructionContractSource
      ? new Map(options.constructionContractSource.rows(state.sessionId).map(row => [row.id, { id: row.id, no: row.no, name: row.name, projectId: row.projectId ?? '', customerId: row.customerId, amount: row.amount }]))
      : state.contracts
  }

  function finalSettlementSupplements(state: WorkspaceState, contractId: string) {
    const known = options.constructionContractSource !== undefined || state.finalSettlementSupplementsKnownContractIds.has(contractId)
    if (!known)
      return null
    const sources = new Map([...state.finalSettlementSupplements.values()].filter(row => row.contractId === contractId).map(row => [row.id, row]))
    for (const row of options.constructionContractSource?.facts(state.sessionId).supplements ?? []) {
      if (row.dataOrigin !== 'real' || row.contractId !== contractId)
        continue
      if (row.amount === null)
        return null
      sources.set(row.id, { contractId, id: row.id, no: row.no, name: row.name, status: row.status, amount: row.amount, date: row.date })
    }
    return [...sources.values()].map(({ contractId: _contractId, ...row }) => clone(row))
  }

  function effectiveSuppliers(state: WorkspaceState): Map<string, SupplierSeed> {
    return new Map([
      ...linkedSubcontractRows(state)
        .filter(row => row.supplierId)
        .map(row => [row.supplierId!, { id: row.supplierId!, name: row.supplierName }] as const),
      ...state.suppliers.entries(),
    ])
  }

  function currentReceiptFacts(state: WorkspaceState): { rows: ReceiptRecord[] | null, sourceVersion: string, problem?: ProblemDTO } | undefined {
    if (!options.receiptSource)
      return undefined
    try {
      const source = options.receiptSource(state.sessionId)
      if (source.rows.some(row => ownerFinalSettlementReceiptIsActive(row.draft.status) && row.draft.amount === null))
        throw new ReceiptRepositoryProblem({ code: 'unavailable', message: '有效收款金额尚未记录，当前无法计算', retryable: false, fieldErrors: {}, traceId: null })
      if (!['project:list:read', 'customer:list:read', 'construction-contract:read'].every(capability => source.capabilities.includes(capability)))
        throw new ReceiptRepositoryProblem({ code: 'forbidden', message: '无权读取收款与结算的关联', retryable: false, fieldErrors: {}, traceId: null })
      return source
    }
    catch (cause) {
      if (!(cause instanceof ReceiptRepositoryProblem) || !['forbidden', 'unavailable'].includes(cause.problem.code))
        throw cause
      return { rows: null, sourceVersion: `receipt-${cause.problem.code}`, problem: cause.problem }
    }
  }

  function finalSettlementEvidenceForContract(state: WorkspaceState, contractId: string | null) {
    const contract = contractId ? effectiveConstructionContracts(state).get(contractId) ?? null : null
    if (!contract)
      return undefined
    const project = effectiveProjects(state).get(contract.projectId) ?? null
    const customerId = contract.customerId ?? project?.customerId ?? null
    const receiptSource = currentReceiptFacts(state)
    return {
      ...(receiptSource?.problem ? { receiptsProblem: receiptSource.problem } : {}),
      originalContractAmount: contract.amount ?? null,
      supplements: finalSettlementSupplements(state, contract.id),
      receipts: receiptSource
        ? receiptSource.rows === null
          ? null
          : receiptSource.rows
              .filter(row => row.dataOrigin === 'real' && row.draft.contractId === contract.id && row.draft.projectId === contract.projectId && row.draft.customerId === customerId && ownerFinalSettlementReceiptIsActive(row.draft.status))
              .map(({ id, draft }) => ({ id, no: draft.no, name: draft.no || '收款登记', status: draft.status, amount: Number(draft.amount), date: draft.receiptDate || null }))
        : state.finalSettlementReceiptsKnownContractIds.has(contract.id)
          ? [...state.finalSettlementReceipts.values()]
              .filter(source => source.contractId === contract.id
                && source.projectId === contract.projectId
                && source.customerId === customerId)
              .map(({ contractId: _contractId, projectId: _projectId, customerId: _customerId, ...source }) => clone(source))
          : null,
    }
  }

  function withFinalSettlementEvidence(
    state: WorkspaceState,
    source: OwnerCommercialDocumentSource,
  ): OwnerCommercialDocumentSource {
    const hydrated = clone(source)
    if (hydrated.kind === 'project_penalty') {
      hydrated.penaltyDeductions = [...state.penaltyDeductions.values()].filter(row => row.penaltyId === source.id).map(clone)
      hydrated.penaltyRectifications = [...state.penaltyRectifications.values()].filter(row => row.penaltyId === source.id).map(clone)
    }
    if (hydrated.kind === 'sub_settlement') {
      hydrated.subcontractSettlementEvidence = {
        contractAmount: effectiveSubcontractContracts(state).get(hydrated.contractId ?? '')?.amount ?? null,
        settlements: [...state.documents.values()].filter(row => row.kind === 'sub_settlement').map(row => ({ id: row.id, projectId: row.projectId, supplierId: row.supplierId, contractId: row.contractId, amount: row.amount, status: row.status })),
        deductions: [...state.penaltyDeductions.values()].map(row => ({ ...row, active: true })),
        applications: null,
      }
    }
    if (hydrated.kind === 'final_settlement')
      hydrated.finalSettlementEvidence = finalSettlementEvidenceForContract(state, hydrated.contractId)
    return hydrated
  }

  function contractSummary(state: WorkspaceState, contract: ContractSeed) {
    const evidence = finalSettlementEvidenceForContract(state, contract.id)
    const activeSupplements = evidence?.supplements?.filter(source => ownerFinalSettlementSupplementIsActive(source.status)) ?? null
    const activeReceipts = evidence?.receipts?.filter(source => ownerFinalSettlementReceiptIsActive(source.status)) ?? null
    return {
      changedContractAmount: evidence?.originalContractAmount == null || activeSupplements == null
        ? null
        : round(evidence.originalContractAmount + activeSupplements.reduce((sum, source) => sum + source.amount, 0)),
      receivedAmount: activeReceipts == null
        ? null
        : round(activeReceipts.reduce((sum, source) => sum + source.amount, 0)),
    }
  }

  function writeCapability(kind: OwnerCommercialDocumentKind) {
    return (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty')
      ? SUBCONTRACT_CHANGE_WRITE_CAPABILITY
      : OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY
  }

  function authorize(session: BusinessSession, kind?: OwnerCommercialDocumentKind): void {
    const allowed = kind
      ? session.capabilities.includes(writeCapability(kind))
      : session.capabilities.includes(OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY)
        || session.capabilities.includes(SUBCONTRACT_CHANGE_WRITE_CAPABILITY)
    if (!allowed)
      throw failure('forbidden', kind === 'sub_change' ? '无分包变洽签写入权限' : '无甲方商务单据写入权限')
  }

  function authorizeCommand(request: OwnerCommercialDocumentCommandRequestDTO, session: BusinessSession): void {
    const requiredCapability = writeCapability(request.kind)
    authorize(session, request.kind)
    if (request.workspaceId !== session.workspaceId
      || request.actorId !== session.actorId
      || request.requiredCapability !== requiredCapability) {
      throw failure('forbidden', request.kind === 'sub_change' ? '无分包变洽签写入权限' : '无甲方商务单据写入权限')
    }
  }

  function document(
    state: WorkspaceState,
    kind: OwnerCommercialDocumentKind,
    id: string | null,
  ): OwnerCommercialDocumentSource | null {
    return id ? state.documents.get(key(kind, id)) ?? null : null
  }

  function assertVersion(
    current: OwnerCommercialDocumentSource | null,
    baseVersion: string | null,
  ): void {
    if (!current && baseVersion !== null)
      throw failure('validation-failed', '新建甲方商务单据不能带 baseVersion')
    if (current && baseVersion !== String(current.version))
      throw failure('conflict', '甲方商务单据已被其他操作更新，请先处理最新版本')
  }

  function relations(
    state: WorkspaceState,
    kind: OwnerCommercialDocumentKind,
    draft: OwnerDocumentDraft,
    complete: boolean,
  ) {
    const projectId = complete ? required(draft.projectId, '项目') : text(draft.projectId)
    if (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty') {
      const supplierId = complete && kind !== 'project_penalty' ? required(draft.supplierId, '分供方') : text(draft.supplierId)
      const contractId = complete && kind !== 'project_penalty' ? required(draft.contractId, '分包合同') : text(draft.contractId)
      if (contractId && (!projectId || !supplierId))
        throw failure('relationship-mismatch', '选择分包合同前必须先选择项目与分供方')
      const project = projectId ? effectiveProjects(state).get(projectId) ?? null : null
      const supplier = supplierId ? effectiveSuppliers(state).get(supplierId) ?? null : null
      const subcontract = contractId ? effectiveSubcontractContracts(state).get(contractId) ?? null : null
      if (projectId && !project)
        throw failure('relationship-mismatch', '项目不存在或已删除')
      if (supplierId && !supplier)
        throw failure('relationship-mismatch', '分供方不存在或已删除')
      if (contractId && (!subcontract || subcontract.projectId !== projectId || subcontract.supplierId !== supplierId))
        throw failure('relationship-mismatch', '分包合同不存在、已删除或不属于所选项目与分供方')
      return {
        project,
        contract: null,
        subcontract,
        customerId: null,
        customer: null,
        supplierId,
        supplier,
      }
    }
    const contractId = complete ? required(draft.contractId, '施工合同') : text(draft.contractId)
    if (contractId && !projectId)
      throw failure('relationship-mismatch', '选择施工合同前必须先选择项目')
    const project = projectId ? effectiveProjects(state).get(projectId) ?? null : null
    const contract = contractId ? effectiveConstructionContracts(state).get(contractId) ?? null : null
    if (projectId && !project)
      throw failure('relationship-mismatch', '项目不存在或已删除')
    if (contractId && (!contract || contract.projectId !== projectId))
      throw failure('relationship-mismatch', '施工合同不存在、已删除或不属于所选项目')
    const customerId = contract?.customerId ?? project?.customerId ?? null
    const customer = customerId ? effectiveCustomers(state).get(customerId) ?? null : null
    return { project, contract, subcontract: null, customerId, customer, supplierId: null, supplier: null }
  }

  function lineFor(
    state: WorkspaceState,
    draft: OwnerDocumentDraft,
    raw: Record<string, unknown>,
  ): BoqLineSeed {
    const id = required(raw.boqLineId, 'BOQ 行')
    const line = state.boqLines.get(id)
    if (!line || line.projectId !== text(draft.projectId) || line.contractId !== text(draft.contractId))
      throw failure('relationship-mismatch', 'BOQ 行不存在或不属于所选施工合同')
    return line
  }

  function effectiveBoqState(state: WorkspaceState, draft: OwnerDocumentDraft) {
    const effective = new Map(
      [...state.boqLines.values()]
        .filter(line => line.projectId === text(draft.projectId) && line.contractId === text(draft.contractId))
        .map(line => [line.id, { effectiveQty: line.qty, effectiveUnitPrice: line.unitPrice, approvedDeltaQty: 0, updatedAt: line.updatedAt ?? null }]),
    )
    const approvedChanges = [...state.documents.values()]
      .filter(source => source.kind === 'owner_change' && source.status === 'approved'
        && source.projectId === text(draft.projectId) && source.contractId === text(draft.contractId))
      .sort((left, right) => approvalBusinessDate(left).localeCompare(approvalBusinessDate(right))
        || approvalSequence(left).localeCompare(approvalSequence(right))
        || left.id.localeCompare(right.id))
    for (const source of approvedChanges) {
      for (const line of source.lines) {
        if (!line.boqLineId)
          continue
        const target = effective.get(line.boqLineId)
        if (!target)
          continue
        if (line.operation === 'qty') {
          target.approvedDeltaQty += line.deltaQty ?? 0
          if (target.effectiveQty !== null)
            target.effectiveQty += line.deltaQty ?? 0
        }
        if (line.operation === 'price' && line.newUnitPrice != null)
          target.effectiveUnitPrice = line.newUnitPrice
        if (!target.updatedAt || source.updatedAt > target.updatedAt)
          target.updatedAt = source.updatedAt
      }
    }
    return effective
  }

  function changeLines(draft: OwnerDocumentDraft, state: WorkspaceState): OwnerCommercialDocumentLineSource[] {
    const effective = effectiveBoqState(state, draft)
    return (draft.lines ?? []).map((raw, index) => {
      const operation = text(raw.operation) as OwnerCommercialDocumentLineSource['operation']
      if (!['add', 'qty', 'price'].includes(operation ?? ''))
        throw failure('validation-failed', '变更明细操作无效')
      const catalog = operation === 'add' ? null : lineFor(state, draft, raw)
      const deltaQty = nullableNumber(raw.deltaQty)
      const newUnitPrice = nullableNumber(raw.newUnitPrice)
      const priorEffective = catalog ? { ...effective.get(catalog.id)! } : null
      let calculation
      try {
        calculation = calculateBoqChangeLine(
          operation as BoqChangeOperation,
          priorEffective,
          deltaQty,
          newUnitPrice,
        )
      }
      catch (cause) {
        throw failure('validation-failed', cause instanceof Error ? cause.message : '变更量价无效')
      }
      const itemName = operation === 'add' ? required(raw.itemName, '新增清单名称') : catalog!.itemName
      const unit = operation === 'add' ? text(raw.unit) : catalog!.unit
      if (catalog) {
        const target = effective.get(catalog.id)!
        if (operation === 'qty' && target.effectiveQty !== null)
          target.effectiveQty += calculation.deltaQty ?? 0
        if (operation === 'price' && calculation.newUnitPrice != null)
          target.effectiveUnitPrice = calculation.newUnitPrice
      }
      return {
        id: text(raw.id) || `change-line-${index + 1}`,
        boqLineId: catalog?.id ?? null,
        operation,
        itemName,
        unit,
        contractQty: priorEffective?.effectiveQty ?? null,
        contractUnitPrice: priorEffective?.effectiveUnitPrice ?? null,
        autoQty: null,
        reportedQty: null,
        auditedQty: null,
        deltaQty: calculation.deltaQty,
        newUnitPrice: calculation.newUnitPrice,
        amount: calculation.amount,
        auditedAmount: null,
        note: text(raw.note),
      }
    })
  }

  function reportSnapshot(draft: OwnerDocumentDraft, state: WorkspaceState) {
    const periodNo = required(draft.periodNo, '报量期次')
    if (!isPeriod(periodNo))
      throw failure('validation-failed', '报量期次格式必须为 yyyy-mm')
    const facts = state.monthlyQuantityFacts.filter(fact => fact.projectId === text(draft.projectId)
      && fact.contractId === text(draft.contractId) && fact.periodNo === periodNo)
    if (!facts.length)
      throw failure('validation-failed', '当前报量期次尚未形成月度工程量快照')
    const factByLine = new Map(facts.map(fact => [fact.boqLineId, fact]))
    const effective = effectiveBoqState(state, draft)
    const usedBoqLineIds = new Set<string>()
    const first = facts[0]!
    const lines = (draft.lines ?? []).map((raw, index) => {
      const catalog = lineFor(state, draft, raw)
      if (usedBoqLineIds.has(catalog.id))
        throw failure('validation-failed', '同一月度报量不能重复选择 BOQ 行')
      usedBoqLineIds.add(catalog.id)
      const fact = factByLine.get(catalog.id)
      if (!fact)
        throw failure('relationship-mismatch', 'BOQ 行不属于当前报量期次快照')
      const effectiveLine = effective.get(catalog.id)
      if (!effectiveLine)
        throw failure('relationship-mismatch', 'BOQ 行不属于当前施工合同有效量价台账')
      if (effectiveLine.effectiveUnitPrice === null)
        throw failure('validation-failed', '当前清单单价未知，请补齐清单后再申报')
      const reportedQty = nullableNumber(raw.reportedQty) ?? fact.autoQty
      if (nullableNumber(raw.reportedQty) === null && fact.missingQtyCount > 0)
        throw failure('validation-failed', '当前自动完成量存在缺量，请核实后明确填写申报量')
      if (reportedQty < 0)
        throw failure('validation-failed', '申报量不能为负数')
      return {
        id: text(raw.id) || `report-line-${index + 1}`,
        boqLineId: catalog.id,
        operation: null,
        itemName: catalog.itemName,
        unit: catalog.unit,
        contractQty: effectiveLine.effectiveQty,
        contractUnitPrice: effectiveLine.effectiveUnitPrice,
        autoQty: fact.autoQty,
        reportedQty,
        auditedQty: null,
        deltaQty: null,
        newUnitPrice: null,
        amount: round(reportedQty * effectiveLine.effectiveUnitPrice),
        auditedAmount: null,
        note: text(raw.note),
      }
    })
    return {
      lines,
      evidence: {
        basis: first.quantityBasis,
        sourceVersion: first.sourceVersion,
        sourceUpdatedAt: first.sourceUpdatedAt,
      },
    }
  }

  function provisionalLines(
    kind: OwnerCommercialDocumentKind,
    draft: OwnerDocumentDraft,
    state: WorkspaceState,
  ): OwnerCommercialDocumentLineSource[] {
    return (draft.lines ?? []).map((raw, index) => {
      const catalogId = text(raw.boqLineId)
      const catalog = catalogId ? state.boqLines.get(catalogId) ?? null : null
      const operation = kind === 'owner_change' && ['add', 'qty', 'price'].includes(text(raw.operation))
        ? text(raw.operation) as OwnerCommercialDocumentLineSource['operation']
        : null
      return {
        id: text(raw.id) || `${kind}-draft-line-${index + 1}`,
        boqLineId: catalogId || null,
        operation,
        itemName: text(raw.itemName) || catalog?.itemName || '',
        unit: text(raw.unit) || catalog?.unit || '',
        contractQty: nullableNumber(raw.contractQty) ?? catalog?.qty ?? null,
        contractUnitPrice: nullableNumber(raw.unitPrice) ?? nullableNumber(raw.contractUnitPrice) ?? catalog?.unitPrice ?? null,
        autoQty: nullableNumber(raw.autoQty),
        reportedQty: nullableNumber(raw.reportedQty),
        auditedQty: nullableNumber(raw.auditedQty),
        deltaQty: nullableNumber(raw.deltaQty),
        newUnitPrice: nullableNumber(raw.newUnitPrice),
        amount: number(raw.amount),
        auditedAmount: nullableNumber(raw.auditedAmount),
        note: text(raw.note),
      }
    })
  }

  function canResolveDraft(kind: OwnerCommercialDocumentKind, draft: OwnerDocumentDraft, state: WorkspaceState): boolean {
    if (!text(draft.projectId) || !text(draft.contractId))
      return false
    const rows = draft.lines ?? []
    if (kind === 'owner_report') {
      const periodNo = text(draft.periodNo)
      return isPeriod(periodNo)
        && rows.every(row => Boolean(text(row.boqLineId)))
        && state.monthlyQuantityFacts.some(fact => fact.projectId === text(draft.projectId)
          && fact.contractId === text(draft.contractId) && fact.periodNo === periodNo)
    }
    return rows.every((row) => {
      const operation = text(row.operation)
      if (operation === 'add')
        return Boolean(text(row.itemName)) && nullableNumber(row.deltaQty) != null && nullableNumber(row.newUnitPrice) != null
      if (operation === 'qty')
        return Boolean(text(row.boqLineId)) && nullableNumber(row.deltaQty) != null
      if (operation === 'price')
        return Boolean(text(row.boqLineId)) && nullableNumber(row.newUnitPrice) != null
      return false
    })
  }

  function filesAfterChanges(
    kind: OwnerCommercialDocumentKind,
    ownerId: string,
    existing: OwnerCommercialDocumentSource['files'],
    changes: FileRefChanges,
    timestamp: string,
  ): OwnerCommercialDocumentSource['files'] {
    const removed = new Set(changes.removeIds ?? [])
    const restored = new Set(changes.restoreIds ?? [])
    const known = new Set(existing.map(file => file.id))
    for (const id of [...removed, ...restored]) {
      if (!known.has(id))
        throw failure('relationship-mismatch', '附件不存在或不属于当前甲方商务单据')
    }
    const files = existing.map(file => ({
      ...file,
      deletedAt: removed.has(file.id) ? timestamp : restored.has(file.id) ? null : file.deletedAt,
    }))
    for (const raw of changes.add ?? []) {
      const fileName = required(raw.fileName, '附件名称')
      files.push({
        id: createAttachmentId(),
        fileName,
        fileSize: Math.max(number(raw.fileSize), 0),
        mimeType: text(raw.mimeType),
        category: text(raw.category),
        uploader: text(raw.uploader),
        uploadedAt: timestamp,
        deletedAt: null,
      })
    }
    return files
  }

  function assertAcceptanceAttachmentCategories(
    changes: FileRefChanges,
    expected: 'acceptance-report' | 'warranty-confirmation',
    existing: OwnerCommercialDocumentSource['files'] = [],
  ) {
    for (const file of changes.add ?? []) {
      if (text(file.category) !== expected)
        throw failure('validation-failed', `验收附件分类必须为 ${expected}`)
    }
    const changedIds = new Set([...(changes.removeIds ?? []), ...(changes.restoreIds ?? [])])
    if (existing.some(file => changedIds.has(file.id) && file.category !== expected))
      throw failure('validation-failed', '附件不属于当前验收视图')
  }

  function save(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'save' | 'submit' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, request.kind, request.id)
    assertVersion(current, request.baseVersion)
    if (current && !['draft', 'rejected'].includes(current.status))
      throw failure('conflict', '只有草稿或已退回甲方商务单据可以编辑')
    const timestamp = now()
    const id = current?.id ?? createId(request.kind)
    const isSubmit = request.action === 'submit'
    const relation = relations(state, request.kind, request.draft, isSubmit)
    const applicationDate = request.kind === 'sub_settlement'
      ? text(request.draft.settlementDate)
      : request.kind === 'sub_change'
        ? text(request.draft.changeDate)
        : request.kind === 'final_settlement'
          ? text(request.draft.submissionDate)
          : (request.kind === 'owner_penalty' || request.kind === 'project_penalty')
              ? text(request.draft.penaltyDate)
              : text(request.draft.applicationDate)
    if (applicationDate && !isIsoDate(applicationDate))
      throw failure('validation-failed', `${request.kind === 'sub_change' ? '变更' : request.kind === 'owner_penalty' ? '罚扣' : '申报'}日期格式必须为 yyyy-mm-dd`)
    if (isSubmit && !applicationDate)
      throw failure('validation-failed', `${request.kind === 'sub_change' ? '变更' : request.kind === 'owner_penalty' ? '罚扣' : '申报'}日期必填`)
    if (request.kind === 'project_penalty') {
      if (text(request.draft.deadline) && !isIsoDate(text(request.draft.deadline)))
        throw failure('validation-failed', '整改期限格式无效')
      const name = isSubmit ? required(request.draft.reason, '罚扣事由') : text(request.draft.reason)
      const crewId = text(request.draft.crewId) || null
      if (crewId && !state.crews.has(crewId))
        throw failure('relationship-mismatch', '责任班组不存在或已删除')
      const totalAmount = nullableNumber(request.draft.amount)
      if (isSubmit && (totalAmount == null || totalAmount <= 0))
        throw failure('validation-failed', '罚扣金额必须大于 0')
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'project_penalty',
        crewId,
        crewName: state.crews.get(crewId ?? '')?.name ?? '',
        id,
        no: text(request.draft.no) || `XMFK-${id}`,
        name,
        documentType: text(request.draft.deductionMethod),
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: null,
        customerName: '',
        customerPermission: 'allowed',
        supplierId: relation.supplier?.id ?? null,
        supplierName: relation.supplier?.name ?? '',
        supplierPermission: 'allowed',
        contractId: relation.subcontract?.id ?? null,
        contractNo: relation.subcontract?.no ?? '',
        contractName: relation.subcontract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'penalty_record',
        sourceId: id,
        sourceLocked: isSubmit,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: null,
        status: isSubmit ? 'pending' : 'draft',
        statusNote: isSubmit ? '待结算抵扣' : '',
        amount: round(totalAmount ?? 0),
        auditedAmount: null,
        penaltyFacts: { deadline: text(request.draft.deadline) || null, rectificationNote: text(request.draft.rectificationNote), deductionMethod: text(request.draft.deductionMethod) },
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    if (request.kind === 'sub_settlement') {
      const name = isSubmit ? required(request.draft.name, '结算名称') : text(request.draft.name)
      const totalAmount = nullableNumber(request.draft.totalAmount)
      if (isSubmit && (totalAmount == null || totalAmount <= 0))
        throw failure('validation-failed', '结算金额必须大于 0')
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'sub_settlement',
        id,
        no: text(request.draft.no) || `FBJS-${id}`,
        name,
        documentType: text(request.draft.settlementType),
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: null,
        customerName: '',
        customerPermission: 'allowed',
        supplierId: relation.supplier?.id ?? null,
        supplierName: relation.supplier?.name ?? '',
        supplierPermission: 'allowed',
        contractId: relation.subcontract?.id ?? null,
        contractNo: relation.subcontract?.no ?? '',
        contractName: relation.subcontract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'expenditure_settlement',
        sourceId: id,
        sourceLocked: isSubmit,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: null,
        status: isSubmit ? 'confirmed' : 'draft',
        statusNote: isSubmit ? '已确认分包结算' : '',
        amount: round(totalAmount ?? 0),
        auditedAmount: null,
        deductionNote: text(request.draft.deductionNote),
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    if (request.kind === 'sub_change') {
      const reason = isSubmit ? required(request.draft.reason, '变更事由') : text(request.draft.reason)
      const approvedAmount = nullableNumber(request.draft.approvedAmount)
      if (isSubmit && (approvedAmount == null || approvedAmount <= 0))
        throw failure('validation-failed', '审批金额必须大于 0')
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'sub_change',
        id,
        no: text(request.draft.no) || `FB-BG-${id}`,
        name: reason || '未填写变更事由',
        documentType: text(request.draft.changeType) || '增项',
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: null,
        customerName: '',
        customerPermission: 'allowed',
        supplierId: relation.supplier?.id ?? null,
        supplierName: relation.supplier?.name ?? '',
        supplierPermission: 'allowed',
        contractId: relation.subcontract?.id ?? null,
        contractNo: relation.subcontract?.no ?? '',
        contractName: relation.subcontract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'subcontract_change_order',
        sourceId: id,
        sourceLocked: isSubmit,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: null,
        status: isSubmit ? 'submitted' : 'draft',
        statusNote: isSubmit ? '已提交分包变洽签' : '',
        amount: round(approvedAmount ?? 0),
        auditedAmount: null,
        changedArea: nullableNumber(request.draft.changedArea),
        actualApprovedPrice: nullableNumber(request.draft.actualApprovedPrice),
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    if (request.kind === 'final_settlement') {
      const name = isSubmit ? required(request.draft.name, '结算名称') : text(request.draft.name)
      const settlementAmount = nullableNumber(request.draft.settlementAmount)
      if (isSubmit && (settlementAmount == null || settlementAmount <= 0))
        throw failure('validation-failed', '结算金额必须大于 0')
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'final_settlement',
        id,
        no: text(request.draft.no) || `JS-${id}`,
        name,
        documentType: 'final_settlement',
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: relation.customerId,
        customerName: relation.customer?.name ?? '',
        customerPermission: 'allowed',
        contractId: relation.contract?.id ?? null,
        contractNo: relation.contract?.no ?? '',
        contractName: relation.contract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'owner_final_settlement',
        sourceId: id,
        sourceLocked: isSubmit,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: current?.approvalDate ?? null,
        status: isSubmit ? 'submitted' : 'draft',
        statusNote: isSubmit ? '已提交甲方结算资料' : '',
        amount: round(settlementAmount ?? 0),
        auditedAmount: current?.auditedAmount ?? null,
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
        settlementBasis: text(request.draft.basis),
        settlementDifferenceNote: text(request.draft.differenceNote),
        finalSettlementEvidence: undefined,
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    if (request.kind === 'owner_penalty') {
      const reason = isSubmit ? required(request.draft.reason, '罚扣事由') : text(request.draft.reason)
      const penaltyAmount = nullableNumber(request.draft.amount)
      if (isSubmit && (penaltyAmount == null || penaltyAmount <= 0))
        throw failure('validation-failed', '罚扣金额必须大于 0')
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'owner_penalty',
        id,
        no: text(request.draft.no) || `FK-${id}`,
        name: reason || '未填写罚扣事由',
        documentType: 'owner_penalty',
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: relation.customerId,
        customerName: relation.customer?.name ?? '',
        customerPermission: 'allowed',
        contractId: relation.contract?.id ?? null,
        contractNo: relation.contract?.no ?? '',
        contractName: relation.contract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'owner_penalty',
        sourceId: id,
        sourceLocked: isSubmit,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: null,
        status: isSubmit ? 'submitted' : 'draft',
        statusNote: isSubmit ? '已提交甲方罚扣事实' : '',
        amount: round(penaltyAmount ?? 0),
        auditedAmount: null,
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
        noticeNo: text(request.draft.noticeNo),
        penaltyReason: reason,
        appealNote: text(request.draft.appealNote),
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    if (request.kind === 'acceptance') {
      assertAcceptanceAttachmentCategories(request.attachments, 'acceptance-report', current?.files)
      const name = isSubmit ? required(request.draft.name, '验收名称') : text(request.draft.name)
      const lifecycle = current?.acceptanceLifecycle ?? {
        acceptanceOrganization: '',
        acceptancePerson: '',
        acceptanceDate: null,
        acceptanceConclusion: '',
        warrantyOwner: '',
        warrantyStartDate: null,
        warrantyEndDate: null,
        warrantyConfirmationOrganization: null,
        warrantyConfirmationDate: null,
        warrantyConfirmationNote: '',
        events: [],
      }
      const events = lifecycle.events.map(clone)
      if (isSubmit) {
        events.push({
          id: `acceptance-event-${crypto.randomUUID()}`,
          action: 'submit',
          fromStatus: 'draft',
          toStatus: 'submitted',
          actorId: request.actorId,
          actorName: request.actorId,
          occurredAt: timestamp,
          note: text(request.draft.note),
        })
      }
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind: 'acceptance',
        id,
        no: text(request.draft.no) || `YS-${id}`,
        name,
        documentType: 'acceptance_lifecycle',
        projectId: relation.project?.id ?? null,
        projectName: relation.project?.name ?? '',
        projectPermission: 'allowed',
        customerId: relation.customerId,
        customerName: relation.customer?.name ?? '',
        customerPermission: 'allowed',
        contractId: relation.contract?.id ?? null,
        contractNo: relation.contract?.no ?? '',
        contractName: relation.contract?.name ?? '',
        contractPermission: 'allowed',
        sourceType: 'manual',
        sourceId: id,
        sourceLocked: false,
        periodNo: '',
        applicationDate: applicationDate || null,
        approvalDate: null,
        status: isSubmit ? 'submitted' : 'draft',
        statusNote: isSubmit ? '验收中' : '',
        amount: number(request.draft.contractEstimate),
        auditedAmount: null,
        note: text(request.draft.note),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lines: [],
        files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
        acceptanceLifecycle: { ...lifecycle, events },
      }
      state.documents.set(key(request.kind, id), source)
      state.sourceVersion += 1
      return source
    }
    let report: ReturnType<typeof reportSnapshot> | null = null
    let lines: OwnerCommercialDocumentLineSource[]
    if (isSubmit) {
      report = request.kind === 'owner_report' ? reportSnapshot(request.draft, state) : null
      lines = request.kind === 'owner_change' ? changeLines(request.draft, state) : report!.lines
    }
    else if (!(request.kind === 'owner_report' && options.withMonthlyQuantity) && canResolveDraft(request.kind, request.draft, state)) {
      report = request.kind === 'owner_report' ? reportSnapshot(request.draft, state) : null
      lines = request.kind === 'owner_change' ? changeLines(request.draft, state) : report!.lines
    }
    else {
      lines = provisionalLines(request.kind, request.draft, state)
    }
    if (isSubmit && lines.length === 0 && request.kind === 'owner_report')
      throw failure('validation-failed', '月度报量至少需要一条 BOQ 行')
    if (isSubmit && request.kind === 'owner_change' && !lines.length
      && number(request.draft.approvedTaxInclusiveAmount) <= 0
      && number(request.draft.approvedTaxExclusiveAmount) <= 0) {
      throw failure('validation-failed', '甲方变洽签至少需要量价变更或纯金额签证金额')
    }
    const periodNo = request.kind === 'owner_report' ? text(request.draft.periodNo) : ''
    if (request.kind === 'owner_report' && isSubmit && !isPeriod(periodNo))
      throw failure('validation-failed', '报量期次格式必须为 yyyy-mm')
    if (request.kind === 'owner_report' && relation.contract && isPeriod(periodNo)) {
      const duplicate = [...state.documents.values()].find(row => row.kind === 'owner_report'
        && row.id !== id
        && row.contractId === relation.contract!.id
        && row.periodNo === periodNo)
      if (duplicate)
        throw failure('conflict', '同一施工合同同一月份只能有一张有效月度报量')
    }
    const lineAmount = round(lines.reduce((sum, line) => sum + line.amount, 0))
    const amount = request.kind === 'owner_change'
      ? round(nullableNumber(request.draft.approvedTaxInclusiveAmount) ?? current?.amount ?? lineAmount)
      : lineAmount
    const name = request.kind === 'owner_change'
      ? (isSubmit ? required(request.draft.name, '变更名称') : text(request.draft.name))
      : `${periodNo || '未定期次'}月度报量`
    if (request.kind === 'owner_change' && isSubmit)
      required(request.draft.reason, '变更事由')
    const source: OwnerCommercialDocumentSource = {
      dataOrigin: 'real',
      kind: request.kind,
      id,
      no: text(request.draft.no) || (request.kind === 'owner_change' ? `BG-${id}` : `BL-${periodNo}`),
      name,
      documentType: request.kind === 'owner_change' ? text(request.draft.documentType) || 'change_negotiation' : 'monthly_statement',
      projectId: relation.project?.id ?? null,
      projectName: relation.project?.name ?? '',
      projectPermission: 'allowed',
      customerId: relation.customerId,
      customerName: relation.customer?.name ?? '',
      customerPermission: 'allowed',
      contractId: relation.contract?.id ?? null,
      contractNo: relation.contract?.no ?? '',
      contractName: relation.contract?.name ?? '',
      contractPermission: 'allowed',
      sourceType: request.kind === 'owner_change' ? (lines.length ? 'boq_change_order' : 'manual') : 'monthly_statement',
      sourceId: id,
      sourceLocked: false,
      periodNo,
      applicationDate: applicationDate || null,
      approvalDate: current?.approvalDate ?? null,
      approvalSequenceAt: current?.approvalSequenceAt ?? null,
      quantityBasis: report?.evidence.basis ?? (request.kind === 'owner_report' && isQuantityBasis(request.draft.quantityBasis) ? request.draft.quantityBasis : null),
      quantitySourceVersion: report?.evidence.sourceVersion ?? null,
      quantitySourceUpdatedAt: report?.evidence.sourceUpdatedAt ?? null,
      operatorName: request.kind === 'owner_report' && isSubmit ? text(request.draft.operatorName) : '',
      submittedAt: isSubmit && request.kind === 'owner_report' ? timestamp : current?.submittedAt ?? null,
      status: isSubmit ? (request.kind === 'owner_change' ? 'submitted' : 'reported') : 'draft',
      statusNote: isSubmit ? (request.kind === 'owner_change' ? '已上报甲方' : '已申报甲方') : '',
      amount,
      boqAmount: request.kind === 'owner_change' ? lineAmount : null,
      taxExclusiveAmount: request.kind === 'owner_change'
        ? nullableNumber(request.draft.approvedTaxExclusiveAmount) ?? current?.taxExclusiveAmount ?? 0
        : null,
      appliedTaxExclusiveAmount: request.kind === 'owner_change'
        ? nullableNumber(request.draft.appliedTaxExclusiveAmount) ?? current?.appliedTaxExclusiveAmount ?? 0
        : null,
      auditedAmount: null,
      note: text(request.draft.note) || text(request.draft.reason),
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lines,
      files: filesAfterChanges(request.kind, id, current?.files ?? [], request.attachments, timestamp),
    }
    state.documents.set(key(request.kind, id), source)
    state.sourceVersion += 1
    return source
  }

  function updateAttachments(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'attachments' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, request.kind, request.id)
    if (!current)
      throw failure('not-found', '甲方商务单据不存在或已删除')
    assertVersion(current, request.baseVersion)
    if (current.kind === 'acceptance' && current.status === 'expired')
      throw failure('conflict', '保修到期确认后单据只读')
    if (current.kind === 'acceptance') {
      assertAcceptanceAttachmentCategories(
        request.attachments,
        ['draft', 'rejected', 'submitted'].includes(current.status)
          ? 'acceptance-report'
          : 'warranty-confirmation',
        current.files,
      )
    }
    const timestamp = now()
    const next = {
      ...current,
      files: filesAfterChanges(request.kind, request.id, current.files, request.attachments, timestamp),
      version: current.version + 1,
      updatedAt: timestamp,
    }
    state.documents.set(key(next.kind, next.id), next)
    state.sourceVersion += 1
    return next
  }

  function transitionAcceptance(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'transition-acceptance' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, 'acceptance', request.id)
    if (!current)
      throw failure('not-found', '验收记录不存在或已删除')
    assertVersion(current, request.baseVersion)
    const expectedStatus = {
      accepted: 'submitted',
      warranty: 'accepted',
      expired: 'warranty',
    }[request.target]
    const targetLabel = {
      accepted: '确认验收',
      warranty: '进入保修',
      expired: '确认保修到期',
    }[request.target]
    if (current.status !== expectedStatus)
      throw failure('conflict', `当前状态不能${targetLabel}`)

    const timestamp = now()
    const facts = request.facts
    assertAcceptanceAttachmentCategories(
      request.attachments,
      request.target === 'accepted' ? 'acceptance-report' : 'warranty-confirmation',
      current.files,
    )
    const lifecycle = clone(current.acceptanceLifecycle ?? {
      acceptanceOrganization: '',
      acceptancePerson: '',
      acceptanceDate: null,
      acceptanceConclusion: '',
      warrantyOwner: '',
      warrantyStartDate: null,
      warrantyEndDate: null,
      warrantyConfirmationOrganization: null,
      warrantyConfirmationDate: null,
      warrantyConfirmationNote: '',
      events: [],
    })
    if (request.target === 'accepted') {
      lifecycle.acceptanceOrganization = required(facts.acceptanceOrganization, '验收单位')
      lifecycle.acceptancePerson = required(facts.acceptancePerson, '验收人')
      lifecycle.acceptanceDate = required(facts.acceptanceDate, '验收日期')
      lifecycle.acceptanceConclusion = required(facts.acceptanceConclusion, '验收结论')
      if (!isIsoDate(lifecycle.acceptanceDate))
        throw failure('validation-failed', '验收日期格式必须为 yyyy-mm-dd')
    }
    if (request.target === 'warranty') {
      lifecycle.warrantyOwner = required(facts.warrantyOwner, '保修责任单位')
      lifecycle.warrantyStartDate = required(facts.warrantyStartDate, '保修开始日期')
      lifecycle.warrantyEndDate = required(facts.warrantyEndDate, '保修结束日期')
      if (!isIsoDate(lifecycle.warrantyStartDate) || !isIsoDate(lifecycle.warrantyEndDate))
        throw failure('validation-failed', '保修日期格式必须为 yyyy-mm-dd')
      if (lifecycle.warrantyEndDate < lifecycle.warrantyStartDate)
        throw failure('validation-failed', '保修结束日期不能早于开始日期')
    }
    if (request.target === 'expired') {
      lifecycle.warrantyConfirmationOrganization = required(facts.warrantyConfirmationOrganization, '到期验收单位')
      lifecycle.warrantyConfirmationDate = required(facts.warrantyConfirmationDate, '到期确认日期')
      lifecycle.warrantyConfirmationNote = required(facts.warrantyConfirmationNote, '到期确认结论')
      if (!isIsoDate(lifecycle.warrantyConfirmationDate))
        throw failure('validation-failed', '到期确认日期格式必须为 yyyy-mm-dd')
      if (lifecycle.warrantyEndDate && lifecycle.warrantyConfirmationDate < lifecycle.warrantyEndDate)
        throw failure('validation-failed', '到期确认日期不能早于保修结束日期')
    }
    const eventByTarget = {
      accepted: { action: 'accept', fromStatus: 'submitted', toStatus: 'accepted' },
      warranty: { action: 'start-warranty', fromStatus: 'accepted', toStatus: 'warranty' },
      expired: { action: 'confirm-expiry', fromStatus: 'warranty', toStatus: 'expired' },
    } as const
    const event = eventByTarget[request.target]
    lifecycle.events.push({
      id: `acceptance-event-${crypto.randomUUID()}`,
      ...event,
      actorId: request.actorId,
      actorName: request.actorId,
      occurredAt: timestamp,
      note: text(facts.note),
    })
    const statusNote = {
      accepted: '验收合格',
      warranty: '保修中',
      expired: '保修到期已确认',
    }[request.target]
    const next: OwnerCommercialDocumentSource = {
      ...current,
      status: request.target,
      statusNote,
      sourceLocked: true,
      files: filesAfterChanges('acceptance', current.id, current.files, request.attachments, timestamp),
      acceptanceLifecycle: lifecycle,
      version: current.version + 1,
      updatedAt: timestamp,
    }
    state.documents.set(key(next.kind, next.id), next)
    state.sourceVersion += 1
    return next
  }

  function approve(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'approve' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, 'owner_change', request.id)
    if (!current)
      throw failure('not-found', '甲方变洽签不存在或已删除')
    assertVersion(current, request.baseVersion)
    if (current.status !== 'submitted')
      throw failure('conflict', '只有已上报甲方变洽签可以确认签证')
    if (!isIsoDate(request.approvedAt))
      throw failure('validation-failed', '签证日期格式必须为 yyyy-mm-dd')
    const latestApprovalDate = [...state.documents.values()]
      .filter(source => source.kind === 'owner_change' && source.status === 'approved'
        && source.projectId === current.projectId && source.contractId === current.contractId)
      .map(approvalBusinessDate)
      .filter(isIsoDate)
      .sort()
      .at(-1)
    if (latestApprovalDate && request.approvedAt < latestApprovalDate)
      throw failure('validation-failed', `签证日期不能早于已有签证 ${latestApprovalDate}`)
    const requestedTimestamp = now()
    const latestApprovalTimestamp = [...state.documents.values()]
      .filter(source => source.kind === 'owner_change' && source.status === 'approved'
        && source.projectId === current.projectId && source.contractId === current.contractId)
      .map(source => source.approvalSequenceAt ?? source.updatedAt)
      .filter(isISODateTimeDTO)
      .sort()
      .at(-1)
    const timestamp = latestApprovalTimestamp && requestedTimestamp <= latestApprovalTimestamp
      ? new Date(Date.parse(latestApprovalTimestamp) + 1).toISOString()
      : requestedTimestamp
    const recalculatedLines = changeLines(formDraft(current), state)
    const hasBoqChange = recalculatedLines.length > 0
    const snapshotVersion = `approved-change:${current.id}:v${current.version + 1}`
    const periodTemplates = [...new Map(
      state.monthlyQuantityFacts
        .filter(fact => fact.projectId === current.projectId && fact.contractId === current.contractId)
        .map(fact => [fact.periodNo, fact]),
    ).values()]
    const additions = new Map<string, BoqLineSeed>()
    const lines = recalculatedLines.map((line) => {
      if (line.operation !== 'add')
        return line
      const resultId = line.boqLineId ?? createBoqLineId(current.id, line.id)
      const quantity = line.deltaQty ?? 0
      const unitPrice = line.newUnitPrice
      if (quantity < 0 || unitPrice == null || unitPrice < 0)
        throw failure('validation-failed', '新增清单项签证量价无效')
      const resultLine: BoqLineSeed = {
        id: resultId,
        projectId: required(current.projectId, '项目'),
        contractId: required(current.contractId, '施工合同'),
        itemName: line.itemName,
        unit: line.unit,
        qty: quantity,
        unitPrice,
        autoQty: 0,
        missingQtyCount: 0,
      }
      const existing = additions.get(resultId) ?? state.boqLines.get(resultId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(resultLine))
        throw failure('conflict', '新增清单项的结果 BOQ 行稳定 ID 冲突')
      additions.set(resultId, resultLine)
      return {
        ...line,
        boqLineId: resultId,
        contractQty: quantity,
        contractUnitPrice: unitPrice,
      }
    })
    if (hasBoqChange) {
      for (const fact of state.monthlyQuantityFacts) {
        if (fact.projectId === current.projectId && fact.contractId === current.contractId) {
          fact.sourceVersion = snapshotVersion
          fact.sourceUpdatedAt = timestamp
        }
      }
    }
    for (const resultLine of additions.values()) {
      state.boqLines.set(resultLine.id, resultLine)
      for (const template of periodTemplates) {
        state.monthlyQuantityFacts.push({
          projectId: resultLine.projectId,
          contractId: resultLine.contractId,
          periodNo: template.periodNo,
          boqLineId: resultLine.id,
          autoQty: 0,
          missingQtyCount: 0,
          quantityBasis: template.quantityBasis,
          sourceVersion: snapshotVersion,
          sourceUpdatedAt: timestamp,
        })
      }
    }
    const next = {
      ...current,
      status: 'approved',
      statusNote: '甲方已签证',
      sourceLocked: true,
      approvalDate: request.approvedAt,
      approvalSequenceAt: timestamp,
      boqAmount: round(lines.reduce((sum, line) => sum + line.amount, 0)),
      version: current.version + 1,
      updatedAt: timestamp,
      lines,
    }
    state.documents.set(key(next.kind, next.id), next)
    state.sourceVersion += 1
    return next
  }

  function audit(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'audit' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, 'owner_report', request.id)
    if (!current)
      throw failure('not-found', '月度报量不存在或已删除')
    assertVersion(current, request.baseVersion)
    if (current.status !== 'reported')
      throw failure('conflict', '只有已申报月度报量可以确认审定')
    const auditedByBoqId = new Map(request.audit.lines.map(line => [line.boqLineId, line.auditedQty]))
    if (auditedByBoqId.size !== current.lines.length)
      throw failure('validation-failed', '必须为每条报量明细填写审定量')
    const lines = current.lines.map((line) => {
      const auditedQty = line.boqLineId ? auditedByBoqId.get(line.boqLineId) : undefined
      if (auditedQty == null || !Number.isFinite(auditedQty) || auditedQty < 0)
        throw failure('validation-failed', '审定量无效')
      const auditedAmount = round(auditedQty * (line.contractUnitPrice ?? 0))
      return { ...line, auditedQty, auditedAmount }
    })
    const auditedAmount = round(lines.reduce((sum, line) => sum + (line.auditedAmount ?? 0), 0))
    const next = {
      ...current,
      status: 'audited',
      statusNote: '甲方已审定',
      sourceLocked: true,
      auditedAmount,
      lines,
      version: current.version + 1,
      updatedAt: now(),
    }
    state.documents.set(key(next.kind, next.id), next)
    state.sourceVersion += 1
    return next
  }

  function penaltyAction(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'deduct-penalty' | 'rectify-penalty' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, 'project_penalty', request.id)
    if (!current)
      throw failure('not-found', '项目罚扣不存在或已删除')
    assertVersion(current, request.baseVersion)
    const timestamp = now()
    const next = clone(current)
    if (request.action === 'deduct-penalty') {
      if (!['pending', 'repairing', 'repaired_self', 'repaired_other'].includes(current.status))
        throw failure('conflict', '仅待抵扣罚扣可以执行结算抵扣')
      const settlement = document(state, 'sub_settlement', request.settlementId)
      if (!settlement || !matchesPenaltySettlement(current, settlement))
        throw failure('relationship-mismatch', '必须选择真实、已确认且来源合同或分供方一致的分包结算')
      assertVersion(settlement, request.settlementVersion)
      const amount = round(request.amount)
      if (amount <= 0 || amount !== request.amount)
        throw failure('validation-failed', '抵扣金额须大于 0 且最多两位小数')
      const all = [...state.penaltyDeductions.values()]
      const deducted = round(all.filter(row => row.penaltyId === current.id).reduce((sum, row) => sum + row.amount, 0))
      const settlementDeducted = round(all.filter(row => row.settlementId === settlement.id).reduce((sum, row) => sum + row.amount, 0))
      if (amount > round(current.amount - deducted))
        throw failure('validation-failed', '抵扣金额超过罚扣剩余金额')
      if (amount > round(settlement.amount - settlementDeducted))
        throw failure('validation-failed', '抵扣金额超过结算剩余可抵扣金额')
      const id = crypto.randomUUID()
      state.penaltyDeductions.set(id, { id, penaltyId: current.id, settlementId: settlement.id, amount, actorId: request.actorId, occurredAt: timestamp, commandId: request.commandId, note: request.note.trim() })
      next.status = round(deducted + amount) === current.amount ? 'deducted' : 'pending'
      next.statusNote = next.status === 'deducted' ? '已全部抵扣' : '部分抵扣，仍有剩余金额'
      state.documents.set(key('sub_settlement', settlement.id), { ...settlement, version: settlement.version + 1, updatedAt: timestamp })
    }
    else {
      if (request.deadline && !isIsoDate(request.deadline))
        throw failure('validation-failed', '整改期限格式无效')
      const note = required(request.note, '整改说明')
      const id = crypto.randomUUID()
      state.penaltyRectifications.set(id, { id, penaltyId: current.id, actorId: request.actorId, occurredAt: timestamp, deadline: request.deadline, note })
      next.penaltyFacts = { deductionMethod: current.penaltyFacts?.deductionMethod ?? '', deadline: request.deadline, rectificationNote: note }
    }
    next.version += 1
    next.updatedAt = timestamp
    state.documents.set(key('project_penalty', next.id), next)
    state.sourceVersion += 1
    return next
  }

  function remove(
    request: Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'delete' }>,
    state: WorkspaceState,
  ): OwnerCommercialDocumentSource {
    const current = document(state, request.kind, request.id)
    if (!current)
      throw failure('not-found', '甲方商务单据不存在或已删除')
    assertVersion(current, request.baseVersion)
    if (!['draft', 'rejected'].includes(current.status))
      throw failure('conflict', '只有草稿或已退回甲方商务单据可以删除')
    state.documents.delete(key(request.kind, request.id))
    state.sourceVersion += 1
    return { ...current, version: current.version + 1, updatedAt: now() }
  }

  function result(
    request: OwnerCommercialDocumentCommandRequestDTO,
    source: OwnerCommercialDocumentSource,
  ): OwnerCommercialDocumentCommandResultDTO {
    return {
      id: source.id,
      commandId: request.commandId,
      version: String(source.version),
      updatedAt: source.updatedAt,
      attachmentIds: source.files.filter(file => file.deletedAt === null).map(file => file.id),
      deleted: request.action === 'delete',
    }
  }

  function prepareMigrationSnapshot(
    snapshot: CoreMigrationSnapshotDTO,
    sessionId?: string | null,
  ): () => void {
    const state = clone(stateFor(sessionId))
    for (const migratedKey of state.migrationKeys)
      state.documents.delete(migratedKey)
    const previousMigrationKeys = new Set(state.migrationKeys)
    state.migrationKeys.clear()
    state.monthlyQuantityFacts = baseMonthlyQuantityFacts.map(clone)
    state.finalSettlementSupplements = new Map(baseFinalSettlementSupplements.map(row => [row.id, clone(row)]))
    state.finalSettlementReceipts = new Map(baseFinalSettlementReceipts.map(row => [row.id, clone(row)]))
    state.finalSettlementSupplementsKnownContractIds = new Set(baseFinalSettlementSupplementsKnownContractIds)
    state.finalSettlementReceiptsKnownContractIds = new Set(baseFinalSettlementReceiptsKnownContractIds)

    state.projects.clear()
    state.customers.clear()
    state.suppliers.clear()
    state.contracts.clear()
    state.subcontractContracts.clear()
    state.boqLines.clear()
    for (const row of baseProjects)
      state.projects.set(row.id, clone(row))
    for (const row of baseCustomers)
      state.customers.set(row.id, clone(row))
    for (const row of baseSuppliers)
      state.suppliers.set(row.id, clone(row))
    for (const row of baseContracts)
      state.contracts.set(row.id, clone(row))
    for (const row of baseSubcontractContracts)
      state.subcontractContracts.set(row.id, clone(row))
    for (const row of baseBoqLines)
      state.boqLines.set(row.id, clone(row))

    state.penaltyDeductions = new Map([...state.penaltyDeductions].filter(([, row]) => !previousMigrationKeys.has(key('project_penalty', row.penaltyId))))
    state.penaltyRectifications = new Map([...state.penaltyRectifications].filter(([, row]) => !previousMigrationKeys.has(key('project_penalty', row.penaltyId))))
    state.crews = new Map((options.crews ?? []).map(row => [row.id, clone(row)]))
    const entities = snapshot.authority === 'central' ? snapshot.entities : []
    for (const entity of entities) {
      if (entity.deletedAt !== null)
        continue
      if (entity.entityType === 'crews')
        state.crews.set(entity.id, { id: entity.id, name: entity.name })
      if (entity.entityType === 'customers')
        state.customers.set(entity.id, { id: entity.id, name: entity.name })
      if (entity.entityType === 'suppliers')
        state.suppliers.set(entity.id, { id: entity.id, name: entity.name })
      if (entity.entityType === 'projects') {
        state.projects.set(entity.id, {
          id: entity.id,
          name: entity.name,
          customerId: entity.references.customerId ?? null,
        })
      }
      if (entity.entityType === 'construction_contracts') {
        state.contracts.set(entity.id, {
          id: entity.id,
          no: entityAttribute(entity, 'no'),
          name: entity.name,
          projectId: entity.references.projectId ?? '',
          customerId: entity.references.customerId ?? null,
          amount: entityNumberAttribute(entity, 'amount') ?? (entity.amount == null ? null : number(entity.amount)),
        })
      }
      if (entity.entityType === 'subcontract_contracts') {
        state.subcontractContracts.set(entity.id, {
          id: entity.id,
          no: entityAttribute(entity, 'no'),
          name: entity.name,
          projectId: entity.references.projectId ?? '',
          supplierId: entity.references.supplierId ?? '',
          amount: entity.amount == null ? null : number(entity.amount),
        })
      }
    }

    if (snapshot.authority === 'central') {
      const subcontractContractIds = new Set(entities
        .filter(entity => entity.entityType === 'subcontract_contracts' && entity.deletedAt === null)
        .map(entity => entity.id))
      state.finalSettlementSupplementsKnownContractIds = new Set(state.contracts.keys())
      state.finalSettlementReceiptsKnownContractIds = new Set(state.contracts.keys())
      for (const entity of entities) {
        if (entity.deletedAt !== null)
          continue
        if (entity.entityType === 'contract_supplements') {
          const contractId = entity.references.contractId ?? ''
          if (subcontractContractIds.has(contractId))
            continue
          if (!state.contracts.has(contractId))
            throw failure('relationship-mismatch', '迁移补充协议的施工合同关系无效')
          if (entity.amount === null)
            throw failure('validation-failed', '迁移补充协议金额缺失')
          state.finalSettlementSupplements.set(entity.id, {
            contractId,
            id: entity.id,
            no: entityAttribute(entity, 'no'),
            name: entity.name,
            status: entityAttribute(entity, 'status'),
            amount: number(entity.amount),
            date: entityAttribute(entity, 'signDate') || null,
          })
        }
        if (entity.entityType === 'receipt_registrations' && !options.receiptSource) {
          const contractId = entity.references.contractId ?? ''
          const projectId = entity.references.projectId ?? ''
          const customerId = entity.references.customerId ?? ''
          const contract = state.contracts.get(contractId) ?? null
          const project = state.projects.get(projectId) ?? null
          const expectedCustomerId = contract?.customerId ?? project?.customerId ?? null
          if (!contract || !project || contract.projectId !== project.id
            || !customerId || customerId !== expectedCustomerId || !state.customers.has(customerId)) {
            throw failure('relationship-mismatch', '迁移收款登记的项目、施工合同与客户关系无效')
          }
          if (entity.amount === null)
            throw failure('validation-failed', '迁移收款登记金额缺失')
          state.finalSettlementReceipts.set(entity.id, {
            contractId,
            projectId,
            customerId,
            id: entity.id,
            no: entityAttribute(entity, 'no'),
            name: entity.name,
            status: entityAttribute(entity, 'status'),
            amount: number(entity.amount),
            date: entityAttribute(entity, 'receiptDate') || null,
          })
        }
      }
    }

    for (const entity of entities) {
      if (entity.entityType !== 'construction_contracts' || entity.deletedAt !== null)
        continue
      const contract = state.contracts.get(entity.id)
      const projectId = entity.references.projectId ?? ''
      if (!contract || !projectId || contract.projectId !== projectId)
        throw failure('relationship-mismatch', '迁移 BOQ 目录的项目与施工合同关系无效')
      for (const raw of jsonRecords(entityAttribute(entity, 'boqCatalogJson'))) {
        const id = required(raw.id, 'BOQ 行')
        const candidate: BoqLineSeed = {
          id,
          projectId,
          contractId: required(contract?.id, '合同'),
          itemName: required(raw.itemName, 'BOQ 名称'),
          unit: text(raw.unit),
          qty: nullableNumber(raw.qty),
          unitPrice: nullableNumber(raw.unitPrice),
          building: text(raw.building) || null,
          unitType: text(raw.unitType) || null,
          floorZone: text(raw.floorZone) || null,
          updatedAt: text(raw.updatedAt) || null,
          autoQty: 0,
          missingQtyCount: 0,
        }
        const existing = state.boqLines.get(id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(candidate))
          throw failure('conflict', '迁移施工合同包含冲突的 BOQ 行稳定 ID')
        state.boqLines.set(id, candidate)
      }
      for (const raw of jsonRecords(entityAttribute(entity, 'monthlyQuantityFactsJson'))) {
        const periodNo = required(raw.periodNo, '报量期次')
        if (!isPeriod(periodNo))
          throw failure('validation-failed', '迁移月度工程量期次格式必须为 yyyy-mm')
        const boqLineId = required(raw.boqLineId, 'BOQ 行')
        const boqLine = state.boqLines.get(boqLineId)
        if (!boqLine || boqLine.projectId !== projectId || boqLine.contractId !== contract.id)
          throw failure('relationship-mismatch', '迁移月度工程量事实引用了无效 BOQ 行')
        const sourceUpdatedAt = text(raw.sourceUpdatedAt) || null
        if (sourceUpdatedAt && !isISODateTimeDTO(sourceUpdatedAt))
          throw failure('validation-failed', '迁移月度工程量更新时间无效')
        state.monthlyQuantityFacts.push({
          projectId,
          contractId: required(contract?.id, '合同'),
          periodNo,
          boqLineId,
          autoQty: number(raw.autoQty),
          missingQtyCount: Math.max(number(raw.missingQtyCount), 0),
          quantityBasis: required(raw.quantityBasis, '取数基准'),
          sourceVersion: required(raw.sourceVersion, '工程量来源版本'),
          sourceUpdatedAt,
        })
      }
    }

    for (const entity of entities) {
      if (entity.entityType !== 'owner_documents' || entity.deletedAt !== null)
        continue
      const kind = entityAttribute(entity, 'kind')
      if (kind !== 'owner_change' && kind !== 'owner_report' && kind !== 'acceptance'
        && kind !== 'final_settlement' && kind !== 'owner_penalty' && kind !== 'sub_change' && kind !== 'sub_settlement' && kind !== 'project_penalty') {
        throw failure('validation-failed', '甲方商务单据迁移类型无效')
      }
      const projectId = entity.references.projectId ?? null
      const contractId = entity.references.contractId ?? null
      const project = projectId ? state.projects.get(projectId) ?? null : null
      const constructionContract = contractId ? state.contracts.get(contractId) ?? null : null
      const auxiliary = kind === 'project_penalty' && entity.attributes.contractKind === 'other_expense'
        ? entities.find(row => row.entityType === 'auxiliary_contracts' && row.id === contractId && !row.deletedAt && row.attributes.kind === 'other_expense' && !['draft', '草稿'].includes(String(row.attributes.status)))
        : null
      const subcontract = auxiliary
        ? { id: auxiliary.id, no: entityAttribute(auxiliary, 'no'), name: auxiliary.name, projectId: auxiliary.references.projectId ?? '', supplierId: auxiliary.references.supplierId ?? '', amount: auxiliary.amount == null ? null : Number(auxiliary.amount) }
        : contractId ? state.subcontractContracts.get(contractId) ?? null : null
      const contract = (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty')
        ? subcontract && { ...subcontract, customerId: null }
        : constructionContract
      const supplierId = (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty') ? entity.references.supplierId ?? null : null
      const supplier = supplierId ? state.suppliers.get(supplierId) ?? null : null
      if (!project || (kind !== 'project_penalty' && !contract) || (contractId && (!contract || contract.projectId !== project.id))
        || (kind === 'project_penalty' && supplierId && !supplier)
        || ((kind === 'sub_change' || kind === 'sub_settlement' || (kind === 'project_penalty' && contractId)) && (!supplier || subcontract?.supplierId !== supplier.id))) {
        throw failure(
          'relationship-mismatch',
          kind === 'sub_change'
            ? '迁移分包变洽签的项目、分供方与分包合同关系无效'
            : '迁移甲方商务单据的项目与施工合同关系无效',
        )
      }
      const customerId = kind === 'project_penalty' ? null : contract?.customerId ?? project!.customerId
      const customer = customerId ? state.customers.get(customerId) ?? null : null
      const sourceTypeRaw = entityAttribute(entity, 'sourceType')
      if (kind === 'sub_settlement' && sourceTypeRaw !== 'expenditure_settlement')
        throw failure('validation-failed', '迁移分包结算来源类型无效')
      if (kind === 'owner_penalty' && sourceTypeRaw !== 'owner_penalty')
        throw failure('validation-failed', '迁移甲方罚扣来源类型无效')
      if (kind === 'sub_change' && sourceTypeRaw !== 'subcontract_change_order')
        throw failure('validation-failed', '迁移分包变洽签来源类型无效')
      const sourceType = sourceTypeRaw === 'manual'
        || sourceTypeRaw === 'monthly_statement'
        || sourceTypeRaw === 'owner_final_settlement'
        || sourceTypeRaw === 'owner_penalty'
        || sourceTypeRaw === 'subcontract_change_order'
        || sourceTypeRaw === 'expenditure_settlement'
        || sourceTypeRaw === 'penalty_record'
        ? sourceTypeRaw
        : 'boq_change_order'
      const rawLines = jsonRecords(entityAttribute(entity, 'linesJson'))
      const lines: OwnerCommercialDocumentLineSource[] = rawLines.map((raw, index) => {
        const operationRaw = text(raw.operation)
        const operation = operationRaw === 'add' || operationRaw === 'qty' || operationRaw === 'price'
          ? operationRaw
          : null
        return {
          id: text(raw.id) || `${entity.id}-line-${index + 1}`,
          boqLineId: text(raw.boqLineId) || null,
          operation,
          itemName: text(raw.itemName),
          unit: text(raw.unit),
          contractQty: nullableNumber(raw.contractQty),
          contractUnitPrice: nullableNumber(raw.contractUnitPrice),
          autoQty: nullableNumber(raw.autoQty),
          reportedQty: nullableNumber(raw.reportedQty),
          auditedQty: nullableNumber(raw.auditedQty),
          deltaQty: nullableNumber(raw.deltaQty),
          newUnitPrice: nullableNumber(raw.newUnitPrice),
          amount: number(raw.amount),
          auditedAmount: nullableNumber(raw.auditedAmount),
          note: text(raw.note),
        }
      })
      for (const line of lines) {
        if (!line.boqLineId)
          continue
        const existing = state.boqLines.get(line.boqLineId)
        const candidate: BoqLineSeed = {
          id: line.boqLineId,
          projectId: project.id,
          contractId: required(contract?.id, '合同'),
          itemName: line.itemName,
          unit: line.unit,
          qty: line.contractQty ?? 0,
          unitPrice: line.contractUnitPrice ?? 0,
          autoQty: line.autoQty ?? 0,
          missingQtyCount: 0,
        }
        if (existing) {
          if (existing.projectId !== candidate.projectId || existing.contractId !== candidate.contractId)
            throw failure('conflict', '迁移甲方商务单据包含跨合同的 BOQ 行稳定 ID')
          continue
        }
        state.boqLines.set(line.boqLineId, candidate)
      }
      const files = jsonRecords(entityAttribute(entity, 'filesJson')).map((raw, index) => ({
        id: text(raw.id) || `${entity.id}-file-${index + 1}`,
        fileName: text(raw.fileName),
        fileSize: Math.max(number(raw.fileSize), 0),
        mimeType: text(raw.mimeType),
        category: text(raw.category),
        uploader: text(raw.uploader),
        uploadedAt: text(raw.uploadedAt) || null,
        deletedAt: text(raw.deletedAt) || null,
      }))
      for (const file of files) {
        if (file.uploadedAt && !isISODateTimeDTO(file.uploadedAt))
          throw failure('validation-failed', '迁移甲方商务单据附件上传时间无效')
        if (file.deletedAt && !isISODateTimeDTO(file.deletedAt))
          throw failure('validation-failed', '迁移甲方商务单据附件删除时间无效')
        if (kind === 'acceptance'
          && !['acceptance-report', 'warranty-confirmation'].includes(file.category)) {
          throw failure('validation-failed', '迁移甲方验收附件分类无效')
        }
      }
      const rawStatus = entityAttribute(entity, 'status')
      const status = kind === 'owner_report'
        ? rawStatus === 'exported' ? 'audited' : rawStatus === 'adjusted' ? 'reported' : rawStatus
        : rawStatus
      const statusesByKind: Record<OwnerCommercialDocumentKind, readonly string[]> = {
        owner_change: ['draft', 'rejected', 'submitted', 'approved'],
        owner_report: ['draft', 'reported', 'audited'],
        acceptance: ['draft', 'submitted', 'accepted', 'warranty', 'expired'],
        final_settlement: ['draft', 'submitted', 'audited'],
        owner_penalty: ['draft', 'submitted'],
        sub_change: ['draft', 'rejected', 'submitted', 'approved'],
        sub_settlement: ['draft', 'confirmed'],
        project_penalty: ['draft', 'pending', 'repairing', 'repaired_self', 'repaired_other', 'deducted'],
      }
      if (!statusesByKind[kind].includes(status)) {
        throw failure(
          'validation-failed',
          kind === 'acceptance' ? '迁移甲方验收状态无效' : '迁移甲方商务单据状态无效',
        )
      }
      const createdAt = entityAttribute(entity, 'createdAt') || '1970-01-01T00:00:00.000Z'
      if (!isISODateTimeDTO(createdAt))
        throw failure('validation-failed', '迁移甲方商务单据创建时间无效')
      const updatedAt = entityAttribute(entity, 'updatedAt') || createdAt
      if (!isISODateTimeDTO(updatedAt))
        throw failure('validation-failed', '迁移甲方商务单据更新时间无效')
      const approvalSequenceAt = kind === 'owner_change' && status === 'approved'
        ? entityAttribute(entity, 'approvalSequenceAt') || updatedAt
        : null
      if (approvalSequenceAt && !isISODateTimeDTO(approvalSequenceAt))
        throw failure('validation-failed', '迁移甲方变洽签签证执行时间无效')
      const applicationDate = entityAttribute(entity, 'applicationDate') || null
      if (applicationDate && !isISODateDTO(applicationDate))
        throw failure('validation-failed', '迁移甲方商务单据申报日期无效')
      const ownerPenaltyAmount = kind === 'owner_penalty' ? number(entity.amount) : null
      const ownerPenaltyReason = kind === 'owner_penalty'
        ? entityAttribute(entity, 'penaltyReason') || entity.name
        : null
      if (kind === 'owner_penalty' && status === 'submitted') {
        if (!applicationDate)
          throw failure('validation-failed', '迁移甲方罚扣日期必填')
        if (ownerPenaltyAmount == null || ownerPenaltyAmount <= 0)
          throw failure('validation-failed', '罚扣金额必须大于 0')
        if (!ownerPenaltyReason)
          throw failure('validation-failed', '迁移甲方罚扣事由必填')
      }
      if (kind === 'sub_settlement' && status === 'confirmed' && (Number(entity.amount) <= 0 || !entity.name || !applicationDate))
        throw failure('validation-failed', '迁移已确认分包结算必须有正金额、名称和日期')
      if (kind === 'sub_change' && status === 'submitted') {
        if (!applicationDate)
          throw failure('validation-failed', '迁移分包变洽签日期必填')
        if (entity.amount === null || number(entity.amount) <= 0)
          throw failure('validation-failed', '迁移分包变洽签审批金额必须大于 0')
        if (!entity.name.trim())
          throw failure('validation-failed', '迁移分包变洽签事由必填')
      }
      const approvalDate = entityAttribute(entity, 'approvalDate') || null
      if (approvalDate && !isISODateDTO(approvalDate))
        throw failure('validation-failed', '迁移甲方变洽签签证日期无效')
      const quantitySourceUpdatedAt = entityAttribute(entity, 'quantitySourceUpdatedAt') || null
      if (quantitySourceUpdatedAt && !isISODateTimeDTO(quantitySourceUpdatedAt))
        throw failure('validation-failed', '迁移甲方报量来源更新时间无效')
      const submittedAt = entityAttribute(entity, 'submittedAt') || null
      if (submittedAt && !isISODateTimeDTO(submittedAt))
        throw failure('validation-failed', '迁移甲方报量提交时间无效')
      const acceptanceLifecycleRaw = jsonObject(entityAttribute(entity, 'acceptanceLifecycleJson'))
      const acceptanceDate = text(acceptanceLifecycleRaw.acceptanceDate) || null
      const warrantyStartDate = text(acceptanceLifecycleRaw.warrantyStartDate) || null
      const warrantyEndDate = text(acceptanceLifecycleRaw.warrantyEndDate) || null
      const warrantyConfirmationDate = text(acceptanceLifecycleRaw.warrantyConfirmationDate) || null
      for (const [date, label] of [
        [acceptanceDate, '验收日期'],
        [warrantyStartDate, '保修开始日期'],
        [warrantyEndDate, '保修结束日期'],
        [warrantyConfirmationDate, '到期确认日期'],
      ] as const) {
        if (date && !isISODateDTO(date))
          throw failure('validation-failed', `迁移甲方验收${label}无效`)
      }
      const lifecycleEventIds = new Set<string>()
      const lifecycleEventTargets = new Set<string>()
      const lifecycleEventTransitions = {
        'submit': ['draft', 'submitted'],
        'accept': ['submitted', 'accepted'],
        'start-warranty': ['accepted', 'warranty'],
        'confirm-expiry': ['warranty', 'expired'],
      } as const
      const lifecycleEvents = jsonRecords(entityAttribute(entity, 'lifecycleEventsJson')).map((raw, index) => {
        const action = text(raw.action)
        const fromStatus = text(raw.fromStatus)
        const toStatus = text(raw.toStatus)
        const occurredAt = text(raw.occurredAt)
        const id = text(raw.id) || `${entity.id}-event-${index + 1}`
        const expected = lifecycleEventTransitions[action as keyof typeof lifecycleEventTransitions]
        if (!['submit', 'accept', 'start-warranty', 'confirm-expiry'].includes(action)
          || !['draft', 'submitted', 'accepted', 'warranty'].includes(fromStatus)
          || !['submitted', 'accepted', 'warranty', 'expired'].includes(toStatus)
          || !isISODateTimeDTO(occurredAt)) {
          throw failure('validation-failed', '迁移甲方验收生命周期审计无效')
        }
        if (!expected || expected[0] !== fromStatus || expected[1] !== toStatus)
          throw failure('validation-failed', '迁移甲方验收生命周期审计转换无效')
        if (lifecycleEventIds.has(id) || lifecycleEventTargets.has(toStatus))
          throw failure('validation-failed', '迁移甲方验收生命周期审计重复')
        lifecycleEventIds.add(id)
        lifecycleEventTargets.add(toStatus)
        return {
          id,
          action: action as 'submit' | 'accept' | 'start-warranty' | 'confirm-expiry',
          fromStatus: fromStatus as 'draft' | 'submitted' | 'accepted' | 'warranty',
          toStatus: toStatus as 'submitted' | 'accepted' | 'warranty' | 'expired',
          actorId: text(raw.actorId),
          actorName: text(raw.actorName),
          occurredAt,
          note: text(raw.note),
        }
      })
      const source: OwnerCommercialDocumentSource = {
        dataOrigin: 'real',
        kind,
        id: entity.id,
        no: entityAttribute(entity, 'no'),
        name: entity.name,
        documentType: entityAttribute(entity, 'documentType'),
        projectId: project.id,
        projectName: project.name,
        projectPermission: 'allowed',
        customerId,
        customerName: customer?.name ?? '',
        customerPermission: 'allowed',
        supplierId,
        supplierName: supplier?.name ?? '',
        supplierPermission: 'allowed',
        contractId: contract?.id ?? null,
        contractNo: contract?.no ?? '',
        contractName: contract?.name ?? '',
        contractPermission: 'allowed',
        sourceType,
        sourceId: entity.id,
        sourceLocked: entityNumberAttribute(entity, 'sourceLocked') === 1,
        periodNo: entityAttribute(entity, 'periodNo'),
        applicationDate,
        approvalDate,
        approvalSequenceAt,
        quantityBasis: entityAttribute(entity, 'quantityBasis') || null,
        quantitySourceVersion: entityAttribute(entity, 'quantitySourceVersion') || null,
        quantitySourceUpdatedAt,
        operatorName: entityAttribute(entity, 'operatorName'),
        submittedAt,
        status,
        statusNote: entityAttribute(entity, 'statusNote'),
        amount: ownerPenaltyAmount ?? number(entity.amount),
        boqAmount: kind === 'owner_change' ? round(lines.reduce((sum, line) => sum + line.amount, 0)) : null,
        taxExclusiveAmount: kind === 'owner_change' ? entityNumberAttribute(entity, 'taxExclusiveAmount') ?? 0 : null,
        appliedTaxExclusiveAmount: kind === 'owner_change' ? entityNumberAttribute(entity, 'appliedTaxExclusiveAmount') ?? 0 : null,
        auditedAmount: kind === 'sub_change' ? null : entityNumberAttribute(entity, 'auditedAmount'),
        changedArea: kind === 'sub_change' ? entityNumberAttribute(entity, 'changedArea') : null,
        actualApprovedPrice: kind === 'sub_change' ? entityNumberAttribute(entity, 'actualApprovedPrice') : null,
        note: entityAttribute(entity, 'note'),
        version: 1,
        createdAt,
        updatedAt,
        lines,
        files,
        acceptanceLifecycle: kind === 'acceptance'
          ? {
              acceptanceOrganization: text(acceptanceLifecycleRaw.acceptanceOrganization),
              acceptancePerson: text(acceptanceLifecycleRaw.acceptancePerson),
              acceptanceDate,
              acceptanceConclusion: text(acceptanceLifecycleRaw.acceptanceConclusion),
              warrantyOwner: text(acceptanceLifecycleRaw.warrantyOwner),
              warrantyStartDate,
              warrantyEndDate,
              warrantyConfirmationOrganization: text(acceptanceLifecycleRaw.warrantyConfirmationOrganization) || null,
              warrantyConfirmationDate,
              warrantyConfirmationNote: text(acceptanceLifecycleRaw.warrantyConfirmationNote),
              events: lifecycleEvents,
            }
          : undefined,
        settlementBasis: kind === 'final_settlement'
          ? entityAttribute(entity, 'settlementBasis')
          : undefined,
        crewId: kind === 'project_penalty' ? entity.references.crewId ?? null : undefined,
        crewName: kind === 'project_penalty' ? state.crews.get(entity.references.crewId ?? '')?.name ?? '' : undefined,
        penaltyFacts: kind === 'project_penalty' ? { deadline: entityAttribute(entity, 'deadline') || null, rectificationNote: entityAttribute(entity, 'rectificationNote'), deductionMethod: entityAttribute(entity, 'deductionMethod'), origin: entityAttribute(entity, 'penaltyOrigin') || null } : undefined,
        deductionNote: kind === 'sub_settlement' ? entityAttribute(entity, 'settlementDifferenceNote') : undefined,
        settlementDifferenceNote: kind === 'final_settlement'
          ? entityAttribute(entity, 'settlementDifferenceNote')
          : undefined,
        finalSettlementEvidence: undefined,
        noticeNo: kind === 'owner_penalty' ? entityAttribute(entity, 'noticeNo') : undefined,
        penaltyReason: kind === 'owner_penalty' ? ownerPenaltyReason ?? '' : undefined,
        appealNote: kind === 'owner_penalty' ? entityAttribute(entity, 'appealNote') : undefined,
      }
      const documentKey = key(kind, source.id)
      if (state.documents.has(documentKey))
        throw failure('conflict', '迁移甲方商务单据 ID 与既有中央命令记录冲突')
      state.documents.set(documentKey, source)
      state.migrationKeys.add(documentKey)
      if (kind === 'owner_report' && source.periodNo) {
        for (const line of source.lines) {
          if (!line.boqLineId)
            continue
          state.monthlyQuantityFacts.push({
            projectId: project.id,
            contractId: required(contract?.id, '合同'),
            periodNo: source.periodNo,
            boqLineId: line.boqLineId,
            autoQty: line.autoQty ?? line.reportedQty ?? 0,
            missingQtyCount: 0,
            quantityBasis: source.quantityBasis ?? 'provisional',
            sourceVersion: source.quantitySourceVersion ?? `migration:${source.id}`,
            sourceUpdatedAt: source.quantitySourceUpdatedAt ?? source.updatedAt,
          })
        }
      }
    }
    const migratedDocuments = entities.filter(row => row.entityType === 'owner_documents' && row.deletedAt === null)
    for (const entity of migratedDocuments.filter(row => row.attributes.kind === 'project_penalty')) {
      const penalty = state.documents.get(key('project_penalty', entity.id))!
      if (penalty.crewId && !state.crews.has(penalty.crewId))
        throw failure('relationship-mismatch', '迁移罚扣班组身份无效')
      if (penalty.penaltyFacts?.deadline && !isIsoDate(penalty.penaltyFacts.deadline))
        throw failure('validation-failed', '迁移罚扣整改期限无效')
      for (const raw of jsonRecords(entityAttribute(entity, 'penaltyDeductionsJson'))) {
        const target = migratedDocuments.find(row => row.legacyId === raw.settlementId && row.attributes.kind === 'sub_settlement')
        const otherTarget = entities.find(row => row.entityType === 'other_settlements' && !row.deletedAt && row.legacyId === raw.settlementId)
        if (target && otherTarget)
          throw failure('relationship-mismatch', '结算旧身份同时对应多个类型，不能猜接')
        const settlement = otherTarget
          ? { id: otherTarget.id, projectId: otherTarget.references.projectId ?? null, supplierId: otherTarget.references.supplierId ?? null, contractId: otherTarget.references.contractId ?? null, status: ['confirmed', '已确认'].includes(String(otherTarget.attributes.status)) ? 'confirmed' : String(otherTarget.attributes.status), amount: otherTarget.amount == null ? null : Number(otherTarget.amount) }
          : target ? state.documents.get(key('sub_settlement', target.id)) : null
        const amount = Number(raw.amount)
        if (!settlement || !matchesPenaltySettlement(penalty, settlement) || !Number.isFinite(amount) || amount <= 0 || round(amount) !== amount || !isISODateTimeDTO(raw.occurredAt))
          throw failure('relationship-mismatch', '迁移抵扣缺少真实一致结算、有效金额或发生时间')
        const id = required(raw.id, '抵扣旧 ID')
        if (state.penaltyDeductions.has(id))
          throw failure('conflict', '迁移抵扣 ID 重复')
        state.penaltyDeductions.set(id, { id, penaltyId: penalty.id, settlementId: settlement.id, amount, actorId: text(raw.actorId), occurredAt: text(raw.occurredAt), commandId: text(raw.commandId), note: text(raw.note) })
        if (settlement.amount !== null && round([...state.penaltyDeductions.values()].filter(row => row.settlementId === settlement.id).reduce((sum, row) => sum + row.amount, 0)) > settlement.amount)
          throw failure('validation-failed', '迁移抵扣超出结算金额')
      }
      const total = round([...state.penaltyDeductions.values()].filter(row => row.penaltyId === penalty.id).reduce((sum, row) => sum + row.amount, 0))
      if (total > penalty.amount || (penalty.amount > 0 && total === penalty.amount && penalty.status !== 'deducted') || (penalty.status === 'draft' && total > 0) || (penalty.status === 'deducted' && total !== penalty.amount))
        throw failure('validation-failed', '迁移罚扣金额、状态与抵扣事实不一致')
      for (const settlement of [...state.documents.values()].filter(row => row.kind === 'sub_settlement')) {
        if (round([...state.penaltyDeductions.values()].filter(row => row.settlementId === settlement.id).reduce((sum, row) => sum + row.amount, 0)) > settlement.amount)
          throw failure('validation-failed', '迁移抵扣超出结算金额')
      }
    }
    state.sourceVersion += 1
    return () => workspaces.set(workspaceKey(sessionId), state)
  }

  function synchronizeMigrationSnapshot(
    snapshot: CoreMigrationSnapshotDTO,
    sessionId?: string | null,
  ): void {
    prepareMigrationSnapshot(snapshot, sessionId)()
  }

  return {
    reset(sessionId?: string | null) {
      if (sessionId)
        workspaces.delete(sessionId)
      else
        workspaces.clear()
    },
    rows(sessionId?: string | null) {
      const state = stateFor(sessionId)
      return [...state.documents.values()].map(source => withFinalSettlementEvidence(state, source))
    },
    sourceVersion(sessionId?: string | null) {
      const state = stateFor(sessionId)
      const receipts = currentReceiptFacts(state)
      return `owner-document-command-${state.sourceVersion}${receipts ? `+${receipts.sourceVersion}` : ''}`
    },
    importExisting(
      records: readonly OwnerCommercialDocumentSource[],
      sessionId?: string | null,
    ): string[] {
      const state = stateFor(sessionId)
      const imported: string[] = []
      for (const record of records) {
        const documentKey = key(record.kind, record.id)
        const current = state.documents.get(documentKey)
        if (current) {
          if (JSON.stringify(current) === JSON.stringify(record))
            continue
          throw failure('conflict', '甲方商务单据 ID 已存在且内容不一致')
        }
        state.documents.set(documentKey, clone(record))
        imported.push(record.id)
      }
      if (imported.length)
        state.sourceVersion += 1
      return imported
    },
    prepareMigrationSnapshot,
    synchronizeMigrationSnapshot,
    context(
      session: BusinessSession,
      sessionId?: string | null,
      kind?: OwnerCommercialDocumentKind,
    ): OwnerCommercialDocumentCommandContextDTO {
      authorize(session, kind)
      const state = stateFor(sessionId)
      const includeOwner = kind ? kind !== 'sub_change' && kind !== 'sub_settlement' && kind !== 'project_penalty' : session.capabilities.includes(OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY)
      const includeSubcontract = kind ? (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty') : session.capabilities.includes(SUBCONTRACT_CHANGE_WRITE_CAPABILITY)
      return {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: [...session.capabilities],
        crews: includeSubcontract ? [...state.crews.values()].map(row => ({ id: row.id, label: row.name })) : [],
        settlements: includeSubcontract ? [...state.documents.values()].filter(row => row.kind === 'sub_settlement' && row.status === 'confirmed').map(row => ({ id: row.id, label: row.name || row.no, projectId: row.projectId, supplierId: row.supplierId ?? null, contractId: row.contractId, amount: row.amount, version: String(row.version), remainingAmount: round(row.amount - [...state.penaltyDeductions.values()].filter(d => d.settlementId === row.id).reduce((sum, d) => sum + d.amount, 0)) })) : [],
        projects: [...effectiveProjects(state).values()].map(row => ({ id: row.id, label: row.name, customerId: row.customerId })),
        customers: includeOwner ? [...effectiveCustomers(state).values()].map(row => ({ id: row.id, label: row.name })) : [],
        suppliers: includeSubcontract ? [...effectiveSuppliers(state).values()].map(row => ({ id: row.id, label: row.name })) : [],
        contracts: [
          ...(includeOwner
            ? [...effectiveConstructionContracts(state).values()].map(row => ({
                id: row.id,
                label: row.name,
                hint: row.no,
                projectId: row.projectId,
                customerId: row.customerId,
                supplierId: null,
                kind: 'construction' as const,
                ...contractSummary(state, row),
              }))
            : []),
          ...(includeSubcontract
            ? [...effectiveSubcontractContracts(state).values()].map(row => ({
                id: row.id,
                label: row.name,
                hint: row.no,
                projectId: row.projectId,
                customerId: null,
                supplierId: row.supplierId,
                kind: 'subcontract' as const,
                changedContractAmount: row.amount ?? null,
                receivedAmount: null,
              }))
            : []),
        ],
      }
    },
    quantityBoqFacts(projectId: string, sessionId?: string | null): QuantityBoqWorkspace & { sourceVersion: string } {
      const state = stateFor(sessionId)
      const contracts = effectiveConstructionContracts(state)
      const lines: QuantityBoqLine[] = []
      if (effectiveProjects(state).has(projectId)) {
        for (const contract of contracts.values()) {
          if (contract.projectId !== projectId)
            continue
          const effective = effectiveBoqState(state, { projectId, contractId: contract.id })
          for (const line of state.boqLines.values()) {
            if (line.projectId !== projectId || line.contractId !== contract.id)
              continue
            const current = effective.get(line.id)!
            lines.push({
              id: line.id,
              contractId: contract.id,
              contractName: contract.name,
              contractNo: contract.no,
              itemName: line.itemName,
              unit: line.unit,
              qty: line.qty,
              unitPrice: line.unitPrice,
              approvedDeltaQty: current.approvedDeltaQty,
              effectiveUnitPrice: current.effectiveUnitPrice,
              building: line.building ?? null,
              unitType: line.unitType ?? null,
              floorZone: line.floorZone ?? null,
              updatedAt: current.updatedAt,
            })
          }
        }
      }
      lines.sort((left, right) => left.contractId.localeCompare(right.contractId) || left.id.localeCompare(right.id))
      const sourceVersion = `quantity-boq:${createHash('sha256').update(JSON.stringify([projectId, lines])).digest('hex')}`
      return { projectId, lines: clone(lines), sourceVersion }
    },
    boqLinesFor(projectId: string, contractId: string, periodNo = '', sessionId?: string | null, monthlyFacts?: readonly QuantityMonthlyBoqFact[]): OwnerDocumentBoqLine[] {
      const state = stateFor(sessionId)
      if (!effectiveProjects(state).has(projectId) || effectiveConstructionContracts(state).get(contractId)?.projectId !== projectId)
        return []
      const effective = effectiveBoqState(state, { projectId, contractId })
      const facts = periodNo
        ? (monthlyFacts ?? state.monthlyQuantityFacts).filter(fact => fact.projectId === projectId
          && fact.contractId === contractId && fact.periodNo === periodNo)
        : []
      const factByLine = new Map(facts.map(fact => [fact.boqLineId, fact]))
      if (periodNo && !facts.length)
        return []
      return [...state.boqLines.values()]
        .filter(line => line.projectId === projectId && line.contractId === contractId)
        .filter(line => !periodNo || factByLine.has(line.id))
        .map(({ projectId: _projectId, contractId: _contractId, ...line }) => {
          const fact = factByLine.get(line.id)
          const effectiveLine = effective.get(line.id)
          return clone({
            ...line,
            qty: effectiveLine?.effectiveQty ?? line.qty,
            unitPrice: effectiveLine?.effectiveUnitPrice ?? line.unitPrice,
            autoQty: fact?.autoQty ?? line.autoQty,
            missingQtyCount: fact?.missingQtyCount ?? line.missingQtyCount,
          })
        })
    },
    form(
      kind: OwnerCommercialDocumentKind,
      id: string,
      session: BusinessSession,
      sessionId?: string | null,
    ): OwnerCommercialDocumentFormReadDTO {
      authorize(session, kind)
      const state = stateFor(sessionId)
      const stored = document(state, kind, id)
      const source = stored ? withFinalSettlementEvidence(state, stored) : null
      if (!source)
        throw failure('not-found', '甲方商务单据不存在或已删除')
      return {
        kind,
        id,
        draft: formDraft(source),
        attachments: source.files.map(file => fileRecord(kind, id, file)),
        version: String(source.version),
        updatedAt: source.updatedAt,
      }
    },
    async execute(
      input: OwnerCommercialDocumentCommandRequestDTO,
      session: BusinessSession,
      sessionId?: string | null,
    ): Promise<OwnerCommercialDocumentCommandResultDTO> {
      const request = clone(input)
      authorizeCommand(request, session)
      const state = stateFor(sessionId)
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return clone(duplicate)
      const run = (monthlyFacts?: readonly QuantityMonthlyBoqFact[]) => {
        const state = stateFor(sessionId)
        const duplicate = state.commands.get(request.commandId)
        if (duplicate)
          return clone(duplicate)
        const previousMonthlyFacts = state.monthlyQuantityFacts
        if (monthlyFacts)
          state.monthlyQuantityFacts = monthlyFacts.map(clone)
        try {
          let source: OwnerCommercialDocumentSource
          switch (request.action) {
            case 'save':
            case 'submit':
              source = save(request, state)
              break
            case 'deduct-penalty':
            case 'rectify-penalty':
              source = penaltyAction(request, state)
              break
            case 'approve':
              source = approve(request, state)
              break
            case 'audit':
              source = audit(request, state)
              break
            case 'transition-acceptance':
              source = transitionAcceptance(request, state)
              break
            case 'attachments':
              source = updateAttachments(request, state)
              break
            case 'delete':
              source = remove(request, state)
              break
          }
          const commandResult = result(request, source)
          state.commands.set(request.commandId, commandResult)
          return clone(commandResult)
        }
        finally {
          state.monthlyQuantityFacts = previousMonthlyFacts
        }
      }
      if (options.withMonthlyQuantity && request.kind === 'owner_report' && (request.action === 'save' || request.action === 'submit') && request.draft.projectId) {
        const basis = request.draft.quantityBasis ?? 'field'
        if (!isQuantityBasis(basis))
          throw failure('validation-failed', '取数基准只能是合同量、暂估量或现场复核量')
        if (request.action === 'submit')
          return options.withMonthlyQuantity(String(request.draft.projectId), sessionId, run, basis)
      }
      return run()
    },
  }
}

export const ownerCommercialDocumentCommandTestInstance
  = createOwnerCommercialDocumentCommandTestInstance({
    withMonthlyQuantity: async (projectId, sessionId, consume, basis) => {
      const { quantityTestInstance } = await import('./quantity-runtime')
      return quantityTestInstance.withMonthly({ projectId, origin: 'real', includeDemo: false, basis }, consume, sessionId)
    },
    receiptSource: sessionId => receiptReadTestInstance.facts(sessionId),
    projectSource: projectCommandTestInstance,
    customerSource: customerCommandTestInstance,
    constructionContractSource: constructionContractCommandTestInstance,
    subcontractContractSource: subcontractContractCommandTestInstance,
    crewSource: crewWorkerCommandTestInstance,
    projects: [{ id: 'project-real-320', name: '中央正式施工项目', customerId: 'customer-real-320' }],
    customers: [{ id: 'customer-real-320', name: '中央正式甲方客户' }],
    contracts: [{
      id: 'construction-contract-existing-320',
      no: 'SG-CENTRAL-320',
      name: '既有中央施工合同',
      projectId: 'project-real-320',
      customerId: 'customer-real-320',
      amount: 1200000,
    }],
    finalSettlementSupplements: [{
      contractId: 'construction-contract-existing-320',
      id: 'supplement-real-325',
      no: 'BC-2026-325',
      name: '结算范围补充协议',
      status: 'approved',
      amount: 80000,
      date: '2026-08-12',
    }],
    finalSettlementReceipts: [{
      contractId: 'construction-contract-existing-320',
      projectId: 'project-real-320',
      customerId: 'customer-real-320',
      id: 'receipt-real-325',
      no: 'SK-2026-325',
      name: '甲方工程款收款',
      status: 'submitted',
      amount: 900000,
      date: '2026-08-15',
    }],
    boqLines: [{
      id: 'boq-line-real-323',
      projectId: 'project-real-320',
      contractId: 'construction-contract-existing-320',
      itemName: '桥架安装',
      unit: 'm',
      qty: 100,
      unitPrice: 52,
      autoQty: 90,
      missingQtyCount: 0,
    }],
    monthlyQuantityFacts: [{
      projectId: 'project-real-320',
      contractId: 'construction-contract-existing-320',
      periodNo: '2026-08',
      boqLineId: 'boq-line-real-323',
      autoQty: 90,
      missingQtyCount: 0,
      quantityBasis: 'field',
      sourceVersion: 'monthly-quantity-real-323-v1',
      sourceUpdatedAt: '2026-08-24T10:00:00.000Z',
    }],
  })
