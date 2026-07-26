import type { TransactionDb } from '~/lib/db/coordinator'
import { select, withTransaction } from '~/lib/db/connection'
import {
  logCreate,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'
import { parseJsonColumn } from '~/lib/util/json'

export type MasterDataSaveAction = 'draft' | 'save' | 'submit'
export type MasterDataOwnerType
  = | 'supplier'
    | 'customer'
    | 'crew'
    | 'worker'
    | 'project'
    | 'target_cost'

export interface FormAttachmentDraft {
  fileName: string
  filePath?: string
  fileSize?: number
  mimeType?: string
  category?: string
  uploader?: string
}

export interface FormAttachmentChanges {
  add?: FormAttachmentDraft[]
  removeIds?: string[]
  restoreIds?: string[]
}

export interface FormAttachment {
  id: string
  ownerType: MasterDataOwnerType
  ownerId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  deletedAt: string | null
}

export interface FormSaveResult {
  id: string
  logId: string | null
  attachmentIds: string[]
}

interface FormIdentity {
  id?: string
}

export interface SupplierFormDraft extends FormIdentity {
  name?: string
  aliases?: string[]
  externalRef?: string
  uniqueCode?: string
  taxNo?: string
  businessType?: string
  supplierCategory?: string
  rating?: string
  legalRep?: string
  registeredCapital?: number | null
  registeredDate?: string
  address?: string
  taxpayerType?: string
  mainBusiness?: string
  invoiceName?: string
  invoiceAddress?: string
  bank?: string
  bankAccount?: string
  phone?: string
  contact?: string
  contactPhone?: string
  contactTitle?: string
  note?: string
  approvalStatus?: string
}

export interface CustomerFormDraft extends FormIdentity {
  name?: string
  aliases?: string[]
  taxNo?: string
  legalRep?: string
  registeredAddress?: string
  invoiceName?: string
  bank?: string
  bankAccount?: string
  contact?: string
  contactPhone?: string
  note?: string
  status?: string
}

export type CrewAssignmentLevel = 'crew' | 'worker'

export interface CrewFormDraft extends FormIdentity {
  name?: string
  trade?: string
  contactName?: string
  contactPhone?: string
  defaultPayRatio?: number | null
  rentSubsidyEnabled?: boolean
  rentSubsidyPrice?: number | null
  mgmtFeeEnabled?: boolean
  mgmtFeePrice?: number | null
  assignmentLevel?: CrewAssignmentLevel
  note?: string
  status?: string
}

export interface WorkerFormDraft extends FormIdentity {
  name?: string
  gender?: string
  idCard?: string
  phone?: string
  hometown?: string
  emergencyContact?: string
  emergencyPhone?: string
  bankName?: string
  bankAccount?: string
  bankCode?: string
  trade?: string
  skillLevel?: string
  dailyWage?: number | null
  crewId?: string | null
  currentProjectId?: string | null
  familyGroupId?: string | null
  projectStatus?: string
  entryDate?: string
  exitDate?: string
  safetyEducation?: boolean
  note?: string
  status?: string
}

export interface ProjectFormDraft extends FormIdentity {
  name?: string
  contractName?: string
  code?: string
  customerId?: string | null
  secondaryCustomerId?: string | null
  region?: string
  address?: string
  operationType?: string
  type?: string
  area?: number | null
  contractAmount?: number | null
  overview?: string
  status?: string
  startDate?: string
  plannedEnd?: string
  plannedDuration?: number | null
  actualEnd?: string
  developerSupervisor?: string
  manager?: string
  managerPhone?: string
  execManager?: string
  builder?: string
  contractor?: string
  supervisor?: string
  designer?: string
  siteLeader?: string
  siteLeaderPhone?: string
  riskLevel?: string
  approvalStatus?: string
  acceptanceDate?: string
  filingDate?: string
  note?: string
}

export interface TargetCostFormDraft extends FormIdentity {
  projectId?: string | null
  name?: string
  isBaseline?: boolean
  contractRevenue?: number | null
  plannedProfit?: number | null
  signedContractSum?: number | null
  taxInclusiveTotal?: number | null
  taxExclusiveTotal?: number | null
  taxAmount?: number | null
  note?: string
  status?: string
}

interface PersistConfig {
  ownerType: MasterDataOwnerType
  table: string
  idPrefix: string
  lifecycleColumn: string
}

interface PersistOptions {
  attachments?: FormAttachmentChanges
  beforePersist?: (tx: TransactionDb, id: string) => Promise<void>
}

const MASTER_DATA_TABLES: Record<MasterDataOwnerType, string> = {
  supplier: 'suppliers',
  customer: 'customers',
  crew: 'crews',
  worker: 'workers',
  project: 'projects',
  target_cost: 'target_costs',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rawText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  const normalized = text(value)
  return normalized || null
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value == null)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function requireFields(fields: Array<[label: string, value: unknown]>): void {
  const missing = fields
    .filter(([, value]) => !text(value))
    .map(([label]) => label)
  if (missing.length)
    throw new Error(`${missing[0]}：为必填项（共 ${missing.length} 处）`)
}

function assertNonNegative(label: string, value: unknown): void {
  const number = nullableNumber(value)
  if (number != null && number < 0)
    throw new Error(`${label}不能为负数`)
}

function assertRatio(label: string, value: unknown): void {
  const number = nullableNumber(value)
  if (number != null && (number < 0 || number > 1))
    throw new Error(`${label}必须在 0 到 1 之间`)
}

async function assertActiveReference(
  tx: TransactionDb,
  table: string,
  id: string | null | undefined,
  label: string,
): Promise<void> {
  if (!id)
    return
  const rows = await tx.select<{ id: string }>(
    selectVisibleSql(table, 'AND id = ? LIMIT 1'),
    [id],
  )
  if (!rows[0])
    throw new Error(`${label}不存在或已删除`)
}

function formLifecycleStatus(action: MasterDataSaveAction): string | null {
  if (action === 'draft')
    return 'draft'
  if (action === 'submit')
    return 'submitted'
  return null
}

async function applyAttachmentChanges(
  tx: TransactionDb,
  ownerType: MasterDataOwnerType,
  ownerId: string,
  changes: FormAttachmentChanges = {},
): Promise<string[]> {
  const attachmentIds: string[] = []

  for (const attachmentId of changes.removeIds ?? []) {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    await softDelete(tx, 'file_refs', attachmentId)
  }
  for (const attachmentId of changes.restoreIds ?? []) {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    await restoreRecord(tx, 'file_refs', attachmentId)
  }
  if (ownerType === 'customer') {
    const [usage] = await tx.select<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM file_refs
      WHERE owner_type = 'customer'
        AND owner_id = ?
        AND deleted_at IS NULL
    `, [ownerId])
    const nextTotal = (usage?.total ?? 0) + (changes.add?.length ?? 0)
    if (nextTotal > 9)
      throw new Error('客户附件最多 9 个')
  }
  for (const draft of changes.add ?? []) {
    const fileName = text(draft.fileName)
    if (!fileName)
      throw new Error('附件文件名必填')
    const id = generateId('file')
    await tx.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_path, file_size,
        category, uploader, uploaded_at, mime_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      ownerType,
      ownerId,
      fileName,
      text(draft.filePath),
      Math.max(0, nullableNumber(draft.fileSize) ?? 0),
      text(draft.category),
      text(draft.uploader),
      new Date().toISOString(),
      text(draft.mimeType),
    ])
    await logCreate(tx, 'file_refs', id)
    attachmentIds.push(id)
  }

  return attachmentIds
}

async function assertAttachmentOwner(
  tx: TransactionDb,
  ownerType: MasterDataOwnerType,
  ownerId: string,
  attachmentId: string,
): Promise<void> {
  const rows = await tx.select<{ id: string }>(`
    SELECT id
    FROM file_refs
    WHERE id = ? AND owner_type = ? AND owner_id = ?
    LIMIT 1
  `, [attachmentId, ownerType, ownerId])
  if (!rows[0])
    throw new Error('附件不存在或不属于当前记录')
}

async function persistForm(
  config: PersistConfig,
  sourceId: string | undefined,
  values: Record<string, unknown>,
  action: MasterDataSaveAction,
  options: PersistOptions = {},
): Promise<FormSaveResult> {
  return withTransaction(tx => persistFormInExistingTransaction(
    tx,
    config,
    sourceId,
    values,
    action,
    options,
  ))
}

export async function saveSupplierForm(
  draft: SupplierFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['公司全称', draft.name],
      ['分供方类别', draft.supplierCategory],
      ['主要联系人', draft.contact],
    ])
  }
  assertNonNegative('注册资金', draft.registeredCapital)

  return persistForm({
    ownerType: 'supplier',
    table: 'suppliers',
    idPrefix: 'sup',
    lifecycleColumn: 'approval_status',
  }, draft.id, {
    name: text(draft.name),
    aliases: JSON.stringify(draft.aliases ?? []),
    external_ref: text(draft.externalRef),
    unique_code: text(draft.uniqueCode),
    tax_no: text(draft.taxNo),
    business_type: text(draft.businessType),
    supplier_category: text(draft.supplierCategory),
    rating: text(draft.rating),
    legal_rep: text(draft.legalRep),
    registered_capital: nullableNumber(draft.registeredCapital),
    registered_date: text(draft.registeredDate),
    address: text(draft.address),
    taxpayer_type: text(draft.taxpayerType),
    main_business: rawText(draft.mainBusiness),
    invoice_name: text(draft.invoiceName),
    invoice_address: text(draft.invoiceAddress),
    bank: text(draft.bank),
    bank_account: text(draft.bankAccount),
    phone: text(draft.phone),
    contact: text(draft.contact),
    contact_phone: text(draft.contactPhone),
    contact_title: text(draft.contactTitle),
    note: rawText(draft.note),
  }, action, { attachments })
}

export async function saveCustomerForm(
  draft: CustomerFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['客户名称', draft.name],
      ['联系人', draft.contact],
    ])
  }

  return persistForm({
    ownerType: 'customer',
    table: 'customers',
    idPrefix: 'customer',
    lifecycleColumn: 'status',
  }, draft.id, {
    name: text(draft.name),
    aliases: JSON.stringify(draft.aliases ?? []),
    tax_no: text(draft.taxNo),
    legal_rep: text(draft.legalRep),
    registered_address: text(draft.registeredAddress),
    invoice_name: text(draft.invoiceName),
    bank: text(draft.bank),
    bank_account: text(draft.bankAccount),
    contact: text(draft.contact),
    contact_phone: text(draft.contactPhone),
    note: rawText(draft.note),
  }, action, { attachments })
}

export async function saveCrewForm(
  draft: CrewFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['班组名称', draft.name],
      ['工种', draft.trade],
      ['负责人', draft.contactName],
      ['联系电话', draft.contactPhone],
    ])
  }
  assertRatio('默认发放比例', draft.defaultPayRatio)
  assertNonNegative('房租补贴单价', draft.rentSubsidyPrice)
  assertNonNegative('管理提成单价', draft.mgmtFeePrice)
  if (action !== 'draft' && draft.rentSubsidyEnabled && nullableNumber(draft.rentSubsidyPrice) == null)
    throw new Error('房租补贴单价：为必填项（共 1 处）')
  if (action !== 'draft' && draft.mgmtFeeEnabled && nullableNumber(draft.mgmtFeePrice) == null)
    throw new Error('管理提成单价：为必填项（共 1 处）')

  return persistForm({
    ownerType: 'crew',
    table: 'crews',
    idPrefix: 'crew',
    lifecycleColumn: 'status',
  }, draft.id, {
    name: text(draft.name),
    trade: text(draft.trade),
    contact_name: text(draft.contactName),
    contact_phone: text(draft.contactPhone),
    default_pay_ratio: nullableNumber(draft.defaultPayRatio) ?? 0.95,
    rent_subsidy_enabled: draft.rentSubsidyEnabled ? 1 : 0,
    rent_subsidy_price: nullableNumber(draft.rentSubsidyPrice),
    mgmt_fee_enabled: draft.mgmtFeeEnabled ? 1 : 0,
    mgmt_fee_price: nullableNumber(draft.mgmtFeePrice),
    assignment_level: draft.assignmentLevel ?? 'crew',
    note: rawText(draft.note),
  }, action, {
    attachments,
    beforePersist: async (tx, id) => {
      const name = text(draft.name)
      if (!name)
        return
      const duplicate = await tx.select<{ id: string }>(`
        SELECT id
        FROM crews
        WHERE name = ? AND id <> ? AND deleted_at IS NULL
        LIMIT 1
      `, [name, id])
      if (duplicate[0])
        throw new Error('班组名称已存在')
    },
  })
}

export async function saveWorkerForm(
  draft: WorkerFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['姓名', draft.name],
      ['联系电话', draft.phone],
      ['开户银行', draft.bankName],
      ['银行卡号', draft.bankAccount],
      ['工种', draft.trade],
    ])
  }
  assertNonNegative('参考日工资', draft.dailyWage)

  return withTransaction(async (tx) => {
    if (action !== 'draft' || draft.crewId)
      await assertActiveReference(tx, 'crews', draft.crewId, '所属班组')
    if (action !== 'draft' || draft.currentProjectId)
      await assertActiveReference(tx, 'projects', draft.currentProjectId, '当前项目')

    return persistFormInExistingTransaction(tx, {
      ownerType: 'worker',
      table: 'workers',
      idPrefix: 'worker',
      lifecycleColumn: 'status',
    }, draft.id, {
      crew_id: nullableText(draft.crewId),
      name: text(draft.name),
      gender: text(draft.gender),
      id_card: text(draft.idCard),
      phone: text(draft.phone),
      hometown: text(draft.hometown),
      emergency_contact: text(draft.emergencyContact),
      emergency_phone: text(draft.emergencyPhone),
      trade: text(draft.trade),
      skill_level: text(draft.skillLevel),
      daily_wage: nullableNumber(draft.dailyWage),
      current_project_id: nullableText(draft.currentProjectId),
      family_group_id: nullableText(draft.familyGroupId),
      project_status: draft.projectStatus ?? '在场',
      entry_date: text(draft.entryDate),
      exit_date: text(draft.exitDate),
      safety_education: draft.safetyEducation ? 1 : 0,
      bank_name: text(draft.bankName),
      bank_account: text(draft.bankAccount),
      bank_code: text(draft.bankCode),
      note: rawText(draft.note),
    }, action, { attachments })
  })
}

export async function saveProjectForm(
  draft: ProjectFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['项目名称', draft.name],
      ['客户', draft.customerId],
      ['项目经理', draft.manager],
    ])
  }
  assertNonNegative('建筑面积', draft.area)
  assertNonNegative('合同金额', draft.contractAmount)
  assertNonNegative('计划工期', draft.plannedDuration)

  return withTransaction(async (tx) => {
    if (action !== 'draft' || draft.customerId)
      await assertActiveReference(tx, 'customers', draft.customerId, '客户')
    if (draft.secondaryCustomerId)
      await assertActiveReference(tx, 'customers', draft.secondaryCustomerId, '客户2')

    return persistFormInExistingTransaction(tx, {
      ownerType: 'project',
      table: 'projects',
      idPrefix: 'proj',
      lifecycleColumn: 'approval_status',
    }, draft.id, {
      name: text(draft.name),
      contract_name: text(draft.contractName),
      code: text(draft.code),
      customer_id: nullableText(draft.customerId),
      secondary_customer_id: nullableText(draft.secondaryCustomerId),
      region: text(draft.region),
      address: text(draft.address),
      operation_type: text(draft.operationType),
      type: text(draft.type),
      area: nullableNumber(draft.area),
      contract_amount: nullableNumber(draft.contractAmount),
      overview: rawText(draft.overview),
      status: draft.status ?? '筹备中',
      start_date: text(draft.startDate),
      planned_end: text(draft.plannedEnd),
      planned_duration: nullableNumber(draft.plannedDuration),
      actual_end: text(draft.actualEnd),
      developer_supervisor: text(draft.developerSupervisor),
      manager: text(draft.manager),
      manager_phone: text(draft.managerPhone),
      exec_manager: text(draft.execManager),
      builder: text(draft.builder),
      contractor: text(draft.contractor),
      supervisor: text(draft.supervisor),
      designer: text(draft.designer),
      site_leader: text(draft.siteLeader),
      site_leader_phone: text(draft.siteLeaderPhone),
      risk_level: text(draft.riskLevel),
      acceptance_date: text(draft.acceptanceDate),
      filing_date: text(draft.filingDate),
      note: rawText(draft.note),
    }, action, { attachments })
  })
}

export async function saveTargetCostForm(
  draft: TargetCostFormDraft,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
): Promise<FormSaveResult> {
  if (action !== 'draft') {
    requireFields([
      ['项目', draft.projectId],
      ['版本名', draft.name],
    ])
  }
  for (const [label, value] of [
    ['合同收入', draft.contractRevenue],
    ['计划利润', draft.plannedProfit],
    ['已签合同额', draft.signedContractSum],
    ['含税合价', draft.taxInclusiveTotal],
    ['无税合价', draft.taxExclusiveTotal],
    ['税额', draft.taxAmount],
  ] as const) {
    assertNonNegative(label, value)
  }

  return withTransaction(async (tx) => {
    if (action !== 'draft' || draft.projectId)
      await assertActiveReference(tx, 'projects', draft.projectId, '项目')

    return persistFormInExistingTransaction(tx, {
      ownerType: 'target_cost',
      table: 'target_costs',
      idPrefix: 'target_cost',
      lifecycleColumn: 'status',
    }, draft.id, {
      project_id: nullableText(draft.projectId),
      name: text(draft.name),
      is_baseline: draft.isBaseline ? 1 : 0,
      contract_revenue: nullableNumber(draft.contractRevenue),
      planned_profit: nullableNumber(draft.plannedProfit),
      signed_contract_sum: nullableNumber(draft.signedContractSum),
      tax_inclusive_total: nullableNumber(draft.taxInclusiveTotal),
      tax_exclusive_total: nullableNumber(draft.taxExclusiveTotal),
      tax_amount: nullableNumber(draft.taxAmount),
      note: rawText(draft.note),
    }, action, {
      attachments,
      beforePersist: async (targetTx, id) => {
        if (!draft.isBaseline || !draft.projectId)
          return
        const baselines = await targetTx.select<{ id: string }>(`
          SELECT id
          FROM target_costs
          WHERE project_id = ?
            AND id <> ?
            AND is_baseline = 1
            AND deleted_at IS NULL
        `, [draft.projectId, id])
        for (const baseline of baselines) {
          await withUpdateLog(targetTx, 'target_costs', baseline.id, () => targetTx.execute(`
            UPDATE target_costs
            SET is_baseline = 0, updated_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), baseline.id]))
        }
      },
    })
  })
}

async function persistFormInExistingTransaction(
  tx: TransactionDb,
  config: PersistConfig,
  sourceId: string | undefined,
  values: Record<string, unknown>,
  action: MasterDataSaveAction,
  options: PersistOptions = {},
): Promise<FormSaveResult> {
  const id = sourceId || generateId(config.idPrefix)
  const [existing] = await tx.select<Record<string, unknown>>(
    `SELECT * FROM "${config.table}" WHERE id = ? LIMIT 1`,
    [id],
  )
  if (sourceId && !existing)
    throw new Error('记录不存在')
  if (existing?.deleted_at != null)
    throw new Error('记录已删除，不能保存')

  const lifecycle = formLifecycleStatus(action)
  if (lifecycle != null)
    values[config.lifecycleColumn] = lifecycle
  else if (!existing)
    values[config.lifecycleColumn] = 'draft'

  await options.beforePersist?.(tx, id)

  const columns = Object.keys(values)
  let logId: string | null
  if (existing) {
    logId = await withUpdateLog(tx, config.table, id, () => tx.execute(
      `UPDATE "${config.table}"
       SET ${columns.map(column => `"${column}" = ?`).join(', ')}, updated_at = ?
       WHERE id = ?`,
      [...columns.map(column => values[column]), new Date().toISOString(), id],
    ))
  }
  else {
    const now = new Date().toISOString()
    await tx.execute(
      `INSERT INTO "${config.table}"
        (id, ${columns.map(column => `"${column}"`).join(', ')}, created_at, updated_at)
       VALUES (?, ${columns.map(() => '?').join(', ')}, ?, ?)`,
      [id, ...columns.map(column => values[column]), now, now],
    )
    logId = await logCreate(tx, config.table, id)
  }

  const attachmentIds = await applyAttachmentChanges(
    tx,
    config.ownerType,
    id,
    options.attachments,
  )
  return { id, logId, attachmentIds }
}

function supplierFromRow(row: Record<string, unknown>): SupplierFormDraft & { id: string } {
  return {
    id: row.id as string,
    name: rawText(row.name),
    aliases: parseJsonColumn<string[]>(row.aliases, []),
    externalRef: rawText(row.external_ref),
    uniqueCode: rawText(row.unique_code),
    taxNo: rawText(row.tax_no),
    businessType: rawText(row.business_type),
    supplierCategory: rawText(row.supplier_category),
    rating: rawText(row.rating),
    legalRep: rawText(row.legal_rep),
    registeredCapital: nullableNumber(row.registered_capital),
    registeredDate: rawText(row.registered_date),
    address: rawText(row.address),
    taxpayerType: rawText(row.taxpayer_type),
    mainBusiness: rawText(row.main_business),
    invoiceName: rawText(row.invoice_name),
    invoiceAddress: rawText(row.invoice_address),
    bank: rawText(row.bank),
    bankAccount: rawText(row.bank_account),
    phone: rawText(row.phone),
    contact: rawText(row.contact),
    contactPhone: rawText(row.contact_phone),
    contactTitle: rawText(row.contact_title),
    note: rawText(row.note),
    approvalStatus: rawText(row.approval_status),
  }
}

function customerFromRow(row: Record<string, unknown>): CustomerFormDraft & { id: string } {
  return {
    id: row.id as string,
    name: rawText(row.name),
    aliases: parseJsonColumn<string[]>(row.aliases, []),
    taxNo: rawText(row.tax_no),
    legalRep: rawText(row.legal_rep),
    registeredAddress: rawText(row.registered_address),
    invoiceName: rawText(row.invoice_name),
    bank: rawText(row.bank),
    bankAccount: rawText(row.bank_account),
    contact: rawText(row.contact),
    contactPhone: rawText(row.contact_phone),
    note: rawText(row.note),
    status: rawText(row.status),
  }
}

function crewFromRow(row: Record<string, unknown>): CrewFormDraft & { id: string } {
  return {
    id: row.id as string,
    name: rawText(row.name),
    trade: rawText(row.trade),
    contactName: rawText(row.contact_name),
    contactPhone: rawText(row.contact_phone),
    defaultPayRatio: nullableNumber(row.default_pay_ratio),
    rentSubsidyEnabled: row.rent_subsidy_enabled === 1,
    rentSubsidyPrice: nullableNumber(row.rent_subsidy_price),
    mgmtFeeEnabled: row.mgmt_fee_enabled === 1,
    mgmtFeePrice: nullableNumber(row.mgmt_fee_price),
    assignmentLevel: row.assignment_level as CrewAssignmentLevel,
    note: rawText(row.note),
    status: rawText(row.status),
  }
}

function workerFromRow(row: Record<string, unknown>): WorkerFormDraft & { id: string } {
  return {
    id: row.id as string,
    crewId: nullableText(row.crew_id),
    name: rawText(row.name),
    gender: rawText(row.gender),
    idCard: rawText(row.id_card),
    phone: rawText(row.phone),
    hometown: rawText(row.hometown),
    emergencyContact: rawText(row.emergency_contact),
    emergencyPhone: rawText(row.emergency_phone),
    trade: rawText(row.trade),
    skillLevel: rawText(row.skill_level),
    dailyWage: nullableNumber(row.daily_wage),
    currentProjectId: nullableText(row.current_project_id),
    familyGroupId: nullableText(row.family_group_id),
    projectStatus: rawText(row.project_status),
    entryDate: rawText(row.entry_date),
    exitDate: rawText(row.exit_date),
    safetyEducation: row.safety_education === 1,
    bankName: rawText(row.bank_name),
    bankAccount: rawText(row.bank_account),
    bankCode: rawText(row.bank_code),
    note: rawText(row.note),
    status: rawText(row.status),
  }
}

function projectFromRow(row: Record<string, unknown>): ProjectFormDraft & { id: string } {
  return {
    id: row.id as string,
    name: rawText(row.name),
    contractName: rawText(row.contract_name),
    code: rawText(row.code),
    customerId: nullableText(row.customer_id),
    secondaryCustomerId: nullableText(row.secondary_customer_id),
    region: rawText(row.region),
    address: rawText(row.address),
    operationType: rawText(row.operation_type),
    type: rawText(row.type),
    area: nullableNumber(row.area),
    contractAmount: nullableNumber(row.contract_amount),
    overview: rawText(row.overview),
    status: rawText(row.status),
    startDate: rawText(row.start_date),
    plannedEnd: rawText(row.planned_end),
    plannedDuration: nullableNumber(row.planned_duration),
    actualEnd: rawText(row.actual_end),
    developerSupervisor: rawText(row.developer_supervisor),
    manager: rawText(row.manager),
    managerPhone: rawText(row.manager_phone),
    execManager: rawText(row.exec_manager),
    builder: rawText(row.builder),
    contractor: rawText(row.contractor),
    supervisor: rawText(row.supervisor),
    designer: rawText(row.designer),
    siteLeader: rawText(row.site_leader),
    siteLeaderPhone: rawText(row.site_leader_phone),
    riskLevel: rawText(row.risk_level),
    approvalStatus: rawText(row.approval_status),
    acceptanceDate: rawText(row.acceptance_date),
    filingDate: rawText(row.filing_date),
    note: rawText(row.note),
  }
}

function targetCostFromRow(row: Record<string, unknown>): TargetCostFormDraft & { id: string } {
  return {
    id: row.id as string,
    projectId: nullableText(row.project_id),
    name: rawText(row.name),
    isBaseline: row.is_baseline === 1,
    contractRevenue: nullableNumber(row.contract_revenue),
    plannedProfit: nullableNumber(row.planned_profit),
    signedContractSum: nullableNumber(row.signed_contract_sum),
    taxInclusiveTotal: nullableNumber(row.tax_inclusive_total),
    taxExclusiveTotal: nullableNumber(row.tax_exclusive_total),
    taxAmount: nullableNumber(row.tax_amount),
    note: rawText(row.note),
    status: rawText(row.status),
  }
}

async function loadForm<T>(
  table: string,
  id: string,
  map: (row: Record<string, unknown>) => T,
): Promise<T | null> {
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql(table, 'AND id = ? LIMIT 1'),
    [id],
  )
  return rows[0] ? map(rows[0]) : null
}

export function loadSupplierForm(id: string) {
  return loadForm('suppliers', id, supplierFromRow)
}

export function loadCustomerForm(id: string) {
  return loadForm('customers', id, customerFromRow)
}

export function loadCrewForm(id: string) {
  return loadForm('crews', id, crewFromRow)
}

export function loadWorkerForm(id: string) {
  return loadForm('workers', id, workerFromRow)
}

export function loadProjectForm(id: string) {
  return loadForm('projects', id, projectFromRow)
}

export function loadTargetCostForm(id: string) {
  return loadForm('target_costs', id, targetCostFromRow)
}

export async function listFormAttachments(
  ownerType: MasterDataOwnerType,
  ownerId: string,
  includeDeleted = false,
): Promise<FormAttachment[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = ?
      AND owner_id = ?
      ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
    ORDER BY uploaded_at, id
  `, [ownerType, ownerId])
  return rows.map(row => ({
    id: row.id as string,
    ownerType: row.owner_type as MasterDataOwnerType,
    ownerId: row.owner_id as string,
    fileName: rawText(row.file_name),
    filePath: rawText(row.file_path),
    fileSize: nullableNumber(row.file_size) ?? 0,
    mimeType: rawText(row.mime_type),
    category: rawText(row.category),
    uploader: rawText(row.uploader),
    uploadedAt: rawText(row.uploaded_at),
    deletedAt: nullableText(row.deleted_at),
  }))
}

export async function removeFormAttachment(
  ownerType: MasterDataOwnerType,
  ownerId: string,
  attachmentId: string,
): Promise<string | null> {
  return withTransaction(async (tx) => {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    return softDelete(tx, 'file_refs', attachmentId)
  })
}

export async function restoreFormAttachment(
  ownerType: MasterDataOwnerType,
  ownerId: string,
  attachmentId: string,
): Promise<string | null> {
  return withTransaction(async (tx) => {
    await assertAttachmentOwner(tx, ownerType, ownerId, attachmentId)
    return restoreRecord(tx, 'file_refs', attachmentId)
  })
}

export async function deleteMasterDataRecord(
  ownerType: MasterDataOwnerType,
  id: string,
): Promise<string | null> {
  return withTransaction(async (tx) => {
    if (ownerType === 'customer') {
      const projects = await tx.select<{ id: string }>(
        selectVisibleSql(
          'projects',
          'AND (customer_id = ? OR secondary_customer_id = ?)',
        ),
        [id, id],
      )
      if (projects.length > 0)
        throw new Error(`客户仍被 ${projects.length} 个活跃项目引用`)

      const contractColumns = await tx.select<{ name: string }>(
        `SELECT name FROM pragma_table_info('contracts')`,
      )
      if (contractColumns.some(column => column.name === 'customer_id')) {
        const [contracts] = await tx.select<{ total: number }>(`
          SELECT COUNT(*) AS total
          FROM contracts
          WHERE customer_id = ? AND deleted_at IS NULL
        `, [id])
        if ((contracts?.total ?? 0) > 0)
          throw new Error(`客户仍被 ${contracts!.total} 份活跃施工合同引用`)
      }
    }

    if (ownerType === 'crew') {
      const workers = await tx.select<{ id: string }>(
        selectVisibleSql('workers', 'AND crew_id = ?'),
        [id],
      )
      if (workers.length > 0)
        throw new Error(`班组仍有 ${workers.length} 名在册工人`)
    }

    return softDelete(tx, MASTER_DATA_TABLES[ownerType], id)
  })
}

export async function restoreMasterDataRecord(
  ownerType: MasterDataOwnerType,
  id: string,
): Promise<string | null> {
  return withTransaction(tx => restoreRecord(tx, MASTER_DATA_TABLES[ownerType], id))
}
