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
import type { BusinessSession } from './business-session'
import { calculateBoqChangeLine } from '../../app/lib/boq/change-calculation'
import {
  OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
} from '../../app/lib/owner-document/central-command-contract'
import {
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
} from '../../app/lib/owner-document/central-repository'
import { isISODateDTO, isISODateTimeDTO } from '../../app/types/read-model'

interface ProjectSeed {
  id: string
  name: string
  customerId: string | null
}

interface CustomerSeed {
  id: string
  name: string
}

interface ContractSeed {
  id: string
  no: string
  name: string
  projectId: string
  customerId: string | null
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

export interface OwnerCommercialDocumentCommandTestInstanceOptions {
  now?: () => string
  createId?: (kind: OwnerCommercialDocumentKind) => string
  createBoqLineId?: (changeId: string, changeLineId: string) => string
  createAttachmentId?: () => string
  projects?: readonly ProjectSeed[]
  customers?: readonly CustomerSeed[]
  contracts?: readonly ContractSeed[]
  boqLines?: readonly BoqLineSeed[]
  monthlyQuantityFacts?: readonly MonthlyQuantityFactSeed[]
  documents?: readonly OwnerCommercialDocumentSource[]
}

interface WorkspaceState {
  documents: Map<string, OwnerCommercialDocumentSource>
  commands: Map<string, OwnerCommercialDocumentCommandResultDTO>
  migrationKeys: Set<string>
  boqLines: Map<string, BoqLineSeed>
  monthlyQuantityFacts: MonthlyQuantityFactSeed[]
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
  return kind === 'owner_change' ? 'owner_change_order' : 'monthly_statement'
}

function formDraft(source: OwnerCommercialDocumentSource): OwnerDocumentDraft & { id: string } {
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

export function createOwnerCommercialDocumentCommandTestInstance(
  options: OwnerCommercialDocumentCommandTestInstanceOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? defaultId
  const createBoqLineId = options.createBoqLineId ?? (() => `boq-line-${crypto.randomUUID()}`)
  const createAttachmentId = options.createAttachmentId ?? (() => `owner-file-${crypto.randomUUID()}`)
  const baseProjects = (options.projects ?? []).map(clone)
  const baseCustomers = (options.customers ?? []).map(clone)
  const baseContracts = (options.contracts ?? []).map(clone)
  const baseBoqLines = (options.boqLines ?? []).map(clone)
  const baseMonthlyQuantityFacts = (options.monthlyQuantityFacts ?? []).map(clone)
  const projects = new Map(baseProjects.map(row => [row.id, clone(row)]))
  const customers = new Map(baseCustomers.map(row => [row.id, clone(row)]))
  const contracts = new Map(baseContracts.map(row => [row.id, clone(row)]))
  const workspaces = new Map<string, WorkspaceState>()

  function freshState(): WorkspaceState {
    return {
      documents: new Map((options.documents ?? []).map(row => [key(row.kind, row.id), clone(row)])),
      commands: new Map(),
      migrationKeys: new Set(),
      boqLines: new Map(baseBoqLines.map(row => [row.id, clone(row)])),
      monthlyQuantityFacts: baseMonthlyQuantityFacts.map(clone),
      sourceVersion: 1,
    }
  }

  function stateFor(sessionId?: string | null): WorkspaceState {
    const workspaceKey = sessionId || 'default'
    let state = workspaces.get(workspaceKey)
    if (!state) {
      state = freshState()
      workspaces.set(workspaceKey, state)
    }
    return state
  }

  function authorize(session: BusinessSession): void {
    if (!session.capabilities.includes(OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY))
      throw failure('forbidden', '无甲方商务单据写入权限')
  }

  function authorizeCommand(request: OwnerCommercialDocumentCommandRequestDTO, session: BusinessSession): void {
    authorize(session)
    if (request.workspaceId !== session.workspaceId
      || request.actorId !== session.actorId
      || request.requiredCapability !== OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY) {
      throw failure('forbidden', '无甲方商务单据写入权限')
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

  function relations(draft: OwnerDocumentDraft, complete: boolean) {
    const projectId = complete ? required(draft.projectId, '项目') : text(draft.projectId)
    const contractId = complete ? required(draft.contractId, '施工合同') : text(draft.contractId)
    if (contractId && !projectId)
      throw failure('relationship-mismatch', '选择施工合同前必须先选择项目')
    const project = projectId ? projects.get(projectId) ?? null : null
    const contract = contractId ? contracts.get(contractId) ?? null : null
    if (projectId && !project)
      throw failure('relationship-mismatch', '项目不存在或已删除')
    if (contractId && (!contract || contract.projectId !== projectId))
      throw failure('relationship-mismatch', '施工合同不存在、已删除或不属于所选项目')
    const customerId = contract?.customerId ?? project?.customerId ?? null
    const customer = customerId ? customers.get(customerId) ?? null : null
    return { project, contract, customerId, customer }
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
        .map(line => [line.id, { effectiveQty: line.qty, effectiveUnitPrice: line.unitPrice }]),
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
        if (line.operation === 'qty')
          target.effectiveQty += line.deltaQty ?? 0
        if (line.operation === 'price' && line.newUnitPrice != null)
          target.effectiveUnitPrice = line.newUnitPrice
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
          catalog ? effective.get(catalog.id) ?? null : null,
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
        if (operation === 'qty')
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
      const reportedQty = nullableNumber(raw.reportedQty) ?? fact.autoQty
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
    const relation = relations(request.draft, isSubmit)
    const applicationDate = text(request.draft.applicationDate)
    if (applicationDate && !isIsoDate(applicationDate))
      throw failure('validation-failed', '申报日期格式必须为 yyyy-mm-dd')
    if (isSubmit && !applicationDate)
      throw failure('validation-failed', '申报日期必填')
    let report: ReturnType<typeof reportSnapshot> | null = null
    let lines: OwnerCommercialDocumentLineSource[]
    if (isSubmit) {
      report = request.kind === 'owner_report' ? reportSnapshot(request.draft, state) : null
      lines = request.kind === 'owner_change' ? changeLines(request.draft, state) : report!.lines
    }
    else if (canResolveDraft(request.kind, request.draft, state)) {
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
      quantityBasis: report?.evidence.basis ?? null,
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

  function synchronizeMigrationSnapshot(
    snapshot: CoreMigrationSnapshotDTO,
    sessionId?: string | null,
  ): void {
    const state = stateFor(sessionId)
    for (const migratedKey of state.migrationKeys)
      state.documents.delete(migratedKey)
    state.migrationKeys.clear()
    state.monthlyQuantityFacts = baseMonthlyQuantityFacts.map(clone)

    projects.clear()
    customers.clear()
    contracts.clear()
    state.boqLines.clear()
    for (const row of baseProjects)
      projects.set(row.id, clone(row))
    for (const row of baseCustomers)
      customers.set(row.id, clone(row))
    for (const row of baseContracts)
      contracts.set(row.id, clone(row))
    for (const row of baseBoqLines)
      state.boqLines.set(row.id, clone(row))

    const entities = snapshot.authority === 'central' ? snapshot.entities : []
    for (const entity of entities) {
      if (entity.deletedAt !== null)
        continue
      if (entity.entityType === 'customers')
        customers.set(entity.id, { id: entity.id, name: entity.name })
      if (entity.entityType === 'projects') {
        projects.set(entity.id, {
          id: entity.id,
          name: entity.name,
          customerId: entity.references.customerId ?? null,
        })
      }
      if (entity.entityType === 'construction_contracts') {
        contracts.set(entity.id, {
          id: entity.id,
          no: entityAttribute(entity, 'no'),
          name: entity.name,
          projectId: entity.references.projectId ?? '',
          customerId: entity.references.customerId ?? null,
        })
      }
    }

    for (const entity of entities) {
      if (entity.entityType !== 'construction_contracts' || entity.deletedAt !== null)
        continue
      const contract = contracts.get(entity.id)
      const projectId = entity.references.projectId ?? ''
      if (!contract || !projectId || contract.projectId !== projectId)
        throw failure('relationship-mismatch', '迁移 BOQ 目录的项目与施工合同关系无效')
      for (const raw of jsonRecords(entityAttribute(entity, 'boqCatalogJson'))) {
        const id = required(raw.id, 'BOQ 行')
        const candidate: BoqLineSeed = {
          id,
          projectId,
          contractId: contract.id,
          itemName: required(raw.itemName, 'BOQ 名称'),
          unit: text(raw.unit),
          qty: number(raw.qty),
          unitPrice: number(raw.unitPrice),
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
          contractId: contract.id,
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
      if (kind !== 'owner_change' && kind !== 'owner_report')
        throw failure('validation-failed', '甲方商务单据迁移类型无效')
      const projectId = entity.references.projectId ?? null
      const contractId = entity.references.contractId ?? null
      const project = projectId ? projects.get(projectId) ?? null : null
      const contract = contractId ? contracts.get(contractId) ?? null : null
      if (!project || !contract || contract.projectId !== project.id)
        throw failure('relationship-mismatch', '迁移甲方商务单据的项目与施工合同关系无效')
      const customerId = contract.customerId ?? project.customerId
      const customer = customerId ? customers.get(customerId) ?? null : null
      const sourceTypeRaw = entityAttribute(entity, 'sourceType')
      const sourceType = sourceTypeRaw === 'manual' || sourceTypeRaw === 'monthly_statement'
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
          contractId: contract.id,
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
      }
      const rawStatus = entityAttribute(entity, 'status')
      const status = kind === 'owner_report'
        ? rawStatus === 'exported' ? 'audited' : rawStatus === 'adjusted' ? 'reported' : rawStatus
        : rawStatus
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
      const approvalDate = entityAttribute(entity, 'approvalDate') || null
      if (approvalDate && !isISODateDTO(approvalDate))
        throw failure('validation-failed', '迁移甲方变洽签签证日期无效')
      const quantitySourceUpdatedAt = entityAttribute(entity, 'quantitySourceUpdatedAt') || null
      if (quantitySourceUpdatedAt && !isISODateTimeDTO(quantitySourceUpdatedAt))
        throw failure('validation-failed', '迁移甲方报量来源更新时间无效')
      const submittedAt = entityAttribute(entity, 'submittedAt') || null
      if (submittedAt && !isISODateTimeDTO(submittedAt))
        throw failure('validation-failed', '迁移甲方报量提交时间无效')
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
        contractId: contract.id,
        contractNo: contract.no,
        contractName: contract.name,
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
        amount: number(entity.amount),
        boqAmount: kind === 'owner_change' ? round(lines.reduce((sum, line) => sum + line.amount, 0)) : null,
        taxExclusiveAmount: kind === 'owner_change' ? entityNumberAttribute(entity, 'taxExclusiveAmount') ?? 0 : null,
        appliedTaxExclusiveAmount: kind === 'owner_change' ? entityNumberAttribute(entity, 'appliedTaxExclusiveAmount') ?? 0 : null,
        auditedAmount: entityNumberAttribute(entity, 'auditedAmount'),
        note: entityAttribute(entity, 'note'),
        version: 1,
        createdAt,
        updatedAt,
        lines,
        files,
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
            contractId: contract.id,
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
    state.sourceVersion += 1
  }

  return {
    reset(sessionId?: string | null) {
      if (sessionId)
        workspaces.delete(sessionId)
      else
        workspaces.clear()
    },
    rows(sessionId?: string | null) {
      return [...stateFor(sessionId).documents.values()].map(clone)
    },
    sourceVersion(sessionId?: string | null) {
      return `owner-document-command-${stateFor(sessionId).sourceVersion}`
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
    synchronizeMigrationSnapshot,
    context(session: BusinessSession): OwnerCommercialDocumentCommandContextDTO {
      authorize(session)
      return {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: [...session.capabilities],
        projects: [...projects.values()].map(row => ({ id: row.id, label: row.name, customerId: row.customerId })),
        customers: [...customers.values()].map(row => ({ id: row.id, label: row.name })),
        contracts: [...contracts.values()].map(row => ({
          id: row.id,
          label: row.name,
          hint: row.no,
          projectId: row.projectId,
          customerId: row.customerId,
        })),
      }
    },
    boqLinesFor(projectId: string, contractId: string, periodNo = '', sessionId?: string | null): OwnerDocumentBoqLine[] {
      const state = stateFor(sessionId)
      const effective = effectiveBoqState(state, { projectId, contractId })
      const facts = periodNo
        ? state.monthlyQuantityFacts.filter(fact => fact.projectId === projectId
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
      authorize(session)
      const source = document(stateFor(sessionId), kind, id)
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
      request: OwnerCommercialDocumentCommandRequestDTO,
      session: BusinessSession,
      sessionId?: string | null,
    ): Promise<OwnerCommercialDocumentCommandResultDTO> {
      authorizeCommand(request, session)
      const state = stateFor(sessionId)
      const duplicate = state.commands.get(request.commandId)
      if (duplicate)
        return clone(duplicate)
      let source: OwnerCommercialDocumentSource
      switch (request.action) {
        case 'save':
        case 'submit':
          source = save(request, state)
          break
        case 'approve':
          source = approve(request, state)
          break
        case 'audit':
          source = audit(request, state)
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
    },
  }
}

export const ownerCommercialDocumentCommandTestInstance
  = createOwnerCommercialDocumentCommandTestInstance({
    projects: [{ id: 'project-real-320', name: '中央正式施工项目', customerId: 'customer-real-320' }],
    customers: [{ id: 'customer-real-320', name: '中央正式甲方客户' }],
    contracts: [{
      id: 'construction-contract-existing-320',
      no: 'SG-CENTRAL-320',
      name: '既有中央施工合同',
      projectId: 'project-real-320',
      customerId: 'customer-real-320',
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
