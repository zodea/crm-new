import type { ArchiveCheckResult } from '~/lib/invoice/archive'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { createSoftDeleteActions, logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'
import { checkArchiveOwnership, checkReviewed } from '~/lib/invoice/archive'
import { generateId } from '~/lib/util/id'

export interface Invoice {
  id: string
  fileName: string
  filePath: string
  fileSize: string
  pageCount: number
  invoiceType: string
  invoiceNumber: string
  invoiceDate: string
  buyer: string
  buyerTaxNo: string
  seller: string
  sellerTaxNo: string
  amount: number
  taxAmount: number
  totalAmount: number
  taxRate: string
  remark: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed'
  /** 「确认」= 内容已校对（unreviewed→reviewed），独立于是否归档，可在归档前后再调整内容 */
  reviewStatus: 'unreviewed' | 'reviewed'
  /** 两态（DATABASE.md §2.4 权威定义，无 confirmed 中间值）：none → archived(已归档，进台账终态，见 archiveInvoice) */
  accountStatus: 'none' | 'archived'
  dupStatus: 'normal' | 'duplicate'
  source: 'scan' | 'excel'
  printRotation: number
  ocrConfidence: number | null
  confirmedAt: string | null
  /** 归属（ADR-0001 归属铁律）：project=挂具体项目、personal=个人开支；null=尚未指定，禁止归档 */
  ownerKind: 'project' | 'personal' | null
  /** 仅预留（#57 范围不做外键关联/UI） */
  contractId: string | null
  printCount: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 可写数据列（排除主键与时间戳：id 由 generateId 生成，created_at/updated_at 由写路径注入 now）。 */
type InvoiceWritable = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>

/** 单列登记项：数据库列名 + 写绑定（字段值 → SQL 占位符实参）+ 读映射（DB 行 → 字段值，按列类型 K 精确定型）。 */
interface InvoiceColumn<K extends keyof InvoiceWritable> {
  col: string
  toBind: (d: Partial<Invoice>) => unknown
  fromRow: (row: Record<string, unknown>) => InvoiceWritable[K]
}

/**
 * 列登记表（唯一权威源）：INSERT / UPDATE / rowToInvoice 全部从这里派生列名、占位符、绑定与读映射，
 * 消除「interface / rowToInvoice / add INSERT / update SET 四处并行维护」造成的列漂移（对齐
 * stores/project.ts、stores/supplier.ts 已验证范式——本次为 owner_kind/contract_id/print_count/
 * archived_at 四个新列补齐写路径时，若沿用旧的纯手写 39 字段 SQL 字符串，极易再现该类历史 bug）。
 */
const INVOICE_COLUMNS: { [K in keyof InvoiceWritable]: InvoiceColumn<K> } = {
  fileName: { col: 'file_name', toBind: d => d.fileName ?? '', fromRow: r => (r.file_name ?? '') as string },
  filePath: { col: 'file_path', toBind: d => d.filePath ?? '', fromRow: r => (r.file_path ?? '') as string },
  fileSize: { col: 'file_size', toBind: d => d.fileSize ?? '', fromRow: r => (r.file_size ?? '') as string },
  pageCount: { col: 'page_count', toBind: d => d.pageCount ?? 0, fromRow: r => (r.page_count ?? 0) as number },
  invoiceType: { col: 'invoice_type', toBind: d => d.invoiceType ?? '', fromRow: r => (r.invoice_type ?? '') as string },
  invoiceNumber: { col: 'invoice_number', toBind: d => d.invoiceNumber ?? '', fromRow: r => (r.invoice_number ?? '') as string },
  invoiceDate: { col: 'invoice_date', toBind: d => d.invoiceDate ?? '', fromRow: r => (r.invoice_date ?? '') as string },
  buyer: { col: 'buyer', toBind: d => d.buyer ?? '', fromRow: r => (r.buyer ?? '') as string },
  buyerTaxNo: { col: 'buyer_tax_no', toBind: d => d.buyerTaxNo ?? '', fromRow: r => (r.buyer_tax_no ?? '') as string },
  seller: { col: 'seller', toBind: d => d.seller ?? '', fromRow: r => (r.seller ?? '') as string },
  sellerTaxNo: { col: 'seller_tax_no', toBind: d => d.sellerTaxNo ?? '', fromRow: r => (r.seller_tax_no ?? '') as string },
  amount: { col: 'amount', toBind: d => d.amount ?? 0, fromRow: r => (r.amount ?? 0) as number },
  taxAmount: { col: 'tax_amount', toBind: d => d.taxAmount ?? 0, fromRow: r => (r.tax_amount ?? 0) as number },
  totalAmount: { col: 'total_amount', toBind: d => d.totalAmount ?? 0, fromRow: r => (r.total_amount ?? 0) as number },
  taxRate: { col: 'tax_rate', toBind: d => d.taxRate ?? '', fromRow: r => (r.tax_rate ?? '') as string },
  remark: { col: 'remark', toBind: d => d.remark ?? '', fromRow: r => (r.remark ?? '') as string },
  projectId: { col: 'project_id', toBind: d => d.projectId ?? null, fromRow: r => (r.project_id ?? null) as string | null },
  projectName: { col: 'project_name', toBind: d => d.projectName ?? '', fromRow: r => (r.project_name ?? '') as string },
  supplierId: { col: 'supplier_id', toBind: d => d.supplierId ?? null, fromRow: r => (r.supplier_id ?? null) as string | null },
  ocrStatus: { col: 'ocr_status', toBind: d => d.ocrStatus ?? 'pending', fromRow: r => (r.ocr_status ?? 'pending') as Invoice['ocrStatus'] },
  reviewStatus: { col: 'review_status', toBind: d => d.reviewStatus ?? 'unreviewed', fromRow: r => (r.review_status ?? 'unreviewed') as Invoice['reviewStatus'] },
  accountStatus: { col: 'account_status', toBind: d => d.accountStatus ?? 'none', fromRow: r => (r.account_status ?? 'none') as Invoice['accountStatus'] },
  dupStatus: { col: 'dup_status', toBind: d => d.dupStatus ?? 'normal', fromRow: r => (r.dup_status ?? 'normal') as Invoice['dupStatus'] },
  source: { col: 'source', toBind: d => d.source ?? 'scan', fromRow: r => (r.source ?? 'scan') as Invoice['source'] },
  printRotation: { col: 'print_rotation', toBind: d => d.printRotation ?? 0, fromRow: r => (r.print_rotation ?? 0) as number },
  ocrConfidence: { col: 'ocr_confidence', toBind: d => d.ocrConfidence ?? null, fromRow: r => r.ocr_confidence as number | null },
  confirmedAt: { col: 'confirmed_at', toBind: d => d.confirmedAt ?? null, fromRow: r => r.confirmed_at as string | null },
  ownerKind: { col: 'owner_kind', toBind: d => d.ownerKind ?? null, fromRow: r => (r.owner_kind ?? null) as Invoice['ownerKind'] },
  contractId: { col: 'contract_id', toBind: d => d.contractId ?? null, fromRow: r => (r.contract_id ?? null) as string | null },
  printCount: { col: 'print_count', toBind: d => d.printCount ?? 0, fromRow: r => (r.print_count ?? 0) as number },
  archivedAt: { col: 'archived_at', toBind: d => d.archivedAt ?? null, fromRow: r => r.archived_at as string | null },
}

/** 登记键序（单次求值）：列名清单与绑定值清单都按同一序派生，保证 SQL 占位符与实参一一对齐。 */
const INVOICE_COLUMN_KEYS = Object.keys(INVOICE_COLUMNS) as (keyof InvoiceWritable)[]
const INVOICE_COLS = INVOICE_COLUMN_KEYS.map(k => INVOICE_COLUMNS[k].col)

/** 写路径共用 SQL（add 的 INSERT、update 的 SET 均由登记表派生，杜绝列漂移）。 */
const INSERT_SQL = `INSERT INTO invoices (id, ${INVOICE_COLS.join(', ')}, created_at, updated_at)
       VALUES (?, ${INVOICE_COLS.map(() => '?').join(', ')}, ?, ?)`
const UPDATE_SQL = `UPDATE invoices SET ${INVOICE_COLS.map(c => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`

/** 写路径唯一绑定源：按登记键序产出各列 SQL 实参。 */
function invoiceToBindings(data: Partial<Invoice>): unknown[] {
  return INVOICE_COLUMN_KEYS.map(k => INVOICE_COLUMNS[k].toBind(data))
}

function rowToInvoice(row: Record<string, unknown>): Invoice {
  const data: Record<string, unknown> = {}
  for (const k of INVOICE_COLUMN_KEYS)
    data[k] = INVOICE_COLUMNS[k].fromRow(row)
  return {
    id: row.id as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
    ...(data as InvoiceWritable),
  }
}

export type ArchiveResult = ArchiveCheckResult

export const useInvoiceStore = defineStore('invoice', () => {
  const list = shallowRef<Invoice[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(
        selectVisibleSql('invoices', 'ORDER BY created_at DESC'),
      )
      list.value = rows.map(rowToInvoice)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(inv => inv.id === id)
  }

  const documents = computed(() =>
    list.value.filter(inv => inv.source === 'scan'),
  )

  const pendingReview = computed(() =>
    list.value.filter(inv =>
      inv.ocrStatus === 'done'
      && inv.reviewStatus === 'unreviewed'
      && inv.dupStatus === 'normal',
    ),
  )

  /** 台账（DATABASE.md §4.2 权威口径）：仅已归档（account_status='archived'）计入，「确认」不等于「归档」。 */
  const ledger = computed(() =>
    list.value.filter(inv => inv.accountStatus === 'archived'),
  )

  /** 台账三分组（归属铁律，issue #57 验收③）：按 项目 / 个人开支 / 未归 分组计数；「未归」= 已校对(reviewStatus='reviewed')但尚未归档(accountStatus 仍为 'none')的过渡态。 */
  const ledgerGroups = computed(() => {
    const project = ledger.value.filter(inv => inv.ownerKind === 'project')
    const personal = ledger.value.filter(inv => inv.ownerKind === 'personal')
    const unassigned = list.value.filter(inv =>
      inv.reviewStatus === 'reviewed' && inv.accountStatus === 'none',
    )
    return { project, personal, unassigned }
  })

  async function add(data: Partial<Invoice>) {
    const id = generateId('inv')
    const now = new Date().toISOString()
    await execute(INSERT_SQL, [id, ...invoiceToBindings(data), now, now])
    await logCreate(db, 'invoices', id)
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Invoice>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      UPDATE_SQL,
      [...invoiceToBindings(data), now, id],
    ))
    await load()
    return logId
  }

  async function updateField(id: string, field: keyof Invoice, value: unknown) {
    const inv = byId(id)
    if (!inv)
      return

    const updated = { ...inv, [field]: value }
    await update(id, updated)
  }

  /**
   * 确认（内容校对完成）：只改 review_status，不碰 account_status（DATABASE.md §2.4 权威定义
   * account_status 只有 none|archived 两态，无 confirmed 中间值）——「确认」与「归档」是两个独立
   * 阶段：前者表示内容校对完毕，后者表示进台账终态，靠 reviewStatus/accountStatus 两个字段分别表达。
   */
  async function confirmInvoice(id: string) {
    const now = new Date().toISOString()
    // withUpdateLog 兼做存在性检查(记录不存在/已删则跳过并返回 null),不再依赖内存 byId
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      `UPDATE invoices SET review_status='reviewed', confirmed_at=?, updated_at=? WHERE id=?`,
      [now, now, id],
    ))
    await load()
    return logId
  }

  /**
   * 归档（ADR-0001 归属铁律）：无归属禁止归档；ownerKind='project' 必须指定 projectId，
   * ownerKind='personal' 不挂项目也可归档（写入时显式清空 project_id/project_name，两类出口互斥）。
   * 归档是独立于「确认」的终态动作——进 §4.2 台账聚合口径靠的是这一步，不是 confirmInvoice。
   * 前置：DATABASE.md §2.4「核对完成是归档唯一前置」——reviewStatus 必须已是 reviewed 才允许归档，
   * 不能只靠调用方（UI）恰好按顺序调用来保证，否则新增调用点很容易绕过这条硬性规则。
   * projectName 由调用方传入（查 projectStore 得到的规范名，而非发票原始 OCR/自由文本），
   * 避免 project_id 与 project_name 各自指向不同项目、界面显示与实际归属对不上。
   */
  async function archiveInvoice(id: string, ownerKind: 'project' | 'personal', projectId?: string | null, projectName?: string): Promise<ArchiveResult> {
    const inv = byId(id)
    if (!inv)
      return { ok: false, reason: '发票不存在或已删除' }

    const reviewedCheck = checkReviewed(inv.reviewStatus)
    if (!reviewedCheck.ok)
      return reviewedCheck

    const ownershipCheck = checkArchiveOwnership(ownerKind, projectId)
    if (!ownershipCheck.ok)
      return ownershipCheck

    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      `UPDATE invoices SET account_status='archived', owner_kind=?, project_id=?, project_name=?, archived_at=?, updated_at=? WHERE id=?`,
      [ownerKind, ownerKind === 'project' ? projectId : null, ownerKind === 'project' ? (projectName ?? '') : '', now, now, id],
    ))
    await load()
    if (!logId)
      return { ok: false, reason: '发票不存在或已删除' }
    return { ok: true }
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'invoices', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, documents, pendingReview, ledger, ledgerGroups, add, update, updateField, confirmInvoice, archiveInvoice, remove, restore, undo }
})
