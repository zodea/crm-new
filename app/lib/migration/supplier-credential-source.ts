import type { SoftDb } from '../db/soft-delete'
import type { SupplierFormDraft } from '../master-data/forms'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import { quantityMigrationTimestamp } from '../quantity/migration-graph'
import { credentialProblem } from '../supplier/credential-contract'
import { assertSupplierCredentialFile, MAX_CREDENTIAL_FILE_BYTES } from '../supplier/credential-files'
import { REQUIRED_SUPPLIER_CREDENTIALS, SUPPLIER_CREDENTIAL_CATEGORIES } from '../supplier/credentials'

/** 迁移只接受这些既有业务列，不暴露任意表或文件路径读取能力。 */
export const SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS = {
  supplier: ['id', 'name', 'external_ref', 'aliases', 'unique_code', 'tax_no', 'business_type', 'supplier_category', 'rating', 'legal_rep', 'registered_capital', 'registered_date', 'address', 'taxpayer_type', 'main_business', 'labor_scope', 'invoice_name', 'invoice_address', 'bank', 'bank_account', 'phone', 'contact', 'contact_phone', 'contact_title', 'credential_status', 'approval_status', 'source', 'note', 'created_at', 'updated_at', 'deleted_at', 'credential_reviewed_at', 'credential_review_note', 'taxpayer_verification_status', 'taxpayer_verification_source', 'taxpayer_verified_at', 'taxpayer_verification_note'],
  credentials: ['id', 'supplier_id', 'category', 'file_name', 'file_path', 'ocr_result', 'ocr_confidence', 'verified_at', 'added_at', 'deleted_at', 'file_ref_id', 'valid_from', 'expires_at', 'long_term', 'ocr_confirmed_result', 'ocr_confirmed_at', 'ocr_review_status'],
  requirements: ['id', 'supplier_id', 'category', 'requirement', 'reason', 'updated_at', 'deleted_at'],
  files: ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'],
  payloads: ['file_ref_id', 'encoding', 'content'],
  credentialAudits: ['id', 'supplier_id', 'credential_id', 'action', 'category_before', 'category_after', 'changed_fields', 'valid_from_before', 'valid_from_after', 'expires_at_before', 'expires_at_after', 'long_term_before', 'long_term_after', 'confidence', 'created_at'],
  supplierAudits: ['id', 'supplier_id', 'action', 'outcome', 'source_category', 'changed_fields', 'note_present', 'created_at'],
  reviewHistory: ['id', 'supplier_id', 'decision', 'reviewed_at', 'note', 'actor_id', 'archived_at'],
} as const

export type SupplierCredentialMigrationPart = keyof typeof SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS
export type SupplierCredentialMigrationRow = Record<string, string | number | null>
export interface SupplierCredentialMigrationGraph {
  schemaVersion: 1 | 2
  supplier: SupplierCredentialMigrationRow
  credentials: SupplierCredentialMigrationRow[]
  requirements: SupplierCredentialMigrationRow[]
  files: SupplierCredentialMigrationRow[]
  payloads: SupplierCredentialMigrationRow[]
  credentialAudits: SupplierCredentialMigrationRow[]
  supplierAudits: SupplierCredentialMigrationRow[]
  reviewHistory?: SupplierCredentialMigrationRow[]
}

const parts = ['credentials', 'requirements', 'files', 'payloads', 'credentialAudits', 'supplierAudits'] as const
const tables = { supplier: 'suppliers', credentials: 'supplier_credentials', requirements: 'supplier_credential_requirements', files: 'file_refs', payloads: 'file_payloads', credentialAudits: 'supplier_credential_audits', supplierAudits: 'supplier_audits', reviewHistory: 'supplier_credential_review_history' } as const
const numeric = new Set(['registered_capital', 'ocr_confidence', 'long_term', 'file_size', 'long_term_before', 'long_term_after', 'confidence', 'note_present'])
const dates = new Set(['created_at', 'updated_at', 'deleted_at', 'credential_reviewed_at', 'taxpayer_verified_at', 'verified_at', 'added_at', 'ocr_confirmed_at', 'uploaded_at', 'reviewed_at', 'archived_at'])
const auditFields = new Set<string>([
  ...SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS.supplier,
  ...SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS.credentials,
  ...SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS.supplier.map(key => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())),
  ...['name', 'uniqueCode', 'taxNo', 'legalRep', 'address', 'bank', 'bankAccount'].map(key => `supplier.${key}`),
  'credential',
  'file_ref',
  'validity',
])

function invalid(message: string): never {
  throw credentialProblem('validation-failed', `证照迁移：${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}
function row(part: SupplierCredentialMigrationPart, value: unknown): SupplierCredentialMigrationRow {
  const columns: readonly string[] = SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS[part]
  if (!object(value) || columns.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !columns.includes(key)))
    return invalid(`${tables[part]}字段缺失或含未识别字段`)
  const result: SupplierCredentialMigrationRow = {}
  for (const key of columns) {
    const entry = value[key]
    if (dates.has(key)) {
      result[key] = quantityMigrationTimestamp(entry, `${tables[part]}.${key}`)
    }
    else if (numeric.has(key)) {
      if (entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry)))
        invalid(`${tables[part]}.${key}数值无效`)
      result[key] = entry as number | null
    }
    else {
      if (entry !== null && typeof entry !== 'string')
        invalid(`${tables[part]}.${key}必须是文本或空值`)
      result[key] = entry as string | null
    }
  }
  if (!identifier(result[part === 'payloads' ? 'file_ref_id' : 'id']))
    invalid(`${tables[part]}稳定身份无效`)
  return result
}

export function parseSupplierCredentialJson(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof value === 'string' && value.trim() ? value : '{}')
  }
  catch {
    return invalid(`${label} JSON 损坏`)
  }
  if (!object(parsed))
    return invalid(`${label}必须为 JSON 对象`)
  return parsed
}

export function parseSupplierCredentialAuditFields(value: unknown): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(String(value))
  }
  catch {
    return invalid('审计变更字段 JSON 损坏')
  }
  if (!Array.isArray(parsed) || parsed.some(field => typeof field !== 'string' || !auditFields.has(field)) || new Set(parsed).size !== parsed.length)
    return invalid('审计只能包含已知字段名，不得含敏感正文')
  return parsed as string[]
}

function validDate(value: unknown): boolean {
  if (value === '')
    return true
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

/** 校验正文与元数据；仅处理已持久化字节，从不打开旧路径。 */
export function supplierCredentialMigrationBytes(file: SupplierCredentialMigrationRow, payload: SupplierCredentialMigrationRow): Uint8Array {
  const value = payload.content
  if (payload.encoding !== 'base64' || typeof value !== 'string' || !value || value.length > Math.ceil(MAX_CREDENTIAL_FILE_BYTES / 3) * 4
    || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(value)) {
    return invalid('原件正文编码或大小无效')
  }
  const decoded = atob(value)
  if (btoa(decoded) !== value)
    invalid('原件正文必须使用规范 Base64 编码')
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0))
  if (bytes.length !== file.file_size)
    invalid('原件正文与文件大小不一致')
  try {
    assertSupplierCredentialFile({ fileName: String(file.file_name ?? ''), fileSize: bytes.length, mimeType: String(file.mime_type) }, bytes)
  }
  catch (error) {
    invalid((error as Error).message)
  }
  return bytes
}

/** 包括软删历史在内的完整图验证；原始 OCR 与人工确认正文原字节保留。 */
export function parseSupplierCredentialMigrationGraph(value: unknown, legacySupplierId?: string): SupplierCredentialMigrationGraph {
  if (!object(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || Object.keys(value).some(key => !['schemaVersion', 'supplier', ...parts, ...(value.schemaVersion === 2 ? ['reviewHistory'] : [])].includes(key)))
    return invalid('完整图结构或版本无效')
  const supplier = row('supplier', value.supplier)
  if (!String(supplier.name ?? '').trim() || (legacySupplierId !== undefined && supplier.id !== legacySupplierId))
    invalid('分供方身份或名称无效')
  const graph: SupplierCredentialMigrationGraph = { schemaVersion: value.schemaVersion as 1 | 2, supplier, credentials: [], requirements: [], files: [], payloads: [], credentialAudits: [], supplierAudits: [] }
  for (const part of parts) {
    if (!Array.isArray(value[part]))
      invalid(`${tables[part]}必须完整提供数组`)
    const ids = new Set<string>()
    graph[part] = (value[part] as unknown[]).map((entry) => {
      const parsed = row(part, entry)
      const id = String(parsed[part === 'payloads' ? 'file_ref_id' : 'id'])
      if (ids.has(id))
        invalid(`${tables[part]}稳定身份重复`)
      ids.add(id)
      if (['credentials', 'requirements', 'credentialAudits', 'supplierAudits'].includes(part) && parsed.supplier_id !== supplier.id)
        invalid(`${tables[part]}分供方归属错配`)
      return parsed
    })
  }
  if (value.schemaVersion === 2) {
    if (!Array.isArray(value.reviewHistory))
      invalid('历史人工核验必须完整提供数组')
    const ids = new Set<string>()
    graph.reviewHistory = (value.reviewHistory as unknown[]).map((entry) => {
      const proof = row('reviewHistory', entry)
      if (ids.has(String(proof.id)) || proof.supplier_id !== supplier.id)
        invalid('历史人工核验身份重复或分供方归属错配')
      ids.add(String(proof.id))
      if (!['qualified', 'rejected'].includes(String(proof.decision)) || !proof.reviewed_at || !proof.archived_at
        || typeof proof.note !== 'string' || (proof.decision === 'rejected' && !proof.note.trim())) {
        invalid('历史人工核验凭证或备注无效')
      }
      return proof
    })
  }
  const credentials = new Map(graph.credentials.map(entry => [entry.id, entry]))
  const files = new Map(graph.files.map(entry => [entry.id, entry]))
  const activeFiles = new Set<string>()
  for (const credential of graph.credentials) {
    if (!SUPPLIER_CREDENTIAL_CATEGORIES.includes(credential.category as never))
      invalid('证照类别不是已确认的规范类别')
    if (![0, 1].includes(credential.long_term as number) || !['not_started', 'pending', 'confirmed'].includes(String(credential.ocr_review_status)))
      invalid('证照有效期或 OCR 核对状态无效')
    if (!validDate(credential.valid_from) || !validDate(credential.expires_at)
      || (credential.valid_from && credential.expires_at && String(credential.valid_from) > String(credential.expires_at))) {
      invalid('证照有效期日期无效')
    }
    if (credential.ocr_confidence !== null && (Number(credential.ocr_confidence) < 0 || Number(credential.ocr_confidence) > 1))
      invalid('OCR 置信度无效')
    parseSupplierCredentialJson(credential.ocr_result, 'OCR 原文')
    parseSupplierCredentialJson(credential.ocr_confirmed_result, 'OCR 已确认结果')
    if (credential.file_ref_id !== null) {
      const file = files.get(credential.file_ref_id)
      if (!file || file.owner_type !== 'supplier_credential' || file.owner_id !== credential.id)
        invalid('证照原件关系缺失或所有者错配')
    }
  }
  for (const file of graph.files) {
    if (file.owner_type !== 'supplier_credential' || !credentials.has(file.owner_id))
      invalid('文件缺少可解释证照所有者')
    if (!Number.isSafeInteger(file.file_size) || Number(file.file_size) < 0)
      invalid('文件大小无效')
    if (file.deleted_at === null) {
      if (activeFiles.has(String(file.owner_id)) || credentials.get(file.owner_id)!.file_ref_id !== file.id)
        invalid('证照存在歧义或未关联的活跃原件')
      activeFiles.add(String(file.owner_id))
    }
  }
  for (const payload of graph.payloads) {
    const file = files.get(payload.file_ref_id)
    if (!file)
      invalid('正文缺少文件元数据')
    supplierCredentialMigrationBytes(file, payload)
  }
  const activeRequirements = new Set<string>()
  for (const requirement of graph.requirements) {
    if (!SUPPLIER_CREDENTIAL_CATEGORIES.includes(requirement.category as never) || !['not_applicable', 'optional', 'required'].includes(String(requirement.requirement)))
      invalid('资料要求类别或状态无效')
    if (requirement.deleted_at === null) {
      const fixed = REQUIRED_SUPPLIER_CREDENTIALS.includes(requirement.category as never)
      if (fixed && requirement.requirement !== 'required')
        invalid('固定必需资料不能降级为选填或不适用')
      if (!fixed && requirement.requirement === 'required' && !String(requirement.reason ?? '').trim())
        invalid('条件必需资料必须说明适用原因')
      if (activeRequirements.has(String(requirement.category)))
        invalid('同类别存在重复活跃资料要求')
      activeRequirements.add(String(requirement.category))
    }
  }
  for (const audit of graph.credentialAudits) {
    if (!credentials.has(audit.credential_id))
      invalid('证照审计缺少原证照身份')
    if (!['credential_create', 'ocr_recognition', 'ocr_review', 'validity_update', 'credential_delete', 'credential_restore'].includes(String(audit.action)))
      invalid('证照审计动作无效')
    if (['category_before', 'category_after'].some(key => audit[key] !== '' && !SUPPLIER_CREDENTIAL_CATEGORIES.includes(audit[key] as never))
      || ['valid_from_before', 'valid_from_after', 'expires_at_before', 'expires_at_after'].some(key => !validDate(audit[key]))
      || ['long_term_before', 'long_term_after'].some(key => ![0, 1].includes(audit[key] as number))) {
      invalid('证照审计类别或有效期无效')
    }
    if (audit.confidence !== null && (Number(audit.confidence) < 0 || Number(audit.confidence) > 1))
      invalid('审计置信度无效')
  }
  for (const audit of graph.supplierAudits) {
    if (!['create', 'update', 'delete', 'restore', 'credential_review', 'taxpayer_verification'].includes(String(audit.action))
      || ![0, 1].includes(audit.note_present as number)) {
      invalid('分供方审计动作或备注标记无效')
    }
    if (!['', 'created', 'updated', 'unchanged', 'deleted', 'restored', 'undo_delete', 'undo_restore', 'qualified', 'rejected', 'not_checked', 'confirmed_general', 'not_found', 'manually_confirmed'].includes(String(audit.outcome))
      || !['', 'store', 'form', 'import', 'undo', 'project_file_import', 'manual', 'none', 'manual_document', 'official_website', 'external_reference', 'unspecified'].includes(String(audit.source_category))) {
      invalid('审计结果与来源必须是规范类别，不得含敏感正文')
    }
  }
  for (const audit of [...graph.credentialAudits, ...graph.supplierAudits]) {
    if (!audit.created_at)
      invalid('审计缺少可核对的发生时间')
    parseSupplierCredentialAuditFields(audit.changed_fields)
  }
  supplierCredentialMasterDraft(graph.supplier)
  return graph
}

/** 只在受保护的本地快照读取全部物理图，包含软删除父记录。 */
export async function readSupplierCredentialMigrationGraphs(db: Pick<SoftDb, 'select'>, schemaVersion = 49): Promise<CoreMigrationSourceEntityDTO[]> {
  // v50/v52 材采、v53 合同主体、v54 原费用引用及 v55 两物料行税点、v56 财务身份列均不改变供应商图；v51 历史以 graph v2 完整承接。
  if (![47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].includes(schemaVersion))
    invalid('不支持该旧数据库版本，请先完成既有数据库升级')
  const all = {} as Record<SupplierCredentialMigrationPart, SupplierCredentialMigrationRow[]>
  for (const part of ['supplier', ...parts] as const) {
    const where = part === 'files' ? ' WHERE owner_type = \'supplier_credential\'' : part === 'payloads' ? ' WHERE file_ref_id IN (SELECT id FROM file_refs WHERE owner_type = \'supplier_credential\')' : ''
    const columns = SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS[part].map(column => part === 'supplier' && schemaVersion === 47 && column === 'labor_scope' ? '\'\' AS labor_scope' : column)
    all[part] = await db.select<SupplierCredentialMigrationRow>(`SELECT ${columns.join(', ')} FROM ${tables[part]}${where} ORDER BY ${part === 'payloads' ? 'file_ref_id' : 'id'}`)
  }
  if (schemaVersion >= 51)
    all.reviewHistory = await db.select<SupplierCredentialMigrationRow>(`SELECT ${SUPPLIER_CREDENTIAL_MIGRATION_COLUMNS.reviewHistory.join(', ')} FROM ${tables.reviewHistory} ORDER BY id`)
  const suppliers = new Set(all.supplier.map(entry => entry.id))
  const credentials = new Map(all.credentials.map(entry => [entry.id, entry.supplier_id]))
  const files = new Map(all.files.map(entry => [entry.id, credentials.get(entry.owner_id)]))
  for (const part of parts) {
    for (const entry of all[part]) {
      const parent = part === 'files' ? credentials.get(entry.owner_id) : part === 'payloads' ? files.get(entry.file_ref_id) : entry.supplier_id
      if (!parent || !suppliers.has(parent))
        invalid(`${tables[part]}缺少可解释的分供方祖先`)
    }
  }
  for (const proof of all.reviewHistory ?? []) {
    if (!suppliers.has(proof.supplier_id))
      invalid('历史人工核验缺少可解释的分供方祖先')
  }
  if (suppliers.size !== all.supplier.length)
    invalid('分供方稳定身份重复')
  return all.supplier.map((supplier) => {
    const graph = parseSupplierCredentialMigrationGraph({
      schemaVersion: schemaVersion >= 51 ? 2 : 1,
      supplier,
      ...Object.fromEntries(parts.map(part => [part, all[part].filter(entry => (part === 'files' ? credentials.get(entry.owner_id) : part === 'payloads' ? files.get(entry.file_ref_id) : entry.supplier_id) === supplier.id)])),
      ...(schemaVersion >= 51 ? { reviewHistory: all.reviewHistory.filter(row => row.supplier_id === supplier.id) } : {}),
    }, String(supplier.id))
    return { legacyId: String(supplier.id), name: String(supplier.name), deletedAt: graph.supplier.deleted_at as string | null, references: { supplierId: String(supplier.id) }, attributes: { graphJson: JSON.stringify(graph) } }
  })
}

const masterFields = {
  name: 'name',
  externalRef: 'external_ref',
  uniqueCode: 'unique_code',
  taxNo: 'tax_no',
  businessType: 'business_type',
  supplierCategory: 'supplier_category',
  rating: 'rating',
  legalRep: 'legal_rep',
  registeredDate: 'registered_date',
  address: 'address',
  taxpayerType: 'taxpayer_type',
  taxpayerVerificationStatus: 'taxpayer_verification_status',
  taxpayerVerificationSource: 'taxpayer_verification_source',
  taxpayerVerificationNote: 'taxpayer_verification_note',
  mainBusiness: 'main_business',
  laborScope: 'labor_scope',
  invoiceName: 'invoice_name',
  invoiceAddress: 'invoice_address',
  bank: 'bank',
  bankAccount: 'bank_account',
  phone: 'phone',
  contact: 'contact',
  contactPhone: 'contact_phone',
  contactTitle: 'contact_title',
  note: 'note',
  approvalStatus: 'approval_status',
} as const satisfies Partial<Record<keyof SupplierFormDraft, string>>

/** 主档与证照凭证使用同一来源图；人工资料结论只由专用领域接管。 */
export function supplierCredentialMasterDraft(source: SupplierCredentialMigrationRow): SupplierFormDraft {
  const supplier = row('supplier', source)
  let aliases: unknown
  try {
    aliases = JSON.parse(typeof supplier.aliases === 'string' && supplier.aliases.trim() ? supplier.aliases : '[]')
  }
  catch {
    return invalid('分供方别名 JSON 损坏')
  }
  if (!Array.isArray(aliases) || aliases.some(value => typeof value !== 'string'))
    return invalid('分供方别名必须是文本数组')
  return {
    ...Object.fromEntries(Object.entries(masterFields).map(([field, column]) => [field, typeof supplier[column] === 'string' ? supplier[column] : ''])),
    aliases: [...aliases] as string[],
    registeredCapital: supplier.registered_capital as number | null,
    taxpayerVerifiedAt: supplier.taxpayer_verified_at as string | null,
  }
}

/** CoreMigration 的 attributes 为标量；aliases 使用既有 JSON 字符串约定。 */
export function supplierCredentialMasterAttributes(source: SupplierCredentialMigrationRow): Record<string, string | number | null> {
  const draft = supplierCredentialMasterDraft(source)
  return {
    ...Object.fromEntries(Object.entries(draft)
      .filter(([field]) => field !== 'name')
      .map(([field, value]) => [field, field === 'aliases' ? JSON.stringify(value) : value])),
    createdAt: quantityMigrationTimestamp(source.created_at, 'suppliers.created_at'),
    updatedAt: quantityMigrationTimestamp(source.updated_at, 'suppliers.updated_at'),
  } as Record<string, string | number | null>
}
