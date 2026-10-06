import type { TransactionDb } from '~/lib/db/coordinator'
import type { FileRefDraft, FileRefRecord } from '~/lib/forms/file-refs'
import type { SupplierCredentialReviewProof } from '~/lib/supplier/credential-contract'
import type {
  SupplierCredentialCategory,
  SupplierCredentialRequirement,
} from '~/lib/supplier/credentials'
import type {
  SupplierContractSummary,
  SupplierInvoiceSummary,
  SupplierPaymentSummary,
  SupplierProjectRelation,
  SupplierProjectSummary,
  SupplierReadonlySummary,
} from '~/lib/supplier/detail'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { effectiveExpenditureSupplementAmountSql } from '~/lib/contract/effective-status'
import { select, withTransaction } from '~/lib/db/connection'
import { hiddenCtes, hiddenCtesFor, logCreate, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { approvalPaymentCap, readApprovalAmount } from '~/lib/finance/approval-amount'
import { applyFileRefChanges } from '~/lib/forms/file-refs'
import {
  taxpayerAuditSourceCategory,
  writeSupplierAudit,
} from '~/lib/supplier/audit'
import {
  canonicalCredentialCategory,
  defaultCredentialRequirement,
  hasManualCredentialReviewProof,
  resolveAutomaticCredentialStatus,
  storedSupplierCredentialStatus,
} from '~/lib/supplier/credentials'
import {
  buildSupplierProjectSummaries,
  buildSupplierReadonlySummary,
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
  fileRefId: string | null
  fileRef: FileRefRecord | null
  fileSize: number
  mimeType: string
  hasAccessibleFile: boolean
  validFrom: string
  expiresAt: string
  longTerm: boolean
  ocrResult: Record<string, unknown>
  ocrConfidence: number | null
  ocrConfirmedResult: Record<string, unknown>
  ocrConfirmedAt: string | null
  ocrReviewStatus: SupplierCredentialOcrReviewStatus
  verifiedAt: string | null
  addedAt: string
}

export type SupplierCredentialOcrReviewStatus = 'not_started' | 'pending' | 'confirmed'

export interface SupplierCredentialRequirementRecord {
  id: string
  supplierId: string
  category: SupplierCredentialCategory
  requirement: SupplierCredentialRequirement
  reason: string
  updatedAt: string
}

export interface AddSupplierCredentialInput {
  supplierId: string
  category: SupplierCredentialCategory | string
  file: FileRefDraft
  validFrom?: string
  expiresAt?: string
  longTerm?: boolean
}

export interface UpdateSupplierCredentialReviewInput {
  supplierId: string
  credentialId: string
  category: SupplierCredentialCategory | string
  confirmedFields: Record<string, unknown>
  validFrom?: string
  expiresAt?: string
  longTerm?: boolean
  supplierFields?: Partial<{
    name: string
    uniqueCode: string
    taxNo: string
    legalRep: string
    address: string
    bank: string
    bankAccount: string
  }>
}

export interface RecordSupplierCredentialOcrInput {
  supplierId: string
  credentialId: string
  rawOcrResult: Record<string, unknown>
  confidence: number | null
}

export interface UpdateSupplierCredentialValidityInput {
  supplierId: string
  credentialId: string
  validFrom?: string
  expiresAt?: string
  longTerm: boolean
}

export interface TaxpayerVerificationInput {
  supplierId: string
  status: 'not_checked' | 'confirmed_general' | 'not_found' | 'manually_confirmed'
  source?: string
  note?: string
  taxpayerType?: '未核验' | '一般纳税人' | '小规模纳税人'
}

export interface SupplierDetailSnapshot {
  credentials: readonly SupplierCredential[]
  requirements: readonly SupplierCredentialRequirementRecord[]
  projects: readonly SupplierProjectSummary[]
  contracts: readonly SupplierContractSummary[]
  payments: readonly SupplierPaymentSummary[]
  invoices: readonly SupplierInvoiceSummary[]
  summary: SupplierReadonlySummary
  reviewHistory: readonly SupplierCredentialReviewProof[]
}

const EMPTY_SUMMARY: SupplierReadonlySummary = {
  projectCount: 0,
  contractCount: 0,
  contractTotal: 0,
  settledTotal: 0,
  claimedTotal: 0,
  invoiceTotal: 0,
  invoiceTaxTotal: 0,
  paidTotal: 0,
  payableBalance: 0,
}

const EMPTY_SNAPSHOT: SupplierDetailSnapshot = {
  credentials: [],
  requirements: [],
  projects: [],
  contracts: [],
  payments: [],
  invoices: [],
  summary: EMPTY_SUMMARY,
  reviewHistory: [],
}

function rowToCredential(row: Record<string, unknown>): SupplierCredential {
  const fileRefId = (row.ref_id ?? null) as string | null
  const fileRef = fileRefId
    ? {
        id: fileRefId,
        ownerType: String(row.ref_owner_type ?? ''),
        ownerId: String(row.ref_owner_id ?? ''),
        fileName: String(row.ref_file_name ?? ''),
        filePath: String(row.ref_file_path ?? ''),
        fileSize: Number(row.ref_file_size) || 0,
        mimeType: String(row.ref_mime_type ?? ''),
        category: String(row.ref_category ?? ''),
        uploader: String(row.ref_uploader ?? ''),
        uploadedAt: String(row.ref_uploaded_at ?? ''),
        deletedAt: null,
      }
    : null
  const ocrResult = parseJsonColumn<Record<string, unknown>>(row.ocr_result, {})
  const ocrConfirmedAt = (row.ocr_confirmed_at ?? null) as string | null
  const persistedOcrStatus = String(row.ocr_review_status ?? '')
  const ocrReviewStatus: SupplierCredentialOcrReviewStatus
    = persistedOcrStatus === 'pending' || persistedOcrStatus === 'confirmed'
      ? persistedOcrStatus
      : ocrConfirmedAt
        ? 'confirmed'
        : Object.keys(ocrResult).length
          ? 'pending'
          : 'not_started'
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    category: canonicalCredentialCategory(String(row.category ?? '')),
    fileName: fileRef?.fileName ?? String(row.file_name ?? ''),
    filePath: fileRef?.filePath || String(row.file_path ?? ''),
    fileRefId,
    fileRef,
    fileSize: fileRef?.fileSize ?? 0,
    mimeType: fileRef?.mimeType ?? '',
    hasAccessibleFile: Number(row.has_accessible_file ?? 0) === 1,
    validFrom: (row.valid_from ?? '') as string,
    expiresAt: (row.expires_at ?? '') as string,
    longTerm: Number(row.long_term ?? 0) === 1,
    ocrResult,
    ocrConfidence: row.ocr_confidence == null ? null : Number(row.ocr_confidence),
    ocrConfirmedResult: parseJsonColumn<Record<string, unknown>>(row.ocr_confirmed_result, {}),
    ocrConfirmedAt,
    ocrReviewStatus,
    verifiedAt: (row.verified_at ?? null) as string | null,
    addedAt: (row.added_at ?? '') as string,
  }
}

function rowToRequirement(row: Record<string, unknown>): SupplierCredentialRequirementRecord {
  return {
    id: String(row.id),
    supplierId: String(row.supplier_id),
    category: canonicalCredentialCategory(String(row.category ?? '')),
    requirement: row.requirement as SupplierCredentialRequirement,
    reason: String(row.reason ?? ''),
    updatedAt: String(row.updated_at ?? ''),
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
    supplementAmount: Number(row.supplement_amount ?? 0),
    changed: Number(row.changed ?? 0),
    settled: Number(row.settled ?? 0),
    paid: Number(row.paid ?? 0),
    signDate: (row.sign_date ?? '') as string,
    status: (row.status ?? '') as string,
  }
}

function rowToPayment(row: Record<string, unknown>): SupplierPaymentSummary {
  const paidAmount = Number(row.derived_paid_amount ?? 0)
  const approvedAmount = row.approved_amount === null ? null : Number(row.approved_amount)
  const origin = row.approved_amount_origin === 'user-entry' ? 'user-entry' : 'legacy'
  const approval = readApprovalAmount(approvedAmount, origin)
  const cap = approvalPaymentCap(Number(row.apply_amount ?? 0), approvedAmount, origin)
  return {
    id: row.id as string,
    applicationNo: (row.no ?? '') as string,
    name: (row.name ?? '') as string,
    projectId: (row.project_id ?? '') as string,
    projectName: (row.project_name ?? '') as string,
    amount: Number(row.apply_amount ?? 0),
    approvedAmount: approval.amount,
    approvedAmountState: approval.state,
    paidAmount,
    actualPayment: paidAmount,
    approvalStatus: (row.status ?? '') as string,
    paymentStatus: cap === null
      ? '历史批复待核验'
      : paidAmount > cap
        ? '超额支付'
        : paidAmount <= 0
          ? '未付款'
          : paidAmount >= cap
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
    const [
      credentialRows,
      requirementRows,
      relationRows,
      contractRows,
      paymentRows,
      invoiceRows,
      reviewRows,
    ] = await Promise.all([
      select<Record<string, unknown>>(`
          ${hiddenCtes('supplier_credentials')}
          SELECT sc.*,
                 file.id AS ref_id,
                 file.owner_type AS ref_owner_type,
                 file.owner_id AS ref_owner_id,
                 file.file_name AS ref_file_name,
                 file.file_path AS ref_file_path,
                 file.file_size AS ref_file_size,
                 file.mime_type AS ref_mime_type,
                 file.category AS ref_category,
                 file.uploader AS ref_uploader,
                 file.uploaded_at AS ref_uploaded_at,
                 CASE
                   WHEN file.id IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM file_payloads AS payload
                       WHERE payload.file_ref_id = file.id
                     )
                   THEN 1
                   ELSE 0
                 END AS has_accessible_file
          FROM supplier_credentials sc
          LEFT JOIN file_refs AS file
            ON file.id = sc.file_ref_id
           AND file.owner_type = 'supplier_credential'
           AND file.owner_id = sc.id
           AND file.deleted_at IS NULL
          WHERE ${visibleCond('supplier_credentials', 'sc')} AND sc.supplier_id = ?
          ORDER BY sc.added_at DESC
        `, [supplierId]),
      select<Record<string, unknown>>(`
          ${hiddenCtes('supplier_credential_requirements')}
          SELECT requirement.*
          FROM supplier_credential_requirements AS requirement
          WHERE ${visibleCond('supplier_credential_requirements', 'requirement')}
            AND requirement.supplier_id = ?
          ORDER BY requirement.category
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
          ${hiddenCtesFor('contracts', 'contract_supplements')}
          SELECT c.*, p.name AS project_name,
                 ${effectiveExpenditureSupplementAmountSql('c')} AS supplement_amount
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
      select<Record<string, unknown>>(`SELECT id,decision,reviewed_at,note,actor_id,archived_at
        FROM supplier_credential_review_history WHERE supplier_id=?
        UNION ALL SELECT NULL,credential_status,credential_reviewed_at,credential_review_note,NULL,NULL
        FROM suppliers WHERE id=? AND credential_status IN ('qualified','rejected')
          AND credential_reviewed_at IS NOT NULL AND trim(credential_reviewed_at) <> ''
          AND (credential_status <> 'rejected' OR trim(credential_review_note) <> '')
          AND NOT EXISTS(SELECT 1 FROM supplier_credential_review_history history WHERE history.supplier_id=suppliers.id
            AND history.decision=suppliers.credential_status AND history.reviewed_at=suppliers.credential_reviewed_at AND history.note=suppliers.credential_review_note)
        ORDER BY reviewed_at,id`, [supplierId, supplierId]),
    ])

    const credentials = credentialRows.map(rowToCredential)
    const requirements = requirementRows.map(rowToRequirement)
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
        requirements,
        projects,
        contracts,
        payments,
        invoices,
        summary: buildSupplierReadonlySummary(projects, contracts, payments, invoices),
        reviewHistory: reviewRows.map(row => ({ decision: row.decision as 'qualified' | 'rejected', reviewedAt: String(row.reviewed_at), note: String(row.note), actorId: row.actor_id as string | null, ...(row.id === null ? {} : { historyIdentity: { id: String(row.id), legacyId: String(row.id), archivedAt: String(row.archived_at) } }) })),
      },
    }
  }

  async function requirementForCategory(
    tx: TransactionDb,
    supplierId: string,
    category: string,
  ): Promise<SupplierCredentialRequirement> {
    const canonical = canonicalCredentialCategory(category)
    const [row] = await tx.select<{ requirement: SupplierCredentialRequirement }>(
      `SELECT requirement
       FROM supplier_credential_requirements
       WHERE supplier_id = ? AND category = ? AND deleted_at IS NULL
       LIMIT 1`,
      [supplierId, canonical],
    )
    return row?.requirement ?? defaultCredentialRequirement(canonical)
  }

  async function syncCredentialStatusInTransaction(
    tx: TransactionDb,
    supplierId: string,
    options: { invalidateReview?: boolean } = {},
  ): Promise<{ changed: boolean, status: string }> {
    const [supplier] = await tx.select<{
      credential_status: string
      credential_reviewed_at: string | null
      credential_review_note: string
      deleted_at: string | null
    }>(
      `SELECT credential_status, credential_reviewed_at,
              credential_review_note, deleted_at
       FROM suppliers WHERE id = ?`,
      [supplierId],
    )
    if (!supplier || supplier.deleted_at != null)
      throw new Error('分供方不存在或已删除')

    const credentials = await tx.select<{
      category: string
      expires_at: string
      long_term: number
      has_accessible_file: number
    }>(
      `SELECT credential.category, credential.expires_at, credential.long_term,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM file_refs AS file
                  WHERE file.id = credential.file_ref_id
                    AND file.owner_type = 'supplier_credential'
                    AND file.owner_id = credential.id
                    AND file.deleted_at IS NULL
                    AND EXISTS (
                      SELECT 1 FROM file_payloads AS payload
                      WHERE payload.file_ref_id = file.id
                    )
                )
                THEN 1
                ELSE 0
              END AS has_accessible_file
       FROM supplier_credentials AS credential
       WHERE credential.supplier_id = ? AND credential.deleted_at IS NULL`,
      [supplierId],
    )
    const requirements = await tx.select<{
      category: SupplierCredentialCategory
      requirement: SupplierCredentialRequirement
      reason: string
    }>(
      `SELECT category, requirement, reason
       FROM supplier_credential_requirements
       WHERE supplier_id = ? AND deleted_at IS NULL`,
      [supplierId],
    )
    const automaticStatus = resolveAutomaticCredentialStatus(
      credentials.map(row => ({
        category: row.category,
        hasAccessibleFile: row.has_accessible_file === 1,
        expiresAt: row.expires_at,
        longTerm: row.long_term === 1,
      })),
      requirements,
    )
    const hasManualProof = hasManualCredentialReviewProof({
      status: supplier.credential_status,
      reviewedAt: supplier.credential_reviewed_at,
      reviewNote: supplier.credential_review_note,
    })
    const projection = storedSupplierCredentialStatus({ status: supplier.credential_status, reviewedAt: supplier.credential_reviewed_at, reviewNote: supplier.credential_review_note }, credentials.map(row => ({ category: row.category, hasAccessibleFile: row.has_accessible_file === 1, expiresAt: row.expires_at, longTerm: row.long_term === 1 })), requirements, new Date())
    // 可选资料等无关写动作不能因跨日而清旧凭证；门禁消费本次真实事实的只读投影。
    if (!options.invalidateReview && hasManualProof)
      return { changed: false, status: projection }
    const status = automaticStatus
    const reviewedAt = null
    const reviewNote = ''
    if (
      supplier.credential_status === status
      && supplier.credential_reviewed_at === reviewedAt
      && supplier.credential_review_note === reviewNote
    ) {
      return { changed: false, status }
    }

    await tx.execute(
      `UPDATE suppliers
       SET credential_status = ?, credential_reviewed_at = ?,
           credential_review_note = ?, updated_at = ?
       WHERE id = ?`,
      [status, reviewedAt, reviewNote, new Date().toISOString(), supplierId],
    )
    return { changed: true, status }
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

  async function loadReadonlySnapshot(supplierId: string) {
    setLoading(supplierId, true)
    try {
      await loadSnapshot(supplierId)
    }
    finally {
      setLoading(supplierId, false)
    }
  }

  async function insertCredential(tx: TransactionDb, input: AddSupplierCredentialInput) {
    const id = generateId('cred')
    const now = new Date().toISOString()
    const category = canonicalCredentialCategory(input.category)
    const fileName = input.file.fileName.trim()
    if (!fileName)
      throw new Error('证照文件名必填')
    if (!input.file.filePath?.trim() && !input.file.payloadBase64?.trim())
      throw new Error('证照必须包含可访问的原件')
    await tx.execute(
      `INSERT INTO supplier_credentials (
         id, supplier_id, category, file_name, file_path, file_ref_id,
         valid_from, expires_at, long_term, ocr_result, ocr_confidence,
         ocr_confirmed_result, ocr_confirmed_at, added_at
       )
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.supplierId,
        category,
        fileName,
        input.file.filePath?.trim() ?? '',
        input.validFrom?.trim() ?? '',
        input.expiresAt?.trim() ?? '',
        input.longTerm ? 1 : 0,
        '{}',
        null,
        '{}',
        null,
        now,
      ],
    )
    const [fileRefId] = await applyFileRefChanges(
      tx,
      'supplier_credential',
      id,
      { add: [{ ...input.file, category }] },
    )
    await tx.execute(
      'UPDATE supplier_credentials SET file_ref_id = ? WHERE id = ?',
      [fileRefId, id],
    )
    await writeCredentialAudit(tx, {
      supplierId: input.supplierId,
      credentialId: id,
      action: 'credential_create',
      categoryBefore: '',
      categoryAfter: category,
      changedFields: ['credential', 'file_ref'],
      validFromBefore: '',
      validFromAfter: input.validFrom?.trim() ?? '',
      expiresAtBefore: '',
      expiresAtAfter: input.expiresAt?.trim() ?? '',
      longTermBefore: false,
      longTermAfter: Boolean(input.longTerm),
      confidence: null,
      createdAt: now,
    })
    return { id, category }
  }

  async function writeCredentialAudit(
    tx: TransactionDb,
    input: {
      supplierId: string
      credentialId: string
      action:
        | 'credential_create'
        | 'ocr_recognition'
        | 'ocr_review'
        | 'validity_update'
        | 'credential_delete'
        | 'credential_restore'
      categoryBefore: string
      categoryAfter: string
      changedFields: readonly string[]
      validFromBefore: string
      validFromAfter: string
      expiresAtBefore: string
      expiresAtAfter: string
      longTermBefore: boolean
      longTermAfter: boolean
      confidence?: number | null
      createdAt: string
    },
  ) {
    const auditId = generateId('cred_audit')
    await tx.execute(
      `INSERT INTO supplier_credential_audits (
         id, supplier_id, credential_id, action,
         category_before, category_after, changed_fields,
         valid_from_before, valid_from_after,
         expires_at_before, expires_at_after,
         long_term_before, long_term_after, confidence, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        input.supplierId,
        input.credentialId,
        input.action,
        input.categoryBefore,
        input.categoryAfter,
        JSON.stringify(input.changedFields),
        input.validFromBefore,
        input.validFromAfter,
        input.expiresAtBefore,
        input.expiresAtAfter,
        input.longTermBefore ? 1 : 0,
        input.longTermAfter ? 1 : 0,
        input.confidence ?? null,
        input.createdAt,
      ],
    )
    return auditId
  }

  async function addCredential(input: AddSupplierCredentialInput) {
    const id = await withTransaction(async (tx) => {
      const inserted = await insertCredential(tx, input)
      const requirement = await requirementForCategory(tx, input.supplierId, inserted.category)
      await syncCredentialStatusInTransaction(tx, input.supplierId, {
        invalidateReview: requirement === 'required',
      })
      return inserted.id
    })
    await refreshCaches(input.supplierId)
    return id
  }

  async function addCredentials(input: {
    supplierId: string
    category: SupplierCredentialCategory | string
    files: FileRefDraft[]
  }) {
    if (!input.files.length)
      throw new Error('请选择至少一个证照文件')
    const ids = await withTransaction(async (tx) => {
      const inserted = []
      for (const file of input.files) {
        inserted.push(await insertCredential(tx, {
          supplierId: input.supplierId,
          category: input.category,
          file,
        }))
      }
      const requirement = await requirementForCategory(tx, input.supplierId, input.category)
      await syncCredentialStatusInTransaction(tx, input.supplierId, {
        invalidateReview: requirement === 'required',
      })
      return inserted.map(item => item.id)
    })
    await refreshCaches(input.supplierId)
    return ids
  }

  async function removeCredential(id: string, supplierId: string) {
    const auditId = await withTransaction(async (tx) => {
      const [credential] = await tx.select<{
        supplier_id: string
        category: string
        file_ref_id: string | null
        valid_from: string
        expires_at: string
        long_term: number
        deleted_at: string | null
      }>(
        `SELECT supplier_id, category, file_ref_id,
                valid_from, expires_at, long_term, deleted_at
         FROM supplier_credentials WHERE id = ?`,
        [id],
      )
      if (!credential || credential.deleted_at != null)
        return null
      if (credential.supplier_id !== supplierId)
        throw new Error('证照不属于当前分供方')

      const now = new Date().toISOString()
      await tx.execute(
        `UPDATE supplier_credentials SET deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [now, id],
      )
      if (credential.file_ref_id) {
        await tx.execute(
          `UPDATE file_refs SET deleted_at = ?
           WHERE id = ? AND owner_type = 'supplier_credential'
             AND owner_id = ? AND deleted_at IS NULL`,
          [now, credential.file_ref_id, id],
        )
      }
      const deletionAuditId = await writeCredentialAudit(tx, {
        supplierId,
        credentialId: id,
        action: 'credential_delete',
        categoryBefore: credential.category,
        categoryAfter: credential.category,
        changedFields: ['deleted_at'],
        validFromBefore: credential.valid_from,
        validFromAfter: credential.valid_from,
        expiresAtBefore: credential.expires_at,
        expiresAtAfter: credential.expires_at,
        longTermBefore: credential.long_term === 1,
        longTermAfter: credential.long_term === 1,
        createdAt: now,
      })
      const requirement = await requirementForCategory(tx, supplierId, credential.category)
      await syncCredentialStatusInTransaction(tx, supplierId, {
        invalidateReview: requirement === 'required',
      })
      return deletionAuditId
    })
    await refreshCaches(supplierId)
    return auditId
  }

  async function undoCredential(auditId: string, supplierId: string) {
    const restored = await withTransaction(async (tx) => {
      const [audit] = await tx.select<{
        supplier_id: string
        credential_id: string
        action: string
      }>(
        `SELECT supplier_id, credential_id, action
         FROM supplier_credential_audits WHERE id = ?`,
        [auditId],
      )
      if (!audit || audit.action !== 'credential_delete')
        return false
      if (audit.supplier_id !== supplierId)
        throw new Error('撤回记录不属于当前分供方')

      const [credential] = await tx.select<{
        category: string
        file_ref_id: string | null
        valid_from: string
        expires_at: string
        long_term: number
        deleted_at: string | null
      }>(
        `SELECT category, file_ref_id, valid_from, expires_at, long_term, deleted_at
         FROM supplier_credentials WHERE id = ? AND supplier_id = ?`,
        [audit.credential_id, supplierId],
      )
      if (!credential || credential.deleted_at == null)
        return false

      await tx.execute(
        'UPDATE supplier_credentials SET deleted_at = NULL WHERE id = ?',
        [audit.credential_id],
      )
      if (credential.file_ref_id) {
        await tx.execute(
          `UPDATE file_refs SET deleted_at = NULL
           WHERE id = ? AND owner_type = 'supplier_credential' AND owner_id = ?`,
          [credential.file_ref_id, audit.credential_id],
        )
      }
      const now = new Date().toISOString()
      await writeCredentialAudit(tx, {
        supplierId,
        credentialId: audit.credential_id,
        action: 'credential_restore',
        categoryBefore: credential.category,
        categoryAfter: credential.category,
        changedFields: ['deleted_at'],
        validFromBefore: credential.valid_from,
        validFromAfter: credential.valid_from,
        expiresAtBefore: credential.expires_at,
        expiresAtAfter: credential.expires_at,
        longTermBefore: credential.long_term === 1,
        longTermAfter: credential.long_term === 1,
        createdAt: now,
      })
      const requirement = await requirementForCategory(tx, supplierId, credential.category)
      await syncCredentialStatusInTransaction(tx, supplierId, {
        invalidateReview: requirement === 'required',
      })
      return true
    })
    if (!restored)
      return false
    await refreshCaches(supplierId)
    return true
  }

  async function updateCredentialReview(input: UpdateSupplierCredentialReviewInput) {
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const [existing] = await tx.select<{
        supplier_id: string
        category: string
        valid_from: string
        expires_at: string
        long_term: number
        ocr_review_status: string
        ocr_confidence: number | null
        deleted_at: string | null
      }>(
        `SELECT supplier_id, category, valid_from, expires_at, long_term,
                ocr_review_status, ocr_confidence, deleted_at
         FROM supplier_credentials WHERE id = ?`,
        [input.credentialId],
      )
      if (!existing || existing.deleted_at != null)
        throw new Error('证照不存在或已删除')
      if (existing.supplier_id !== input.supplierId)
        throw new Error('证照不属于当前分供方')
      if (existing.ocr_review_status !== 'pending')
        throw new Error('当前证照没有待核对的 OCR 结果')

      const category = canonicalCredentialCategory(input.category)
      const validFrom = input.validFrom?.trim() ?? ''
      const expiresAt = input.expiresAt?.trim() ?? ''
      const longTerm = Boolean(input.longTerm)
      await tx.execute(
        `UPDATE supplier_credentials
         SET category = ?, ocr_confirmed_result = ?, ocr_confirmed_at = ?,
             ocr_review_status = 'confirmed',
             valid_from = ?, expires_at = ?, long_term = ?
         WHERE id = ?`,
        [
          category,
          JSON.stringify(input.confirmedFields),
          now,
          validFrom,
          expiresAt,
          longTerm ? 1 : 0,
          input.credentialId,
        ],
      )
      const supplierFieldColumns = {
        name: 'name',
        uniqueCode: 'unique_code',
        taxNo: 'tax_no',
        legalRep: 'legal_rep',
        address: 'address',
        bank: 'bank',
        bankAccount: 'bank_account',
      } as const
      const supplierFieldEntries = Object.entries(input.supplierFields ?? {})
        .filter(([key, value]) =>
          Object.hasOwn(supplierFieldColumns, key)
          && typeof value === 'string',
        ) as Array<[keyof typeof supplierFieldColumns, string]>
      const [currentSupplier] = await tx.select<Record<string, unknown>>(
        `SELECT name, unique_code, tax_no, legal_rep, address, bank, bank_account
         FROM suppliers WHERE id = ? AND deleted_at IS NULL`,
        [input.supplierId],
      )
      if (!currentSupplier)
        throw new Error('分供方不存在或已删除')
      const qualificationValuesChanged
        = category !== existing.category
          || validFrom !== existing.valid_from
          || expiresAt !== existing.expires_at
          || longTerm !== (existing.long_term === 1)
          || supplierFieldEntries.some(([key, value]) =>
            String(currentSupplier[supplierFieldColumns[key]] ?? '').trim() !== value.trim(),
          )
      await writeCredentialAudit(tx, {
        supplierId: input.supplierId,
        credentialId: input.credentialId,
        action: 'ocr_review',
        categoryBefore: existing.category,
        categoryAfter: category,
        changedFields: [
          'category',
          'ocr_confirmed_result',
          'ocr_review_status',
          'validity',
          ...supplierFieldEntries.map(([key]) => `supplier.${key}`),
        ],
        validFromBefore: existing.valid_from,
        validFromAfter: validFrom,
        expiresAtBefore: existing.expires_at,
        expiresAtAfter: expiresAt,
        longTermBefore: existing.long_term === 1,
        longTermAfter: longTerm,
        confidence: existing.ocr_confidence,
        createdAt: now,
      })
      if (supplierFieldEntries.length) {
        await tx.execute(
          `UPDATE suppliers
           SET ${supplierFieldEntries.map(([key]) => `${supplierFieldColumns[key]} = ?`).join(', ')},
               updated_at = ?
           WHERE id = ?`,
          [
            ...supplierFieldEntries.map(([, value]) => value.trim()),
            now,
            input.supplierId,
          ],
        )
      }
      const [oldRequirement, newRequirement] = await Promise.all([
        requirementForCategory(tx, input.supplierId, existing.category),
        requirementForCategory(tx, input.supplierId, category),
      ])
      await syncCredentialStatusInTransaction(tx, input.supplierId, {
        invalidateReview: qualificationValuesChanged
          && (oldRequirement === 'required' || newRequirement === 'required'),
      })
    })
    await refreshCaches(input.supplierId)
  }

  async function recordCredentialOcrRecognition(input: RecordSupplierCredentialOcrInput) {
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const [existing] = await tx.select<{
        supplier_id: string
        category: string
        valid_from: string
        expires_at: string
        long_term: number
        deleted_at: string | null
      }>(
        `SELECT supplier_id, category, valid_from, expires_at, long_term, deleted_at
         FROM supplier_credentials WHERE id = ?`,
        [input.credentialId],
      )
      if (!existing || existing.deleted_at != null)
        throw new Error('证照不存在或已删除')
      if (existing.supplier_id !== input.supplierId)
        throw new Error('证照不属于当前分供方')

      await tx.execute(
        `UPDATE supplier_credentials
         SET ocr_result = ?, ocr_confidence = ?, ocr_review_status = 'pending'
         WHERE id = ?`,
        [
          JSON.stringify(input.rawOcrResult),
          input.confidence,
          input.credentialId,
        ],
      )
      await writeCredentialAudit(tx, {
        supplierId: input.supplierId,
        credentialId: input.credentialId,
        action: 'ocr_recognition',
        categoryBefore: existing.category,
        categoryAfter: existing.category,
        changedFields: ['ocr_result', 'ocr_confidence', 'ocr_review_status'],
        validFromBefore: existing.valid_from,
        validFromAfter: existing.valid_from,
        expiresAtBefore: existing.expires_at,
        expiresAtAfter: existing.expires_at,
        longTermBefore: existing.long_term === 1,
        longTermAfter: existing.long_term === 1,
        confidence: input.confidence,
        createdAt: now,
      })
    })
    await refreshCaches(input.supplierId)
  }

  async function updateCredentialValidity(input: UpdateSupplierCredentialValidityInput) {
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const [existing] = await tx.select<{
        supplier_id: string
        category: string
        valid_from: string
        expires_at: string
        long_term: number
        deleted_at: string | null
      }>(
        `SELECT supplier_id, category, valid_from, expires_at, long_term, deleted_at
         FROM supplier_credentials
         WHERE id = ?`,
        [input.credentialId],
      )
      if (!existing || existing.deleted_at != null)
        throw new Error('证照不存在或已删除')
      if (existing.supplier_id !== input.supplierId)
        throw new Error('证照不属于当前分供方')

      const validFrom = input.validFrom?.trim() ?? ''
      const expiresAt = input.expiresAt?.trim() ?? ''
      const validityChanged
        = validFrom !== existing.valid_from
          || expiresAt !== existing.expires_at
          || input.longTerm !== (existing.long_term === 1)
      await tx.execute(
        `UPDATE supplier_credentials
         SET valid_from = ?, expires_at = ?, long_term = ?
         WHERE id = ?`,
        [validFrom, expiresAt, input.longTerm ? 1 : 0, input.credentialId],
      )
      await writeCredentialAudit(tx, {
        supplierId: input.supplierId,
        credentialId: input.credentialId,
        action: 'validity_update',
        categoryBefore: existing.category,
        categoryAfter: existing.category,
        changedFields: ['validity'],
        validFromBefore: existing.valid_from,
        validFromAfter: validFrom,
        expiresAtBefore: existing.expires_at,
        expiresAtAfter: expiresAt,
        longTermBefore: existing.long_term === 1,
        longTermAfter: input.longTerm,
        createdAt: now,
      })
      const requirement = await requirementForCategory(
        tx,
        input.supplierId,
        existing.category,
      )
      await syncCredentialStatusInTransaction(tx, input.supplierId, {
        invalidateReview: validityChanged && requirement === 'required',
      })
    })
    await refreshCaches(input.supplierId)
  }

  async function updateCredentialRequirement(input: {
    supplierId: string
    category: SupplierCredentialCategory | string
    requirement: SupplierCredentialRequirement
    reason?: string
  }) {
    const category = canonicalCredentialCategory(input.category)
    if (
      defaultCredentialRequirement(category) === 'required'
      && input.requirement !== 'required'
    ) {
      throw new Error(`${category}是固定必需资料，不能设为可选或不适用`)
    }
    if (input.requirement === 'required' && !input.reason?.trim()
      && defaultCredentialRequirement(category) !== 'required') {
      throw new Error('把条件资料设为需提供时必须填写原因')
    }
    await withTransaction(async (tx) => {
      const [existing] = await tx.select<{
        id: string
        requirement: SupplierCredentialRequirement
      }>(
        `SELECT id, requirement
         FROM supplier_credential_requirements
         WHERE supplier_id = ? AND category = ? AND deleted_at IS NULL`,
        [input.supplierId, category],
      )
      const previous = existing?.requirement ?? defaultCredentialRequirement(category)
      if (existing) {
        await withUpdateLog(tx, 'supplier_credential_requirements', existing.id, () =>
          tx.execute(
            `UPDATE supplier_credential_requirements
             SET requirement = ?, reason = ?, updated_at = ?
             WHERE id = ?`,
            [input.requirement, input.reason?.trim() ?? '', new Date().toISOString(), existing.id],
          ))
      }
      else {
        const id = generateId('cred_req')
        await tx.execute(
          `INSERT INTO supplier_credential_requirements
           (id, supplier_id, category, requirement, reason, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.supplierId,
            category,
            input.requirement,
            input.reason?.trim() ?? '',
            new Date().toISOString(),
          ],
        )
        await logCreate(tx, 'supplier_credential_requirements', id)
      }
      await syncCredentialStatusInTransaction(tx, input.supplierId, {
        invalidateReview: previous !== input.requirement
          && (previous === 'required' || input.requirement === 'required'),
      })
    })
    await refreshCaches(input.supplierId)
  }

  async function reviewCredentials(input: {
    supplierId: string
    decision: 'qualified' | 'rejected'
    note?: string
  }) {
    const note = input.note?.trim() ?? ''
    if (input.decision === 'rejected' && !note)
      throw new Error('人工退回必须填写原因')
    await withTransaction(async (tx) => {
      const current = await syncCredentialStatusInTransaction(tx, input.supplierId)
      if (input.decision === 'qualified' && current.status !== 'reviewing')
        throw new Error('只有资料齐全待核验时才能人工通过')
      if (input.decision === 'rejected' && current.status !== 'reviewing')
        throw new Error('只有资料齐全待核验时才能人工退回')
      const now = new Date().toISOString()
      await tx.execute(
        `UPDATE suppliers
         SET credential_status = ?, credential_reviewed_at = ?,
             credential_review_note = ?, updated_at = ?
         WHERE id = ?`,
        [input.decision, now, note, now, input.supplierId],
      )
      await writeSupplierAudit(tx, {
        supplierId: input.supplierId,
        action: 'credential_review',
        outcome: input.decision,
        sourceCategory: 'manual',
        changedFields: [
          'credential_status',
          'credential_reviewed_at',
          'credential_review_note',
        ],
        notePresent: Boolean(note),
        createdAt: now,
      })
    })
    await refreshCaches(input.supplierId)
  }

  async function recordTaxpayerVerification(input: TaxpayerVerificationInput) {
    if (input.status === 'confirmed_general' && input.taxpayerType === '小规模纳税人')
      throw new Error('一般纳税人核验结果不能保存为小规模纳税人')
    const taxpayerType = input.status === 'confirmed_general'
      ? '一般纳税人'
      : input.status === 'not_found'
        ? '未核验'
        : input.taxpayerType ?? '未核验'
    const now = new Date().toISOString()
    const verifiedAt = input.status === 'not_checked' ? null : now
    const source = input.source?.trim() ?? ''
    const note = input.note?.trim() ?? ''
    await withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE suppliers
         SET taxpayer_type = ?, taxpayer_verification_status = ?,
             taxpayer_verification_source = ?, taxpayer_verified_at = ?,
             taxpayer_verification_note = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          taxpayerType,
          input.status,
          source,
          verifiedAt,
          note,
          now,
          input.supplierId,
        ],
      )
      await writeSupplierAudit(tx, {
        supplierId: input.supplierId,
        action: 'taxpayer_verification',
        outcome: input.status,
        sourceCategory: taxpayerAuditSourceCategory(input.status, source),
        changedFields: [
          'taxpayer_type',
          'taxpayer_verification_status',
          'taxpayer_verification_source',
          'taxpayer_verified_at',
          'taxpayer_verification_note',
        ],
        notePresent: Boolean(note),
        createdAt: now,
      })
    })
    await refreshCaches(input.supplierId)
    return {
      status: input.status,
      taxpayerType,
      source,
      verifiedAt,
      note,
    }
  }

  return {
    bySupplier,
    hasSnapshot,
    isLoading,
    load,
    loadReadonlySnapshot,
    addCredential,
    addCredentials,
    recordCredentialOcrRecognition,
    updateCredentialReview,
    updateCredentialValidity,
    updateCredentialRequirement,
    reviewCredentials,
    recordTaxpayerVerification,
    removeCredential,
    undoCredential,
  }
})
