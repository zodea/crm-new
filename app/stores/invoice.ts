import type { MigrationDb } from '~/lib/db/migrations'
import type {
  ArchiveCheckResult,
  InvoiceArchiveAuditRecord,
  InvoiceArchiveProvenance,
} from '~/lib/invoice/archive'
import type { InvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import type { InvoiceExportSettingsDatabase } from '~/lib/invoice/preferences'
import type { InvoiceItem, RecognizedInvoiceFields } from '~/lib/invoice/recognize'
import type { ArchivedInvoiceAggregate } from '~/lib/project/detail-aggregate'
import { defineStore } from 'pinia'
import { computed, readonly, ref, shallowRef } from 'vue'
import { useSessionFileCache } from '~/composables/useSessionFileCache'
import { db } from '~/lib/db/client'
import { execute, select, withTransaction } from '~/lib/db/connection'
import { createSoftDeleteActions, logCreate, logOperation, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'
import { checkInvoiceArchiveReady, checkNotDuplicate } from '~/lib/invoice/archive'
import { partitionBatchPass, selectBatchCandidates } from '~/lib/invoice/batch-pass'
import { hasInvoiceDuplicate } from '~/lib/invoice/duplicate'
import { createDefaultInvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import { loadInvoiceExportStyleSetting, saveInvoiceExportStyleSetting } from '~/lib/invoice/preferences'
import { normalizePrintRotation } from '~/lib/invoice/print-layout'
import { recognizeInvoice } from '~/lib/invoice/recognize'
import { loadArchivedInvoiceAggregates } from '~/lib/project/detail-aggregate'
import { formatFileSize } from '~/lib/util/file'
import { generateId } from '~/lib/util/id'
import { parseJsonColumn } from '~/lib/util/json'
import { round2 } from '~/lib/util/number'
import { useOcrSettingsStore } from '~/stores/ocr-settings'
import { useProjectStore } from '~/stores/project'

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
  /** 货物明细行（OCR 提取，#60；JSON 列存取） */
  items: InvoiceItem[]
  /** 逐字段置信度 {字段名: 0~1}（#60 字段校对模式的边框色/角标/✓确认依据；人工录入的票为空对象） */
  fieldConfidence: Record<string, number>
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
  items: { col: 'items', toBind: d => JSON.stringify(d.items ?? []), fromRow: r => parseJsonColumn<InvoiceItem[]>(r.items, []) },
  fieldConfidence: { col: 'field_confidence', toBind: d => JSON.stringify(d.fieldConfidence ?? {}), fromRow: r => parseJsonColumn<Record<string, number>>(r.field_confidence, {}) },
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

const INVOICE_ARCHIVE_PROVENANCE_LOG = 'invoice_archive_provenance'
const INVOICE_RECOGNITION_LOG_OPERATOR = 'system:invoice-recognition'
const INVOICE_ARCHIVE_CONCURRENT_CHANGE = 'INVOICE_ARCHIVE_CONCURRENT_CHANGE'
const ARCHIVE_PROVENANCE_FIELDS = [
  ['invoiceType', 'invoice_type'],
  ['invoiceNumber', 'invoice_number'],
  ['invoiceDate', 'invoice_date'],
  ['buyer', 'buyer'],
  ['buyerTaxNo', 'buyer_tax_no'],
  ['seller', 'seller'],
  ['sellerTaxNo', 'seller_tax_no'],
  ['amount', 'amount'],
  ['taxAmount', 'tax_amount'],
  ['totalAmount', 'total_amount'],
  ['taxRate', 'tax_rate'],
  ['remark', 'remark'],
  ['items', 'items'],
] as const

interface InvoiceOperationLogRow {
  before_data: string | null
  after_data: string | null
  operator: string
  created_at: string
}

function parseOperationSnapshot(value: string | null): Record<string, unknown> | null {
  if (!value)
    return null
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

function provenanceFieldValue(snapshot: Record<string, unknown>, column: string): unknown {
  const value = snapshot[column]
  if (column !== 'items' || typeof value !== 'string')
    return value
  return parseJsonColumn<InvoiceItem[]>(value, [])
}

function provenanceValues(snapshot: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(ARCHIVE_PROVENANCE_FIELDS.map(([field, column]) => [
    field,
    provenanceFieldValue(snapshot, column),
  ]))
}

function valuesDiffer(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

function archiveCurrentValues(
  invoice: Invoice,
  ownerKind: 'project' | 'personal',
  projectId: string | null,
  projectName: string,
): Readonly<Record<string, unknown>> {
  return {
    invoiceType: invoice.invoiceType,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    buyer: invoice.buyer,
    buyerTaxNo: invoice.buyerTaxNo,
    seller: invoice.seller,
    sellerTaxNo: invoice.sellerTaxNo,
    amount: invoice.amount,
    taxAmount: invoice.taxAmount,
    totalAmount: invoice.totalAmount,
    taxRate: invoice.taxRate,
    remark: invoice.remark,
    items: invoice.items,
    ownerKind,
    projectId,
    projectName,
    supplierId: invoice.supplierId,
  }
}

export type ArchiveResult = ArchiveCheckResult

/**
 * 人工修正字段的域规则（store.correctField 与重新识别草稿共用）：
 * - 修正即人工判定 → 该字段置信度置满变绿；
 * - 金额铁律：改价税合计/税额时派生 amount = total − tax（round2 统一舍入，数字值一律
 *   两位小数入库——input 的 step=0.01 只是 UI 提示挡不住三位小数）。
 */
export function invoiceCorrectionPatch(inv: Invoice, field: keyof Invoice & string, value: string | number): Partial<Invoice> {
  const next = { [field]: typeof value === 'number' ? round2(value) : value } as Partial<Invoice>
  if (field === 'totalAmount' || field === 'taxAmount') {
    const total = field === 'totalAmount' ? (next.totalAmount as number) : inv.totalAmount
    const tax = field === 'taxAmount' ? (next.taxAmount as number) : inv.taxAmount
    next.amount = round2(total - tax)
  }
  const conf = inv.fieldConfidence[field]
  if (conf != null && conf < 1)
    next.fieldConfidence = { ...inv.fieldConfidence, [field]: 1 }
  return next
}

export const useInvoiceStore = defineStore('invoice', () => {
  const ocrSettingsStore = useOcrSettingsStore()
  const list = shallowRef<Invoice[]>([])
  const archivedAggregateRows = shallowRef<ArchivedInvoiceAggregate[]>([])
  const loading = shallowRef(false)
  const invoiceExportStyle = shallowRef<InvoiceXlsxStyleConfig>(createDefaultInvoiceXlsxStyleConfig())
  const invoiceExportStyleLoaded = shallowRef(false)
  /** 识别进度 {发票id: 0~100}——仅识别期间存在，完成即删（左栏「识别中 N%」的数据源） */
  const recognitionProgress = ref<Record<string, number>>({})
  const recognitionErrors = ref<Record<string, string>>({})
  /** 原文件不进入响应式代理；删除或归档后仅保留 10 秒撤回窗口。 */
  const recognitionFiles = useSessionFileCache(10_000, clearRecognitionError)

  function recognitionError(id: string): string {
    return recognitionErrors.value[id] ?? ''
  }

  function clearRecognitionError(id: string) {
    delete recognitionErrors.value[id]
  }

  async function buildArchiveProvenance(
    invoice: Invoice,
    database: MigrationDb = db,
  ): Promise<InvoiceArchiveProvenance> {
    const logs = await database.select<InvoiceOperationLogRow>(
      `SELECT before_data, after_data, operator, created_at
       FROM operation_logs
       WHERE table_name = 'invoices' AND record_id = ? AND action = 'update'
       ORDER BY rowid`,
      [invoice.id],
    )
    const snapshots = logs.map(log => ({
      ...log,
      before: parseOperationSnapshot(log.before_data),
      after: parseOperationSnapshot(log.after_data),
    }))
    // 原始 OCR 取首次识别；其后的人工修订与重新识别覆盖按时间全部留痕（#500）
    const firstExplicitRecognition = snapshots.findIndex(log => log.operator === INVOICE_RECOGNITION_LOG_OPERATOR)
    const recognizedIndex = firstExplicitRecognition >= 0
      ? firstExplicitRecognition
      : snapshots.findIndex(log => log.after?.ocr_status === 'done' && log.before?.ocr_status !== 'done')
    const recognized = recognizedIndex >= 0 ? snapshots[recognizedIndex]?.after ?? null : null
    const sourceKind: InvoiceArchiveProvenance['sourceKind'] = invoice.source === 'excel'
      ? 'excel'
      : recognized
        ? 'ocr'
        : 'manual'
    const revisions = recognizedIndex < 0
      ? []
      : snapshots.slice(recognizedIndex + 1).flatMap((log) => {
          if (!log.before || !log.after)
            return []
          const reason = log.operator === INVOICE_RECOGNITION_LOG_OPERATOR ? '重新识别' : '人工校对'
          return ARCHIVE_PROVENANCE_FIELDS.flatMap(([field, column]) => {
            const from = provenanceFieldValue(log.before!, column)
            const to = provenanceFieldValue(log.after!, column)
            return valuesDiffer(from, to)
              ? [{ field, from, to, reason, at: log.created_at }]
              : []
          })
        })
    return {
      sourceKind,
      sourceId: invoice.filePath || invoice.fileName || invoice.id,
      sourceInfo: {
        source: invoice.source,
        ...(invoice.fileName ? { fileName: invoice.fileName } : {}),
        ...(invoice.filePath ? { filePath: invoice.filePath } : {}),
      },
      originalOcr: recognized ? provenanceValues(recognized) : null,
      revisions,
    }
  }

  async function loadInvoiceArchiveAudit(id: string): Promise<InvoiceArchiveAuditRecord | null> {
    const [row] = await select<{ after_data: string | null }>(
      `SELECT after_data
       FROM operation_logs
       WHERE table_name = ? AND record_id = ? AND action = 'create'
       ORDER BY rowid DESC
       LIMIT 1`,
      [INVOICE_ARCHIVE_PROVENANCE_LOG, id],
    )
    const snapshot = parseOperationSnapshot(row?.after_data ?? null)
    return snapshot as InvoiceArchiveAuditRecord | null
  }

  async function loadInvoiceExportStyle(database: InvoiceExportSettingsDatabase = db) {
    invoiceExportStyle.value = await loadInvoiceExportStyleSetting(database)
    invoiceExportStyleLoaded.value = true
    return invoiceExportStyle.value
  }

  async function saveInvoiceExportStyle(
    next: InvoiceXlsxStyleConfig,
    database: InvoiceExportSettingsDatabase = db,
  ) {
    invoiceExportStyle.value = await saveInvoiceExportStyleSetting(database, next)
    invoiceExportStyleLoaded.value = true
    return invoiceExportStyle.value
  }

  async function markRecognitionFailed(inv: Invoice) {
    if (inv.ocrStatus !== 'pending' && inv.ocrStatus !== 'failed')
      return
    try {
      await update(inv.id, { ...inv, ocrStatus: 'failed' })
    }
    catch {
      // 原始识别错误优先展示；数据库写失败不覆盖它。
    }
  }

  async function load() {
    loading.value = true
    try {
      const [rows, aggregates] = await Promise.all([
        select<Record<string, unknown>>(
          selectVisibleSql('invoices', 'ORDER BY created_at DESC'),
        ),
        loadArchivedInvoiceAggregates(db),
      ])
      list.value = rows.map(rowToInvoice)
      archivedAggregateRows.value = aggregates
      const activeIds = new Set(list.value.filter(invoice => invoice.accountStatus !== 'archived').map(invoice => invoice.id))
      recognitionFiles.sync(activeIds)
      for (const id of Object.keys(recognitionErrors.value)) {
        if (!activeIds.has(id))
          clearRecognitionError(id)
      }
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

  const archivedInvoiceSummaries = computed<Record<string, ArchivedInvoiceAggregate>>(() => Object.fromEntries(
    archivedAggregateRows.value.map(row => [row.projectId, row]),
  ))

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
    await withTransaction(async (tx) => {
      const duplicate = await hasInvoiceDuplicate(tx, id, data.invoiceNumber ?? '')
      if (duplicate && data.accountStatus === 'archived')
        throw new Error('发票号码重复，不能计入台账')
      await tx.execute(INSERT_SQL, [id, ...invoiceToBindings({ ...data, ...(duplicate ? { dupStatus: 'duplicate' } : {}) }), now, now])
      await logCreate(tx, 'invoices', id)
    })
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  /** 全列覆写：data 必须是「最新行 + 改动」的合并结果（`{ ...byId(id), ...patch }`），缺列会被写回默认值。 */
  async function update(id: string, data: Partial<Invoice>, operator = '') {
    const logId = await withTransaction(tx => updateInTransaction(tx, id, data, operator))
    await load()
    return logId
  }

  async function updateInTransaction(tx: MigrationDb, id: string, data: Partial<Invoice>, operator: string) {
    const now = new Date().toISOString()
    const [current] = await tx.select<{ invoice_number: string, account_status: string }>('SELECT invoice_number, account_status FROM invoices WHERE id = ? AND deleted_at IS NULL', [id])
    if (!current)
      return null
    const changedNumber = (data.invoiceNumber ?? '') !== current.invoice_number
    const recheck = changedNumber || operator === INVOICE_RECOGNITION_LOG_OPERATOR
    const duplicate = (recheck || (data.accountStatus === 'archived' && current.account_status !== 'archived'))
      && await hasInvoiceDuplicate(tx, id, data.invoiceNumber ?? '')
    if (duplicate && (current.account_status === 'archived' || data.accountStatus === 'archived'))
      throw new Error('发票号码重复，不能计入台账')
    const values = { ...data, ...(recheck ? { dupStatus: duplicate ? 'duplicate' as const : 'normal' as const } : {}) }
    return withUpdateLog(tx, 'invoices', id, () => tx.execute(UPDATE_SQL, [...invoiceToBindings(values), now, id]), operator)
  }

  // ── 字段级写路径（校对表单）──
  // 全行覆写 + 事件时刻快照会互相回滚（编辑后同一手势点另一字段的✓，后落地者以旧快照胜出）：
  // 改为「串行写队列 + 出队时刻取最新行」——合并发生在队列执行时，前一笔写的 load() 已完成，
  // 快照必然新鲜；Tauri sqlite 真异步驱动下同样成立。
  let writeChain: Promise<unknown> = Promise.resolve()
  function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const p = writeChain.then(fn)
    writeChain = p.then(() => undefined, () => undefined)
    return p
  }

  /** 人工修正字段：域规则见 invoiceCorrectionPatch（收敛在 store 侧，而非各编辑面自带）。 */
  async function correctField(id: string, field: keyof Invoice & string, value: string | number) {
    return enqueueWrite(async () => {
      const inv = byId(id)
      if (!inv)
        return null
      return update(id, { ...inv, ...invoiceCorrectionPatch(inv, field, value) })
    })
  }

  /** ✓确认：不改值，仅人工判定该字段识别无误 → 置信度置满变绿。 */
  async function confirmField(id: string, field: string) {
    return enqueueWrite(async () => {
      const inv = byId(id)
      if (!inv)
        return null
      return update(id, { ...inv, fieldConfidence: { ...inv.fieldConfidence, [field]: 1 } })
    })
  }

  /**
   * 在线识别（#60/#108）：「识别中」是纯会话态，只存在于 recognitionProgress（左栏「识别中 N%」的数据源），
   * 不往内存 list 打 processing 补丁——补丁会被全行写路径持久化进 DB 成死状态、也会被任何 load()
   * 静默回退，两类都真实发生过（#60 审查 c7/c10）。
   * 守卫：已归档票拒绝（重识别会覆写金额并把 reviewStatus 拉回 unreviewed，产生 archived+unreviewed
   * 非法组合且 §4.2 台账合计静默变动）；同 id 在飞拒绝（双击重识别会进度回跳 + 写双份操作日志）；
   * 缺原文件给出可操作错误。失败时待识别/失败票落 failed，已识别票保持原状态与原值。
   */
  async function recognizeFile(id: string): Promise<RecognizedInvoiceFields | null> {
    const inv = byId(id)
    if (!inv || inv.accountStatus === 'archived' || recognitionProgress.value[id] != null)
      return null
    const file = recognitionFiles.get(id)
    if (!file) {
      recognitionErrors.value[id] = '原文件仅保留在上传会话中，请废弃此条后重新上传文件再识别'
      await markRecognitionFailed(inv)
      return null
    }
    clearRecognitionError(id)
    recognitionProgress.value[id] = 0
    try {
      if (!ocrSettingsStore.loaded)
        await ocrSettingsStore.load()
      return await recognizeInvoice({ file }, {
        onProgress: (percent) => {
          recognitionProgress.value[id] = percent
        },
        runtimeOptions: ocrSettingsStore.recognitionOptions,
      })
    }
    catch (error) {
      const current = byId(id)
      if (current) {
        recognitionErrors.value[id] = error instanceof Error ? error.message : 'OCR 识别失败，请稍后重试'
        await markRecognitionFailed(current)
      }
      return null
    }
    finally {
      delete recognitionProgress.value[id]
    }
  }

  /**
   * 首次识别（待识别/识别失败 → 已识别）：完成即把全套字段 + 逐字段置信度写库（走 update() 落操作日志，
   * 识别结果可审计/可撤回）。重复检测读 DB 已提交事实，发票号撞车 → dup_status='duplicate'。
   * 已识别票拒绝：重新识别只走 recognizeDraft，先作草稿、保存确认后才写库（用户 2026-10-13 确认）。
   * @returns 是否成功完成识别（false = 被守卫拒绝、缺少原文件或引擎失败）
   */
  async function startRecognition(id: string) {
    if (byId(id)?.ocrStatus === 'done')
      return false
    const r = await recognizeFile(id)
    const current = r ? byId(id) : undefined
    if (!r || !current)
      return false
    const logId = await update(id, {
      ...current,
      ...r,
      ocrStatus: 'done',
      reviewStatus: 'unreviewed',
    }, INVOICE_RECOGNITION_LOG_OPERATOR)
    if (logId)
      clearRecognitionError(id)
    return logId != null
  }

  /**
   * 重新识别（仅已识别票）：只返回识别结果作为草稿，不写库、不落日志；守卫同首次识别。
   * @returns 识别结果；null = 被守卫拒绝、缺少原文件或引擎失败（错误见 recognitionError）
   */
  async function recognizeDraft(id: string): Promise<RecognizedInvoiceFields | null> {
    if (byId(id)?.ocrStatus !== 'done')
      return null
    return recognizeFile(id)
  }

  /**
   * 保存重新识别草稿（调用方须已取得用户二次确认）：同一事务内先以识别操作人写入识别结果并把
   * review_status 拉回 unreviewed，再把草稿上的人工修改以普通人工写一次（无差异不写），
   * 归档审计据此区分「重新识别」与「人工校对」（#500）。已归档票拒绝。
   * @returns 识别写入的操作日志 id；记录不存在/已删返回 null
   */
  async function saveRecognitionDraft(id: string, recognized: RecognizedInvoiceFields, manualPatch: Partial<Invoice>) {
    return enqueueWrite(async () => {
      const logId = await withTransaction(async (tx) => {
        const current = byId(id)
        const [row] = await tx.select<{ account_status: string }>('SELECT account_status FROM invoices WHERE id = ? AND deleted_at IS NULL', [id])
        if (!current || !row)
          return null
        if (row.account_status === 'archived')
          throw new Error('已归档发票不能保存重新识别结果')
        const recognizedRow: Invoice = { ...current, ...recognized, ocrStatus: 'done', reviewStatus: 'unreviewed' }
        const recognitionLogId = await updateInTransaction(tx, id, recognizedRow, INVOICE_RECOGNITION_LOG_OPERATOR)
        if (!recognitionLogId)
          return null
        const manualRow: Invoice = { ...recognizedRow, ...manualPatch, ocrStatus: 'done', reviewStatus: 'unreviewed' }
        if (valuesDiffer(invoiceToBindings(recognizedRow), invoiceToBindings(manualRow)))
          await updateInTransaction(tx, id, manualRow, '')
        return recognitionLogId
      })
      await load()
      if (logId)
        clearRecognitionError(id)
      return logId
    })
  }

  /**
   * 上传建行（#60 两种入口共用）：逐张 INSERT（pending 态）后一次性 load()（此前复用 add() 每张
   * 全表重载一次）。识别由调用方接着调 recognizeMany 驱动——页面先选中第一张再启动识别，
   * 避免旧实现「整批识别 await 完才选中」夺走用户批量期间的手动选择。
   */
  async function uploadInvoices(files: File[]) {
    const ids: string[] = []
    for (const f of files) {
      const id = generateId('inv')
      const now = new Date().toISOString()
      await execute(INSERT_SQL, [id, ...invoiceToBindings({
        fileName: f.name,
        fileSize: formatFileSize(f.size),
        pageCount: 1,
        source: 'scan',
        ocrStatus: 'pending',
      }), now, now])
      await logCreate(db, 'invoices', id)
      recognitionFiles.set(id, f)
      clearRecognitionError(id)
      ids.push(id)
    }
    await load()
    return ids
  }

  /** 批量识别驱动：串行走完给定 id 集（进度逐张出现在左栏），返回成败张数供 UI 如实提示。 */
  async function recognizeMany(ids: string[]) {
    let done = 0
    for (const id of ids) {
      if (await startRecognition(id))
        done++
    }
    return { done, failed: ids.length - done }
  }

  /**
   * 待识别池（唯一谓词源：批量识别按钮计数与实际处理集共用，防两处漂移）：
   * pending 与 failed（真引擎可能写入的失败态）都可（重）跑；识别中的排除。
   */
  const pendingRecognition = computed(() =>
    list.value.filter(inv =>
      (inv.ocrStatus === 'pending' || inv.ocrStatus === 'failed')
      && inv.source === 'scan'
      && recognitionProgress.value[inv.id] == null,
    ),
  )

  /** 批量识别：把当前待识别池依次走完在线识别，返回成败张数。 */
  async function recognizeAllPending() {
    return recognizeMany(pendingRecognition.value.map(inv => inv.id))
  }

  /**
   * 确认（内容校对完成）：只改 review_status，不碰 account_status（DATABASE.md §2.4 权威定义
   * account_status 只有 none|archived 两态，无 confirmed 中间值）——「确认」与「归档」是两个独立
   * 阶段：前者表示内容校对完毕，后者表示进台账终态，靠 reviewStatus/accountStatus 两个字段分别表达。
   */
  async function confirmInvoice(id: string): Promise<ArchiveResult> {
    // 重复票排除在确认路径之外(#60):文档页标「重复已排除」,写路径必须同口径拒绝,
    // 否则重复票被确认→归档后同号票双份计入 §4.2 台账合计
    const inv = byId(id)
    const dupCheck = checkNotDuplicate(inv?.dupStatus)
    if (!dupCheck.ok)
      return dupCheck
    const now = new Date().toISOString()
    // withUpdateLog 兼做存在性检查(记录不存在/已删则跳过并返回 null),不再依赖内存 byId
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      `UPDATE invoices SET review_status='reviewed', confirmed_at=?, updated_at=? WHERE id=?`,
      [now, now, id],
    ))
    await load()
    if (!logId)
      return { ok: false, reason: '发票不存在或已删除' }
    return { ok: true }
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
    let result: ArchiveResult = { ok: false, reason: '发票不存在或已删除' }
    try {
      await withTransaction(async (tx) => {
        const [row] = await tx.select<Record<string, unknown>>(
          `SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
          [id],
        )
        if (!row)
          return

        const inv = rowToInvoice(row)
        if (await hasInvoiceDuplicate(tx, id, inv.invoiceNumber, true)) {
          result = { ok: false, reason: '发票号码重复，请核对或排除副本后再归档' }
          return
        }
        const provenance = await buildArchiveProvenance(inv, tx)
        const ready = checkInvoiceArchiveReady({
          ocrStatus: inv.ocrStatus,
          reviewStatus: inv.reviewStatus,
          dupStatus: inv.dupStatus,
          ownerKind,
          projectId,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          seller: inv.seller,
          totalAmount: inv.totalAmount,
          currentValuesConfirmed: inv.reviewStatus === 'reviewed',
          provenance,
        })
        if (!ready.ok) {
          result = ready
          return
        }

        const now = new Date().toISOString()
        const archivedProjectId = ownerKind === 'project' ? projectId ?? null : null
        const archivedProjectName = ownerKind === 'project' ? projectName ?? '' : ''
        const archiveAudit: InvoiceArchiveAuditRecord = {
          invoiceId: id,
          archivedAt: now,
          currentValues: archiveCurrentValues(inv, ownerKind, archivedProjectId, archivedProjectName),
          provenance,
        }
        const logId = await withUpdateLog(tx, 'invoices', id, async () => {
          await tx.execute(
            `UPDATE invoices
             SET account_status='archived', owner_kind=?, project_id=?, project_name=?, archived_at=?, updated_at=?
             WHERE id=? AND deleted_at IS NULL AND updated_at=? AND account_status=?`,
            [ownerKind, archivedProjectId, archivedProjectName, now, now, id, inv.updatedAt, inv.accountStatus],
          )
          const [written] = await tx.select<{ archived_at: string | null }>(
            `SELECT archived_at FROM invoices WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
            [id],
          )
          if (written?.archived_at !== now)
            throw new Error(INVOICE_ARCHIVE_CONCURRENT_CHANGE)
        })
        if (!logId)
          return
        await logOperation(tx, {
          table: INVOICE_ARCHIVE_PROVENANCE_LOG,
          recordId: id,
          action: 'create',
          after: archiveAudit as unknown as Record<string, unknown>,
        })
        result = { ok: true }
      })
    }
    catch (error) {
      if (!(error instanceof Error) || error.message !== INVOICE_ARCHIVE_CONCURRENT_CHANGE)
        throw error
      result = { ok: false, reason: '发票已被其他操作更新，请重新加载后重试' }
    }
    await load()
    return result
  }

  /** 「建议通过」池(#63):工作台内全绿扫描件——只标记不自动归档,是「批量通过」的放行范围。 */
  const suggestPass = computed(() => selectBatchCandidates(list.value))

  /**
   * 批量通过(#63):对建议通过池分拣——有归属(项目命中主数据 / 个人开支)的票依次
   * 确认(未校对的补确认)+ 归档,缺归属的排除并返回清单(UI 原样列出)。
   * 全绿只是入围条件,判决权在人:本动作只由用户点「批量通过」触发,绝不自动执行。
   */
  async function batchPass() {
    const projectStore = useProjectStore()
    const { pass, excluded } = partitionBatchPass(
      suggestPass.value,
      name => projectStore.list.find(p => p.name === name),
    )
    let archived = 0
    const rejected = excluded.map(e => ({ id: e.inv.id, label: e.inv.invoiceNumber || e.inv.fileName || e.inv.id, reason: e.reason }))
    for (const { inv, attribution } of pass) {
      if (inv.reviewStatus === 'unreviewed') {
        const confirmed = await confirmInvoice(inv.id)
        if (!confirmed.ok) {
          rejected.push({ id: inv.id, label: inv.invoiceNumber || inv.fileName || inv.id, reason: confirmed.reason ?? '确认失败' })
          continue
        }
      }
      const result = await archiveInvoice(
        inv.id,
        attribution.ownerKind,
        attribution.ownerKind === 'project' ? attribution.projectId : null,
        attribution.ownerKind === 'project' ? attribution.projectName : undefined,
      )
      if (result.ok)
        archived++
      else
        rejected.push({ id: inv.id, label: inv.invoiceNumber || inv.fileName || inv.id, reason: result.reason ?? '归档失败' })
    }
    return { archived, excluded: rejected }
  }

  /**
   * 系统打印对话框关闭后、用户明确确认“已打印”才调用：批量累加次数并保存本次排版角度。
   * 单事务保证一批票要么全部落账，要么全部不动；直接 SQL `print_count + 1` 避免旧快照覆写计数。
   */
  async function recordPrinted(ids: readonly string[], rotations: Readonly<Record<string, number>>) {
    const printableIds = [...new Set(ids)]
    if (!printableIds.length)
      return 0

    const now = new Date().toISOString()
    let committedRows: { id: string, printCount: number, printRotation: number }[] = []
    await withTransaction(async (tx) => {
      const placeholders = printableIds.map(() => '?').join(', ')
      const rows = await tx.select<{ id: string, printCount: number, printRotation: number }>(
        `SELECT id, print_count AS printCount, print_rotation AS printRotation
         FROM invoices
         WHERE deleted_at IS NULL AND id IN (${placeholders})`,
        printableIds,
      )
      if (rows.length !== printableIds.length)
        throw new Error('PRINT_RECORD_SET_CHANGED')

      const currentRotations = new Map(rows.map(row => [row.id, row.printRotation]))
      for (const id of printableIds) {
        const logId = await withUpdateLog(tx, 'invoices', id, () => tx.execute(
          `UPDATE invoices
           SET print_count = print_count + 1, print_rotation = ?, updated_at = ?
           WHERE id = ?`,
          [normalizePrintRotation(rotations[id] ?? currentRotations.get(id) ?? 0), now, id],
        ))
        if (!logId)
          throw new Error('PRINT_RECORD_SET_CHANGED')
      }
      committedRows = rows
    })

    const committedById = new Map(committedRows.map(row => [row.id, row]))
    list.value = list.value.map((invoice) => {
      const committed = committedById.get(invoice.id)
      if (!committed)
        return invoice
      return {
        ...invoice,
        printCount: committed.printCount + 1,
        printRotation: normalizePrintRotation(rotations[invoice.id] ?? committed.printRotation),
        updatedAt: now,
      }
    })
    return printableIds.length
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'invoices', load)

  return { list: readonly(list), archivedInvoiceSummaries, loading: readonly(loading), invoiceExportStyle: readonly(invoiceExportStyle), invoiceExportStyleLoaded: readonly(invoiceExportStyleLoaded), recognitionProgress: readonly(recognitionProgress), recognitionError, load, loadInvoiceExportStyle, saveInvoiceExportStyle, byId, documents, pendingReview, pendingRecognition, suggestPass, ledger, ledgerGroups, add, update, correctField, confirmField, startRecognition, recognizeDraft, saveRecognitionDraft, uploadInvoices, recognizeMany, recognizeAllPending, confirmInvoice, archiveInvoice, loadInvoiceArchiveAudit, batchPass, recordPrinted, remove, restore, undo }
})
