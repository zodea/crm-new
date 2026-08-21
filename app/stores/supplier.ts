import type { ConfirmImpact } from '~/lib/kit/confirm'
import type {
  FormAttachmentChanges,
  MasterDataSaveAction,
  SupplierFormDraft,
} from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { select, withTransaction } from '~/lib/db/connection'
import {
  downstreamImpact as downstreamImpactCounts,
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import {
  listFormAttachments,
  loadSupplierForm,
  saveSupplierForm,
} from '~/lib/master-data/forms'
import { writeSupplierAudit } from '~/lib/supplier/audit'
import { revalidateSupplierCredentialStatuses } from '~/lib/supplier/credentials'
import { withSupplierImportCreateDefaults } from '~/lib/supplier/import'
import { generateId } from '~/lib/util/id'
import { parseJsonColumn } from '~/lib/util/json'
import { toNum } from '~/lib/util/number'
import { useDataVisibilityStore } from '~/stores/data-visibility'

// 子表中文标签（PARENT_REFS 无展示名，这是唯一需本地保留的信息；缺省回退表名；对称 stores/project.ts）。
const TABLE_LABELS: Record<string, string> = {
  invoices: '发票',
  supplier_credentials: '证照',
  project_suppliers: '合作项目关系',
  expenditure_contracts: '支出合同',
  contracts: '合同',
  payment_applications: '请款单',
}

export interface Supplier {
  id: string
  name: string
  /** 源系统主键/匹配标识（ADR 0005），用于迁移对账、重导修正与去重。 */
  externalRef: string
  aliases: string[]
  uniqueCode: string
  taxNo: string
  businessType: string
  supplierCategory: string
  rating: string
  legalRep: string
  registeredCapital: number | null
  registeredDate: string
  address: string
  taxpayerType: string
  mainBusiness: string
  invoiceName: string
  invoiceAddress: string
  bank: string
  bankAccount: string
  phone: string
  contact: string
  contactPhone: string
  contactTitle: string
  credentialStatus: string
  credentialReviewedAt: string | null
  credentialReviewNote: string
  taxpayerVerificationStatus: string
  taxpayerVerificationSource: string
  taxpayerVerifiedAt: string | null
  taxpayerVerificationNote: string
  approvalStatus: string
  source: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface SupplierListStats {
  projectCount: number
  contractTotal: number
  paidTotal: number
  payableBalance: number
  projectIds: string[]
}

export interface SupplierProjectFilterOption {
  id: string
  name: string
}

/** 可写数据列（排除主键与时间戳：id 由 generateId 生成，created_at/updated_at 由写路径注入 now）。 */
type SupplierData = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>

/** 单列登记项：数据库列名 + 写绑定（字段值 → SQL 占位符实参）+ 读映射（DB 行 → 字段值，按列类型 K 精确定型）。 */
interface SupplierColumn<K extends keyof SupplierData> {
  col: string
  toBind: (d: Partial<Supplier>) => unknown
  fromRow: (row: Record<string, unknown>) => SupplierData[K]
}

/**
 * 列登记表（唯一权威源）：INSERT / UPDATE / rowToSupplier 全部从这里派生列名、占位符、绑定与读映射，
 * 消除「interface / rowToSupplier / add INSERT / update SET 四处并行维护」造成的列漂移
 * （本次修复的 credential_status / approval_status 只写进 INSERT 却漏出 UPDATE，即此类 bug）。
 * 映射类型 `{ [K in keyof SupplierData]: … }` 强制键 = 字段名：漏登记某字段直接 typecheck 失败，
 * 新增字段时编译期强制在此补齐，四处自动跟上。
 */
const SUPPLIER_COLUMNS: { [K in keyof SupplierData]: SupplierColumn<K> } = {
  name: { col: 'name', toBind: d => d.name ?? '', fromRow: r => r.name as string },
  externalRef: { col: 'external_ref', toBind: d => d.externalRef ?? '', fromRow: r => (r.external_ref ?? '') as string },
  aliases: { col: 'aliases', toBind: d => JSON.stringify(d.aliases ?? []), fromRow: r => parseJsonColumn<string[]>(r.aliases, []) },
  uniqueCode: { col: 'unique_code', toBind: d => d.uniqueCode ?? '', fromRow: r => (r.unique_code ?? '') as string },
  taxNo: { col: 'tax_no', toBind: d => d.taxNo ?? '', fromRow: r => (r.tax_no ?? '') as string },
  businessType: { col: 'business_type', toBind: d => d.businessType ?? '', fromRow: r => (r.business_type ?? '') as string },
  supplierCategory: { col: 'supplier_category', toBind: d => d.supplierCategory ?? '', fromRow: r => (r.supplier_category ?? '') as string },
  rating: { col: 'rating', toBind: d => d.rating ?? '', fromRow: r => (r.rating ?? '') as string },
  legalRep: { col: 'legal_rep', toBind: d => d.legalRep ?? '', fromRow: r => (r.legal_rep ?? '') as string },
  registeredCapital: { col: 'registered_capital', toBind: d => toNum(d.registeredCapital), fromRow: r => r.registered_capital as number | null },
  registeredDate: { col: 'registered_date', toBind: d => d.registeredDate ?? '', fromRow: r => (r.registered_date ?? '') as string },
  address: { col: 'address', toBind: d => d.address ?? '', fromRow: r => (r.address ?? '') as string },
  taxpayerType: { col: 'taxpayer_type', toBind: d => d.taxpayerType ?? '', fromRow: r => (r.taxpayer_type ?? '') as string },
  mainBusiness: { col: 'main_business', toBind: d => d.mainBusiness ?? '', fromRow: r => (r.main_business ?? '') as string },
  invoiceName: { col: 'invoice_name', toBind: d => d.invoiceName ?? '', fromRow: r => (r.invoice_name ?? '') as string },
  invoiceAddress: { col: 'invoice_address', toBind: d => d.invoiceAddress ?? '', fromRow: r => (r.invoice_address ?? '') as string },
  bank: { col: 'bank', toBind: d => d.bank ?? '', fromRow: r => (r.bank ?? '') as string },
  bankAccount: { col: 'bank_account', toBind: d => d.bankAccount ?? '', fromRow: r => (r.bank_account ?? '') as string },
  phone: { col: 'phone', toBind: d => d.phone ?? '', fromRow: r => (r.phone ?? '') as string },
  contact: { col: 'contact', toBind: d => d.contact ?? '', fromRow: r => (r.contact ?? '') as string },
  contactPhone: { col: 'contact_phone', toBind: d => d.contactPhone ?? '', fromRow: r => (r.contact_phone ?? '') as string },
  contactTitle: { col: 'contact_title', toBind: d => d.contactTitle ?? '', fromRow: r => (r.contact_title ?? '') as string },
  credentialStatus: { col: 'credential_status', toBind: d => d.credentialStatus ?? 'incomplete', fromRow: r => (r.credential_status ?? 'incomplete') as string },
  credentialReviewedAt: { col: 'credential_reviewed_at', toBind: d => d.credentialReviewedAt ?? null, fromRow: r => (r.credential_reviewed_at ?? null) as string | null },
  credentialReviewNote: { col: 'credential_review_note', toBind: d => d.credentialReviewNote ?? '', fromRow: r => (r.credential_review_note ?? '') as string },
  taxpayerVerificationStatus: { col: 'taxpayer_verification_status', toBind: d => d.taxpayerVerificationStatus ?? 'not_checked', fromRow: r => (r.taxpayer_verification_status ?? 'not_checked') as string },
  taxpayerVerificationSource: { col: 'taxpayer_verification_source', toBind: d => d.taxpayerVerificationSource ?? '', fromRow: r => (r.taxpayer_verification_source ?? '') as string },
  taxpayerVerifiedAt: { col: 'taxpayer_verified_at', toBind: d => d.taxpayerVerifiedAt ?? null, fromRow: r => (r.taxpayer_verified_at ?? null) as string | null },
  taxpayerVerificationNote: { col: 'taxpayer_verification_note', toBind: d => d.taxpayerVerificationNote ?? '', fromRow: r => (r.taxpayer_verification_note ?? '') as string },
  approvalStatus: { col: 'approval_status', toBind: d => d.approvalStatus ?? 'draft', fromRow: r => (r.approval_status ?? 'draft') as string },
  source: { col: 'source', toBind: d => d.source ?? 'manual', fromRow: r => (r.source ?? 'manual') as string },
  note: { col: 'note', toBind: d => d.note ?? '', fromRow: r => (r.note ?? '') as string },
}

/** 登记键序（单次求值）：列名清单与绑定值清单都按同一序派生，保证 SQL 占位符与实参一一对齐。 */
const SUPPLIER_COLUMN_KEYS = Object.keys(SUPPLIER_COLUMNS) as (keyof SupplierData)[]
const SUPPLIER_COLS = SUPPLIER_COLUMN_KEYS.map(k => SUPPLIER_COLUMNS[k].col)

/** 写路径共用 SQL（add 的 INSERT、update 的 SET 均由登记表派生，杜绝列漂移）。 */
const INSERT_SQL = `INSERT INTO suppliers (id, ${SUPPLIER_COLS.join(', ')}, created_at, updated_at)
       VALUES (?, ${SUPPLIER_COLS.map(() => '?').join(', ')}, ?, ?)`
const UPDATE_SQL = `UPDATE suppliers SET ${SUPPLIER_COLS.map(c => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`

/** 写路径唯一绑定源：按登记键序产出各列 SQL 实参（aliases → JSON、registered_capital 允许 null 等特殊取值都收在登记表里）。 */
function supplierToBindings(data: Partial<Supplier>): unknown[] {
  return SUPPLIER_COLUMN_KEYS.map(k => SUPPLIER_COLUMNS[k].toBind(data))
}

function rowToSupplier(row: Record<string, unknown>): Supplier {
  const data: Record<string, unknown> = {}
  for (const k of SUPPLIER_COLUMN_KEYS)
    data[k] = SUPPLIER_COLUMNS[k].fromRow(row)
  return {
    id: row.id as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
    ...(data as SupplierData),
  }
}

export const useSupplierStore = defineStore('supplier', () => {
  const dataVisibilityStore = useDataVisibilityStore()
  const list = shallowRef<Supplier[]>([])
  const listStats = shallowRef<Record<string, SupplierListStats>>({})
  const projectOptions = shallowRef<SupplierProjectFilterOption[]>([])
  const loading = shallowRef(false)

  async function load(businessDate?: string) {
    loading.value = true
    try {
      // Demo snapshots are immutable evidence. Credential revalidation belongs to
      // the writable production workspace; demo reads use the seeded status.
      if (!dataVisibilityStore.includeDemo)
        await revalidateSupplierCredentialStatuses(db, businessDate)
      const [rows, statsRows, projectRows] = await Promise.all([
        select<Record<string, unknown>>(
          selectVisibleSql('suppliers', 'ORDER BY created_at DESC'),
        ),
        select<Record<string, unknown>>(`
          ${hiddenCtesFor(
            'suppliers',
            'project_suppliers',
            'contracts',
            'payment_applications',
            'payment_record_application_allocations',
            'payment_records',
          )}
          SELECT supplier.id AS supplier_id,
                 (
                   SELECT COUNT(DISTINCT relation.project_id)
                   FROM project_suppliers AS relation
                   WHERE relation.supplier_id = supplier.id
                     AND ${visibleCond('project_suppliers', 'relation')}
                 ) AS project_count,
                 (
                   SELECT COALESCE(SUM(contract.amount), 0)
                   FROM contracts AS contract
                   WHERE contract.supplier_id = supplier.id
                     AND ${visibleCond('contracts', 'contract')}
                 ) AS contract_total,
                 (
                   SELECT COALESCE(SUM(allocation.allocated_amount), 0)
                   FROM payment_applications AS application
                   JOIN payment_record_application_allocations AS allocation
                     ON allocation.payment_application_id = application.id
                    AND ${visibleCond('payment_record_application_allocations', 'allocation')}
                   JOIN payment_records AS payment
                     ON payment.id = allocation.payment_record_id
                    AND ${visibleCond('payment_records', 'payment')}
                    AND payment.confirmation_status = 'confirmed'
                   WHERE application.supplier_id = supplier.id
                     AND ${visibleCond('payment_applications', 'application')}
                 ) AS paid_total,
                 (
                   SELECT GROUP_CONCAT(DISTINCT relation.project_id)
                   FROM project_suppliers AS relation
                   WHERE relation.supplier_id = supplier.id
                     AND ${visibleCond('project_suppliers', 'relation')}
                 ) AS project_ids
          FROM suppliers AS supplier
          WHERE ${visibleCond('suppliers', 'supplier')}
        `),
        select<Record<string, unknown>>(`
          ${hiddenCtesFor('project_suppliers', 'projects', 'suppliers')}
          SELECT DISTINCT project.id, project.name
          FROM project_suppliers AS relation
          JOIN projects AS project
            ON project.id = relation.project_id
           AND ${visibleCond('projects', 'project')}
          JOIN suppliers AS supplier
            ON supplier.id = relation.supplier_id
           AND ${visibleCond('suppliers', 'supplier')}
          WHERE ${visibleCond('project_suppliers', 'relation')}
          ORDER BY project.name
        `),
      ])
      list.value = rows.map(rowToSupplier)
      listStats.value = Object.fromEntries(statsRows.map((row) => {
        const contractTotal = Number(row.contract_total ?? 0)
        const paidTotal = Number(row.paid_total ?? 0)
        return [String(row.supplier_id), {
          projectCount: Number(row.project_count ?? 0),
          contractTotal,
          paidTotal,
          payableBalance: contractTotal - paidTotal,
          projectIds: String(row.project_ids ?? '').split(',').filter(Boolean),
        } satisfies SupplierListStats]
      }))
      projectOptions.value = projectRows.map(row => ({
        id: String(row.id),
        name: String(row.name || row.id),
      }))
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(s => s.id === id)
  }

  async function add(data: Partial<Supplier>, sourceCategory = 'store') {
    const id = generateId('sup')
    const now = new Date().toISOString()
    const safeData: Partial<Supplier> = {
      ...data,
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    }
    await withTransaction(async (tx) => {
      await tx.execute(INSERT_SQL, [id, ...supplierToBindings(safeData), now, now])
      await writeSupplierAudit(tx, {
        supplierId: id,
        action: 'create',
        outcome: 'created',
        sourceCategory,
        changedFields: SUPPLIER_COLS.filter(column =>
          !['credential_status', 'credential_reviewed_at', 'credential_review_note'].includes(column),
        ),
        createdAt: now,
      })
    })
    await load()
    return id
  }

  /** ADR 0005 导入唯一写路径：有外部旧 ID 时更新既有记录，否则新增。 */
  async function upsertImported(data: Partial<Supplier>) {
    const externalRef = data.externalRef?.trim() ?? ''
    if (!externalRef)
      return add(withSupplierImportCreateDefaults(data), 'import')

    const [row] = await select<Record<string, unknown>>(
      selectVisibleSql('suppliers', 'AND external_ref = ? LIMIT 1'),
      [externalRef],
    )
    if (!row)
      return add(withSupplierImportCreateDefaults({ ...data, externalRef }), 'import')

    const existing = rowToSupplier(row)
    await update(existing.id, { ...existing, ...data, externalRef }, 'import')
    return existing.id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Supplier>, sourceCategory = 'store') {
    const now = new Date().toISOString()
    const auditId = await withTransaction(async (tx) => {
      const [row] = await tx.select<Record<string, unknown>>(
        `SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL`,
        [id],
      )
      if (!row)
        return null
      const existing = rowToSupplier(row)
      const safeData: Partial<Supplier> = {
        ...existing,
        ...data,
        credentialStatus: existing.credentialStatus,
        credentialReviewedAt: existing.credentialReviewedAt,
        credentialReviewNote: existing.credentialReviewNote,
      }
      const changedFields = SUPPLIER_COLUMN_KEYS
        .filter((key) => {
          const column = SUPPLIER_COLUMNS[key]
          return JSON.stringify(column.toBind(existing))
            !== JSON.stringify(column.toBind(safeData))
        })
        .map(key => SUPPLIER_COLUMNS[key].col)
      await tx.execute(
        UPDATE_SQL,
        [...supplierToBindings(safeData), now, id],
      )
      return writeSupplierAudit(tx, {
        supplierId: id,
        action: 'update',
        outcome: changedFields.length ? 'updated' : 'unchanged',
        sourceCategory,
        changedFields,
        createdAt: now,
      })
    })
    await load()
    return auditId
  }

  async function saveForm(
    draft: SupplierFormDraft,
    action: MasterDataSaveAction,
    attachments?: FormAttachmentChanges,
  ) {
    const result = await saveSupplierForm(draft, action, attachments)
    await load()
    return result
  }

  /**
   * 删除前统计各下游子表在「应用可见集」中的未删记录，返回 cascade 杀伤清单（ADR 0003）。
   */
  async function downstreamImpact(id: string): Promise<ConfirmImpact[]> {
    const counts = await downstreamImpactCounts(db, 'suppliers', id)
    return counts
      .map(c => ({ label: TABLE_LABELS[c.table] ?? c.table, n: c.n }))
  }

  async function remove(id: string) {
    const auditId = await withTransaction(async (tx) => {
      const [supplier] = await tx.select<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM suppliers WHERE id = ?',
        [id],
      )
      if (!supplier || supplier.deleted_at != null)
        return null
      const now = new Date().toISOString()
      await tx.execute(
        'UPDATE suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [now, now, id],
      )
      return writeSupplierAudit(tx, {
        supplierId: id,
        action: 'delete',
        outcome: 'deleted',
        sourceCategory: 'store',
        changedFields: ['deleted_at'],
        createdAt: now,
      })
    })
    await load()
    return auditId
  }

  async function restore(id: string) {
    const auditId = await withTransaction(async (tx) => {
      const [supplier] = await tx.select<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM suppliers WHERE id = ?',
        [id],
      )
      if (!supplier || supplier.deleted_at == null)
        return null
      const now = new Date().toISOString()
      await tx.execute(
        'UPDATE suppliers SET deleted_at = NULL, updated_at = ? WHERE id = ?',
        [now, id],
      )
      return writeSupplierAudit(tx, {
        supplierId: id,
        action: 'restore',
        outcome: 'restored',
        sourceCategory: 'store',
        changedFields: ['deleted_at'],
        createdAt: now,
      })
    })
    await load()
    return auditId
  }

  async function undo(auditId: string) {
    const changed = await withTransaction(async (tx) => {
      const [audit] = await tx.select<{
        supplier_id: string
        action: 'delete' | 'restore' | string
      }>(
        `SELECT supplier_id, action FROM supplier_audits WHERE id = ?`,
        [auditId],
      )
      if (!audit || !['delete', 'restore'].includes(audit.action))
        return false
      const [supplier] = await tx.select<{ deleted_at: string | null }>(
        'SELECT deleted_at FROM suppliers WHERE id = ?',
        [audit.supplier_id],
      )
      if (!supplier)
        return false
      const undoDelete = audit.action === 'delete'
      if ((undoDelete && supplier.deleted_at == null)
        || (!undoDelete && supplier.deleted_at != null)) {
        return false
      }
      const now = new Date().toISOString()
      await tx.execute(
        `UPDATE suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?`,
        [undoDelete ? null : now, now, audit.supplier_id],
      )
      await writeSupplierAudit(tx, {
        supplierId: audit.supplier_id,
        action: undoDelete ? 'restore' : 'delete',
        outcome: undoDelete ? 'undo_delete' : 'undo_restore',
        sourceCategory: 'undo',
        changedFields: ['deleted_at'],
        createdAt: now,
      })
      return true
    })
    if (changed)
      await load()
    return changed
  }

  return {
    list: readonly(list),
    listStats: readonly(listStats),
    projectOptions: readonly(projectOptions),
    loading: readonly(loading),
    load,
    byId,
    add,
    update,
    upsertImported,
    saveForm,
    loadForm: loadSupplierForm,
    loadFormAttachments: (id: string) => listFormAttachments('supplier', id),
    remove,
    restore,
    undo,
    downstreamImpact,
  }
})
