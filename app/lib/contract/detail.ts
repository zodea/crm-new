import type { ContractKind } from '~/lib/contract/status'
import type { FileRefRecord } from '~/lib/forms/file-refs'
import { select } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'

export type ContractDocumentGroup
  = | '补充协议'
    | '甲方变洽签'
    | '分包变洽签'
    | '甲方报量'
    | '最终结算'
    | '支出结算'
    | '开票申请'
    | '收票登记'
    | '收款登记'
    | '付款申请'
    | '材料申请'
    | '材料到货'

export interface ContractRelatedDocument {
  id: string
  group: ContractDocumentGroup
  no: string
  name: string
  amount: number | null
  date: string
  status: string
  to: string
}

export interface ContractLineItem {
  id: string
  materialName: string
  spec: string
  brand: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount: number | null
  plannedArrivalDate: string
}

export type ContractDetailFile = FileRefRecord

export interface ContractDetailSnapshot {
  documents: readonly ContractRelatedDocument[]
  lineItems: readonly ContractLineItem[]
  files: readonly ContractDetailFile[]
}

export type ContractStageState = 'complete' | 'current' | 'pending'

export interface ContractStage {
  key: string
  label: string
  state: ContractStageState
}

const STAGES = [
  { key: 'draft', label: '拟定' },
  { key: 'approval', label: '审批与签订' },
  { key: 'performance', label: '履约' },
  { key: 'settlement', label: '结算' },
  { key: 'closed', label: '结清' },
] as const

const STATUS_STAGE: Record<string, number> = {
  草稿: 0,
  审批中: 1,
  已签订: 1,
  履约中: 2,
  已结算: 3,
  已结清: 4,
}

export function contractStages(status: string): ContractStage[] {
  const current = STATUS_STAGE[status] ?? 0
  return STAGES.map((stage, index) => ({
    ...stage,
    state: index < current
      ? 'complete'
      : index === current ? 'current' : 'pending',
  }))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function mapDocuments(
  rows: readonly Record<string, unknown>[],
  group: ContractDocumentGroup,
  path: (id: string, row: Record<string, unknown>) => string,
): ContractRelatedDocument[] {
  return rows.map(row => ({
    id: stringValue(row.id),
    group,
    no: stringValue(row.no),
    name: stringValue(row.name),
    amount: nullableNumber(row.amount),
    date: stringValue(row.date),
    status: stringValue(row.status),
    to: path(stringValue(row.id), row),
  }))
}

async function loadSupplements(contractId: string): Promise<ContractRelatedDocument[]> {
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('contract_supplements', `
      AND contract_id = ?
      ORDER BY sign_date DESC, created_at DESC
    `),
    [contractId],
  )
  return mapDocuments(
    rows.map(row => ({
      id: row.id,
      no: row.no,
      name: row.name,
      amount: row.amount,
      date: row.sign_date,
      status: row.status,
    })),
    '补充协议',
    () => '',
  )
}

async function loadChanges(
  contractId: string,
  kind: ContractKind,
): Promise<ContractRelatedDocument[]> {
  if (kind === '材采')
    return []
  if (kind === '施工') {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('owner_change_orders', `
        AND contract_id = ?
        ORDER BY COALESCE(NULLIF(approval_date, ''), application_date) DESC, created_at DESC
      `),
      [contractId],
    )
    return mapDocuments(
      rows.map(row => ({
        id: row.source_type === 'boq_change_order' && row.source_id
          ? row.source_id
          : row.id,
        no: row.change_no,
        name: row.name || row.contract_name,
        amount: row.tax_inc_amount,
        date: row.approval_date || row.application_date,
        status: row.status,
      })),
      '甲方变洽签',
      id => `/owner/change/${id}`,
    )
  }
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('subcontract_change_orders', `
      AND contract_id = ?
      ORDER BY change_date DESC, created_at DESC
    `),
    [contractId],
  )
  return mapDocuments(
    rows.map(row => ({
      id: row.id,
      no: row.no,
      name: row.reason,
      amount: row.approved_amount,
      date: row.change_date,
      status: row.status,
    })),
    '分包变洽签',
    id => `/subcontract/change/${id}`,
  )
}

async function loadSettlements(
  contractId: string,
  kind: ContractKind,
): Promise<ContractRelatedDocument[]> {
  if (kind === '施工') {
    const [statementRows, finalRows] = await Promise.all([
      select<Record<string, unknown>>(
        selectVisibleSql('monthly_statements', `
          AND contract_id = ?
          ORDER BY month DESC, created_at DESC
        `),
        [contractId],
      ),
      select<Record<string, unknown>>(
        selectVisibleSql('owner_final_settlements', `
          AND contract_id = ?
          ORDER BY submission_date DESC, created_at DESC
        `),
        [contractId],
      ),
    ])
    return [
      ...mapDocuments(
        statementRows.map(row => ({
          id: row.id,
          no: row.no || row.period_no || row.month,
          name: row.period_no || row.month || '月度报量',
          amount: row.audited_amount ?? row.reported_amount ?? row.total_amount,
          date: row.application_date || row.month,
          status: row.status,
        })),
        '甲方报量',
        id => `/owner/report/${id}`,
      ),
      ...mapDocuments(
        finalRows.map(row => ({
          id: row.id,
          no: row.no,
          name: row.name,
          amount: row.settlement_amount,
          date: row.submission_date,
          status: row.status,
        })),
        '最终结算',
        id => `/owner/final-settlement/${id}`,
      ),
    ]
  }
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('expenditure_settlements', `
      AND contract_id = ?
      ORDER BY settlement_date DESC, created_at DESC
    `),
    [contractId],
  )
  return mapDocuments(
    rows.map(row => ({
      id: row.id,
      no: row.no,
      name: row.name,
      amount: row.total_amount,
      date: row.settlement_date,
      status: row.status,
    })),
    '支出结算',
    id => kind === '分包'
      ? `/subcontract/settlement/${id}`
      : `/material/settlement/form/${id}`,
  )
}

async function loadInvoices(
  contractId: string,
  kind: ContractKind,
): Promise<ContractRelatedDocument[]> {
  if (kind === '施工') {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('invoice_applications', `
        AND contract_id = ?
        ORDER BY application_date DESC, created_at DESC
      `),
      [contractId],
    )
    return mapDocuments(
      rows.map(row => ({
        id: row.id,
        no: row.no,
        name: row.name || row.invoice_content,
        amount: row.amount,
        date: row.application_date,
        status: row.status,
      })),
      '开票申请',
      id => `/finance/billing/${id}`,
    )
  }
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('invoices', `
      AND contract_id = ?
      ORDER BY invoice_date DESC, created_at DESC
    `),
    [contractId],
  )
  return mapDocuments(
    rows.map(row => ({
      id: row.id,
      no: row.invoice_number,
      name: row.seller || row.file_name,
      amount: row.total_amount,
      date: row.invoice_date,
      status: row.account_status,
    })),
    '收票登记',
    id => `/finance/invoice/${id}`,
  )
}

async function loadPayments(
  contractId: string,
  kind: ContractKind,
): Promise<ContractRelatedDocument[]> {
  if (kind === '施工') {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('receipt_registrations', `
        AND contract_id = ?
        ORDER BY receipt_date DESC, created_at DESC
      `),
      [contractId],
    )
    return mapDocuments(
      rows.map(row => ({
        id: row.id,
        no: row.no,
        name: row.payer_account,
        amount: row.amount,
        date: row.receipt_date,
        status: row.status,
        customerId: row.customer_id,
      })),
      '收款登记',
      () => '',
    )
  }
  const rows = await select<Record<string, unknown>>(`
    ${hiddenCtesFor(
      'payment_applications',
      'payment_records',
      'payment_record_application_allocations',
    )}
    SELECT
      application.id,
      application.no,
      application.name,
      COALESCE(SUM(
        CASE WHEN payment.confirmation_status = 'confirmed'
          THEN allocation.allocated_amount
          ELSE 0
        END
      ), 0) AS amount,
      application.apply_date AS date,
      application.status
    FROM payment_applications AS application
    LEFT JOIN payment_record_application_allocations AS allocation
      ON allocation.payment_application_id = application.id
     AND ${visibleCond('payment_record_application_allocations', 'allocation')}
    LEFT JOIN payment_records AS payment
      ON payment.id = allocation.payment_record_id
     AND ${visibleCond('payment_records', 'payment')}
    WHERE ${visibleCond('payment_applications', 'application')}
      AND application.contract_id = ?
    GROUP BY
      application.id,
      application.no,
      application.name,
      application.apply_date,
      application.status
    ORDER BY application.apply_date DESC, application.created_at DESC
  `, [contractId])
  return mapDocuments(rows, '付款申请', id => `/finance/payment/${id}/detail`)
}

async function loadMaterialDocuments(
  contractId: string,
): Promise<ContractRelatedDocument[]> {
  const [requisitions, arrivals] = await Promise.all([
    select<Record<string, unknown>>(
      selectVisibleSql('material_requisitions', `
        AND contract_id = ?
        ORDER BY requisition_date DESC, created_at DESC
      `),
      [contractId],
    ),
    select<Record<string, unknown>>(
      selectVisibleSql('material_arrivals', `
        AND contract_id = ?
        ORDER BY arrival_date DESC, created_at DESC
      `),
      [contractId],
    ),
  ])
  return [
    ...mapDocuments(
      requisitions.map(row => ({
        id: row.id,
        no: row.no,
        name: row.material_name,
        amount: null,
        date: row.requisition_date,
        status: row.status,
      })),
      '材料申请',
      id => `/material/requisition/${id}`,
    ),
    ...mapDocuments(
      arrivals.map(row => ({
        id: row.id,
        no: row.no,
        name: row.warehouse || '材料到货',
        amount: null,
        date: row.arrival_date,
        status: row.status,
      })),
      '材料到货',
      id => `/material/arrival/${id}`,
    ),
  ]
}

async function loadLineItems(contractId: string): Promise<ContractLineItem[]> {
  const rows = await select<Record<string, unknown>>(
    selectVisibleSql('contract_line_items', `
      AND contract_id = ?
      ORDER BY sort_order, created_at, id
    `),
    [contractId],
  )
  return rows.map((row) => {
    const qty = nullableNumber(row.qty)
    const unitPrice = nullableNumber(row.tax_inclusive_unit_price)
    return {
      id: stringValue(row.id),
      materialName: stringValue(row.material_name),
      spec: stringValue(row.spec),
      brand: stringValue(row.brand),
      unit: stringValue(row.unit),
      qty,
      unitPrice,
      amount: qty == null || unitPrice == null ? null : qty * unitPrice,
      plannedArrivalDate: stringValue(row.planned_arrival_date),
    }
  })
}

async function loadFiles(contractId: string): Promise<ContractDetailFile[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = 'contract'
      AND owner_id = ?
      AND deleted_at IS NULL
    ORDER BY uploaded_at DESC, id DESC
  `, [contractId])
  return rows.map(row => ({
    id: stringValue(row.id),
    ownerType: stringValue(row.owner_type),
    ownerId: stringValue(row.owner_id),
    fileName: stringValue(row.file_name),
    filePath: stringValue(row.file_path),
    fileSize: Number(row.file_size ?? 0),
    mimeType: stringValue(row.mime_type),
    category: stringValue(row.category),
    uploader: stringValue(row.uploader),
    uploadedAt: stringValue(row.uploaded_at),
    deletedAt: row.deleted_at == null ? null : stringValue(row.deleted_at),
  }))
}

export async function loadContractDetailSnapshot(
  contractId: string,
  kind: ContractKind,
): Promise<ContractDetailSnapshot> {
  const [
    supplements,
    changes,
    settlements,
    invoices,
    payments,
    materialDocuments,
    lineItems,
    files,
  ] = await Promise.all([
    loadSupplements(contractId),
    loadChanges(contractId, kind),
    loadSettlements(contractId, kind),
    loadInvoices(contractId, kind),
    loadPayments(contractId, kind),
    kind === '材采' ? loadMaterialDocuments(contractId) : Promise.resolve([]),
    kind === '材采' ? loadLineItems(contractId) : Promise.resolve([]),
    loadFiles(contractId),
  ])

  return {
    documents: [
      ...supplements,
      ...changes,
      ...settlements,
      ...invoices,
      ...payments,
      ...materialDocuments,
    ],
    lineItems,
    files,
  }
}
