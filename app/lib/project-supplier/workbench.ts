import type { SoftDb } from '~/lib/db/soft-delete'
import type { FileRefDraft } from '~/lib/forms/file-refs'
import { withTransaction } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  logCreate,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { applyFileRefChanges } from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'

export const PROJECT_SUPPLIER_WORKBENCH_TABS = [
  'overview',
  'contract',
  'claim',
  'ticket',
  'payment',
  'settlement',
] as const
export type ProjectSupplierWorkbenchTab = (typeof PROJECT_SUPPLIER_WORKBENCH_TABS)[number]

export function projectSupplierWorkbenchTab(
  value: unknown,
): ProjectSupplierWorkbenchTab | null {
  return typeof value === 'string'
    && PROJECT_SUPPLIER_WORKBENCH_TABS.includes(value as ProjectSupplierWorkbenchTab)
    ? value as ProjectSupplierWorkbenchTab
    : null
}

export interface ProjectSupplierContractFact {
  id: string
  no: string
  name: string
  kind: string
  status: string
  amount: number
  changedAmount: number
  signDate: string
  attachmentCount: number
  sourcePath: string
}

export interface ProjectSupplierClaimFact {
  id: string
  no: string
  name: string
  status: string
  applyAmount: number
  approvedAmount: number
  applyDate: string
  invoiceState: string
  attachmentCount: number
  sourcePath: string
}

export interface ProjectSupplierInvoiceFact {
  id: string
  invoiceNumber: string
  invoiceDate: string
  invoiceType: string
  totalAmount: number
  taxAmount: number
  accountStatus: string
  fileName: string
  sourcePath: string
}

export interface ProjectSupplierPaymentFact {
  id: string
  no: string
  paymentDate: string
  amount: number
  paymentMethod: string
  voucherNo: string
  status: string
  applicationNos: string
  attachmentCount: number
  sourcePath: string
}

export interface ProjectSupplierSettlementFact {
  id: string
  no: string
  name: string
  settlementType: string
  settlementDate: string
  amount: number
  status: string
  attachmentCount: number
  sourcePath: string
}

export interface ProjectSupplierFileFact {
  id: string
  ownerType: string
  ownerId: string
  sourceLabel: string
  sourcePath: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  deletedAt: null
}

export interface ProjectSupplierWorkbenchSummary {
  contractTotal: number
  claimedTotal: number
  invoiceTotal: number
  taxTotal: number
  paidTotal: number
  settlementTotal: number
  balance: number
}

export interface ProjectSupplierWorkbenchFacts {
  contracts: ProjectSupplierContractFact[]
  claims: ProjectSupplierClaimFact[]
  invoices: ProjectSupplierInvoiceFact[]
  payments: ProjectSupplierPaymentFact[]
  settlements: ProjectSupplierSettlementFact[]
  files: ProjectSupplierFileFact[]
  relationSettlement: {
    id: string
    date: string
    finalAmount: number
    pdfFile: string
    pdfFileName: string
    note: string
  } | null
  summary: ProjectSupplierWorkbenchSummary
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function sum<T>(rows: T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0)
}

function settlementPath(row: Record<string, unknown>): string {
  const bizType = text(row.biz_type)
  if (['材料', '材采'].includes(bizType))
    return `/material/settlement/form/${text(row.id)}`
  if (['分包', '专业分包', '合同劳务'].includes(bizType))
    return `/subcontract/settlement/${text(row.id)}`
  return `/contract/other-settlement/form/${text(row.id)}`
}

const FILE_SOURCE: Record<string, { label: string, path: (id: string) => string }> = {
  contract: { label: '合同', path: id => `/contract/${id}` },
  payment_application: { label: '付款申请', path: id => `/finance/payment/${id}` },
  payment_record: { label: '支付记录', path: id => `/finance/records/${id}` },
  expenditure_settlement: { label: '支出结算', path: id => `/contract/other-settlement/form/${id}` },
  settlement: { label: '最终结算', path: () => '' },
  project_supplier: { label: '合作档案', path: () => '' },
}

export async function loadProjectSupplierWorkbench(
  db: SoftDb,
  projectId: string,
  supplierId: string,
  projectSupplierId: string,
): Promise<ProjectSupplierWorkbenchFacts> {
  const [
    contractRows,
    claimRows,
    invoiceRows,
    paymentRows,
    settlementRows,
    relationSettlementRows,
  ] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('contracts', 'contract_supplements', 'file_refs')}
      SELECT contract.*,
             COALESCE((
               SELECT SUM(supplement.amount)
               FROM contract_supplements AS supplement
               WHERE supplement.contract_id = contract.id
                 AND ${visibleCond('contract_supplements', 'supplement')}
                 AND supplement.status NOT IN ('draft', '草稿')
             ), 0) AS supplement_amount,
             COALESCE((
               SELECT COUNT(*)
               FROM file_refs AS file
               WHERE file.owner_type = 'contract'
                 AND file.owner_id = contract.id
                 AND ${visibleCond('file_refs', 'file')}
             ), 0) AS attachment_count
      FROM contracts AS contract
      WHERE ${visibleCond('contracts', 'contract')}
        AND contract.project_id = ?
        AND contract.supplier_id = ?
        AND contract.kind <> '施工'
      ORDER BY contract.sign_date DESC, contract.created_at DESC, contract.id
    `, [projectId, supplierId]),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('payment_applications', 'file_refs')}
      SELECT application.*,
             COALESCE((
               SELECT COUNT(*)
               FROM file_refs AS file
               WHERE file.owner_type = 'payment_application'
                 AND file.owner_id = application.id
                 AND ${visibleCond('file_refs', 'file')}
             ), 0) AS attachment_count
      FROM payment_applications AS application
      WHERE ${visibleCond('payment_applications', 'application')}
        AND application.project_id = ?
        AND application.supplier_id = ?
      ORDER BY application.apply_date DESC, application.created_at DESC, application.id
    `, [projectId, supplierId]),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('invoices')}
      SELECT invoice.*
      FROM invoices AS invoice
      WHERE ${visibleCond('invoices', 'invoice')}
        AND invoice.project_id = ?
        AND invoice.supplier_id = ?
      ORDER BY invoice.invoice_date DESC, invoice.created_at DESC, invoice.id
    `, [projectId, supplierId]),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor(
        'payment_records',
        'payment_record_application_allocations',
        'payment_applications',
        'file_refs',
      )}
      SELECT payment.*,
             SUM(allocation.allocated_amount) AS supplier_allocated_amount,
             GROUP_CONCAT(application.no, '、') AS application_nos,
             COALESCE((
               SELECT COUNT(*)
               FROM file_refs AS file
               WHERE file.owner_type = 'payment_record'
                 AND file.owner_id = payment.id
                 AND ${visibleCond('file_refs', 'file')}
             ), 0) AS attachment_count
      FROM payment_records AS payment
      JOIN payment_record_application_allocations AS allocation
        ON allocation.payment_record_id = payment.id
       AND ${visibleCond('payment_record_application_allocations', 'allocation')}
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
       AND ${visibleCond('payment_applications', 'application')}
      WHERE ${visibleCond('payment_records', 'payment')}
        AND payment.confirmation_status = 'confirmed'
        AND application.project_id = ?
        AND application.supplier_id = ?
      GROUP BY payment.id
      ORDER BY payment.payment_date DESC, payment.created_at DESC, payment.id
    `, [projectId, supplierId]),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('expenditure_settlements', 'file_refs')}
      SELECT settlement.*,
             COALESCE((
               SELECT COUNT(*)
               FROM file_refs AS file
               WHERE file.owner_type = 'expenditure_settlement'
                 AND file.owner_id = settlement.id
                 AND ${visibleCond('file_refs', 'file')}
             ), 0) AS attachment_count
      FROM expenditure_settlements AS settlement
      WHERE ${visibleCond('expenditure_settlements', 'settlement')}
        AND settlement.project_id = ?
        AND settlement.supplier_id = ?
      ORDER BY settlement.settlement_date DESC, settlement.created_at DESC, settlement.id
    `, [projectId, supplierId]),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('settlements', 'file_refs')}
      SELECT settlement.*, COALESCE(file.file_name, '') AS pdf_file_name
      FROM settlements AS settlement
      LEFT JOIN file_refs AS file
        ON file.id = settlement.pdf_file
       AND file.owner_type = 'settlement'
       AND file.owner_id = settlement.id
       AND ${visibleCond('file_refs', 'file')}
      WHERE settlement.project_supplier_id = ?
        AND ${visibleCond('settlements', 'settlement')}
      ORDER BY settlement.created_at DESC
      LIMIT 1
    `, [projectSupplierId]),
  ])

  const contracts = contractRows.map<ProjectSupplierContractFact>(row => ({
    id: text(row.id),
    no: text(row.no),
    name: text(row.name),
    kind: text(row.kind),
    status: text(row.status),
    amount: number(row.amount),
    changedAmount: number(row.amount) + number(row.supplement_amount),
    signDate: text(row.sign_date),
    attachmentCount: number(row.attachment_count),
    sourcePath: `/contract/${text(row.id)}`,
  }))
  const claims = claimRows.map<ProjectSupplierClaimFact>(row => ({
    id: text(row.id),
    no: text(row.no),
    name: text(row.name),
    status: text(row.status),
    applyAmount: number(row.apply_amount),
    approvedAmount: number(row.approved_amount),
    applyDate: text(row.apply_date),
    invoiceState: text(row.invoice_state),
    attachmentCount: number(row.attachment_count),
    sourcePath: `/finance/payment/${text(row.id)}`,
  }))
  const invoices = invoiceRows.map<ProjectSupplierInvoiceFact>(row => ({
    id: text(row.id),
    invoiceNumber: text(row.invoice_number),
    invoiceDate: text(row.invoice_date),
    invoiceType: text(row.invoice_type),
    totalAmount: number(row.total_amount),
    taxAmount: number(row.tax_amount),
    accountStatus: text(row.account_status),
    fileName: text(row.file_name),
    sourcePath: `/finance/invoice/${text(row.id)}`,
  }))
  const payments = paymentRows.map<ProjectSupplierPaymentFact>(row => ({
    id: text(row.id),
    no: text(row.no),
    paymentDate: text(row.payment_date),
    amount: number(row.supplier_allocated_amount),
    paymentMethod: text(row.payment_method),
    voucherNo: text(row.voucher_no),
    status: text(row.confirmation_status),
    applicationNos: text(row.application_nos),
    attachmentCount: number(row.attachment_count),
    sourcePath: `/finance/records/${text(row.id)}`,
  }))
  const settlements = settlementRows.map<ProjectSupplierSettlementFact>(row => ({
    id: text(row.id),
    no: text(row.no),
    name: text(row.name),
    settlementType: text(row.settlement_type),
    settlementDate: text(row.settlement_date),
    amount: number(row.total_amount),
    status: text(row.status),
    attachmentCount: number(row.attachment_count),
    sourcePath: settlementPath(row),
  }))
  const relationSettlementRow = relationSettlementRows[0]
  const relationSettlement = relationSettlementRow
    ? {
        id: text(relationSettlementRow.id),
        date: text(relationSettlementRow.date),
        finalAmount: number(relationSettlementRow.final_amount),
        pdfFile: text(relationSettlementRow.pdf_file),
        pdfFileName: text(relationSettlementRow.pdf_file_name),
        note: text(relationSettlementRow.note),
      }
    : null

  const owners = new Map<string, { label: string, path: string }>()
  owners.set(`project_supplier:${projectSupplierId}`, { label: '合作档案', path: '' })
  for (const row of contracts)
    owners.set(`contract:${row.id}`, { label: `合同 · ${row.no || row.name}`, path: row.sourcePath })
  for (const row of claims)
    owners.set(`payment_application:${row.id}`, { label: `付款申请 · ${row.no || row.name}`, path: row.sourcePath })
  for (const row of payments)
    owners.set(`payment_record:${row.id}`, { label: `支付记录 · ${row.no || row.voucherNo}`, path: row.sourcePath })
  for (const row of settlements)
    owners.set(`expenditure_settlement:${row.id}`, { label: `支出结算 · ${row.no || row.name}`, path: row.sourcePath })
  if (relationSettlement)
    owners.set(`settlement:${relationSettlement.id}`, { label: '最终结算确认书', path: '' })

  const ownerTypes = [...new Set([...owners.keys()].map(key => key.split(':')[0]))]
  const ownerIds = [...new Set([...owners.keys()].map(key => key.slice(key.indexOf(':') + 1)))]
  let files: ProjectSupplierFileFact[] = []
  if (ownerTypes.length && ownerIds.length) {
    const typeSlots = ownerTypes.map(() => '?').join(', ')
    const idSlots = ownerIds.map(() => '?').join(', ')
    const rows = await db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('file_refs')}
      SELECT file.*
      FROM file_refs AS file
      WHERE ${visibleCond('file_refs', 'file')}
        AND file.owner_type IN (${typeSlots})
        AND file.owner_id IN (${idSlots})
      ORDER BY file.uploaded_at DESC, file.id DESC
    `, [...ownerTypes, ...ownerIds])
    files = rows
      .filter(row => owners.has(`${text(row.owner_type)}:${text(row.owner_id)}`))
      .map((row) => {
        const ownerType = text(row.owner_type)
        const ownerId = text(row.owner_id)
        const owner = owners.get(`${ownerType}:${ownerId}`)
        const fallback = FILE_SOURCE[ownerType]
        return {
          id: text(row.id),
          ownerType,
          ownerId,
          sourceLabel: owner?.label ?? fallback?.label ?? '业务附件',
          sourcePath: owner?.path ?? fallback?.path(ownerId) ?? '',
          fileName: text(row.file_name),
          filePath: text(row.file_path),
          fileSize: number(row.file_size),
          mimeType: text(row.mime_type),
          category: text(row.category),
          uploader: text(row.uploader),
          uploadedAt: text(row.uploaded_at),
          deletedAt: null,
        }
      })
  }

  const invoiceOriginalFiles = invoices
    .filter(row => row.fileName)
    .map<ProjectSupplierFileFact>(row => ({
      id: row.id,
      ownerType: 'invoice',
      ownerId: row.id,
      sourceLabel: `发票原件 · ${row.invoiceNumber || row.fileName}`,
      sourcePath: row.sourcePath,
      fileName: row.fileName,
      filePath: text(invoiceRows.find(item => text(item.id) === row.id)?.file_path),
      fileSize: number(invoiceRows.find(item => text(item.id) === row.id)?.file_size),
      mimeType: 'application/pdf',
      category: '收票原件',
      uploader: '',
      uploadedAt: text(invoiceRows.find(item => text(item.id) === row.id)?.created_at),
      deletedAt: null,
    }))
  files = [...files, ...invoiceOriginalFiles]

  const formalContracts = contracts.filter(row => !['draft', '草稿'].includes(row.status))
  const approvedClaims = claims.filter(row =>
    ['approved', '已审批', '已批复'].includes(row.status),
  )
  const archivedInvoices = invoices.filter(row => row.accountStatus === 'archived')
  const confirmedPayments = payments.filter(row => row.status === 'confirmed')
  const confirmedSettlements = settlements.filter(row =>
    ['confirmed', 'approved', '已确认', '已审批'].includes(row.status),
  )
  const contractTotal = sum(formalContracts, row => row.changedAmount)
  const paidTotal = sum(confirmedPayments, row => row.amount)

  return {
    contracts,
    claims,
    invoices,
    payments,
    settlements,
    files,
    relationSettlement,
    summary: {
      contractTotal,
      claimedTotal: sum(approvedClaims, row => row.approvedAmount),
      invoiceTotal: sum(archivedInvoices, row => row.totalAmount),
      taxTotal: sum(archivedInvoices, row => row.taxAmount),
      paidTotal,
      settlementTotal: sum(confirmedSettlements, row => row.amount),
      balance: contractTotal - paidTotal,
    },
  }
}

export interface ConfirmProjectSupplierSettlementInput {
  projectSupplierId: string
  finalAmount: number
  date: string
  note?: string
  pdf: FileRefDraft
}

export async function confirmProjectSupplierSettlement(
  input: ConfirmProjectSupplierSettlementInput,
): Promise<{ settlementId: string, fileRefId: string }> {
  if (!(input.finalAmount > 0))
    throw new Error('最终结算金额必须大于 0')
  if (!input.date.trim())
    throw new Error('结算日期不能为空')
  const pdfName = input.pdf.fileName.trim()
  const isPdf = input.pdf.mimeType === 'application/pdf'
    || pdfName.toLocaleLowerCase('en-US').endsWith('.pdf')
  if (!pdfName || !isPdf)
    throw new Error('必须上传 PDF 格式的结算确认书')

  return withTransaction(async (tx) => {
    const [relation] = await tx.select<{ id: string, status: string }>(`
      SELECT id, status
      FROM project_suppliers
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `, [input.projectSupplierId])
    if (!relation)
      throw new Error('项目与分供方合作关系不存在或已删除')
    if (relation.status === 'settled')
      throw new Error('该合作关系已结算，不能重复确认')
    if (relation.status !== 'paid')
      throw new Error('合作状态到达“已付款”后才能确认最终结算')

    const [existing] = await tx.select<{ id: string }>(
      'SELECT id FROM settlements WHERE project_supplier_id = ? AND deleted_at IS NULL LIMIT 1',
      [input.projectSupplierId],
    )
    if (existing)
      throw new Error('该合作关系已存在最终结算记录')

    const settlementId = generateId('settlement')
    await tx.execute(`
      INSERT INTO settlements (
        id, project_supplier_id, date, final_amount, pdf_file, note
      )
      VALUES (?, ?, ?, ?, '', ?)
    `, [
      settlementId,
      input.projectSupplierId,
      input.date.trim(),
      input.finalAmount,
      input.note?.trim() ?? '',
    ])
    await logCreate(tx, 'settlements', settlementId)

    const [fileRefId] = await applyFileRefChanges(
      tx,
      'settlement',
      settlementId,
      {
        add: [{
          ...input.pdf,
          category: '结算确认书',
        }],
      },
    )
    if (!fileRefId)
      throw new Error('结算确认书保存失败')

    await tx.execute(
      'UPDATE settlements SET pdf_file = ? WHERE id = ?',
      [fileRefId, settlementId],
    )
    const logId = await withUpdateLog(tx, 'project_suppliers', relation.id, () => tx.execute(`
      UPDATE project_suppliers
      SET status = 'settled', updated_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), relation.id]))
    if (!logId)
      throw new Error('合作状态更新失败')

    return { settlementId, fileRefId }
  })
}
