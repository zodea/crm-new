import type { BoqChangeLineDraft, BoqDirectiveType, BoqDocumentType } from '~/lib/boq/change'
import type { TransactionDb } from '~/lib/db/coordinator'
import type { FileRefChanges, FileRefRecord } from '~/lib/forms/file-refs'
import type { QuantityBasis } from '~/lib/quantity/basis'
import type { NavigationIntentDTO } from '~/types/read-model'
import {
  approveBoqChangeOrder,
  createBoqChangeOrder,
  replaceBoqChangeOrderDraft,
  transitionBoqChangeOrder,
} from '~/lib/boq/change'
import { DEFAULT_PROGRESS_QUANTITY_BASIS, loadMonthlyQuantities } from '~/lib/boq/monthly'
import { select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { applyFileRefChanges, listFileRefs } from '~/lib/forms/file-refs'
import { isQuantityBasis } from '~/lib/quantity/basis'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'
import { isISODateDTO } from '~/types/read-model'

export type OwnerDocumentKind
  = | 'owner_change'
    | 'owner_report'
    | 'acceptance'
    | 'final_settlement'
    | 'owner_penalty'
    | 'sub_change'
    | 'sub_settlement'
    | 'project_penalty'

export type OwnerDocumentSaveAction = 'draft' | 'submit'
export type AcceptanceLifecycleTarget = 'accepted' | 'warranty' | 'expired'

export interface OwnerDocumentDraft {
  [key: string]: unknown
  id?: string
  no?: string
  name?: string
  status?: string
  note?: string
  projectId?: string | null
  contractId?: string | null
  supplierId?: string | null
  crewId?: string | null
  lines?: Array<Record<string, unknown>>
}

export interface OwnerDocumentSaveResult {
  id: string
  logIds: readonly string[]
}

export interface OwnerDocumentListRecord {
  id: string
  no: string
  name: string
  noticeNo?: string
  projectId: string | null
  projectName: string
  contractId: string | null
  contractName: string
  supplierId: string | null
  supplierName: string
  crewId: string | null
  crewName: string
  type: string
  period: string
  amount: number
  secondaryAmount: number | null
  tertiaryAmount: number
  quantity: number | null
  date: string
  status: string
  contractNavigation?: NavigationIntentDTO
  projectNavigation?: NavigationIntentDTO
  supplierNavigation?: NavigationIntentDTO
  viewVariant?: 'acceptance' | 'warranty'
  acceptanceOrganization?: string
  acceptancePerson?: string
  acceptanceConclusion?: string
  warrantyOwner?: string
  warrantyStartDate?: string
  warrantyEndDate?: string
  warrantyConfirmationOrganization?: string
  warrantyConfirmationDate?: string
  warrantyConfirmationNote?: string
  attachmentCount?: number
  deductions?: number | null
  netSettlement?: number | null
  cumulativeApplied?: number | null
  remainingApplicable?: number | null
  cumulativePaid?: number | null
  remainingUnpaid?: number | null
}

export interface OwnerDocumentBoqLine {
  unitType?: string | null
  floorZone?: string | null
  id: string
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number | null
  building?: string | null
  updatedAt?: string | null
  autoQty: number
  /** 取数基准下缺量的模板明细条数；> 0 表示自动完成量不完整，需在界面显式标注。 */
  missingQtyCount: number
}

export interface OwnerReportAuditDraft {
  auditedAmount: number
  lines: Array<{
    boqLineId: string
    auditedQty: number
    auditedAmount?: number
  }>
}

export interface PenaltyDeductionView {
  id: string
  penaltyId: string
  settlementId: string
  settlementNo: string
  settlementName: string
  amount: number
  note: string
  createdAt: string
}

export interface OwnerDocumentContractSummary {
  contractAmount: number
  priorSettlementAmount: number
  receivedAmount: number
}

export interface OwnerDocumentLookupOption {
  id: string
  label: string
  hint?: string
}

interface ContractRef {
  id: string
  project_id: string
  supplier_id: string | null
  kind: string
  name: string
  amount: number
  status: string
}

const FILE_OWNER_TYPES: Record<Exclude<OwnerDocumentKind, 'owner_change'>, string> = {
  owner_report: 'monthly_statement',
  acceptance: 'project_acceptance',
  final_settlement: 'owner_final_settlement',
  owner_penalty: 'owner_penalty',
  sub_change: 'subcontract_change_order',
  sub_settlement: 'expenditure_settlement',
  project_penalty: 'penalty_record',
}

const TABLE_BY_KIND: Record<OwnerDocumentKind, string> = {
  owner_change: 'boq_change_orders',
  owner_report: 'monthly_statements',
  acceptance: 'project_acceptances',
  final_settlement: 'owner_final_settlements',
  owner_penalty: 'owner_penalties',
  sub_change: 'subcontract_change_orders',
  sub_settlement: 'expenditure_settlements',
  project_penalty: 'penalty_records',
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function ownerDocumentStatusIsEditable(status: string): boolean {
  return ['draft', 'rejected', '草稿', '已退回'].includes(text(status))
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function required(value: unknown, label: string): string {
  const normalized = text(value)
  if (!normalized)
    throw new Error(`${label}必填`)
  return normalized
}

function requiredPositive(value: unknown, label: string): number {
  const normalized = numberValue(value)
  if (normalized <= 0)
    throw new Error(`${label}必须大于 0`)
  return normalized
}

function documentNo(value: unknown, prefix: string): string {
  const current = text(value)
  if (current)
    return current
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${generateId('no').slice(-6).toUpperCase()}`
}

async function assertEditableDraft(
  tx: TransactionDb,
  table: string,
  id: string,
  label: string,
  condition = '',
): Promise<void> {
  const [record] = await tx.select<{ status: string }>(
    `SELECT status
     FROM "${table}"
     WHERE id = ? AND deleted_at IS NULL ${condition}`,
    [id],
  )
  if (!record)
    throw new Error(`${label}不存在或已删除`)
  if (!ownerDocumentStatusIsEditable(record.status))
    throw new Error(`只有草稿或已退回${label}可以编辑`)
}

async function activeContract(
  tx: TransactionDb,
  projectId: string,
  contractId: string,
  side: 'owner' | 'expenditure',
  supplierId?: string | null,
): Promise<ContractRef> {
  const [contract] = await tx.select<ContractRef>(`
    SELECT id, project_id, supplier_id, kind, name, amount, status
    FROM contracts
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL
  `, [contractId, projectId])
  if (!contract)
    throw new Error('合同不存在、已删除或不属于所选项目')
  if (['draft', '草稿'].includes(contract.status))
    throw new Error('草稿合同不能用于业务单据')
  if (side === 'owner' && contract.kind !== '施工')
    throw new Error('甲方单据只能关联施工合同')
  if (side === 'expenditure' && contract.kind === '施工')
    throw new Error('分包单据只能关联非施工支出合同')
  if (supplierId && contract.supplier_id !== supplierId)
    throw new Error('所选分供方与支出合同不一致')
  return contract
}

async function assertActiveProject(tx: TransactionDb, projectId: string): Promise<void> {
  const [project] = await tx.select<{ id: string }>(
    `SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL`,
    [projectId],
  )
  if (!project)
    throw new Error('项目不存在或已删除')
}

async function assertActiveCrew(tx: TransactionDb, crewId: string | null): Promise<void> {
  if (!crewId)
    return
  const [crew] = await tx.select<{ id: string }>(
    `SELECT id FROM crews WHERE id = ? AND deleted_at IS NULL`,
    [crewId],
  )
  if (!crew)
    throw new Error('班组不存在或已删除')
}

function boqLines(draft: OwnerDocumentDraft): BoqChangeLineDraft[] {
  return (draft.lines ?? []).map((line): BoqChangeLineDraft => ({
    operation: text(line.operation) as BoqChangeLineDraft['operation'],
    boqLineId: text(line.boqLineId) || undefined,
    itemId: text(line.itemId) || null,
    section: text(line.section),
    trade: text(line.trade),
    itemName: text(line.itemName),
    unit: text(line.unit),
    qty: nullableNumber(line.qty) ?? undefined,
    deltaQty: nullableNumber(line.deltaQty) ?? undefined,
    newUnitPrice: nullableNumber(line.newUnitPrice) ?? undefined,
    spec: text(line.spec),
    note: text(line.note),
  }))
}

async function saveOwnerChange(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const projectId = action === 'submit'
    ? required(draft.projectId, '项目')
    : text(draft.projectId) || null
  const contractId = action === 'submit'
    ? required(draft.contractId, '施工合同')
    : text(draft.contractId) || null
  const contract = projectId && contractId
    ? await activeContract(tx, projectId, contractId, 'owner')
    : null
  if (contractId && !projectId)
    throw new Error('选择施工合同前必须先选择项目')
  const no = documentNo(draft.no, 'BQ')
  const name = action === 'submit'
    ? required(draft.name, '变更名称')
    : text(draft.name)
  const lines = boqLines(draft)
  if (lines.length && (!projectId || !contractId))
    throw new Error('量价变更明细必须关联项目与施工合同')
  const documentType = (text(draft.documentType) || 'change_negotiation') as BoqDocumentType
  const directiveType = text(draft.directiveType) as BoqDirectiveType
  const reason = action === 'submit' ? required(draft.reason, '变更事由') : text(draft.reason)

  if (draft.id) {
    const id = text(draft.id)
    const [boqOrder] = await tx.select<{ id: string }>(
      `SELECT id FROM boq_change_orders WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (boqOrder) {
      if (!lines.length)
        throw new Error('量价变更草稿不能改为纯金额签证，请保留至少一条明细')
      if (!projectId || !contractId)
        throw new Error('量价变更明细必须关联项目与施工合同')
      const result = await replaceBoqChangeOrderDraft(tx, id, {
        projectId,
        contractId,
        code: no,
        name,
        documentType,
        directiveNo: text(draft.directiveNo),
        directiveType,
        applicationDate: text(draft.applicationDate),
        reason,
        approvedTaxInclusiveAmount: nullableNumber(draft.approvedTaxInclusiveAmount),
        approvedTaxExclusiveAmount: nullableNumber(draft.approvedTaxExclusiveAmount),
        appliedTaxExclusiveAmount: nullableNumber(draft.appliedTaxExclusiveAmount),
        note: text(draft.note),
        lines,
      })
      const logIds = [...result.logIds]
      if (action === 'submit') {
        const statusLogId = await transitionBoqChangeOrder(tx, id, 'submitted', text(draft.statusNote))
        if (statusLogId)
          logIds.push(statusLogId)
      }
      await applyFileRefChanges(tx, 'boq_change_order', id, attachments)
      return { id, logIds }
    }

    const [ledger] = await tx.select<{ id: string, status: string, source_type: string }>(
      `SELECT id, status, source_type FROM owner_change_orders
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!ledger || ledger.source_type !== 'manual')
      throw new Error('变更单不存在、已删除或不可编辑')
    if (!['draft', 'rejected'].includes(ledger.status))
      throw new Error('只有草稿或已退回纯金额签证可以编辑')
    if (lines.length) {
      if (!projectId || !contractId)
        throw new Error('量价变更明细必须关联项目与施工合同')
      const result = await createBoqChangeOrder(tx, {
        id,
        projectId,
        contractId,
        code: no,
        name,
        documentType,
        directiveNo: text(draft.directiveNo),
        directiveType,
        applicationDate: text(draft.applicationDate),
        reason,
        approvedTaxInclusiveAmount: nullableNumber(draft.approvedTaxInclusiveAmount),
        approvedTaxExclusiveAmount: nullableNumber(draft.approvedTaxExclusiveAmount),
        appliedTaxExclusiveAmount: nullableNumber(draft.appliedTaxExclusiveAmount),
        note: text(draft.note),
        lines,
      })
      const deleteLogId = await softDelete(tx, 'owner_change_orders', id)
      await tx.execute(`
        UPDATE file_refs
        SET owner_type = 'boq_change_order'
        WHERE owner_type = 'owner_change_order' AND owner_id = ?
      `, [id])
      const logIds = [...result.logIds]
      if (deleteLogId)
        logIds.push(deleteLogId)
      if (action === 'submit') {
        const statusLogId = await transitionBoqChangeOrder(tx, id, 'submitted', text(draft.statusNote))
        if (statusLogId)
          logIds.push(statusLogId)
      }
      await applyFileRefChanges(tx, 'boq_change_order', id, attachments)
      return { id, logIds }
    }
    const logId = await withUpdateLog(tx, 'owner_change_orders', id, () => tx.execute(`
      UPDATE owner_change_orders
      SET project_id = ?, change_no = ?, contract_name = ?, tax_inc_amount = ?,
          tax_exc_amount = ?, applied_amount = ?, contract_id = ?, name = ?,
          document_type = ?, directive_no = ?, directive_type = ?,
          application_date = ?, reason = ?, status = ?, status_note = ?, note = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      projectId,
      no,
      contract?.name ?? '',
      numberValue(draft.approvedTaxInclusiveAmount),
      numberValue(draft.approvedTaxExclusiveAmount),
      numberValue(draft.appliedTaxExclusiveAmount),
      contractId,
      name,
      documentType,
      text(draft.directiveNo),
      directiveType,
      text(draft.applicationDate),
      reason,
      action === 'submit' ? 'submitted' : 'draft',
      text(draft.statusNote),
      text(draft.note),
      id,
    ]))
    await applyFileRefChanges(tx, 'owner_change_order', id, attachments)
    return { id, logIds: logId ? [logId] : [] }
  }

  if (!lines.length) {
    const id = generateId('owner_change')
    const logIds: string[] = []
    await tx.execute(`
      INSERT INTO owner_change_orders (
        id, project_id, change_no, contract_name, tax_inc_amount, tax_exc_amount,
        applied_amount, approval_date, source_type, source_id, source_locked,
        contract_id, name, document_type, directive_no, directive_type,
        application_date, reason, status, status_note, note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, '', 'manual', NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      projectId,
      no,
      contract?.name ?? '',
      numberValue(draft.approvedTaxInclusiveAmount),
      numberValue(draft.approvedTaxExclusiveAmount),
      numberValue(draft.appliedTaxExclusiveAmount),
      contractId,
      name,
      documentType,
      text(draft.directiveNo),
      directiveType,
      text(draft.applicationDate),
      reason,
      action === 'submit' ? 'submitted' : 'draft',
      text(draft.statusNote),
      text(draft.note),
    ])
    const logId = await logCreate(tx, 'owner_change_orders', id)
    if (logId)
      logIds.push(logId)
    await applyFileRefChanges(tx, 'owner_change_order', id, attachments)
    return { id, logIds }
  }

  if (!projectId || !contractId)
    throw new Error('量价变更明细必须关联项目与施工合同')
  const result = await createBoqChangeOrder(tx, {
    projectId,
    contractId,
    code: no,
    name,
    documentType,
    directiveNo: text(draft.directiveNo),
    directiveType,
    applicationDate: text(draft.applicationDate),
    reason,
    approvedTaxInclusiveAmount: nullableNumber(draft.approvedTaxInclusiveAmount),
    approvedTaxExclusiveAmount: nullableNumber(draft.approvedTaxExclusiveAmount),
    appliedTaxExclusiveAmount: nullableNumber(draft.appliedTaxExclusiveAmount),
    note: text(draft.note),
    lines,
  })
  const logIds = [...result.logIds]
  if (action === 'submit') {
    const statusLogId = await transitionBoqChangeOrder(tx, result.orderId, 'submitted', text(draft.statusNote))
    if (statusLogId)
      logIds.push(statusLogId)
  }
  await applyFileRefChanges(tx, 'boq_change_order', result.orderId, attachments)
  return { id: result.orderId, logIds }
}

async function assertBoqLine(
  tx: TransactionDb,
  boqLineId: string,
  projectId: string,
  contractId: string,
): Promise<{
  id: string
  item_name: string
  unit: string
  unit_price: number
}> {
  const [line] = await tx.select<{
    id: string
    item_name: string
    unit: string
    unit_price: number
  }>(`
    SELECT id, item_name, unit,
           COALESCE(recognized_unit_price, unit_price, 0) AS unit_price
    FROM boq_lines
    WHERE id = ? AND project_id = ? AND contract_id = ? AND deleted_at IS NULL
  `, [boqLineId, projectId, contractId])
  if (!line)
    throw new Error('报量明细包含无效合同工程量清单行')
  return line
}

async function saveOwnerReport(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const projectId = action === 'submit'
    ? required(draft.projectId, '项目')
    : text(draft.projectId) || null
  const contractId = action === 'submit'
    ? required(draft.contractId, '施工合同')
    : text(draft.contractId) || null
  if (contractId && !projectId)
    throw new Error('选择施工合同前必须先选择项目')
  if (projectId && contractId)
    await activeContract(tx, projectId, contractId, 'owner')
  const periodNo = action === 'submit'
    ? required(draft.periodNo, '报量期次')
    : text(draft.periodNo)
  if (periodNo && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(periodNo))
    throw new Error('报量期次格式必须为 yyyy-mm')
  const lines = draft.lines ?? []
  if (action === 'submit' && !lines.length)
    throw new Error('报量单至少需要一条明细')
  if (lines.length && (!projectId || !contractId))
    throw new Error('报量明细必须关联项目与施工合同')

  const quantities = projectId && contractId && periodNo
    ? await loadMonthlyQuantities(
        tx,
        projectId,
        contractId,
        periodNo,
        await resolveReportQuantityBasis(tx, projectId, contractId, periodNo),
      )
    : []
  const autoQtyById = new Map(
    quantities.map(row => [row.boq_line_id, numberValue(row.auto_qty)]),
  )
  const normalized = await Promise.all(lines.map(async (line) => {
    const boqLineId = required(line.boqLineId, '合同工程量清单行')
    if (!projectId || !contractId)
      throw new Error('报量明细必须关联项目与施工合同')
    const boqLine = await assertBoqLine(tx, boqLineId, projectId, contractId)
    const autoQty = autoQtyById.get(boqLineId) ?? 0
    const reportedQty = nullableNumber(line.reportedQty) ?? autoQty
    if (autoQty < 0 || reportedQty < 0)
      throw new Error('自动完成量与申报量不能为负数')
    const unitPrice = numberValue(boqLine.unit_price)
    if (unitPrice < 0)
      throw new Error('合同单价不能为负数')
    return {
      boqLineId,
      itemName: boqLine.item_name,
      unit: boqLine.unit,
      autoQty,
      reportedQty,
      unitPrice,
      amount: round2(reportedQty * unitPrice),
      note: text(line.note),
    }
  }))
  const id = text(draft.id) || generateId('monthly_statement')
  const reportedAmount = round2(normalized.reduce((sum, line) => sum + line.amount, 0))
  const logIds: string[] = []
  let headLogId: string | null
  if (draft.id) {
    const [head] = await tx.select<{ id: string, status: string }>(
      `SELECT id, status FROM monthly_statements
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!head)
      throw new Error('月度报量单不存在或已删除')
    if (head.status !== 'draft')
      throw new Error('只有草稿月度报量可以编辑')
    headLogId = await withUpdateLog(tx, 'monthly_statements', id, () => tx.execute(`
      UPDATE monthly_statements
      SET project_id = ?, contract_id = ?, month = ?, no = ?, period_no = ?,
          application_date = ?, status = ?, total_amount = ?, reported_amount = ?,
          audited_amount = NULL, note = ?,
          operator_name = CASE WHEN ? = 'submit' THEN ? ELSE operator_name END,
          submitted_at = CASE WHEN ? = 'submit' THEN datetime('now') ELSE submitted_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      projectId,
      contractId,
      periodNo,
      documentNo(draft.no, 'BL'),
      periodNo,
      text(draft.applicationDate),
      action === 'submit' ? 'adjusted' : 'draft',
      reportedAmount,
      reportedAmount,
      text(draft.note),
      action,
      text(draft.operatorName),
      action,
      id,
    ]))
    const existingLines = await tx.select<{ id: string }>(
      `SELECT id FROM monthly_statement_lines
       WHERE statement_id = ? AND deleted_at IS NULL`,
      [id],
    )
    for (const line of existingLines) {
      const lineLogId = await softDelete(tx, 'monthly_statement_lines', line.id)
      if (lineLogId)
        logIds.push(lineLogId)
    }
  }
  else {
    await tx.execute(`
      INSERT INTO monthly_statements (
        id, project_id, contract_id, month, no, period_no, application_date,
        status, total_amount, reported_amount, audited_amount, note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `, [
      id,
      projectId,
      contractId,
      periodNo,
      documentNo(draft.no, 'BL'),
      periodNo,
      text(draft.applicationDate),
      action === 'submit' ? 'adjusted' : 'draft',
      reportedAmount,
      reportedAmount,
      text(draft.note),
    ])
    headLogId = await logCreate(tx, 'monthly_statements', id)
  }
  if (headLogId)
    logIds.push(headLogId)
  for (const [index, line] of normalized.entries()) {
    const lineId = generateId('monthly_statement_line')
    await tx.execute(`
      INSERT INTO monthly_statement_lines (
        id, statement_id, boq_line_id, item_name, unit, auto_qty,
        adjusted_qty, reported_qty, unit_price, amount, note, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      lineId,
      id,
      line.boqLineId,
      line.itemName,
      line.unit,
      line.autoQty,
      line.reportedQty,
      line.reportedQty,
      line.unitPrice,
      line.amount,
      line.note,
      (index + 1) * 10,
    ])
    const lineLogId = await logCreate(tx, 'monthly_statement_lines', lineId)
    if (lineLogId)
      logIds.push(lineLogId)
  }
  await applyFileRefChanges(tx, 'monthly_statement', id, attachments)
  return { id, logIds }
}

async function saveAcceptance(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('project_acceptance')
  if (draft.id)
    await assertEditableDraft(tx, 'project_acceptances', id, '验收或保修记录')
  const projectId = text(draft.projectId) || null
  const contractId = text(draft.contractId) || null
  if (action === 'submit') {
    required(projectId, '项目')
    required(contractId, '施工合同')
    required(draft.name, '名称')
    required(draft.applicationDate ?? draft.documentDate, '申报日期')
  }
  await assertAcceptanceAttachmentChanges(tx, id, attachments, 'acceptance-report')
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'owner')
  const values = [
    documentNo(draft.no, 'YS'),
    'acceptance',
    text(draft.name),
    projectId,
    contractId,
    text(draft.applicationDate ?? draft.documentDate),
    nullableNumber(draft.contractEstimate),
    text(draft.acceptancePerson ?? draft.acceptor),
    text(draft.warrantyOwner),
    text(draft.acceptanceConclusion ?? draft.conclusion),
    action === 'submit' ? 'submitted' : 'draft',
    text(draft.note),
    text(draft.acceptanceOrganization),
    text(draft.acceptanceDate) || null,
    text(draft.acceptanceConclusion),
    text(draft.warrantyStartDate) || null,
    text(draft.warrantyEndDate) || null,
    text(draft.warrantyConfirmationOrganization) || null,
    text(draft.warrantyConfirmationDate) || null,
    text(draft.warrantyConfirmationNote),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'project_acceptances', id, () => tx.execute(`
        UPDATE project_acceptances
        SET no = ?, type = ?, name = ?, project_id = ?, contract_id = ?,
            document_date = ?, contract_estimate = ?, acceptor = ?,
            warranty_owner = ?, conclusion = ?, status = ?, note = ?,
            acceptance_organization = ?, acceptance_date = ?, acceptance_conclusion = ?,
            warranty_start_date = ?, warranty_end_date = ?,
            warranty_confirmation_organization = ?, warranty_confirmation_date = ?,
            warranty_confirmation_note = ?,
            updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO project_acceptances (
            id, no, type, name, project_id, contract_id, document_date,
            contract_estimate, acceptor, warranty_owner, conclusion, status, note,
            acceptance_organization, acceptance_date, acceptance_conclusion,
            warranty_start_date, warranty_end_date, warranty_confirmation_organization,
            warranty_confirmation_date, warranty_confirmation_note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'project_acceptances', id)
      })()
  if (draft.id && !logId)
    throw new Error('验收或保修记录不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'project_acceptance', id, attachments)
  if (action === 'submit') {
    await tx.execute(`
      INSERT INTO project_acceptance_lifecycle_events (
        id, acceptance_id, action, from_status, to_status,
        actor_id, actor_name, occurred_at, note
      ) VALUES (?, ?, 'submit', 'draft', 'submitted', 'local-user', '本地用户', ?, ?)
    `, [generateId('acceptance_event'), id, new Date().toISOString(), text(draft.note)])
  }
  return { id, logIds: logId ? [logId] : [] }
}

async function saveFinalSettlement(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('owner_final_settlement')
  if (draft.id)
    await assertEditableDraft(tx, 'owner_final_settlements', id, '最终结算')
  const projectId = text(draft.projectId) || null
  const contractId = text(draft.contractId) || null
  const amount = numberValue(draft.settlementAmount)
  if (action === 'submit') {
    required(projectId, '项目')
    required(draft.name, '结算名称')
    requiredPositive(amount, '结算金额')
    required(draft.submissionDate, '报审日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'owner')
  const values = [
    documentNo(draft.no, 'ZZ'),
    text(draft.name),
    projectId,
    contractId,
    amount,
    text(draft.submissionDate),
    text(draft.basis),
    text(draft.differenceNote),
    action === 'submit' ? 'submitted' : 'draft',
    text(draft.note),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'owner_final_settlements', id, () => tx.execute(`
        UPDATE owner_final_settlements
        SET no = ?, name = ?, project_id = ?, contract_id = ?,
            settlement_amount = ?, submission_date = ?, basis = ?,
            difference_note = ?, status = ?, note = ?, updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO owner_final_settlements (
            id, no, name, project_id, contract_id, settlement_amount,
            submission_date, basis, difference_note, status, note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'owner_final_settlements', id)
      })()
  if (draft.id && !logId)
    throw new Error('最终结算不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'owner_final_settlement', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveOwnerPenalty(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('owner_penalty')
  if (draft.id)
    await assertEditableDraft(tx, 'owner_penalties', id, '甲方罚扣单')
  const projectId = text(draft.projectId) || null
  const contractId = text(draft.contractId) || null
  const amount = numberValue(draft.amount)
  const reason = action === 'submit' ? required(draft.reason, '罚扣事由') : text(draft.reason)
  if (action === 'submit') {
    required(projectId, '项目')
    requiredPositive(amount, '罚扣金额')
    required(draft.penaltyDate, '日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'owner')
  const values = [
    documentNo(draft.no, 'JFFK'),
    projectId,
    contractId,
    text(draft.noticeNo),
    amount,
    text(draft.penaltyDate),
    reason,
    text(draft.appealNote),
    action === 'submit' ? 'submitted' : 'draft',
    text(draft.note),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'owner_penalties', id, () => tx.execute(`
        UPDATE owner_penalties
        SET no = ?, project_id = ?, contract_id = ?, notice_no = ?, amount = ?,
            penalty_date = ?, reason = ?, appeal_note = ?, status = ?, note = ?,
            updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO owner_penalties (
            id, no, project_id, contract_id, notice_no, amount, penalty_date,
            reason, appeal_note, status, note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'owner_penalties', id)
      })()
  if (draft.id && !logId)
    throw new Error('甲方罚扣单不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'owner_penalty', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveSubChange(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('subcontract_change')
  if (draft.id)
    await assertEditableDraft(tx, 'subcontract_change_orders', id, '分包变更单')
  const projectId = text(draft.projectId) || null
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const reason = action === 'submit' ? required(draft.reason, '事由') : text(draft.reason)
  if (action === 'submit') {
    required(projectId, '项目')
    required(supplierId, '分供方')
    required(contractId, '支出合同')
    required(draft.changeDate, '日期')
    requiredPositive(draft.approvedAmount, '审批金额')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  const values = [
    documentNo(draft.no, 'FBBQ'),
    text(draft.changeType),
    projectId,
    supplierId,
    contractId,
    text(draft.changeDate),
    numberValue(draft.approvedAmount),
    nullableNumber(draft.changedArea),
    nullableNumber(draft.actualApprovedPrice),
    reason,
    action === 'submit' ? 'submitted' : 'draft',
    text(draft.note),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'subcontract_change_orders', id, () => tx.execute(`
        UPDATE subcontract_change_orders
        SET no = ?, change_type = ?, project_id = ?, supplier_id = ?,
            contract_id = ?, change_date = ?, approved_amount = ?,
            changed_area = ?, actual_approved_price = ?, reason = ?,
            status = ?, note = ?, updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO subcontract_change_orders (
            id, no, change_type, project_id, supplier_id, contract_id, change_date,
            approved_amount, changed_area, actual_approved_price, reason, status, note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'subcontract_change_orders', id)
      })()
  if (draft.id && !logId)
    throw new Error('分包变更单不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'subcontract_change_order', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveSubSettlement(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('expenditure_settlement')
  if (draft.id) {
    await assertEditableDraft(
      tx,
      'expenditure_settlements',
      id,
      '分包结算',
      `AND biz_type = '分包'`,
    )
  }
  const projectId = text(draft.projectId) || null
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const amount = numberValue(draft.totalAmount)
  if (action === 'submit') {
    required(projectId, '项目')
    required(supplierId, '分供方')
    required(contractId, '支出合同')
    required(draft.name, '结算名称')
    requiredPositive(amount, '结算金额')
    required(draft.settlementDate, '结算日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  const values = [
    documentNo(draft.no, 'FBJS'),
    text(draft.name),
    projectId,
    supplierId,
    contractId,
    text(draft.settlementType),
    amount,
    text(draft.settlementDate),
    text(draft.deductionNote),
    action === 'submit' ? 'confirmed' : 'draft',
    text(draft.note),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'expenditure_settlements', id, () => tx.execute(`
        UPDATE expenditure_settlements
        SET no = ?, name = ?, project_id = ?, supplier_id = ?, contract_id = ?,
            settlement_type = ?, total_amount = ?, settlement_date = ?,
            deduction_note = ?, status = ?, note = ?, updated_at = datetime('now')
        WHERE id = ? AND biz_type = '分包' AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO expenditure_settlements (
            id, no, name, biz_type, project_id, supplier_id, contract_id,
            settlement_type, total_amount, settlement_date, deduction_note, status, note
          )
          VALUES (?, ?, ?, '分包', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'expenditure_settlements', id)
      })()
  if (draft.id && !logId)
    throw new Error('分包结算不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'expenditure_settlement', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveProjectPenalty(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = text(draft.id) || generateId('penalty')
  if (draft.id) {
    await assertEditableDraft(
      tx,
      'penalty_records',
      id,
      '项目罚扣',
      `AND source = 'project'`,
    )
  }
  const projectId = action === 'submit'
    ? required(draft.projectId, '项目')
    : text(draft.projectId) || null
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const crewId = text(draft.crewId) || null
  const amount = numberValue(draft.amount)
  const reason = action === 'submit' ? required(draft.reason, '罚扣事由') : text(draft.reason)
  if (action === 'submit') {
    requiredPositive(amount, '罚扣金额')
    required(draft.penaltyDate, '日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  await assertActiveCrew(tx, crewId)
  if (contractId && !projectId)
    throw new Error('选择支出合同前必须先选择项目')
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  const values = [
    documentNo(draft.no, 'XMFK'),
    projectId,
    crewId,
    reason,
    amount,
    text(draft.penaltyDate),
    text(draft.deductionMethod),
    text(draft.deadline),
    action === 'submit' ? 'pending' : 'draft',
    supplierId,
    contractId,
    text(draft.deductionMethod),
    text(draft.rectificationNote),
    text(draft.note),
  ]
  const logId = draft.id
    ? await withUpdateLog(tx, 'penalty_records', id, () => tx.execute(`
        UPDATE penalty_records
        SET no = ?, projectId = ?, crewId = ?, reason = ?, amount = ?,
            penaltyDate = ?, chargeMethod = ?, deadline = ?, status = ?,
            supplier_id = ?, contract_id = ?, deduction_method = ?,
            rectification_note = ?, note = ?, updated_at = datetime('now')
        WHERE id = ? AND source = 'project' AND deleted_at IS NULL
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO penalty_records (
            id, no, projectId, crewId, source, reason, amount, penaltyDate,
            chargeMethod, deadline, status, supplier_id, contract_id,
            deduction_method, rectification_note, note
          )
          VALUES (?, ?, ?, ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values])
        return logCreate(tx, 'penalty_records', id)
      })()
  if (draft.id && !logId)
    throw new Error('项目罚扣不存在、已删除或不可编辑')
  await applyFileRefChanges(tx, 'penalty_record', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

export async function saveOwnerDocumentForm(
  kind: OwnerDocumentKind,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges = {},
): Promise<OwnerDocumentSaveResult> {
  return withTransaction((tx) => {
    switch (kind) {
      case 'owner_change':
        return saveOwnerChange(tx, draft, action, attachments)
      case 'owner_report':
        return saveOwnerReport(tx, draft, action, attachments)
      case 'acceptance':
        return saveAcceptance(tx, draft, action, attachments)
      case 'final_settlement':
        return saveFinalSettlement(tx, draft, action, attachments)
      case 'owner_penalty':
        return saveOwnerPenalty(tx, draft, action, attachments)
      case 'sub_change':
        return saveSubChange(tx, draft, action, attachments)
      case 'sub_settlement':
        return saveSubSettlement(tx, draft, action, attachments)
      case 'project_penalty':
        return saveProjectPenalty(tx, draft, action, attachments)
    }
  })
}

async function loadOwnerChange(id: string): Promise<Record<string, unknown> | null> {
  const [order] = await select<Record<string, unknown>>(`
    SELECT * FROM boq_change_orders
    WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!order) {
    const [ledger] = await select<Record<string, unknown>>(`
      SELECT * FROM owner_change_orders
      WHERE id = ? AND source_type = 'manual' AND deleted_at IS NULL
    `, [id])
    if (!ledger)
      return null
    return {
      id: ledger.id,
      no: ledger.change_no,
      name: ledger.name,
      projectId: ledger.project_id,
      contractId: ledger.contract_id,
      documentType: ledger.document_type,
      directiveNo: ledger.directive_no,
      directiveType: ledger.directive_type,
      applicationDate: ledger.application_date,
      approvedTaxInclusiveAmount: numberValue(ledger.tax_inc_amount),
      approvedTaxExclusiveAmount: numberValue(ledger.tax_exc_amount),
      appliedTaxExclusiveAmount: numberValue(ledger.applied_amount),
      reason: ledger.reason,
      status: ledger.status,
      statusNote: ledger.status_note,
      sourceLocked: numberValue(ledger.source_locked) === 1,
      note: ledger.note,
      totalAmount: numberValue(ledger.tax_inc_amount),
      lines: [],
    }
  }
  const lines = await select<Record<string, unknown>>(`
    SELECT * FROM boq_change_lines
    WHERE change_order_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [id])
  const ledger = order.ledger_id
    ? (await select<Record<string, unknown>>(`
        SELECT * FROM owner_change_orders
        WHERE id = ? AND deleted_at IS NULL
      `, [order.ledger_id]))[0]
    : null
  return {
    id: order.id,
    no: order.code,
    name: order.name,
    projectId: order.project_id,
    contractId: order.contract_id,
    documentType: order.document_type,
    changeType: order.change_type,
    directiveNo: order.directive_no,
    directiveType: order.directive_type,
    applicationDate: order.application_date,
    approvedTaxInclusiveAmount: nullableNumber(order.approved_tax_inclusive_amount),
    approvedTaxExclusiveAmount: nullableNumber(order.approved_tax_exclusive_amount),
    appliedTaxExclusiveAmount: nullableNumber(order.applied_tax_exclusive_amount),
    reason: order.reason,
    status: order.status,
    statusNote: order.status_note,
    note: order.note,
    totalAmount: numberValue(order.total_amount),
    lines: lines.map(line => ({
      id: line.id,
      operation: line.operation,
      boqLineId: line.boq_line_id,
      itemId: line.item_id,
      itemName: line.item_name,
      unit: line.unit,
      deltaQty: nullableNumber(line.delta_qty),
      newUnitPrice: nullableNumber(line.new_unit_price),
      amount: numberValue(line.amount),
      note: line.note,
    })),
    ledger: ledger
      ? {
          id: ledger.id,
          sourceLocked: numberValue(ledger.source_locked) === 1,
          taxInclusiveAmount: numberValue(ledger.tax_inc_amount),
          taxExclusiveAmount: numberValue(ledger.tax_exc_amount),
          appliedAmount: numberValue(ledger.applied_amount),
        }
      : null,
  }
}

async function loadOwnerReport(id: string): Promise<Record<string, unknown> | null> {
  const [head] = await select<Record<string, unknown>>(`
    SELECT * FROM monthly_statements
    WHERE id = ? AND deleted_at IS NULL
  `, [id])
  if (!head)
    return null
  const lines = await select<Record<string, unknown>>(`
    SELECT * FROM monthly_statement_lines
    WHERE statement_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [id])
  const reportedAmount = nullableNumber(head.reported_amount)
  const auditedAmount = nullableNumber(head.audited_amount)
  return {
    id: head.id,
    no: head.no,
    projectId: head.project_id,
    contractId: head.contract_id,
    periodNo: head.period_no || head.month,
    applicationDate: head.application_date,
    operatorName: head.operator_name ?? '',
    status: head.status === 'exported' ? 'audited' : head.status === 'adjusted' ? 'reported' : 'draft',
    reportedAmount,
    auditedAmount,
    auditDifference: auditedAmount == null || reportedAmount == null
      ? null
      : round2(auditedAmount - reportedAmount),
    note: head.note,
    lines: lines.map(line => ({
      id: line.id,
      boqLineId: line.boq_line_id,
      itemName: line.item_name,
      unit: line.unit,
      autoQty: numberValue(line.auto_qty),
      reportedQty: nullableNumber(line.reported_qty) ?? nullableNumber(line.adjusted_qty),
      auditedQty: nullableNumber(line.audited_qty),
      unitPrice: numberValue(line.unit_price),
      amount: numberValue(line.amount),
      auditedAmount: nullableNumber(line.audited_amount),
      note: line.note,
    })),
  }
}

async function loadSimple(
  table: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await select<Record<string, unknown>>(
    `SELECT * FROM "${table}" WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  return rows[0] ?? null
}

export async function loadOwnerDocumentContractSummary(
  contractId: string,
  excludeSettlementId = '',
): Promise<OwnerDocumentContractSummary | null> {
  if (!contractId)
    return null
  const [row] = await select<{
    contract_amount: number
    prior_settlement_amount: number
    received_amount: number
  }>(`
    SELECT
      contract.amount + COALESCE((
        SELECT SUM(supplement.amount)
        FROM contract_supplements supplement
        WHERE supplement.contract_id = contract.id
          AND supplement.deleted_at IS NULL
          AND supplement.status NOT IN ('draft', '草稿')
      ), 0) AS contract_amount,
      COALESCE((
        SELECT SUM(settlement.total_amount)
        FROM expenditure_settlements settlement
        WHERE settlement.contract_id = contract.id
          AND settlement.biz_type = '分包'
          AND settlement.deleted_at IS NULL
          AND (? = '' OR settlement.id <> ?)
      ), 0) AS prior_settlement_amount,
      COALESCE((
        SELECT SUM(receipt.amount)
        FROM receipt_registrations receipt
        WHERE receipt.contract_id = contract.id
          AND receipt.deleted_at IS NULL
      ), 0) AS received_amount
    FROM contracts contract
    WHERE contract.id = ? AND contract.deleted_at IS NULL
  `, [excludeSettlementId, excludeSettlementId, contractId])
  return row
    ? {
        contractAmount: numberValue(row.contract_amount),
        priorSettlementAmount: numberValue(row.prior_settlement_amount),
        receivedAmount: numberValue(row.received_amount),
      }
    : null
}

export async function listOwnerDocumentBasicOptions(
  kind: 'crew' | 'project' | 'supplier',
  keyword: string,
): Promise<OwnerDocumentLookupOption[]> {
  const table = {
    crew: 'crews',
    project: 'projects',
    supplier: 'suppliers',
  }[kind]
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
    [`%${keyword.trim()}%`],
  )
  return rows.map(row => ({ id: row.id, label: row.name }))
}

export async function listOwnerDocumentContractOptions(
  projectId: string,
  side: 'expenditure' | 'owner',
  supplierId: string,
  keyword: string,
): Promise<OwnerDocumentLookupOption[]> {
  if (!projectId)
    return []
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{
    id: string
    no: string
    name: string
    supplier_name: string
  }>(`
    SELECT contract.id, contract.no, contract.name,
           COALESCE(supplier.name, '') AS supplier_name
    FROM contracts contract
    LEFT JOIN suppliers supplier
      ON supplier.id = contract.supplier_id AND supplier.deleted_at IS NULL
    WHERE contract.deleted_at IS NULL
      AND contract.project_id = ?
      AND contract.status NOT IN ('draft', '草稿')
      AND ${side === 'owner' ? 'contract.kind = \'施工\'' : 'contract.kind <> \'施工\''}
      AND (? = '' OR contract.supplier_id = ?)
      AND (contract.no LIKE ? OR contract.name LIKE ?)
    ORDER BY contract.sign_date DESC, contract.created_at DESC
    LIMIT 50
  `, [
    projectId,
    side === 'owner' ? '' : supplierId,
    supplierId,
    pattern,
    pattern,
  ])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no || '未编号'}${row.supplier_name ? ` · ${row.supplier_name}` : ''}`,
  }))
}

export async function listOwnerDocumentSettlementOptions(
  projectId: string,
  supplierId: string,
  contractId: string,
  keyword: string,
): Promise<OwnerDocumentLookupOption[]> {
  if (!projectId)
    return []
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{
    id: string
    no: string
    name: string
    total_amount: number
  }>(`
    SELECT id, no, name, total_amount
    FROM expenditure_settlements
    WHERE deleted_at IS NULL
      AND biz_type = '分包'
      AND status = 'confirmed'
      AND project_id = ?
      AND (? = '' OR supplier_id = ?)
      AND (? = '' OR contract_id = ?)
      AND (no LIKE ? OR name LIKE ?)
    ORDER BY settlement_date DESC, created_at DESC
    LIMIT 50
  `, [
    projectId,
    supplierId,
    supplierId,
    contractId,
    contractId,
    pattern,
    pattern,
  ])
  return rows.map(row => ({
    id: row.id,
    label: row.name || row.no,
    hint: `${row.no || '未编号'} · ¥${numberValue(row.total_amount).toLocaleString('zh-CN')}`,
  }))
}

export async function loadOwnerDocumentForm(
  kind: OwnerDocumentKind,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (kind === 'owner_change')
    return loadOwnerChange(id)
  if (kind === 'owner_report')
    return loadOwnerReport(id)
  if (kind === 'acceptance') {
    const row = await loadSimple('project_acceptances', id)
    if (!row)
      return null
    const lifecycleEvents = await select<Record<string, unknown>>(`
      SELECT * FROM project_acceptance_lifecycle_events
      WHERE acceptance_id = ?
      ORDER BY occurred_at, id
    `, [id])
    return {
      id: row.id,
      no: row.no,
      type: row.type,
      name: row.name,
      projectId: row.project_id,
      contractId: row.contract_id,
      documentDate: row.document_date,
      applicationDate: row.document_date,
      contractEstimate: nullableNumber(row.contract_estimate),
      acceptor: row.acceptor,
      acceptanceOrganization: row.acceptance_organization,
      acceptancePerson: row.acceptor,
      acceptanceDate: row.acceptance_date,
      acceptanceConclusion: row.acceptance_conclusion,
      warrantyOwner: row.warranty_owner,
      warrantyStartDate: row.warranty_start_date,
      warrantyEndDate: row.warranty_end_date,
      warrantyConfirmationOrganization: row.warranty_confirmation_organization,
      warrantyConfirmationDate: row.warranty_confirmation_date,
      warrantyConfirmationNote: row.warranty_confirmation_note,
      conclusion: row.conclusion,
      lifecycleEvents: lifecycleEvents.map(event => ({
        id: event.id,
        action: event.action,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actorId: event.actor_id,
        actorName: event.actor_name,
        occurredAt: event.occurred_at,
        note: event.note,
      })),
      status: row.status,
      note: row.note,
    }
  }
  if (kind === 'final_settlement') {
    const row = await loadSimple('owner_final_settlements', id)
    if (!row)
      return null
    const settlementAmount = numberValue(row.settlement_amount)
    const summary = await loadOwnerDocumentContractSummary(text(row.contract_id))
    const receivedAmount = summary?.receivedAmount ?? 0
    return {
      id: row.id,
      no: row.no,
      name: row.name,
      projectId: row.project_id,
      contractId: row.contract_id,
      settlementAmount,
      submissionDate: row.submission_date,
      basis: row.basis,
      differenceNote: row.difference_note,
      status: row.status,
      note: row.note,
      changedContractAmount: summary?.contractAmount ?? 0,
      receivedAmount,
      settlementReceiptGap: round2(settlementAmount - receivedAmount),
    }
  }
  if (kind === 'owner_penalty') {
    const row = await loadSimple('owner_penalties', id)
    return row && {
      id: row.id,
      no: row.no,
      projectId: row.project_id,
      contractId: row.contract_id,
      noticeNo: row.notice_no,
      amount: numberValue(row.amount),
      penaltyDate: row.penalty_date,
      reason: row.reason,
      appealNote: row.appeal_note,
      status: row.status,
      note: row.note,
    }
  }
  if (kind === 'sub_change') {
    const row = await loadSimple('subcontract_change_orders', id)
    return row && {
      id: row.id,
      no: row.no,
      changeType: row.change_type,
      projectId: row.project_id,
      supplierId: row.supplier_id,
      contractId: row.contract_id,
      changeDate: row.change_date,
      approvedAmount: numberValue(row.approved_amount),
      changedArea: nullableNumber(row.changed_area),
      actualApprovedPrice: nullableNumber(row.actual_approved_price),
      reason: row.reason,
      status: row.status,
      note: row.note,
    }
  }
  if (kind === 'sub_settlement') {
    const row = await loadSimple('expenditure_settlements', id)
    return row && {
      id: row.id,
      sourceTable: 'expenditure_settlements',
      no: row.no,
      name: row.name,
      bizType: row.biz_type,
      projectId: row.project_id,
      supplierId: row.supplier_id,
      contractId: row.contract_id,
      settlementType: row.settlement_type,
      totalAmount: numberValue(row.total_amount),
      settlementDate: row.settlement_date,
      deductionNote: row.deduction_note,
      status: row.status,
      note: row.note,
    }
  }
  const [row] = await select<Record<string, unknown>>(`
    SELECT penalty.*,
           COALESCE(SUM(deduction.amount), 0) AS deducted_amount
    FROM penalty_records penalty
    LEFT JOIN penalty_settlement_deductions deduction
      ON deduction.penalty_id = penalty.id AND deduction.deleted_at IS NULL
    WHERE penalty.id = ? AND penalty.deleted_at IS NULL
    GROUP BY penalty.id
  `, [id])
  if (!row)
    return null
  const amount = numberValue(row.amount)
  const deductedAmount = numberValue(row.deducted_amount)
  return {
    id: row.id,
    no: row.no,
    projectId: row.projectId,
    supplierId: row.supplier_id,
    contractId: row.contract_id,
    crewId: row.crewId,
    penaltyDate: row.penaltyDate,
    reason: row.reason,
    amount,
    deductionMethod: row.deduction_method,
    deadline: row.deadline,
    rectificationNote: row.rectification_note,
    status: row.status,
    note: row.note,
    deductedAmount,
    remainingDeductionAmount: round2(Math.max(amount - deductedAmount, 0)),
  }
}

export async function listOwnerDocumentForms(
  kind: OwnerDocumentKind,
): Promise<OwnerDocumentListRecord[]> {
  if (kind === 'owner_change') {
    const rows = await select<Record<string, unknown>>(`
      SELECT * FROM (
      SELECT change_order.id, change_order.code AS no, change_order.name,
             change_order.project_id, project.name AS project_name,
             change_order.contract_id, contract.name AS contract_name,
             NULL AS supplier_id, '' AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             change_order.document_type AS business_type, '' AS period,
             COALESCE(change_order.approved_tax_inclusive_amount, change_order.total_amount, 0) AS amount,
             COALESCE(change_order.approved_tax_exclusive_amount, 0) AS secondary_amount,
             COALESCE(change_order.applied_tax_exclusive_amount, 0) AS tertiary_amount,
             NULL AS quantity,
             COALESCE(NULLIF(change_order.approved_at, ''), change_order.application_date) AS document_date,
             change_order.status, change_order.created_at
      FROM boq_change_orders change_order
      LEFT JOIN projects project ON project.id = change_order.project_id
      LEFT JOIN contracts contract ON contract.id = change_order.contract_id
      WHERE change_order.deleted_at IS NULL
      UNION ALL
      SELECT ledger.id, ledger.change_no, ledger.name, ledger.project_id,
             project.name, ledger.contract_id, ledger.contract_name,
             NULL, '', NULL, '',
             ledger.document_type, '',
             ledger.tax_inc_amount, ledger.tax_exc_amount, ledger.applied_amount,
             NULL,
             COALESCE(NULLIF(ledger.approval_date, ''), ledger.application_date),
             ledger.status, ledger.created_at
      FROM owner_change_orders ledger
      LEFT JOIN projects project ON project.id = ledger.project_id
      WHERE ledger.source_type = 'manual' AND ledger.deleted_at IS NULL
      ) AS list_record
      ORDER BY created_at DESC, id DESC
    `)
    return rows.map(toListRecord)
  }

  const queryByKind: Record<Exclude<OwnerDocumentKind, 'owner_change'>, string> = {
    owner_report: `
      SELECT statement.id, statement.no, statement.period_no AS name,
             statement.project_id, project.name AS project_name,
             statement.contract_id, contract.name AS contract_name,
             NULL AS supplier_id, '' AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             '' AS business_type, statement.period_no AS period,
             COALESCE(statement.reported_amount, statement.total_amount, 0) AS amount,
             COALESCE(statement.audited_amount, 0) AS secondary_amount,
             CASE
               WHEN statement.audited_amount IS NULL THEN 0
               ELSE statement.audited_amount - COALESCE(statement.reported_amount, statement.total_amount, 0)
             END AS tertiary_amount,
             NULL AS quantity,
             statement.application_date AS document_date, statement.status,
             statement.created_at
      FROM monthly_statements statement
      LEFT JOIN projects project ON project.id = statement.project_id
      LEFT JOIN contracts contract ON contract.id = statement.contract_id
      WHERE statement.deleted_at IS NULL`,
    acceptance: `
      SELECT document.id, document.no, document.name, document.project_id,
             project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             NULL AS supplier_id, '' AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             document.type AS business_type, '' AS period,
             COALESCE(document.contract_estimate, 0) AS amount,
             0 AS secondary_amount, 0 AS tertiary_amount, NULL AS quantity,
             document.document_date, document.status, document.created_at
      FROM project_acceptances document
      LEFT JOIN projects project ON project.id = document.project_id
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      WHERE document.deleted_at IS NULL`,
    final_settlement: `
      SELECT document.id, document.no, document.name, document.project_id,
             project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             NULL AS supplier_id, '' AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             '' AS business_type, '' AS period,
             document.settlement_amount AS amount,
             0 AS secondary_amount, 0 AS tertiary_amount, NULL AS quantity,
             document.submission_date AS document_date, document.status, document.created_at
      FROM owner_final_settlements document
      LEFT JOIN projects project ON project.id = document.project_id
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      WHERE document.deleted_at IS NULL`,
    owner_penalty: `
      SELECT document.id, document.no, document.reason AS name, document.notice_no,
             document.project_id,
             project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             NULL AS supplier_id, '' AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             '' AS business_type, '' AS period,
             document.amount, 0 AS secondary_amount, 0 AS tertiary_amount,
             NULL AS quantity, document.penalty_date AS document_date,
             document.status, document.created_at
      FROM owner_penalties document
      LEFT JOIN projects project ON project.id = document.project_id
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      WHERE document.deleted_at IS NULL`,
    sub_change: `
      SELECT document.id, document.no, document.reason AS name, document.project_id,
             project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             document.supplier_id, supplier.name AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             document.change_type AS business_type, '' AS period,
             document.approved_amount AS amount,
             COALESCE(document.actual_approved_price, 0) AS secondary_amount,
             0 AS tertiary_amount, document.changed_area AS quantity,
             document.change_date AS document_date,
             document.status, document.created_at
      FROM subcontract_change_orders document
      LEFT JOIN projects project ON project.id = document.project_id
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      LEFT JOIN suppliers supplier ON supplier.id = document.supplier_id
      WHERE document.deleted_at IS NULL`,
    sub_settlement: `
      SELECT document.id, document.no, document.name, document.project_id,
             project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             document.supplier_id, supplier.name AS supplier_name,
             NULL AS crew_id, '' AS crew_name,
             document.settlement_type AS business_type, document.settlement_period AS period,
             document.total_amount AS amount,
             0 AS secondary_amount, 0 AS tertiary_amount, NULL AS quantity,
             document.settlement_date AS document_date,
             document.status, document.created_at
      FROM expenditure_settlements document
      LEFT JOIN projects project ON project.id = document.project_id
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      LEFT JOIN suppliers supplier ON supplier.id = document.supplier_id
      WHERE document.biz_type = '分包' AND document.deleted_at IS NULL`,
    project_penalty: `
      SELECT document.id, document.no, document.reason AS name,
             document.projectId AS project_id, project.name AS project_name,
             document.contract_id, contract.name AS contract_name,
             document.supplier_id, supplier.name AS supplier_name,
             document.crewId AS crew_id, crew.name AS crew_name,
             document.deduction_method AS business_type, '' AS period,
             document.amount, 0 AS secondary_amount, 0 AS tertiary_amount,
             NULL AS quantity, document.penaltyDate AS document_date,
             document.status, document.createdAt AS created_at
      FROM penalty_records document
      LEFT JOIN projects project ON project.id = document.projectId
      LEFT JOIN contracts contract ON contract.id = document.contract_id
      LEFT JOIN suppliers supplier ON supplier.id = document.supplier_id
      LEFT JOIN crews crew ON crew.id = document.crewId
      WHERE document.source = 'project' AND document.deleted_at IS NULL`,
  }
  const rows = await select<Record<string, unknown>>(
    `SELECT * FROM (${queryByKind[kind]}) AS list_record
     ORDER BY created_at DESC, id DESC`,
  )
  return rows.map(toListRecord)
}

/**
 * 甲方报量单与 BOQ 工作台的月度报量是 `monthly_statements` 里的同一条记录，
 * 因此自动完成量必须读同一个已冻结基准；该期次尚无单据时才回落默认基准。
 */
async function resolveReportQuantityBasis(
  db: { select: typeof select },
  projectId: string,
  contractId: string,
  periodNo: string,
): Promise<QuantityBasis> {
  const [row] = await db.select<{ quantity_basis: string | null }>(
    `SELECT quantity_basis
     FROM monthly_statements
     WHERE project_id = ? AND contract_id = ? AND month = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectId, contractId, periodNo],
  )
  return isQuantityBasis(row?.quantity_basis)
    ? row.quantity_basis
    : DEFAULT_PROGRESS_QUANTITY_BASIS
}

export async function listOwnerDocumentBoqLines(
  projectId: string,
  contractId: string,
  periodNo = '',
): Promise<OwnerDocumentBoqLine[]> {
  if (!projectId || !contractId)
    return []
  const rows = await select<{
    id: string
    item_name: string
    unit: string
    effective_qty: number
    effective_unit_price: number
  }>(`
    SELECT id, item_name, unit,
           COALESCE(recognized_qty, qty, 0) AS effective_qty,
           COALESCE(recognized_unit_price, unit_price, 0) AS effective_unit_price
    FROM boq_lines
    WHERE project_id = ? AND contract_id = ? AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [projectId, contractId])
  const quantities = periodNo
    ? await loadMonthlyQuantities(
        { select },
        projectId,
        contractId,
        periodNo,
        await resolveReportQuantityBasis({ select }, projectId, contractId, periodNo),
      )
    : []
  const quantityByLineId = new Map(
    quantities.map(row => [row.boq_line_id, row]),
  )
  return rows.map((row) => {
    const quantity = quantityByLineId.get(row.id)
    return {
      id: row.id,
      itemName: row.item_name,
      unit: row.unit,
      qty: numberValue(row.effective_qty),
      unitPrice: numberValue(row.effective_unit_price),
      autoQty: numberValue(quantity?.auto_qty),
      missingQtyCount: numberValue(quantity?.missing_count),
    }
  })
}

function toListRecord(row: Record<string, unknown>): OwnerDocumentListRecord {
  return {
    id: text(row.id),
    no: text(row.no),
    name: text(row.name),
    noticeNo: text(row.notice_no),
    projectId: text(row.project_id) || null,
    projectName: text(row.project_name),
    contractId: text(row.contract_id) || null,
    contractName: text(row.contract_name),
    supplierId: text(row.supplier_id) || null,
    supplierName: text(row.supplier_name),
    crewId: text(row.crew_id) || null,
    crewName: text(row.crew_name),
    type: text(row.business_type),
    period: text(row.period),
    amount: numberValue(row.amount),
    secondaryAmount: numberValue(row.secondary_amount),
    tertiaryAmount: numberValue(row.tertiary_amount),
    quantity: nullableNumber(row.quantity),
    date: text(row.document_date),
    status: text(row.status),
  }
}

async function ownerChangeStorageTable(id: string): Promise<string> {
  const [boq] = await select<{ id: string }>(
    `SELECT id FROM boq_change_orders WHERE id = ?`,
    [id],
  )
  return boq ? 'boq_change_orders' : 'owner_change_orders'
}

async function storageTable(kind: OwnerDocumentKind, id: string): Promise<string> {
  return kind === 'owner_change'
    ? ownerChangeStorageTable(id)
    : TABLE_BY_KIND[kind]
}

export async function deleteOwnerDocumentForm(
  kind: OwnerDocumentKind,
  id: string,
): Promise<string | null> {
  const table = await storageTable(kind, id)
  return withTransaction(async (tx) => {
    if (kind === 'owner_change' && table === 'boq_change_orders') {
      const [order] = await tx.select<{ status: string }>(
        `SELECT status FROM boq_change_orders
         WHERE id = ? AND deleted_at IS NULL`,
        [id],
      )
      if (order?.status === 'approved')
        throw new Error('已签证变更不可直接删除，请在 BOQ 工作区执行级联二次确认')
    }
    if (kind === 'owner_change' && table === 'owner_change_orders') {
      const [ledger] = await tx.select<{ status: string }>(
        `SELECT status FROM owner_change_orders
         WHERE id = ? AND deleted_at IS NULL`,
        [id],
      )
      if (ledger?.status === 'approved')
        throw new Error('已生效纯金额签证不可直接删除，请新建更正单留痕')
    }
    const [record] = await tx.select<{ status: string }>(
      `SELECT status FROM "${table}"
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!record)
      return null
    if (!ownerDocumentStatusIsEditable(record.status))
      throw new Error('只有草稿或已退回单据可以删除')
    return softDelete(tx, table, id)
  })
}

export async function restoreOwnerDocumentForm(
  kind: OwnerDocumentKind,
  id: string,
): Promise<string | null> {
  const table = await storageTable(kind, id)
  return withTransaction(tx => restoreRecord(tx, table, id))
}

async function ownerChangeFileOwner(id: string): Promise<string> {
  const [order] = await select<{ id: string }>(
    `SELECT id FROM boq_change_orders WHERE id = ?`,
    [id],
  )
  return order ? 'boq_change_order' : 'owner_change_order'
}

export async function listOwnerDocumentAttachments(
  kind: OwnerDocumentKind,
  id: string,
  includeDeleted = false,
): Promise<FileRefRecord[]> {
  const ownerType = kind === 'owner_change'
    ? await ownerChangeFileOwner(id)
    : FILE_OWNER_TYPES[kind]
  return listFileRefs(ownerType, id, includeDeleted)
}

export async function updateOwnerDocumentAttachments(
  kind: OwnerDocumentKind,
  id: string,
  changes: FileRefChanges,
): Promise<string[]> {
  const ownerType = kind === 'owner_change'
    ? await ownerChangeFileOwner(id)
    : FILE_OWNER_TYPES[kind]
  const table = await storageTable(kind, id)
  return withTransaction(async (tx) => {
    const [record] = await tx.select<{ id: string, status: string }>(
      `SELECT id, status FROM "${table}" WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!record)
      throw new Error('单据不存在或已删除')
    if (kind === 'acceptance') {
      if (record.status === 'expired')
        throw new Error('保修到期确认后单据只读')
      await assertAcceptanceAttachmentChanges(
        tx,
        id,
        changes,
        ['draft', 'rejected', 'submitted'].includes(record.status)
          ? 'acceptance-report'
          : 'warranty-confirmation',
      )
    }
    return applyFileRefChanges(tx, ownerType, id, changes)
  })
}

async function assertAcceptanceAttachmentChanges(
  tx: TransactionDb,
  ownerId: string,
  changes: FileRefChanges,
  expected: 'acceptance-report' | 'warranty-confirmation',
) {
  for (const file of changes.add ?? []) {
    if (text(file.category) !== expected)
      throw new Error(`验收附件分类必须为 ${expected}`)
  }
  const changedIds = [...new Set([...(changes.removeIds ?? []), ...(changes.restoreIds ?? [])])]
  if (!changedIds.length)
    return
  const rows = await tx.select<{ id: string, category: string }>(`
    SELECT id, category
    FROM file_refs
    WHERE owner_type = 'project_acceptance'
      AND owner_id = ?
      AND id IN (${changedIds.map(() => '?').join(', ')})
  `, [ownerId, ...changedIds])
  if (rows.some(file => file.category !== expected))
    throw new Error('附件不属于当前验收视图')
}

export async function approveOwnerChange(
  id: string,
  approvedAt: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    const [order] = await tx.select<{ id: string }>(
      `SELECT id FROM boq_change_orders WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (order) {
      await approveBoqChangeOrder(tx, id, approvedAt)
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(approvedAt))
      throw new Error('签证日期格式必须为 yyyy-mm-dd')
    const [ledger] = await tx.select<{ id: string, source_type: string, status: string }>(
      `SELECT id, source_type, status
       FROM owner_change_orders
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!ledger || ledger.source_type !== 'manual')
      throw new Error('纯金额签证不存在或已删除')
    if (ledger.status === 'approved')
      throw new Error('该纯金额签证已生效')
    if (ledger.status !== 'submitted')
      throw new Error('只有已上报纯金额签证可以生效')
    await withUpdateLog(tx, 'owner_change_orders', id, () => tx.execute(`
      UPDATE owner_change_orders
      SET approval_date = ?, status = 'approved', status_note = '甲方已签证',
          source_locked = 1, updated_at = datetime('now')
      WHERE id = ?
    `, [approvedAt, id]))
  })
}

export async function transitionAcceptance(
  id: string,
  target: AcceptanceLifecycleTarget,
  facts: OwnerDocumentDraft = {},
  attachments: FileRefChanges = {},
): Promise<void> {
  const allowed: Record<string, AcceptanceLifecycleTarget> = {
    submitted: 'accepted',
    accepted: 'warranty',
    warranty: 'expired',
  }
  await withTransaction(async (tx) => {
    const [record] = await tx.select<{ status: string, warranty_end_date: string | null }>(
      `SELECT status, warranty_end_date
       FROM project_acceptances
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!record)
      throw new Error('验收或保修记录不存在或已删除')
    if (allowed[record.status] !== target)
      throw new Error('验收或保修状态已变化，请刷新后重试')
    await assertAcceptanceAttachmentChanges(
      tx,
      id,
      attachments,
      target === 'accepted' ? 'acceptance-report' : 'warranty-confirmation',
    )
    if (target === 'accepted') {
      const organization = required(facts.acceptanceOrganization, '验收单位')
      const person = required(facts.acceptancePerson, '验收人')
      const date = required(facts.acceptanceDate, '验收日期')
      const conclusion = required(facts.acceptanceConclusion, '验收结论')
      if (!isISODateDTO(date))
        throw new Error('验收日期格式必须为 yyyy-mm-dd')
      await withUpdateLog(tx, 'project_acceptances', id, () => tx.execute(`
        UPDATE project_acceptances
        SET acceptance_organization = ?, acceptor = ?, acceptance_date = ?,
            acceptance_conclusion = ?, conclusion = ?, status = 'accepted',
            updated_at = datetime('now')
        WHERE id = ?
      `, [organization, person, date, conclusion, conclusion, id]))
    }
    if (target === 'warranty') {
      const owner = required(facts.warrantyOwner, '保修责任单位')
      const startDate = required(facts.warrantyStartDate, '保修开始日期')
      const endDate = required(facts.warrantyEndDate, '保修结束日期')
      if (!isISODateDTO(startDate) || !isISODateDTO(endDate))
        throw new Error('保修日期格式必须为 yyyy-mm-dd')
      if (endDate < startDate)
        throw new Error('保修结束日期不能早于开始日期')
      await withUpdateLog(tx, 'project_acceptances', id, () => tx.execute(`
        UPDATE project_acceptances
        SET type = 'warranty', warranty_owner = ?, warranty_start_date = ?,
            warranty_end_date = ?, status = 'warranty', updated_at = datetime('now')
        WHERE id = ?
      `, [owner, startDate, endDate, id]))
    }
    if (target === 'expired') {
      const organization = required(facts.warrantyConfirmationOrganization, '到期验收单位')
      const date = required(facts.warrantyConfirmationDate, '到期确认日期')
      const conclusion = required(facts.warrantyConfirmationNote, '到期确认结论')
      if (!isISODateDTO(date))
        throw new Error('到期确认日期格式必须为 yyyy-mm-dd')
      if (record.warranty_end_date && date < record.warranty_end_date)
        throw new Error('到期确认日期不能早于保修结束日期')
      await withUpdateLog(tx, 'project_acceptances', id, () => tx.execute(`
        UPDATE project_acceptances
        SET warranty_confirmation_organization = ?, warranty_confirmation_date = ?,
            warranty_confirmation_note = ?, status = 'expired', updated_at = datetime('now')
        WHERE id = ?
      `, [organization, date, conclusion, id]))
    }
    const event = {
      accepted: { action: 'accept', fromStatus: 'submitted' },
      warranty: { action: 'start-warranty', fromStatus: 'accepted' },
      expired: { action: 'confirm-expiry', fromStatus: 'warranty' },
    }[target]
    await tx.execute(`
      INSERT INTO project_acceptance_lifecycle_events (
        id, acceptance_id, action, from_status, to_status,
        actor_id, actor_name, occurred_at, note
      ) VALUES (?, ?, ?, ?, ?, 'local-user', '本地用户', ?, ?)
    `, [
      generateId('acceptance_event'),
      id,
      event.action,
      event.fromStatus,
      target,
      new Date().toISOString(),
      text(facts.note),
    ])
    await applyFileRefChanges(tx, 'project_acceptance', id, attachments)
  })
}

export async function auditOwnerReport(
  id: string,
  draft: OwnerReportAuditDraft,
): Promise<void> {
  await withTransaction(async (tx) => {
    const [head] = await tx.select<{ id: string, status: string }>(
      `SELECT id, status FROM monthly_statements WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!head)
      throw new Error('月度报量单不存在或已删除')
    if (head.status !== 'adjusted')
      throw new Error('只有已申报月度报量可以执行审定')
    const rows = await tx.select<{
      id: string
      boq_line_id: string
      unit_price: number
    }>(
      `SELECT id, boq_line_id, unit_price FROM monthly_statement_lines
       WHERE statement_id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!rows.length)
      throw new Error('月度报量没有可审定明细')
    const submittedBoqIds = new Set(draft.lines.map(line => line.boqLineId))
    if (submittedBoqIds.size !== rows.length || draft.lines.length !== rows.length)
      throw new Error('审定必须覆盖当前月度报量的全部明细')
    const rowByBoq = new Map(rows.map(row => [row.boq_line_id, row]))
    let auditedTotal = 0
    for (const line of draft.lines) {
      const row = rowByBoq.get(line.boqLineId)
      if (!row)
        throw new Error('审定明细不属于当前月度报量单')
      if (!Number.isFinite(line.auditedQty) || line.auditedQty < 0)
        throw new Error('审定量必须是非负有效数字')
      const auditedAmount = round2(line.auditedQty * numberValue(row.unit_price))
      auditedTotal = round2(auditedTotal + auditedAmount)
      await withUpdateLog(tx, 'monthly_statement_lines', row.id, () => tx.execute(`
        UPDATE monthly_statement_lines
        SET audited_qty = ?, audited_amount = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [line.auditedQty, auditedAmount, row.id]))
    }
    await withUpdateLog(tx, 'monthly_statements', id, () => tx.execute(`
      UPDATE monthly_statements
      SET audited_amount = ?, status = 'exported', updated_at = datetime('now')
      WHERE id = ?
    `, [auditedTotal, id]))
  })
}

export async function deductProjectPenalty(
  penaltyId: string,
  settlementId: string,
  amount: number,
  note = '',
): Promise<void> {
  await withTransaction(async (tx) => {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('抵扣金额必须大于 0')
    const [penalty] = await tx.select<{
      amount: number
      contract_id: string | null
      projectId: string
      status: string
      supplier_id: string | null
    }>(`
      SELECT amount, contract_id, projectId, status, supplier_id
      FROM penalty_records
      WHERE id = ? AND deleted_at IS NULL
    `, [penaltyId])
    if (!penalty)
      throw new Error('项目罚扣不存在或已删除')
    if (penalty.status === 'draft')
      throw new Error('草稿罚扣不能执行结算抵扣')
    const [settlement] = await tx.select<{
      biz_type: string
      contract_id: string | null
      project_id: string | null
      status: string
      supplier_id: string | null
      total_amount: number
    }>(`
      SELECT project_id, supplier_id, contract_id, total_amount, biz_type, status
      FROM expenditure_settlements
      WHERE id = ? AND deleted_at IS NULL
    `, [settlementId])
    if (!settlement)
      throw new Error('支出结算不存在或已删除')
    if (settlement.biz_type !== '分包' || settlement.status !== 'confirmed')
      throw new Error('项目罚扣只能抵扣已确认分包结算')
    if (settlement.project_id !== penalty.projectId)
      throw new Error('罚扣与支出结算不属于同一项目')
    if (penalty.supplier_id && settlement.supplier_id !== penalty.supplier_id)
      throw new Error('罚扣与支出结算的分供方不一致')
    if (penalty.contract_id && settlement.contract_id !== penalty.contract_id)
      throw new Error('罚扣与支出结算的合同不一致')
    const [penaltyTotal] = await tx.select<{ amount: number }>(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM penalty_settlement_deductions
      WHERE penalty_id = ? AND deleted_at IS NULL
    `, [penaltyId])
    if (numberValue(penaltyTotal?.amount) + amount > numberValue(penalty.amount) + 0.0001)
      throw new Error('抵扣金额超过罚扣剩余金额')
    const [settlementTotal] = await tx.select<{ amount: number }>(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM penalty_settlement_deductions
      WHERE settlement_id = ? AND deleted_at IS NULL
    `, [settlementId])
    if (numberValue(settlementTotal?.amount) + amount > numberValue(settlement.total_amount) + 0.0001)
      throw new Error('抵扣金额超过支出结算可抵扣金额')
    const deductionId = generateId('penalty_deduction')
    await tx.execute(`
      INSERT INTO penalty_settlement_deductions (
        id, penalty_id, settlement_id, amount, note
      )
      VALUES (?, ?, ?, ?, ?)
    `, [deductionId, penaltyId, settlementId, amount, note.trim()])
    await logCreate(tx, 'penalty_settlement_deductions', deductionId)
    const nextTotal = round2(numberValue(penaltyTotal?.amount) + amount)
    await withUpdateLog(tx, 'penalty_records', penaltyId, () => tx.execute(`
      UPDATE penalty_records
      SET status = ?, deductedAt = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [
      nextTotal >= numberValue(penalty.amount) ? 'deducted' : 'pending',
      nextTotal >= numberValue(penalty.amount) ? new Date().toISOString() : null,
      penaltyId,
    ]))
  })
}

export async function loadPenaltyDeductions(
  penaltyId: string,
): Promise<PenaltyDeductionView[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT deduction.*, settlement.no AS settlement_no,
           settlement.name AS settlement_name
    FROM penalty_settlement_deductions deduction
    JOIN expenditure_settlements settlement
      ON settlement.id = deduction.settlement_id
     AND settlement.deleted_at IS NULL
    WHERE deduction.penalty_id = ?
      AND deduction.deleted_at IS NULL
    ORDER BY deduction.created_at DESC, deduction.id DESC
  `, [penaltyId])
  return rows.map(row => ({
    id: text(row.id),
    penaltyId: text(row.penalty_id),
    settlementId: text(row.settlement_id),
    settlementNo: text(row.settlement_no),
    settlementName: text(row.settlement_name),
    amount: numberValue(row.amount),
    note: text(row.note),
    createdAt: text(row.created_at),
  }))
}
