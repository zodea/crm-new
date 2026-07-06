import { generateId } from '~/lib/util/id'
import { execute, select } from '~/lib/db/connection'
import { db } from '~/lib/db/client'
import { createSoftDeleteActions, logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'

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
  reviewStatus: 'unreviewed' | 'reviewed'
  accountStatus: 'none' | 'confirmed'
  dupStatus: 'normal' | 'duplicate'
  source: 'scan' | 'excel'
  printRotation: number
  ocrConfidence: number | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

function rowToInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: row.id as string,
    fileName: (row.file_name ?? '') as string,
    filePath: (row.file_path ?? '') as string,
    fileSize: (row.file_size ?? '') as string,
    pageCount: (row.page_count ?? 0) as number,
    invoiceType: (row.invoice_type ?? '') as string,
    invoiceNumber: (row.invoice_number ?? '') as string,
    invoiceDate: (row.invoice_date ?? '') as string,
    buyer: (row.buyer ?? '') as string,
    buyerTaxNo: (row.buyer_tax_no ?? '') as string,
    seller: (row.seller ?? '') as string,
    sellerTaxNo: (row.seller_tax_no ?? '') as string,
    amount: (row.amount ?? 0) as number,
    taxAmount: (row.tax_amount ?? 0) as number,
    totalAmount: (row.total_amount ?? 0) as number,
    taxRate: (row.tax_rate ?? '') as string,
    remark: (row.remark ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    projectName: (row.project_name ?? '') as string,
    supplierId: (row.supplier_id ?? null) as string | null,
    ocrStatus: (row.ocr_status ?? 'pending') as Invoice['ocrStatus'],
    reviewStatus: (row.review_status ?? 'unreviewed') as Invoice['reviewStatus'],
    accountStatus: (row.account_status ?? 'none') as Invoice['accountStatus'],
    dupStatus: (row.dup_status ?? 'normal') as Invoice['dupStatus'],
    source: (row.source ?? 'scan') as Invoice['source'],
    printRotation: (row.print_rotation ?? 0) as number,
    ocrConfidence: row.ocr_confidence as number | null,
    confirmedAt: (row.confirmed_at ?? null) as string | null,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
  }
}

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

  const ledger = computed(() =>
    list.value.filter(inv =>
      inv.accountStatus === 'confirmed' || inv.source === 'excel',
    ),
  )

  async function add(data: Partial<Invoice>) {
    const id = generateId('inv')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO invoices (id, file_name, file_path, file_size, page_count, invoice_type, invoice_number, invoice_date, buyer, buyer_tax_no, seller, seller_tax_no, amount, tax_amount, total_amount, tax_rate, remark, project_id, project_name, supplier_id, ocr_status, review_status, account_status, dup_status, source, print_rotation, ocr_confidence, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.fileName ?? '', data.filePath ?? '', data.fileSize ?? '', data.pageCount ?? 0,
        data.invoiceType ?? '', data.invoiceNumber ?? '', data.invoiceDate ?? '',
        data.buyer ?? '', data.buyerTaxNo ?? '',
        data.seller ?? '', data.sellerTaxNo ?? '',
        data.amount ?? 0, data.taxAmount ?? 0, data.totalAmount ?? 0,
        data.taxRate ?? '', data.remark ?? '',
        data.projectId ?? null, data.projectName ?? '', data.supplierId ?? null,
        data.ocrStatus ?? 'pending', data.reviewStatus ?? 'unreviewed',
        data.accountStatus ?? 'none', data.dupStatus ?? 'normal',
        data.source ?? 'scan', data.printRotation ?? 0,
        data.ocrConfidence ?? null, data.confirmedAt ?? null,
        now, now,
      ],
    )
    await logCreate(db, 'invoices', id)
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function update(id: string, data: Partial<Invoice>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      `UPDATE invoices SET file_name=?, file_path=?, file_size=?, page_count=?, invoice_type=?, invoice_number=?, invoice_date=?, buyer=?, buyer_tax_no=?, seller=?, seller_tax_no=?, amount=?, tax_amount=?, total_amount=?, tax_rate=?, remark=?, project_id=?, project_name=?, supplier_id=?, ocr_status=?, review_status=?, account_status=?, dup_status=?, source=?, print_rotation=?, ocr_confidence=?, confirmed_at=?, updated_at=? WHERE id=?`,
      [
        data.fileName ?? '', data.filePath ?? '', data.fileSize ?? '', data.pageCount ?? 0,
        data.invoiceType ?? '', data.invoiceNumber ?? '', data.invoiceDate ?? '',
        data.buyer ?? '', data.buyerTaxNo ?? '',
        data.seller ?? '', data.sellerTaxNo ?? '',
        data.amount ?? 0, data.taxAmount ?? 0, data.totalAmount ?? 0,
        data.taxRate ?? '', data.remark ?? '',
        data.projectId ?? null, data.projectName ?? '', data.supplierId ?? null,
        data.ocrStatus ?? 'pending', data.reviewStatus ?? 'unreviewed',
        data.accountStatus ?? 'none', data.dupStatus ?? 'normal',
        data.source ?? 'scan', data.printRotation ?? 0,
        data.ocrConfidence ?? null, data.confirmedAt ?? null,
        now, id,
      ],
    ))
    await load()
    return logId
  }

  async function updateField(id: string, field: keyof Invoice, value: unknown) {
    const inv = byId(id)
    if (!inv) return

    const updated = { ...inv, [field]: value }
    await update(id, updated)
  }

  async function confirmInvoice(id: string) {
    const now = new Date().toISOString()
    // withUpdateLog 兼做存在性检查(记录不存在/已删则跳过并返回 null),不再依赖内存 byId
    const logId = await withUpdateLog(db, 'invoices', id, () => execute(
      `UPDATE invoices SET review_status='reviewed', account_status='confirmed', confirmed_at=?, updated_at=? WHERE id=?`,
      [now, now, id],
    ))
    await load()
    return logId
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'invoices', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, documents, pendingReview, ledger, add, update, updateField, confirmInvoice, remove, restore, undo }
})
