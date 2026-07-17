import type { ConfirmImpact } from '~/lib/kit/confirm'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { createSoftDeleteActions, downstreamImpact as downstreamImpactCounts, logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'
import { withSupplierImportCreateDefaults } from '~/lib/supplier/import'
import { generateId } from '~/lib/util/id'
import { parseJsonColumn } from '~/lib/util/json'
import { toNum } from '~/lib/util/number'

// 子表中文标签（PARENT_REFS 无展示名，这是唯一需本地保留的信息；缺省回退表名；对称 stores/project.ts）。
// suppliers 自引用（parent_supplier_id）不在此登记——本店 downstreamImpact 按本域业务判断过滤自引用
// （领域上分供方无母子挂靠），通用软删层的 downstreamImpact 本身不做这层排除。
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
  parentSupplierId: string | null
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
  credentialStatus: string
  approvalStatus: string
  source: string
  note: string
  createdAt: string
  updatedAt: string
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
  parentSupplierId: { col: 'parent_supplier_id', toBind: d => d.parentSupplierId ?? null, fromRow: r => (r.parent_supplier_id ?? null) as string | null },
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
  credentialStatus: { col: 'credential_status', toBind: d => d.credentialStatus ?? 'incomplete', fromRow: r => (r.credential_status ?? 'incomplete') as string },
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

/** 写路径唯一绑定源：按登记键序产出各列 SQL 实参（aliases → JSON、parent_supplier_id / registered_capital 允许 null 等特殊取值都收在登记表里）。 */
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
  const list = shallowRef<Supplier[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(
        selectVisibleSql('suppliers', 'ORDER BY created_at DESC'),
      )
      list.value = rows.map(rowToSupplier)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(s => s.id === id)
  }

  async function add(data: Partial<Supplier>) {
    const id = generateId('sup')
    const now = new Date().toISOString()
    await execute(INSERT_SQL, [id, ...supplierToBindings(data), now, now])
    await logCreate(db, 'suppliers', id)
    await load()
    return id
  }

  /** ADR 0005 导入唯一写路径：有外部旧 ID 时更新既有记录，否则新增。 */
  async function upsertImported(data: Partial<Supplier>) {
    const externalRef = data.externalRef?.trim() ?? ''
    if (!externalRef)
      return add(withSupplierImportCreateDefaults(data))

    const [row] = await select<Record<string, unknown>>(
      selectVisibleSql('suppliers', 'AND external_ref = ? LIMIT 1'),
      [externalRef],
    )
    if (!row)
      return add(withSupplierImportCreateDefaults({ ...data, externalRef }))

    const existing = rowToSupplier(row)
    await update(existing.id, { ...existing, ...data, externalRef })
    return existing.id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Supplier>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'suppliers', id, () => execute(
      UPDATE_SQL,
      [...supplierToBindings(data), now, id],
    ))
    await load()
    return logId
  }

  /**
   * 删除前统计各下游子表在「应用可见集」中的未删记录，返回 cascade 杀伤清单（ADR 0003）。
   * 分供方自引用（parent_supplier_id）不计入：领域上分供方无母子挂靠（CONTEXT.md「分供方」词条），
   * 这是本域的业务判断，故在此过滤而非焊死进通用软删层。
   */
  async function downstreamImpact(id: string): Promise<ConfirmImpact[]> {
    const counts = await downstreamImpactCounts(db, 'suppliers', id)
    return counts
      .filter(c => c.table !== 'suppliers')
      .map(c => ({ label: TABLE_LABELS[c.table] ?? c.table, n: c.n }))
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'suppliers', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, add, update, upsertImported, remove, restore, undo, downstreamImpact }
})
