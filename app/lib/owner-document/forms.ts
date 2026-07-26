import type { BoqChangeLineDraft, BoqDirectiveType, BoqDocumentType } from '~/lib/boq/change'
import type { TransactionDb } from '~/lib/db/coordinator'
import type { FileRefChanges, FileRefRecord } from '~/lib/forms/file-refs'
import { approveBoqChangeOrder, createBoqChangeOrder, transitionBoqChangeOrder } from '~/lib/boq/change'
import { select, withTransaction } from '~/lib/db/connection'
import { logCreate, withUpdateLog } from '~/lib/db/soft-delete'
import { applyFileRefChanges, listFileRefs } from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'
import { round2 } from '~/lib/util/number'

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

interface ContractRef {
  id: string
  project_id: string
  supplier_id: string | null
  kind: string
  name: string
  amount: number
  changed: number
  paid: number
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

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

async function activeContract(
  tx: TransactionDb,
  projectId: string,
  contractId: string,
  side: 'owner' | 'expenditure',
  supplierId?: string | null,
): Promise<ContractRef> {
  const [contract] = await tx.select<ContractRef>(`
    SELECT id, project_id, supplier_id, kind, name, amount, changed, paid
    FROM contracts
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL
  `, [contractId, projectId])
  if (!contract)
    throw new Error('合同不存在、已删除或不属于所选项目')
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
  if (draft.id)
    throw new Error('现有变更单编辑需走受控更正流程')
  const projectId = required(draft.projectId, '项目')
  const contractId = required(draft.contractId, '施工合同')
  const contract = await activeContract(tx, projectId, contractId, 'owner')
  const no = documentNo(draft.no, 'BQ')
  const name = required(draft.name, '变更名称')
  const lines = boqLines(draft)
  const documentType = (text(draft.documentType) || 'change_negotiation') as BoqDocumentType
  const directiveType = text(draft.directiveType) as BoqDirectiveType
  const reason = action === 'submit' ? required(draft.reason, '变更事由') : text(draft.reason)

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
      contract.name,
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
): Promise<void> {
  const [line] = await tx.select<{ id: string }>(`
    SELECT id FROM boq_lines
    WHERE id = ? AND project_id = ? AND contract_id = ? AND deleted_at IS NULL
  `, [boqLineId, projectId, contractId])
  if (!line)
    throw new Error('报量明细包含无效合同工程量清单行')
}

async function saveOwnerReport(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  if (draft.id)
    throw new Error('现有月度报量请在原单上执行审定或明细调整')
  const projectId = required(draft.projectId, '项目')
  const contractId = required(draft.contractId, '施工合同')
  await activeContract(tx, projectId, contractId, 'owner')
  const periodNo = required(draft.periodNo, '报量期次')
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(periodNo))
    throw new Error('报量期次格式必须为 yyyy-mm')
  const lines = draft.lines ?? []
  if (action === 'submit' && !lines.length)
    throw new Error('报量单至少需要一条明细')

  const normalized = await Promise.all(lines.map(async (line) => {
    const boqLineId = required(line.boqLineId, '合同工程量清单行')
    await assertBoqLine(tx, boqLineId, projectId, contractId)
    const autoQty = numberValue(line.autoQty)
    const reportedQty = nullableNumber(line.reportedQty) ?? autoQty
    if (autoQty < 0 || reportedQty < 0)
      throw new Error('自动完成量与申报量不能为负数')
    const unitPrice = numberValue(line.unitPrice)
    if (unitPrice < 0)
      throw new Error('合同单价不能为负数')
    return {
      boqLineId,
      itemName: required(line.itemName, '分项名称'),
      unit: text(line.unit),
      autoQty,
      reportedQty,
      unitPrice,
      amount: round2(reportedQty * unitPrice),
      note: text(line.note),
    }
  }))
  const id = generateId('monthly_statement')
  const reportedAmount = round2(normalized.reduce((sum, line) => sum + line.amount, 0))
  const logIds: string[] = []
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
  const headLogId = await logCreate(tx, 'monthly_statements', id)
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
  const id = generateId('project_acceptance')
  const projectId = text(draft.projectId) || null
  const contractId = text(draft.contractId) || null
  if (action === 'submit') {
    required(projectId, '项目')
    required(draft.name, '名称')
    required(draft.documentDate, '日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'owner')
  await tx.execute(`
    INSERT INTO project_acceptances (
      id, no, type, name, project_id, contract_id, document_date,
      contract_estimate, acceptor, warranty_owner, conclusion, status, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    documentNo(draft.no, 'YS'),
    text(draft.type) || 'acceptance',
    text(draft.name),
    projectId,
    contractId,
    text(draft.documentDate),
    nullableNumber(draft.contractEstimate),
    text(draft.acceptor),
    text(draft.warrantyOwner),
    text(draft.conclusion),
    action === 'submit' ? 'submitted' : 'draft',
    text(draft.note),
  ])
  const logId = await logCreate(tx, 'project_acceptances', id)
  await applyFileRefChanges(tx, 'project_acceptance', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveFinalSettlement(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = generateId('owner_final_settlement')
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
  await tx.execute(`
    INSERT INTO owner_final_settlements (
      id, no, name, project_id, contract_id, settlement_amount,
      submission_date, basis, difference_note, status, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
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
  ])
  const logId = await logCreate(tx, 'owner_final_settlements', id)
  await applyFileRefChanges(tx, 'owner_final_settlement', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveOwnerPenalty(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = generateId('owner_penalty')
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
  await tx.execute(`
    INSERT INTO owner_penalties (
      id, no, project_id, contract_id, notice_no, amount, penalty_date,
      reason, appeal_note, status, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
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
  ])
  const logId = await logCreate(tx, 'owner_penalties', id)
  await applyFileRefChanges(tx, 'owner_penalty', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveSubChange(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = generateId('subcontract_change')
  const projectId = text(draft.projectId) || null
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const reason = action === 'submit' ? required(draft.reason, '事由') : text(draft.reason)
  if (action === 'submit') {
    required(projectId, '项目')
    required(supplierId, '分供方')
    required(draft.changeDate, '日期')
    requiredPositive(draft.approvedAmount, '审批金额')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  await tx.execute(`
    INSERT INTO subcontract_change_orders (
      id, no, change_type, project_id, supplier_id, contract_id, change_date,
      approved_amount, changed_area, actual_approved_price, reason, status, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
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
  ])
  const logId = await logCreate(tx, 'subcontract_change_orders', id)
  await applyFileRefChanges(tx, 'subcontract_change_order', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveSubSettlement(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = generateId('expenditure_settlement')
  const projectId = text(draft.projectId) || null
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const amount = numberValue(draft.totalAmount)
  if (action === 'submit') {
    required(projectId, '项目')
    required(supplierId, '分供方')
    required(draft.name, '结算名称')
    requiredPositive(amount, '结算金额')
    required(draft.settlementDate, '结算日期')
  }
  if (projectId)
    await assertActiveProject(tx, projectId)
  if (contractId && projectId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  await tx.execute(`
    INSERT INTO expenditure_settlements (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      settlement_type, total_amount, settlement_date, deduction_note, status, note
    )
    VALUES (?, ?, ?, '分包', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
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
  ])
  const logId = await logCreate(tx, 'expenditure_settlements', id)
  await applyFileRefChanges(tx, 'expenditure_settlement', id, attachments)
  return { id, logIds: logId ? [logId] : [] }
}

async function saveProjectPenalty(
  tx: TransactionDb,
  draft: OwnerDocumentDraft,
  action: OwnerDocumentSaveAction,
  attachments: FileRefChanges,
): Promise<OwnerDocumentSaveResult> {
  const id = generateId('penalty')
  const projectId = required(draft.projectId, '项目')
  const supplierId = text(draft.supplierId) || null
  const contractId = text(draft.contractId) || null
  const crewId = text(draft.crewId) || null
  const amount = numberValue(draft.amount)
  const reason = action === 'submit' ? required(draft.reason, '罚扣事由') : text(draft.reason)
  if (action === 'submit') {
    requiredPositive(amount, '罚扣金额')
    required(draft.penaltyDate, '日期')
  }
  await assertActiveProject(tx, projectId)
  await assertActiveCrew(tx, crewId)
  if (contractId)
    await activeContract(tx, projectId, contractId, 'expenditure', supplierId)
  await tx.execute(`
    INSERT INTO penalty_records (
      id, no, projectId, crewId, source, reason, amount, penaltyDate,
      chargeMethod, deadline, status, supplier_id, contract_id,
      deduction_method, rectification_note, note
    )
    VALUES (?, ?, ?, ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
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
  ])
  const logId = await logCreate(tx, 'penalty_records', id)
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
    return row && {
      id: row.id,
      no: row.no,
      type: row.type,
      name: row.name,
      projectId: row.project_id,
      contractId: row.contract_id,
      documentDate: row.document_date,
      contractEstimate: nullableNumber(row.contract_estimate),
      acceptor: row.acceptor,
      warrantyOwner: row.warranty_owner,
      conclusion: row.conclusion,
      status: row.status,
      note: row.note,
    }
  }
  if (kind === 'final_settlement') {
    const [row] = await select<Record<string, unknown>>(`
      SELECT settlement.*, contract.amount AS contract_amount,
             contract.changed AS contract_changed, contract.paid AS contract_paid
      FROM owner_final_settlements settlement
      LEFT JOIN contracts contract
        ON contract.id = settlement.contract_id AND contract.deleted_at IS NULL
      WHERE settlement.id = ? AND settlement.deleted_at IS NULL
    `, [id])
    if (!row)
      return null
    const settlementAmount = numberValue(row.settlement_amount)
    const receivedAmount = numberValue(row.contract_paid)
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
      changedContractAmount: numberValue(row.contract_changed || row.contract_amount),
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

export async function approveOwnerChange(
  id: string,
  approvedAt: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    const [order] = await tx.select<{ id: string }>(
      `SELECT id FROM boq_change_orders WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!order)
      throw new Error('纯金额签证请在台账中确认，量价变更才执行 BOQ 签证')
    await approveBoqChangeOrder(tx, id, approvedAt)
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
    if (head.status === 'exported')
      throw new Error('该月度报量已审定')
    const rows = await tx.select<{ id: string, boq_line_id: string }>(
      `SELECT id, boq_line_id FROM monthly_statement_lines
       WHERE statement_id = ? AND deleted_at IS NULL`,
      [id],
    )
    const rowByBoq = new Map(rows.map(row => [row.boq_line_id, row]))
    let auditedTotal = 0
    for (const line of draft.lines) {
      const row = rowByBoq.get(line.boqLineId)
      if (!row)
        throw new Error('审定明细不属于当前月度报量单')
      if (!Number.isFinite(line.auditedQty) || line.auditedQty < 0)
        throw new Error('审定量必须是非负有效数字')
      const auditedAmount = numberValue(line.auditedAmount)
      if (auditedAmount < 0)
        throw new Error('审定金额不能为负数')
      auditedTotal = round2(auditedTotal + auditedAmount)
      await withUpdateLog(tx, 'monthly_statement_lines', row.id, () => tx.execute(`
        UPDATE monthly_statement_lines
        SET audited_qty = ?, audited_amount = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [line.auditedQty, auditedAmount, row.id]))
    }
    const headAmount = Number.isFinite(draft.auditedAmount)
      ? round2(draft.auditedAmount)
      : auditedTotal
    if (headAmount < 0)
      throw new Error('审定产值不能为负数')
    await withUpdateLog(tx, 'monthly_statements', id, () => tx.execute(`
      UPDATE monthly_statements
      SET audited_amount = ?, status = 'exported', updated_at = datetime('now')
      WHERE id = ?
    `, [headAmount, id]))
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
      contract_id: string | null
      project_id: string | null
      supplier_id: string | null
      total_amount: number
    }>(`
      SELECT project_id, supplier_id, contract_id, total_amount
      FROM expenditure_settlements
      WHERE id = ? AND deleted_at IS NULL
    `, [settlementId])
    if (!settlement)
      throw new Error('支出结算不存在或已删除')
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
