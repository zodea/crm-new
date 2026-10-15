import type { OurSignatorySnapshot } from '../our-signatory/contract'
import type { TransactionDb } from '~/lib/db/coordinator'
import { select, withTransaction } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  logCreate,
  PARENT_REFS,
  selectVisibleSql,
  softDelete,
  undoOperationIfUnchanged,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { applyFileRefChanges } from '~/lib/forms/file-refs'
import { contractOriginalPayloadDigest } from '~/lib/forms/original-content'
import { materialContractTotal, validateMaterialDetails, validateMaterialSourceOriginals } from '~/lib/material-contract/line-model'
import { generateId } from '~/lib/util/id'
import { adoptConstructionManagementFee, emptyConstructionManagementFee, validateConstructionManagementFee } from '../construction-contract/management-fee'
import { persistNativeConstructionManagementFee, readNativeConstructionManagementFee } from '../construction-contract/management-fee-storage'
import { decodeOurSignatorySnapshot } from '../our-signatory/contract'
import { contractNumberConflict, recordContractNumber } from '../our-signatory/number-registry'
import { resolveContractSignatory } from '../our-signatory/storage'

export type F2FormKind
  = | 'construction'
    | 'subcontract'
    | 'material'
    | 'other_expense'
    | 'company_expense'
    | 'other_settlement'
    | 'material_settlement'

export type F2SaveAction = 'draft' | 'save' | 'submit'

export type ContractAttachmentOwnerType
  = | 'contract'
    | 'contract_supplement'
    | 'company_expense_contract'
    | 'expenditure_settlement'

export interface ContractFormAttachmentDraft {
  fileName: string
  filePath?: string
  fileSize?: number
  mimeType?: string
  category?: string
  uploader?: string
  /** 原件正文沿公共文件输入；旧路径只作留痕。 */
  payloadBase64?: string
}

export interface ContractFormAttachmentChanges {
  add?: ContractFormAttachmentDraft[]
  removeIds?: string[]
  restoreIds?: string[]
}

export interface ContractFormAttachment {
  id: string
  ownerType: ContractAttachmentOwnerType
  ownerId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string | null
  deletedAt: string | null
  sha256?: string
}

export interface ContractLineItemDraft {
  id?: string
  materialName?: string
  spec?: string
  materialGrade?: string
  brand?: string
  unit?: string
  qty?: number | null
  taxInclusiveUnitPrice?: number | null
  /** 明确录入适用于本行的税点；未知不沿用合同头税率。 */
  applicableTaxRate?: number | null
  plannedArrivalDate?: string
  note?: string
  sortOrder?: number
  /** 协议实际变更对应的原签约行；新材料保持 null。 */
  originalLineId?: string | null
  /** 引用原行时，文书明确核实的本次增额；不自动追溯计价。 */
  changeAmount?: number | null
  changeBasis?: string
  source?: ContractLineSourceEvidence | null
}

export interface ContractLineSourceEvidence {
  fileName: string
  sheetName: string
  rowNumber: number
  sourceHash: string
  externalRef: string | null
  priceUnit: string
  quantityUnitVerified: boolean
}

export interface ContractDeductionDraft {
  id?: string
  name?: string
  amount?: number | null
  basis?: string
  sortOrder?: number
}

export interface ProjectContractFormDraft {
  id?: string
  isSupplement?: boolean
  originalContractId?: string | null
  no?: string
  ourSignatoryId?: string | null
  ourSignatoryVersion?: string | null
  ourSignatorySnapshot?: OurSignatorySnapshot | null
  legacyPartyA?: string | null
  name?: string
  projectId?: string | null
  customerId?: string | null
  supplierId?: string | null
  subKind?: string
  content?: string
  invoiceType?: string
  contactName?: string
  contactPhone?: string
  taxRate?: number | null
  signDate?: string
  mainTerms?: string
  paymentTerms?: string
  brandQualityTerms?: string
  scheduleTerms?: string
  warrantyTerms?: string
  specialTerms?: string
  /** 仅施工主合同；合同配置不生成实际成本或现金。 */
  managementFeeAmount?: number | null
  managementFeeBasis?: string
  retentionRatio?: number | null
  retentionAmount?: number | null
  retentionDays?: number | null
  invoiceName?: string
  invoiceTaxNo?: string
  invoiceAddressPhone?: string
  invoiceBank?: string
  invoiceBankAccount?: string
  otherExpenseKind?: string
  servicePeriod?: string
  paymentCycle?: string
  amount?: number | null
  status?: string
  note?: string
  lineItems?: ContractLineItemDraft[]
  deductions?: ContractDeductionDraft[]
}

export interface CompanyExpenseContractFormDraft {
  id?: string
  no?: string
  ourSignatoryId?: string | null
  ourSignatoryVersion?: string | null
  ourSignatorySnapshot?: OurSignatorySnapshot | null
  legacyPartyA?: string | null
  name?: string
  category?: string
  counterparty?: string
  signDate?: string
  servicePeriod?: string
  amount?: number | null
  paymentCycle?: string
  mainTerms?: string
  status?: string
  note?: string
}

export interface ExpenditureSettlementFormDraft {
  id?: string
  no?: string
  name?: string
  projectId?: string | null
  contractId?: string | null
  settlementType?: string
  totalAmount?: number | null
  amount?: number | null
  taxAmount?: number | null
  taxRate?: number | null
  settlementDate?: string
  settlementPeriod?: string
  deductionNote?: string
  status?: string
  note?: string
}

export type F2FormDraft
  = | ProjectContractFormDraft
    | CompanyExpenseContractFormDraft
    | ExpenditureSettlementFormDraft

export interface F2FormSaveResult {
  id: string
  logId: string | null
  attachmentIds: string[]
  warnings?: string[]
}

interface ContractReferenceRow {
  id: string
  kind: string
  sub_kind: string
  cost_category: string
  project_id: string | null
  customer_id: string | null
  supplier_id: string | null
  amount: number
  status: string
  deleted_at: string | null
}

const PROJECT_FORM_KINDS = new Set<F2FormKind>([
  'construction',
  'subcontract',
  'material',
  'other_expense',
])

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rawText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  const valueText = normalizedText(value)
  return valueText || null
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value == null)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeNumber(label: string, value: unknown): number {
  const number = nullableNumber(value) ?? 0
  if (number < 0)
    throw new Error(`${label}不能为负数`)
  return number
}

function requireFields(fields: Array<[label: string, value: unknown]>): void {
  const missing = fields.filter(([, value]) => !normalizedText(value))
  if (missing.length)
    throw new Error(`${missing[0]![0]}：为必填项（共 ${missing.length} 处）`)
}

function lifecycleStatus(
  action: F2SaveAction,
  current: string | undefined,
  submittedStatus: string,
): string {
  if (action === 'draft')
    return '草稿'
  if (action === 'submit')
    return submittedStatus
  if (current === 'draft')
    return '草稿'
  if (current === 'submitted')
    return '审批中'
  return current || '草稿'
}

async function activeRow<T>(
  tx: TransactionDb,
  table: string,
  id: string | null | undefined,
): Promise<T | null> {
  if (!id)
    return null
  const rows = await tx.select<T>(
    selectVisibleSql(table, 'AND id = ? LIMIT 1'),
    [id],
  )
  return rows[0] ?? null
}

async function assertActiveReference(
  tx: TransactionDb,
  table: string,
  id: string | null | undefined,
  label: string,
): Promise<void> {
  if (!id)
    return
  const row = await activeRow<{ id: string }>(tx, table, id)
  if (!row)
    throw new Error(`${label}不存在或已删除`)
}

async function assertProjectCustomerRelation(
  tx: TransactionDb,
  projectId: string | null | undefined,
  customerId: string | null | undefined,
): Promise<void> {
  if (!projectId || !customerId)
    return
  const [project] = await tx.select<{ customer_id: string | null }>(`
    SELECT customer_id
    FROM projects
    WHERE id = ? AND deleted_at IS NULL
  `, [projectId])
  if (!project)
    throw new Error('项目不存在或已删除')
  if (project.customer_id !== customerId)
    throw new Error('甲方客户与所选项目不一致')
}

function validateLineItems(
  lines: ContractLineItemDraft[],
  action: F2SaveAction,
): void {
  for (const [index, line] of lines.entries()) {
    const qty = nullableNumber(line.qty)
    const price = nullableNumber(line.taxInclusiveUnitPrice)
    if (qty != null && qty <= 0)
      throw new Error(`第 ${index + 1} 行数量必须大于 0`)
    if (price != null && price < 0)
      throw new Error(`第 ${index + 1} 行含税单价不能为负数`)
    if (action === 'submit') {
      requireFields([
        [`第 ${index + 1} 行物资名称`, line.materialName],
        [`第 ${index + 1} 行数量`, qty == null ? '' : String(qty)],
        [`第 ${index + 1} 行含税单价`, price == null ? '' : String(price)],
      ])
    }
  }
}

function projectContractKind(kind: F2FormKind): {
  kind: '施工' | '分包' | '材采' | '其他支出'
  costCategory: '' | '专业分包' | '合同劳务' | '材料' | '机械' | '其他'
} {
  switch (kind) {
    case 'construction':
      return { kind: '施工', costCategory: '' }
    case 'subcontract':
      return { kind: '分包', costCategory: '专业分包' }
    case 'material':
      return { kind: '材采', costCategory: '材料' }
    case 'other_expense':
      return { kind: '其他支出', costCategory: '其他' }
    default:
      throw new Error(`不支持的项目合同表单：${kind}`)
  }
}

async function validateProjectContract(
  tx: TransactionDb,
  formKind: F2FormKind,
  draft: ProjectContractFormDraft,
  action: F2SaveAction,
): Promise<void> {
  if (draft.managementFeeAmount !== undefined || draft.managementFeeBasis !== undefined) {
    if (formKind !== 'construction' || draft.isSupplement)
      throw new Error('管理费配置仅适用于施工主合同')
    validateConstructionManagementFee(draft.managementFeeAmount ?? null, draft.managementFeeBasis ?? '')
  }
  const amount = nullableNumber(draft.amount)
  if (amount != null && amount < 0)
    throw new Error('含税合同金额不能为负数')
  const taxRate = nullableNumber(draft.taxRate)
  if (taxRate != null && taxRate < 0)
    throw new Error('税率不能为负数')
  const retentionRatio = nullableNumber(draft.retentionRatio)
  if (retentionRatio != null && (retentionRatio < 0 || retentionRatio > 1))
    throw new Error('质保金比例必须在 0 到 1 之间')
  nonNegativeNumber('质保金金额', draft.retentionAmount)
  nonNegativeNumber('质保期', draft.retentionDays)

  if (draft.isSupplement) {
    await assertActiveReference(
      tx,
      'contracts',
      draft.originalContractId,
      '原合同',
    )
    if (formKind === 'material') {
      const parent = await activeRow<ContractReferenceRow>(tx, 'contracts', draft.originalContractId)
      if (parent?.kind !== '材采')
        throw new Error('原合同必须是材料采购主合同')
      const originalLines = await tx.select<{ id: string }>('SELECT id FROM contract_line_items WHERE contract_id = ?', [draft.originalContractId])
      validateMaterialDetails(draft.lineItems ?? [], draft.deductions ?? [], {
        formal: action === 'submit',
        supplement: true,
        originalLineIds: new Set(originalLines.map(row => row.id)),
      })
      if (action === 'submit' && (amount == null || amount <= 0))
        throw new Error('正式补充协议本次增额必须大于 0')
      const total = materialContractTotal(draft.lineItems ?? [], draft.deductions ?? [], true)
      if (action === 'submit' && (total == null || amount == null || Math.abs(total - amount) > 0.005))
        throw new Error('协议自有明细及减项合计与本次增额不一致')
    }
    if (action === 'submit') {
      requireFields([
        ['原合同', draft.originalContractId],
        ['协议名称', draft.name],
        ['协议内容', draft.content],
        ['签约日期', draft.signDate],
      ])
    }
    return
  }

  await assertActiveReference(tx, 'projects', draft.projectId, '项目')
  if (formKind === 'construction') {
    await assertActiveReference(tx, 'customers', draft.customerId, '甲方客户')
    await assertProjectCustomerRelation(tx, draft.projectId, draft.customerId)
  }
  else {
    await assertActiveReference(tx, 'suppliers', draft.supplierId, '分供方')
  }

  const lines = formKind === 'material' ? draft.lineItems ?? [] : []
  validateLineItems(lines, action)
  if (formKind === 'material')
    validateMaterialDetails(lines, draft.deductions ?? [], { formal: action === 'submit', supplement: false })
  const materialTotal = materialContractTotal(lines, draft.deductions ?? [])
  if (
    action === 'submit'
    && formKind === 'material'
    && (materialTotal == null || amount == null || Math.abs(materialTotal - amount) > 0.005)
  ) {
    throw new Error('材采明细含税汇总与合同头金额不一致')
  }

  if (action === 'submit') {
    requireFields([
      ['合同名称', draft.name],
      ['项目', draft.projectId],
      [
        formKind === 'construction' ? '甲方客户' : '分供方',
        formKind === 'construction' ? draft.customerId : draft.supplierId,
      ],
      ['合同内容简述', draft.content],
      ['签约日期', draft.signDate],
    ])
  }
}

async function applyAttachmentChanges(
  tx: TransactionDb,
  ownerType: ContractAttachmentOwnerType,
  ownerId: string,
  changes: ContractFormAttachmentChanges = {},
): Promise<string[]> {
  for (const attachment of changes.add ?? []) {
    if (typeof attachment.payloadBase64 === 'string')
      await contractOriginalPayloadDigest(attachment.payloadBase64, attachment.fileSize ?? 0, () => { throw new Error('附件原件编码或长度无效') })
  }
  return applyFileRefChanges(tx, ownerType, ownerId, changes)
}

async function assertMaterialSourceOriginals(tx: TransactionDb, draft: ProjectContractFormDraft, changes: ContractFormAttachmentChanges) {
  const files = draft.id
    ? await tx.select<{ file_name: string, file_size: number, encoding: string | null, content: string | null }>(`
    SELECT f.file_name,f.file_size,p.encoding,p.content FROM file_refs f
    LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.owner_type=? AND f.owner_id=?
  `, [draft.isSupplement ? 'contract_supplement' : 'contract', draft.id])
    : []
  const originals: { fileName: string, sha256: string }[] = []

  const invalid = () => {
    throw new Error('材采来源原件编码或长度无效')
  }
  for (const file of files) {
    if (typeof file.content === 'string') {
      if (file.encoding !== 'base64')
        invalid()
      originals.push({ fileName: file.file_name, sha256: await contractOriginalPayloadDigest(file.content!, file.file_size, invalid) })
    }
  }
  for (const file of changes.add ?? []) {
    if (typeof file.payloadBase64 === 'string')
      originals.push({ fileName: file.fileName.trim(), sha256: await contractOriginalPayloadDigest(file.payloadBase64, file.fileSize ?? 0, invalid) })
  }
  const prior = draft.id ? await tx.select<{ id: string, source_evidence: string | null }>(`SELECT id,source_evidence FROM ${draft.isSupplement ? 'contract_supplement_line_items' : 'contract_line_items'} WHERE ${draft.isSupplement ? 'supplement_id' : 'contract_id'}=?`, [draft.id]) : []
  validateMaterialSourceOriginals(draft.lineItems ?? [], prior.map(row => ({ id: row.id, source: row.source_evidence ? JSON.parse(row.source_evidence) : null })), originals)
}

async function persistContractLineItems(
  tx: TransactionDb,
  ownerId: string,
  lines: ContractLineItemDraft[],
  supplement = false,
): Promise<void> {
  const table = supplement ? 'contract_supplement_line_items' : 'contract_line_items'
  const parentField = supplement ? 'supplement_id' : 'contract_id'
  const existing = await tx.select<{ id: string, original_line_id?: string | null, original_line_snapshot?: string | null, original_source_updated_at?: string | null }>(`
    SELECT id${supplement ? ', original_line_id, original_line_snapshot, original_source_updated_at' : ''}
    FROM ${table}
    WHERE ${parentField} = ? AND deleted_at IS NULL
  `, [ownerId])
  const incomingIds = new Set(lines.flatMap(line => line.id ? [line.id] : []))
  for (const row of existing) {
    if (!incomingIds.has(row.id))
      await softDelete(tx, table, row.id)
  }

  for (const [index, line] of lines.entries()) {
    const prior = existing.find(row => row.id === line.id)
    const originalId = nullableText(line.originalLineId)
    let snapshot: string | null = null
    let sourceUpdatedAt: string | null = null
    if (supplement && originalId) {
      if (prior && prior.original_line_id === originalId) {
        // 旧协议缺少当时证据时继续保留未知，不能用今天的原行反填历史。
        snapshot = prior.original_line_snapshot ?? null
        sourceUpdatedAt = prior.original_source_updated_at ?? null
      }
      else {
        const original = await tx.select<Record<string, unknown>>(`SELECT line.* FROM contract_line_items line
          JOIN contract_supplements supplement ON supplement.contract_id=line.contract_id
          WHERE supplement.id=? AND line.id=?`, [ownerId, originalId])
        if (!original[0])
          throw new Error('协议原材料行不属于此主合同')
        snapshot = JSON.stringify(original[0])
        sourceUpdatedAt = String(original[0].updated_at)
      }
    }
    const fields = ['material_name', 'spec', 'material_grade', 'brand', 'unit', 'qty', 'tax_inclusive_unit_price', 'applicable_tax_rate', 'planned_arrival_date', 'note', 'sort_order', 'source_evidence', ...(supplement ? ['original_line_id', 'change_amount', 'change_basis', 'original_line_snapshot', 'original_source_updated_at'] : [])]
    const values = [normalizedText(line.materialName), rawText(line.spec), rawText(line.materialGrade), rawText(line.brand), rawText(line.unit), nullableNumber(line.qty), nullableNumber(line.taxInclusiveUnitPrice), nullableNumber(line.applicableTaxRate), normalizedText(line.plannedArrivalDate), rawText(line.note), line.sortOrder ?? index, line.source ? JSON.stringify(line.source) : null, ...(supplement ? [originalId, nullableNumber(line.changeAmount), rawText(line.changeBasis), snapshot, sourceUpdatedAt] : [])]
    const now = new Date().toISOString()
    if (line.id && existing.some(row => row.id === line.id)) {
      await withUpdateLog(tx, table, line.id, () => tx.execute(`
        UPDATE ${table}
        SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ?
        WHERE id = ?
      `, [...values, now, line.id]))
      continue
    }

    const id = generateId('contract_line')
    await tx.execute(`
      INSERT INTO ${table} (id, ${parentField}, ${fields.join(', ')}, created_at, updated_at)
      VALUES (${Array.from({ length: fields.length + 4 }).fill('?').join(', ')})
    `, [id, ownerId, ...values, now, now])
    await logCreate(tx, table, id)
  }
}

async function persistContractDeductions(tx: TransactionDb, ownerId: string, rows: ContractDeductionDraft[], supplement = false): Promise<void> {
  const parentField = supplement ? 'supplement_id' : 'contract_id'
  const existing = await tx.select<{ id: string }>(`SELECT id FROM contract_deductions WHERE ${parentField} = ? AND deleted_at IS NULL`, [ownerId])
  const incoming = new Set(rows.flatMap(row => row.id ? [row.id] : []))
  for (const row of existing) {
    if (!incoming.has(row.id))
      await softDelete(tx, 'contract_deductions', row.id)
  }
  for (const [index, row] of rows.entries()) {
    const now = new Date().toISOString()
    const values = [rawText(row.name), nullableNumber(row.amount), rawText(row.basis), row.sortOrder ?? index, now]
    if (row.id && existing.some(prior => prior.id === row.id)) {
      await withUpdateLog(tx, 'contract_deductions', row.id, () => tx.execute('UPDATE contract_deductions SET name = ?, amount = ?, basis = ?, sort_order = ?, updated_at = ? WHERE id = ?', [...values, row.id]))
    }
    else {
      const id = generateId('contract_deduction')
      await tx.execute(`INSERT INTO contract_deductions (id, ${parentField}, name, amount, basis, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, ownerId, ...values.slice(0, -1), now, now])
      await logCreate(tx, 'contract_deductions', id)
    }
  }
}

async function saveProjectContract(
  tx: TransactionDb,
  formKind: F2FormKind,
  draft: ProjectContractFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  if (draft.id) {
    const [existingContract, existingSupplement] = await Promise.all([
      activeRow<{ id: string, kind: string }>(tx, 'contracts', draft.id),
      activeRow<{ id: string }>(tx, 'contract_supplements', draft.id),
    ])
    if (draft.isSupplement && existingContract && !existingSupplement)
      throw new Error('主合同不能改为补充协议')
    if (!draft.isSupplement && existingSupplement && !existingContract)
      throw new Error('补充协议不能改为主合同')
    if (existingContract && existingContract.kind !== projectContractKind(formKind).kind)
      throw new Error('合同类型与当前编辑入口不一致')
  }
  await validateProjectContract(tx, formKind, draft, action)
  const now = new Date().toISOString()
  const ownerTable = draft.isSupplement ? 'contract_supplements' : 'contracts'
  const owner = draft.id ? (await tx.select<Record<string, unknown>>(`SELECT * FROM ${ownerTable} WHERE id=?`, [draft.id]))[0] : null
  const parent = draft.isSupplement ? (await tx.select<Record<string, unknown>>('SELECT * FROM contracts WHERE id=?', [draft.originalContractId]))[0] : null
  const priorSnapshot = owner?.our_signatory_snapshot ? decodeOurSignatorySnapshot(JSON.parse(String(owner.our_signatory_snapshot))) : null
  const inherited = draft.isSupplement ? (owner ? priorSnapshot : (parent?.our_signatory_snapshot ? decodeOurSignatorySnapshot(JSON.parse(String(parent.our_signatory_snapshot))) : null)) : null
  if (draft.isSupplement && draft.ourSignatoryId && draft.ourSignatoryId !== inherited?.id)
    throw new Error('补充协议不能更换我方签约主体')
  const signatory = draft.isSupplement ? inherited : await resolveContractSignatory(tx, { id: draft.ourSignatoryId ?? priorSnapshot?.id, version: draft.ourSignatoryVersion, prior: priorSnapshot, required: false })
  if (!draft.isSupplement && action === 'submit' && await contractNumberConflict(tx, 'native-contracts', draft.id ?? null, rawText(draft.no)))
    throw new Error('已填写合同编号与其他正式主合同重复')
  if (draft.isSupplement) {
    const id = draft.id ?? generateId('contract_supplement')
    const values = [
      draft.originalContractId,
      rawText(draft.no),
      rawText(draft.name),
      rawText(draft.content),
      nullableNumber(draft.amount),
      normalizedText(draft.signDate),
      lifecycleStatus(action, draft.status, '审批中'),
      rawText(draft.note),
      signatory?.id ?? null,
      signatory ? JSON.stringify(signatory) : null,
      now,
    ]
    const existing = draft.id
      ? await activeRow<{ id: string }>(tx, 'contract_supplements', draft.id)
      : null
    const logId = existing
      ? await withUpdateLog(tx, 'contract_supplements', id, () => tx.execute(`
          UPDATE contract_supplements
          SET contract_id = ?, no = ?, name = ?, content = ?, amount = ?,
              sign_date = ?, status = ?, note = ?, our_signatory_id = ?, our_signatory_snapshot = ?, updated_at = ?
          WHERE id = ?
        `, [...values, id]))
      : await (async () => {
          await tx.execute(`
            INSERT INTO contract_supplements (
              id, contract_id, no, name, content, amount, sign_date,
              status, note, our_signatory_id, our_signatory_snapshot, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [id, ...values.slice(0, -1), now, now])
          return logCreate(tx, 'contract_supplements', id)
        })()
    const attachmentIds = await applyAttachmentChanges(
      tx,
      'contract_supplement',
      id,
      attachments,
    )
    if (formKind === 'material') {
      await persistContractLineItems(tx, id, draft.lineItems ?? [], true)
      await persistContractDeductions(tx, id, draft.deductions ?? [], true)
    }
    return { id, logId, attachmentIds }
  }

  const classification = projectContractKind(formKind)
  const subKind = formKind === 'subcontract'
    ? normalizedText(draft.subKind) || '专业'
    : ''
  const costCategory = formKind === 'subcontract'
    ? subKind === '劳务' ? '合同劳务' : '专业分包'
    : formKind === 'other_expense'
      ? /机械|租赁/.test(normalizedText(draft.otherExpenseKind)) ? '机械' : '其他'
      : classification.costCategory
  const id = draft.id ?? generateId('contract')
  const managementFee = formKind === 'construction'
    ? adoptConstructionManagementFee(owner ? await readNativeConstructionManagementFee(tx, id) : emptyConstructionManagementFee(), draft, { version: generateId('construction_management_fee'), contractVersion: now, adoptedAt: now, actorId: null, commandId: null })
    : null
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    classification.kind,
    subKind,
    costCategory,
    nullableText(draft.projectId),
    formKind === 'construction' ? nullableText(draft.customerId) : null,
    formKind === 'construction' ? null : nullableText(draft.supplierId),
    nullableNumber(draft.amount),
    rawText(draft.content),
    rawText(draft.invoiceType),
    rawText(draft.contactName),
    rawText(draft.contactPhone),
    nullableNumber(draft.taxRate),
    normalizedText(draft.signDate),
    rawText(draft.mainTerms),
    rawText(draft.paymentTerms),
    rawText(draft.brandQualityTerms),
    rawText(draft.scheduleTerms),
    rawText(draft.warrantyTerms),
    rawText(draft.specialTerms),
    nullableNumber(draft.retentionRatio),
    nullableNumber(draft.retentionAmount),
    nullableNumber(draft.retentionDays),
    rawText(draft.invoiceName),
    rawText(draft.invoiceTaxNo),
    rawText(draft.invoiceAddressPhone),
    rawText(draft.invoiceBank),
    rawText(draft.invoiceBankAccount),
    rawText(draft.otherExpenseKind),
    rawText(draft.servicePeriod),
    rawText(draft.paymentCycle),
    lifecycleStatus(action, draft.status, '审批中'),
    rawText(draft.note),
    signatory?.id ?? null,
    signatory ? JSON.stringify(signatory) : null,
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string }>(tx, 'contracts', draft.id)
    : null
  const logId = existing
    ? await withUpdateLog(tx, 'contracts', id, async () => {
        await tx.execute(`
        UPDATE contracts
        SET no = ?, name = ?, kind = ?, sub_kind = ?, cost_category = ?,
            project_id = ?, customer_id = ?, supplier_id = ?, amount = ?,
            content = ?, invoice_type = ?, contact_name = ?, contact_phone = ?,
            tax_rate = ?, sign_date = ?, main_terms = ?, payment_terms = ?,
            brand_quality_terms = ?, schedule_terms = ?, warranty_terms = ?,
            special_terms = ?, retention_ratio = ?, retention_amount = ?,
            retention_days = ?, invoice_name = ?, invoice_tax_no = ?,
            invoice_address_phone = ?, invoice_bank = ?,
            invoice_bank_account = ?, other_expense_kind = ?,
            service_period = ?, payment_cycle = ?, status = ?, note = ?,
            our_signatory_id = ?, our_signatory_snapshot = ?,
            updated_at = ?
        WHERE id = ?
      `, [...values, id])
        if (managementFee)
          await persistNativeConstructionManagementFee(tx, id, managementFee)
      })
    : await (async () => {
        await tx.execute(`
          INSERT INTO contracts (
            id, no, name, kind, sub_kind, cost_category, project_id,
            customer_id, supplier_id, amount, content, invoice_type,
            contact_name, contact_phone, tax_rate, sign_date, main_terms,
            payment_terms, brand_quality_terms, schedule_terms, warranty_terms,
            special_terms, retention_ratio, retention_amount, retention_days,
            invoice_name, invoice_tax_no, invoice_address_phone, invoice_bank,
            invoice_bank_account, other_expense_kind, service_period,
            payment_cycle, status, note, our_signatory_id, our_signatory_snapshot, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `, [id, ...values.slice(0, -1), now, now])
        if (managementFee)
          await persistNativeConstructionManagementFee(tx, id, managementFee)
        return logCreate(tx, 'contracts', id)
      })()

  const duplicateDraftNumber = action === 'draft' && await contractNumberConflict(tx, 'native-contracts', id, rawText(draft.no))
  await recordContractNumber(tx, { owner: 'native-contracts', id, number: rawText(draft.no), version: now, occurredAt: now, formal: action === 'submit' || !['draft', '草稿'].includes(lifecycleStatus(action, draft.status, '审批中')) }, { enforce: action === 'submit', historyId: generateId('contract_number_history') })
  if (formKind === 'material') {
    await persistContractLineItems(tx, id, draft.lineItems ?? [])
    await persistContractDeductions(tx, id, draft.deductions ?? [])
  }
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'contract',
    id,
    attachments,
  )
  return { id, logId, attachmentIds, ...(duplicateDraftNumber ? { warnings: ['草稿编号与其他正式主合同重复，正式提交前请核对。'] } : {}) }
}

async function saveCompanyExpenseContract(
  tx: TransactionDb,
  draft: CompanyExpenseContractFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  const amount = nullableNumber(draft.amount)
  if (amount != null && amount < 0)
    throw new Error('合同金额不能为负数')
  if (action === 'submit') {
    requireFields([
      ['合同名称', draft.name],
      ['对方单位', draft.counterparty],
      ['签订日期', draft.signDate],
    ])
  }
  const id = draft.id ?? generateId('company_expense_contract')
  const now = new Date().toISOString()
  const prior = draft.id ? (await tx.select<{ our_signatory_snapshot: string | null }>('SELECT our_signatory_snapshot FROM company_expense_contracts WHERE id=?', [draft.id]))[0] : null
  const priorSnapshot = prior?.our_signatory_snapshot ? decodeOurSignatorySnapshot(JSON.parse(prior.our_signatory_snapshot)) : null
  const signatory = await resolveContractSignatory(tx, { id: draft.ourSignatoryId ?? priorSnapshot?.id, version: draft.ourSignatoryVersion, prior: priorSnapshot, required: false })
  if (action === 'submit' && await contractNumberConflict(tx, 'native-company-expense', draft.id ?? null, rawText(draft.no)))
    throw new Error('已填写合同编号与其他正式主合同重复')
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    rawText(draft.category),
    rawText(draft.counterparty),
    normalizedText(draft.signDate),
    rawText(draft.servicePeriod),
    amount,
    rawText(draft.paymentCycle),
    rawText(draft.mainTerms),
    lifecycleStatus(action, draft.status, '审批中'),
    rawText(draft.note),
    signatory?.id ?? null,
    signatory ? JSON.stringify(signatory) : null,
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string }>(tx, 'company_expense_contracts', draft.id)
    : null
  const logId = existing
    ? await withUpdateLog(tx, 'company_expense_contracts', id, () => tx.execute(`
        UPDATE company_expense_contracts
        SET no = ?, name = ?, category = ?, counterparty = ?, sign_date = ?,
            service_period = ?, amount = ?, payment_cycle = ?, main_terms = ?,
            status = ?, note = ?, our_signatory_id = ?, our_signatory_snapshot = ?, updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO company_expense_contracts (
            id, no, name, category, counterparty, sign_date, service_period,
            amount, payment_cycle, main_terms, status, note, our_signatory_id, our_signatory_snapshot, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'company_expense_contracts', id)
      })()
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'company_expense_contract',
    id,
    attachments,
  )
  const duplicateDraftNumber = action === 'draft' && await contractNumberConflict(tx, 'native-company-expense', id, rawText(draft.no))
  await recordContractNumber(tx, { owner: 'native-company-expense', id, number: rawText(draft.no), version: now, occurredAt: now, formal: action === 'submit' || !['draft', '草稿'].includes(lifecycleStatus(action, draft.status, '审批中')) }, { enforce: action === 'submit', historyId: generateId('contract_number_history') })
  return { id, logId, attachmentIds, ...(duplicateDraftNumber ? { warnings: ['草稿编号与其他正式主合同重复，正式提交前请核对。'] } : {}) }
}

async function saveExpenditureSettlement(
  tx: TransactionDb,
  kind: 'other_settlement' | 'material_settlement',
  draft: ExpenditureSettlementFormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges,
): Promise<F2FormSaveResult> {
  const totalAmount = nonNegativeNumber('结算金额', draft.totalAmount)
  const amount = nullableNumber(draft.amount)
  const taxAmount = nullableNumber(draft.taxAmount)
  const taxRate = nullableNumber(draft.taxRate)
  for (const [label, value] of [
    ['不含税结算金额', amount],
    ['税额', taxAmount],
    ['税率', taxRate],
  ] as const) {
    if (value != null && value < 0)
      throw new Error(`${label}不能为负数`)
  }

  await assertActiveReference(tx, 'projects', draft.projectId, '项目')
  const contract = await activeRow<ContractReferenceRow>(
    tx,
    'contracts',
    draft.contractId,
  )
  const expectedContractKind = kind === 'material_settlement' ? '材采' : '其他支出'
  const contractLabel = kind === 'material_settlement' ? '材料采购合同' : '其他支出合同'
  if (draft.contractId && !contract)
    throw new Error(`${contractLabel}不存在或已删除`)
  if (contract && contract.kind !== expectedContractKind)
    throw new Error(`所选合同不是${contractLabel}`)
  if (contract && draft.projectId && contract.project_id !== draft.projectId)
    throw new Error(`${contractLabel}与所选项目不一致`)
  if (contract && ['draft', '草稿'].includes(contract.status))
    throw new Error(`${contractLabel}仍为草稿，不能办理结算`)
  if (action === 'submit') {
    requireFields([
      ['结算名称', draft.name],
      ['项目', draft.projectId],
      [contractLabel, draft.contractId],
      ['结算日期', draft.settlementDate],
    ])
  }

  const id = draft.id ?? generateId('expenditure_settlement')
  const now = new Date().toISOString()
  const values = [
    rawText(draft.no),
    rawText(draft.name),
    contract?.cost_category || (kind === 'material_settlement' ? '材料' : '其他'),
    contract?.project_id ?? nullableText(draft.projectId),
    contract?.supplier_id ?? null,
    contract?.id ?? null,
    rawText(draft.settlementType),
    totalAmount,
    amount,
    taxAmount,
    taxRate,
    normalizedText(draft.settlementDate),
    rawText(draft.settlementPeriod),
    rawText(draft.deductionNote),
    lifecycleStatus(action, draft.status, '待确认'),
    rawText(draft.note),
    now,
  ]
  const existing = draft.id
    ? await activeRow<{ id: string, biz_type: string }>(
        tx,
        'expenditure_settlements',
        draft.id,
      )
    : null
  if (existing && !settlementMatchesKind(kind, existing.biz_type))
    throw new Error('错误路由不能修改该结算单')
  const logId = existing
    ? await withUpdateLog(tx, 'expenditure_settlements', id, () => tx.execute(`
        UPDATE expenditure_settlements
        SET no = ?, name = ?, biz_type = ?, project_id = ?, supplier_id = ?,
            contract_id = ?, settlement_type = ?, total_amount = ?, amount = ?,
            tax_amount = ?, tax_rate = ?, settlement_date = ?,
            settlement_period = ?, deduction_note = ?, status = ?, note = ?,
            updated_at = ?
        WHERE id = ?
      `, [...values, id]))
    : await (async () => {
        await tx.execute(`
          INSERT INTO expenditure_settlements (
            id, no, name, biz_type, project_id, supplier_id, contract_id,
            settlement_type, total_amount, amount, tax_amount, tax_rate,
            settlement_date, settlement_period, deduction_note, status, note,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, ...values.slice(0, -1), now, now])
        return logCreate(tx, 'expenditure_settlements', id)
      })()
  const attachmentIds = await applyAttachmentChanges(
    tx,
    'expenditure_settlement',
    id,
    attachments,
  )
  return { id, logId, attachmentIds }
}

function settlementMatchesKind(
  kind: 'other_settlement' | 'material_settlement',
  bizType: string,
): boolean {
  return kind === 'material_settlement'
    ? bizType === '材料' || bizType === '材采'
    : bizType === '机械' || bizType === '其他'
}

export async function saveF2Form(
  kind: F2FormKind,
  draft: F2FormDraft,
  action: F2SaveAction,
  attachments: ContractFormAttachmentChanges = {},
): Promise<F2FormSaveResult> {
  if ((kind === 'other_expense' || kind === 'company_expense') && 'window' in globalThis)
    throw new Error('浏览器辅助合同请通过中央合同表单保存')
  return withTransaction(async (tx) => {
    if (kind === 'material')
      await assertMaterialSourceOriginals(tx, draft as ProjectContractFormDraft, attachments)
    if (PROJECT_FORM_KINDS.has(kind)) {
      return saveProjectContract(
        tx,
        kind,
        draft as ProjectContractFormDraft,
        action,
        attachments,
      )
    }
    if (kind === 'company_expense') {
      return saveCompanyExpenseContract(
        tx,
        draft as CompanyExpenseContractFormDraft,
        action,
        attachments,
      )
    }
    return saveExpenditureSettlement(
      tx,
      kind as 'other_settlement' | 'material_settlement',
      draft as ExpenditureSettlementFormDraft,
      action,
      attachments,
    )
  })
}

export function mapProjectContractRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    customerId: (row.customer_id ?? null) as string | null,
    supplierId: (row.supplier_id ?? null) as string | null,
    subKind: (row.sub_kind ?? '') as string,
    content: (row.content ?? '') as string,
    invoiceType: (row.invoice_type ?? '') as string,
    contactName: (row.contact_name ?? '') as string,
    contactPhone: (row.contact_phone ?? '') as string,
    taxRate: nullableNumber(row.tax_rate),
    signDate: (row.sign_date ?? '') as string,
    mainTerms: (row.main_terms ?? '') as string,
    paymentTerms: (row.payment_terms ?? '') as string,
    brandQualityTerms: (row.brand_quality_terms ?? '') as string,
    scheduleTerms: (row.schedule_terms ?? '') as string,
    warrantyTerms: (row.warranty_terms ?? '') as string,
    specialTerms: (row.special_terms ?? '') as string,
    retentionRatio: nullableNumber(row.retention_ratio),
    retentionAmount: nullableNumber(row.retention_amount),
    retentionDays: nullableNumber(row.retention_days),
    invoiceName: (row.invoice_name ?? '') as string,
    invoiceTaxNo: (row.invoice_tax_no ?? '') as string,
    invoiceAddressPhone: (row.invoice_address_phone ?? '') as string,
    invoiceBank: (row.invoice_bank ?? '') as string,
    invoiceBankAccount: (row.invoice_bank_account ?? '') as string,
    otherExpenseKind: (row.other_expense_kind ?? '') as string,
    servicePeriod: (row.service_period ?? '') as string,
    paymentCycle: (row.payment_cycle ?? '') as string,
    amount: nullableNumber(row.amount),
    ...mapContractSignatory(row),
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
  }
}

function mapContractSignatory(row: Record<string, unknown>) {
  const snapshot = row.our_signatory_snapshot ? decodeOurSignatorySnapshot(JSON.parse(String(row.our_signatory_snapshot))) : null
  if ((row.our_signatory_id ?? null) !== (snapshot?.id ?? null))
    throw new Error('合同我方主体关系与签约快照不一致')
  return { ourSignatoryId: snapshot?.id ?? null, ourSignatoryVersion: snapshot?.version ?? null, ourSignatorySnapshot: snapshot, legacyPartyA: typeof row.party_a === 'string' ? row.party_a : null }
}

function mapLineItem(row: Record<string, unknown>): ContractLineItemDraft {
  return {
    id: row.id as string,
    materialName: (row.material_name ?? '') as string,
    spec: (row.spec ?? '') as string,
    materialGrade: (row.material_grade ?? '') as string,
    brand: (row.brand ?? '') as string,
    unit: (row.unit ?? '') as string,
    qty: nullableNumber(row.qty),
    taxInclusiveUnitPrice: nullableNumber(row.tax_inclusive_unit_price),
    applicableTaxRate: nullableNumber(row.applicable_tax_rate),
    plannedArrivalDate: (row.planned_arrival_date ?? '') as string,
    note: (row.note ?? '') as string,
    sortOrder: Number(row.sort_order ?? 0),
    originalLineId: (row.original_line_id ?? null) as string | null,
    changeAmount: nullableNumber(row.change_amount),
    changeBasis: (row.change_basis ?? '') as string,
    source: row.source_evidence == null ? null : JSON.parse(String(row.source_evidence)) as ContractLineSourceEvidence,
  }
}

function mapDeduction(row: Record<string, unknown>): ContractDeductionDraft {
  return { id: String(row.id), name: String(row.name ?? ''), amount: nullableNumber(row.amount), basis: String(row.basis ?? ''), sortOrder: Number(row.sort_order ?? 0) }
}

export async function loadF2Form(
  kind: F2FormKind,
  id: string,
): Promise<F2FormDraft | null> {
  if (PROJECT_FORM_KINDS.has(kind)) {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('contracts', 'AND id = ? AND kind = ? LIMIT 1'),
      [id, projectContractKind(kind).kind],
    )
    if (!rows[0])
      return null
    const draft = mapProjectContractRow(rows[0])
    if (kind === 'construction') {
      const configuration = await readNativeConstructionManagementFee({ select, execute: async () => {
        throw new Error('只读配置不能执行写入')
      } }, id)
      Object.assign(draft, { managementFeeAmount: configuration.amount, managementFeeBasis: configuration.basis })
    }
    if (kind === 'material') {
      const lines = await select<Record<string, unknown>>(
        selectVisibleSql(
          'contract_line_items',
          'AND contract_id = ? ORDER BY sort_order, created_at, id',
        ),
        [id],
      )
      const deductions = await select<Record<string, unknown>>(selectVisibleSql('contract_deductions', 'AND contract_id = ? ORDER BY sort_order, id'), [id])
      return { ...draft, lineItems: lines.map(mapLineItem), deductions: deductions.map(mapDeduction) }
    }
    return draft
  }
  if (kind === 'company_expense') {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('company_expense_contracts', 'AND id = ? LIMIT 1'),
      [id],
    )
    if (!rows[0])
      return null
    const row = rows[0]
    return {
      id: row.id as string,
      no: (row.no ?? '') as string,
      name: (row.name ?? '') as string,
      category: (row.category ?? '') as string,
      counterparty: (row.counterparty ?? '') as string,
      signDate: (row.sign_date ?? '') as string,
      servicePeriod: (row.service_period ?? '') as string,
      amount: nullableNumber(row.amount),
      ...mapContractSignatory(row),
      paymentCycle: (row.payment_cycle ?? '') as string,
      mainTerms: (row.main_terms ?? '') as string,
      status: (row.status ?? 'draft') as string,
      note: (row.note ?? '') as string,
    }
  }
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('expenditure_settlements', 'AND id = ? LIMIT 1'),
    [id],
  )
  if (!rows[0])
    return null
  const row = rows[0]
  if (
    (kind === 'other_settlement' || kind === 'material_settlement')
    && !settlementMatchesKind(kind, String(row.biz_type ?? ''))
  ) {
    return null
  }
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    contractId: (row.contract_id ?? null) as string | null,
    settlementType: (row.settlement_type ?? '') as string,
    totalAmount: Number(row.total_amount ?? 0),
    amount: nullableNumber(row.amount),
    taxAmount: nullableNumber(row.tax_amount),
    taxRate: nullableNumber(row.tax_rate),
    settlementDate: (row.settlement_date ?? '') as string,
    settlementPeriod: (row.settlement_period ?? '') as string,
    deductionNote: (row.deduction_note ?? '') as string,
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
  }
}

export async function loadContractSupplementForm(
  id: string,
): Promise<ProjectContractFormDraft | null> {
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('contract_supplements', 'AND id = ? LIMIT 1'),
    [id],
  )
  if (!rows[0])
    return null
  const row = rows[0]
  const [lines, deductions] = await Promise.all([
    select<Record<string, unknown>>(selectVisibleSql('contract_supplement_line_items', 'AND supplement_id = ? ORDER BY sort_order, id'), [id]),
    select<Record<string, unknown>>(selectVisibleSql('contract_deductions', 'AND supplement_id = ? ORDER BY sort_order, id'), [id]),
  ])
  return {
    id: row.id as string,
    isSupplement: true,
    originalContractId: (row.contract_id ?? null) as string | null,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    content: (row.content ?? '') as string,
    amount: nullableNumber(row.amount),
    ...mapContractSignatory(row),
    signDate: (row.sign_date ?? '') as string,
    status: (row.status ?? 'draft') as string,
    note: (row.note ?? '') as string,
    lineItems: lines.map(mapLineItem),
    deductions: deductions.map(mapDeduction),
  }
}

export async function listContractFormAttachments(
  ownerType: ContractAttachmentOwnerType,
  ownerId: string,
  includeDeleted = false,
): Promise<ContractFormAttachment[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = ? AND owner_id = ?
      ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
    ORDER BY uploaded_at, id
  `, [ownerType, ownerId])
  return rows.map(row => ({
    id: row.id as string,
    ownerType: row.owner_type as ContractAttachmentOwnerType,
    ownerId: row.owner_id as string,
    fileName: (row.file_name ?? '') as string,
    filePath: (row.file_path ?? '') as string,
    fileSize: Number(row.file_size ?? 0),
    mimeType: (row.mime_type ?? '') as string,
    category: (row.category ?? '') as string,
    uploader: (row.uploader ?? '') as string,
    uploadedAt: (row.uploaded_at ?? '') as string,
    deletedAt: (row.deleted_at ?? null) as string | null,
  }))
}

interface DeleteBlocker {
  table: string
  column: string
  label: string
}

const CONTRACT_DELETE_BLOCKERS: DeleteBlocker[] = [
  { table: 'expenditure_settlements', column: 'contract_id', label: '有效结算' },
  { table: 'payment_applications', column: 'contract_id', label: '付款申请' },
  { table: 'invoices', column: 'contract_id', label: '发票' },
  { table: 'boq_files', column: 'contract_id', label: 'BOQ 文件' },
  { table: 'boq_change_orders', column: 'contract_id', label: '变洽签' },
  { table: 'monthly_statements', column: 'contract_id', label: '月度报量' },
  { table: 'schedule_groups', column: 'contract_id', label: '进度计划' },
]

async function tableColumns(
  tx: TransactionDb,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.select<{ name: string }>(`PRAGMA table_info("${table}")`)
  return new Set(rows.map(row => row.name))
}

async function activeReferenceCount(
  tx: TransactionDb,
  blocker: DeleteBlocker,
  id: string,
): Promise<number> {
  const columns = await tableColumns(tx, blocker.table)
  if (!columns.has(blocker.column))
    return 0
  const visibility = Object.hasOwn(PARENT_REFS, blocker.table)
    ? `${hiddenCtesFor(blocker.table)}
       SELECT COUNT(*) AS total
       FROM "${blocker.table}"
       WHERE "${blocker.column}" = ?
         AND ${visibleCond(blocker.table)}`
    : `SELECT COUNT(*) AS total
       FROM "${blocker.table}"
       WHERE "${blocker.column}" = ?
         ${columns.has('deleted_at') ? 'AND deleted_at IS NULL' : ''}`
  const rows = await tx.select<{ total: number }>(`
    ${visibility}
  `, [id])
  return Number(rows[0]?.total ?? 0)
}

async function assertContractCanDelete(
  tx: TransactionDb,
  id: string,
): Promise<void> {
  const blockers: string[] = []
  for (const blocker of CONTRACT_DELETE_BLOCKERS) {
    const count = await activeReferenceCount(tx, blocker, id)
    if (count)
      blockers.push(`${blocker.label} ${count} 条`)
  }
  if (blockers.length)
    throw new Error(`合同存在${blockers.join('、')}，请先处理关联单据`)
}

async function assertSettlementCanDelete(
  tx: TransactionDb,
  id: string,
): Promise<void> {
  const count = await activeReferenceCount(tx, {
    table: 'payment_application_settlement_allocations',
    column: 'settlement_id',
    label: '付款申请分摊',
  }, id)
  if (count)
    throw new Error(`结算已被付款申请分摊引用 ${count} 条，请先解除关联`)
}

/**
 * F2 删除入口：合同删除前检查结算、付款、发票和 BOQ 等真实下游；
 * 公司支出合同与支出结算仍使用同一套日志化软删除。
 */
export async function deleteF2Form(
  kind: F2FormKind,
  id: string,
): Promise<string | null> {
  if ((kind === 'other_expense' || kind === 'company_expense') && 'window' in globalThis)
    throw new Error('浏览器辅助合同不允许从旧本地源删除')
  return withTransaction(async (tx) => {
    if (PROJECT_FORM_KINDS.has(kind)) {
      await assertContractCanDelete(tx, id)
      return softDelete(tx, 'contracts', id)
    }
    if (kind === 'company_expense')
      return softDelete(tx, 'company_expense_contracts', id)
    await assertSettlementCanDelete(tx, id)
    return softDelete(tx, 'expenditure_settlements', id)
  })
}

/** Restore and number ownership share the actual Native transaction; generic undo cannot bypass it. */
export async function undoF2Form(kind: F2FormKind, logId: string): Promise<boolean> {
  if ((kind === 'other_expense' || kind === 'company_expense') && 'window' in globalThis)
    throw new Error('浏览器辅助合同不允许从旧本地源撤回')
  return withTransaction(async (tx) => {
    const log = (await tx.select<{ table_name: string, record_id: string }>('SELECT table_name,record_id FROM operation_logs WHERE id=?', [logId]))[0]
    if (!log)
      return false
    const table = PROJECT_FORM_KINDS.has(kind) ? 'contracts' : kind === 'company_expense' ? 'company_expense_contracts' : 'expenditure_settlements'
    if (log.table_name !== table)
      throw new Error('撤回日志不属于当前合同入口')
    const prior = (await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, [log.record_id]))[0]
    if (table === 'contracts' && prior?.kind !== projectContractKind(kind).kind)
      throw new Error('撤回日志的合同类型与当前入口不一致')
    const restored = await undoOperationIfUnchanged(tx, logId)
    const row = (await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, [log.record_id]))[0]
    if (!restored) {
      if (JSON.stringify(row) !== JSON.stringify(prior))
        throw new Error('撤回未完整记录，事务已回滚')
      return false
    }
    if (row && (table === 'contracts' || table === 'company_expense_contracts')) {
      const now = new Date().toISOString()
      await recordContractNumber(tx, { owner: table === 'contracts' ? 'native-contracts' : 'native-company-expense', id: log.record_id, number: String(row.no ?? ''), version: String(row.updated_at ?? now), occurredAt: now, formal: !['draft', '草稿'].includes(String(row.status ?? '')) }, { enforce: false, historyId: generateId('contract_number_history') })
    }
    return true
  })
}
