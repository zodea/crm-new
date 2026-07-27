import type { TransactionDb } from '~/lib/db/coordinator'
import type {
  SupplierContractSummary,
  SupplierCredentialCategory,
  SupplierInvoiceSummary,
  SupplierPaymentSummary,
  SupplierProjectRelation,
  SupplierProjectSummary,
  SupplierReadonlySummary,
} from '~/lib/supplier/detail'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { select, withTransaction } from '~/lib/db/connection'
import { hiddenCtes, hiddenCtesFor, logCreate, softDelete, undoOperation, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import {
  buildSupplierProjectSummaries,
  buildSupplierReadonlySummary,
  resolveCredentialStatus,
} from '~/lib/supplier/detail'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { parseJsonColumn } from '~/lib/util/json'
import { useSupplierStore } from '~/stores/supplier'

export interface SupplierCredential {
  id: string
  supplierId: string
  category: SupplierCredentialCategory
  fileName: string
  filePath: string
  ocrResult: Record<string, unknown>
  ocrConfidence: number | null
  verifiedAt: string | null
  addedAt: string
}

export interface SupplierDetailSnapshot {
  credentials: readonly SupplierCredential[]
  projects: readonly SupplierProjectSummary[]
  contracts: readonly SupplierContractSummary[]
  payments: readonly SupplierPaymentSummary[]
  invoices: readonly SupplierInvoiceSummary[]
  summary: SupplierReadonlySummary
}

const EMPTY_SUMMARY: SupplierReadonlySummary = {
  projectCount: 0,
  contractCount: 0,
  contractTotal: 0,
  claimedTotal: 0,
  invoiceTotal: 0,
  invoiceTaxTotal: 0,
  paidTotal: 0,
  payableBalance: 0,
}

const EMPTY_SNAPSHOT: SupplierDetailSnapshot = {
  credentials: [],
  projects: [],
  contracts: [],
  payments: [],
  invoices: [],
  summary: EMPTY_SUMMARY,
}

function rowToCredential(row: Record<string, unknown>): SupplierCredential {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    category: row.category as SupplierCredentialCategory,
    fileName: (row.file_name ?? '') as string,
    filePath: (row.file_path ?? '') as string,
    ocrResult: parseJsonColumn<Record<string, unknown>>(row.ocr_result, {}),
    ocrConfidence: row.ocr_confidence == null ? null : Number(row.ocr_confidence),
    verifiedAt: (row.verified_at ?? null) as string | null,
    addedAt: (row.added_at ?? '') as string,
  }
}

function rowToContract(row: Record<string, unknown>): SupplierContractSummary {
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    kind: (row.kind ?? '') as string,
    projectId: (row.project_id ?? '') as string,
    projectName: (row.project_name ?? '') as string,
    amount: Number(row.amount ?? 0),
    changed: Number(row.changed ?? 0),
    settled: Number(row.settled ?? 0),
    paid: Number(row.paid ?? 0),
    signDate: (row.sign_date ?? '') as string,
    status: (row.status ?? '') as string,
  }
}

function rowToPayment(row: Record<string, unknown>): SupplierPaymentSummary {
  const paidAmount = Number(row.derived_paid_amount ?? 0)
  return {
    id: row.id as string,
    applicationNo: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? '') as string,
    projectName: (row.project_name ?? '') as string,
    amount: Number(row.apply_amount ?? 0),
    approvedAmount: Number(row.approved_amount ?? 0),
    paidAmount,
    actualPayment: paidAmount,
    approvalStatus: (row.status ?? '') as string,
    paymentStatus: paidAmount <= 0
      ? '未付款'
      : paidAmount >= Number(row.apply_amount ?? 0)
        ? '已付款'
        : '部分付款',
    createdAt: (row.created_at ?? '') as string,
  }
}

function rowToInvoice(row: Record<string, unknown>): SupplierInvoiceSummary {
  return {
    id: row.id as string,
    invoiceNumber: (row.invoice_number ?? '') as string,
    invoiceType: (row.invoice_type ?? '') as string,
    invoiceDate: (row.invoice_date ?? '') as string,
    projectId: (row.project_id ?? null) as string | null,
    projectName: (row.project_name ?? '') as string,
    totalAmount: Number(row.total_amount ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
  }
}

export const useSupplierDetailStore = defineStore('supplier-detail', () => {
  const snapshots = shallowRef<Record<string, SupplierDetailSnapshot>>({})
  const loadingIds = shallowRef(new Set<string>())
  const inFlightLoads = new Map<string, Promise<void>>()

  function bySupplier(supplierId: string): SupplierDetailSnapshot {
    return snapshots.value[supplierId] ?? EMPTY_SNAPSHOT
  }

  function hasSnapshot(supplierId: string): boolean {
    return Object.hasOwn(snapshots.value, supplierId)
  }

  function isLoading(supplierId: string): boolean {
    return loadingIds.value.has(supplierId)
  }

  function setLoading(supplierId: string, loading: boolean) {
    const next = new Set(loadingIds.value)
    if (loading)
      next.add(supplierId)
    else
      next.delete(supplierId)
    loadingIds.value = next
  }

  async function loadSnapshot(supplierId: string) {
    const [credentialRows, relationRows, contractRows, paymentRows, invoiceRows] = await Promise.all([
      select<Record<string, unknown>>(`
          ${hiddenCtes('supplier_credentials')}
          SELECT sc.* FROM supplier_credentials sc
          WHERE ${visibleCond('supplier_credentials', 'sc')} AND sc.supplier_id = ?
          ORDER BY sc.added_at DESC
        `, [supplierId]),
      select<Record<string, unknown>>(`
          ${hiddenCtes('project_suppliers')}
          SELECT ps.*, p.name AS project_name, p.status AS project_status
          FROM project_suppliers ps
          LEFT JOIN projects p ON p.id = ps.project_id
          WHERE ${visibleCond('project_suppliers', 'ps')} AND ps.supplier_id = ?
          ORDER BY p.name
        `, [supplierId]),
      select<Record<string, unknown>>(`
          ${hiddenCtes('contracts')}
          SELECT c.*, p.name AS project_name
          FROM contracts c
          LEFT JOIN projects p ON p.id = c.project_id
          WHERE ${visibleCond('contracts', 'c')} AND c.supplier_id = ?
          ORDER BY c.sign_date DESC, c.created_at DESC
        `, [supplierId]),
      select<Record<string, unknown>>(`
          ${hiddenCtesFor(
            'payment_applications',
            'payment_record_application_allocations',
            'payment_records',
          )}
          SELECT pa.*, p.name AS project_name,
                 COALESCE((
                   SELECT SUM(allocation.allocated_amount)
                   FROM payment_record_application_allocations AS allocation
                   JOIN payment_records AS payment
                     ON payment.id = allocation.payment_record_id
                   WHERE allocation.payment_application_id = pa.id
                     AND ${visibleCond('payment_record_application_allocations', 'allocation')}
                     AND ${visibleCond('payment_records', 'payment')}
                     AND payment.confirmation_status = 'confirmed'
                 ), 0) AS derived_paid_amount
          FROM payment_applications pa
          LEFT JOIN projects p ON p.id = pa.project_id
          WHERE ${visibleCond('payment_applications', 'pa')} AND pa.supplier_id = ?
          ORDER BY pa.created_at DESC
        `, [supplierId]),
      select<Record<string, unknown>>(`
          ${hiddenCtes('invoices')}
          SELECT i.*, p.name AS project_name
          FROM invoices i
          LEFT JOIN projects p ON p.id = i.project_id
          WHERE ${visibleCond('invoices', 'i')}
            AND i.supplier_id = ? AND i.account_status = 'archived'
          ORDER BY i.invoice_date DESC, i.created_at DESC
        `, [supplierId]),
    ])

    const credentials = credentialRows.map(rowToCredential)
    const relations: SupplierProjectRelation[] = relationRows.map(row => ({
      id: row.id as string,
      projectId: row.project_id as string,
      projectName: (row.project_name ?? '') as string,
      projectStatus: (row.project_status ?? '') as string,
      relationshipStatus: (row.status ?? 'collecting') as string,
    }))
    const contracts = contractRows.map(rowToContract)
    const payments = paymentRows.map(rowToPayment)
    const invoices = invoiceRows.map(rowToInvoice)
    const projects = buildSupplierProjectSummaries(relations, contracts, payments)
    snapshots.value = {
      ...snapshots.value,
      [supplierId]: {
        credentials,
        projects,
        contracts,
        payments,
        invoices,
        summary: buildSupplierReadonlySummary(projects, contracts, payments, invoices),
      },
    }
  }

  async function syncCredentialStatusInTransaction(tx: TransactionDb, supplierId: string): Promise<boolean> {
    const [supplier] = await tx.select<{ credential_status: string, deleted_at: string | null }>(
      'SELECT credential_status, deleted_at FROM suppliers WHERE id = ?',
      [supplierId],
    )
    if (!supplier || supplier.deleted_at != null)
      throw new Error('分供方不存在或已删除')

    const rows = await tx.select<{ category: string }>(
      'SELECT category FROM supplier_credentials WHERE supplier_id = ? AND deleted_at IS NULL',
      [supplierId],
    )
    const status = resolveCredentialStatus(rows.map(row => row.category))
    if (supplier.credential_status === status)
      return false

    const logId = await withUpdateLog(tx, 'suppliers', supplierId, () => tx.execute(
      'UPDATE suppliers SET credential_status = ?, updated_at = ? WHERE id = ?',
      [status, new Date().toISOString(), supplierId],
    ))
    if (!logId)
      throw new Error('资料状态更新失败')
    return true
  }

  async function refreshCaches(supplierId: string) {
    const results = await Promise.allSettled([
      loadSnapshot(supplierId),
      useSupplierStore().load(),
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      throw new Error(`数据已保存，但界面刷新失败，请刷新后继续：${toErrorMessage(failure.reason)}`)
    }
  }

  async function load(supplierId: string) {
    const inFlight = inFlightLoads.get(supplierId)
    if (inFlight)
      return inFlight

    const task = (async () => {
      setLoading(supplierId, true)
      try {
        await loadSnapshot(supplierId)
        const statusChanged = await withTransaction(tx => syncCredentialStatusInTransaction(tx, supplierId))
        if (statusChanged)
          await useSupplierStore().load()
      }
      finally {
        setLoading(supplierId, false)
      }
    })()
    inFlightLoads.set(supplierId, task)

    try {
      await task
    }
    finally {
      if (inFlightLoads.get(supplierId) === task)
        inFlightLoads.delete(supplierId)
    }
  }

  async function addCredential(input: {
    supplierId: string
    category: SupplierCredentialCategory
    fileName: string
    filePath?: string
  }) {
    const id = generateId('cred')
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO supplier_credentials
         (id, supplier_id, category, file_name, file_path, ocr_result, added_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?)`,
        [id, input.supplierId, input.category, input.fileName.trim(), input.filePath ?? '', now],
      )
      if (!await logCreate(tx, 'supplier_credentials', id))
        throw new Error('证照新增日志写入失败')
      await syncCredentialStatusInTransaction(tx, input.supplierId)
    })
    await refreshCaches(input.supplierId)
    return id
  }

  async function removeCredential(id: string, supplierId: string) {
    const logId = await withTransaction(async (tx) => {
      const [credential] = await tx.select<{ supplier_id: string, deleted_at: string | null }>(
        'SELECT supplier_id, deleted_at FROM supplier_credentials WHERE id = ?',
        [id],
      )
      if (!credential || credential.deleted_at != null)
        return null
      if (credential.supplier_id !== supplierId)
        throw new Error('证照不属于当前分供方')

      const operationLogId = await softDelete(tx, 'supplier_credentials', id)
      if (operationLogId)
        await syncCredentialStatusInTransaction(tx, supplierId)
      return operationLogId
    })
    await refreshCaches(supplierId)
    return logId
  }

  async function undoCredential(logId: string, supplierId: string) {
    const restored = await withTransaction(async (tx) => {
      const [log] = await tx.select<{
        table_name: string
        action: string
        before_data: string | null
      }>('SELECT table_name, action, before_data FROM operation_logs WHERE id = ?', [logId])
      const before = parseJsonColumn<Record<string, unknown>>(log?.before_data, {})
      if (!log || log.table_name !== 'supplier_credentials' || log.action !== 'delete')
        return false
      if (before.supplier_id !== supplierId)
        throw new Error('撤回记录不属于当前分供方')

      const didRestore = await undoOperation(tx, logId)
      if (didRestore)
        await syncCredentialStatusInTransaction(tx, supplierId)
      return didRestore
    })
    if (!restored)
      return false
    await refreshCaches(supplierId)
    return true
  }

  return { bySupplier, hasSnapshot, isLoading, load, addCredential, removeCredential, undoCredential }
})
