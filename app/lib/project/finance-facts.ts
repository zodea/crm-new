import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export interface ProjectCurrentTransactionRow {
  id: string
  projectId: string
  direction: 'receipt' | 'payment'
  documentNo: string
  transactionDate: string
  counterparty: string
  purpose: string
  amount: number
  effectiveAmount: number
  paymentMethod: string
  bankSerialNo: string
  handler: string
  status: string
  sourcePath: string
}

export interface ProjectPaymentRecordRow {
  id: string
  projectId: string
  paymentNo: string
  payee: string
  purpose: string
  paymentDate: string
  amount: number
  effectiveAmount: number
  paymentMethod: string
  voucherNo: string
  bankSerialNo: string
  handler: string
  status: string
  source: string
  recognitionStatus: string
  allocationCount: number
  allocatedAmount: number
  allocationDifference: number
  sourcePath: string
}

export interface ProjectFinanceFacts {
  currentReceipts: ProjectCurrentTransactionRow[]
  currentPayments: ProjectCurrentTransactionRow[]
  paymentRecords: ProjectPaymentRecordRow[]
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function currentRow(row: Record<string, unknown>): ProjectCurrentTransactionRow {
  const direction = row.direction === 'payment' ? 'payment' : 'receipt'
  const status = text(row.status)
  const amount = number(row.amount)
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    direction,
    documentNo: text(row.no),
    transactionDate: text(row.transaction_date),
    counterparty: text(row.counterparty),
    purpose: text(row.purpose),
    amount,
    effectiveAmount: ['draft', '草稿'].includes(status) ? 0 : amount,
    paymentMethod: text(row.payment_method),
    bankSerialNo: text(row.bank_serial_no),
    handler: text(row.handler),
    status,
    sourcePath: `/finance/current/${text(row.id)}`,
  }
}

export async function loadProjectFinanceFacts(db: SoftDb): Promise<ProjectFinanceFacts> {
  const [currentRows, paymentRows, allocationRows] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('current_transactions')}
      SELECT current.*
      FROM current_transactions AS current
      WHERE ${visibleCond('current_transactions', 'current')}
        AND current.project_id IS NOT NULL
      ORDER BY current.transaction_date DESC, current.created_at DESC, current.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('payment_records')}
      SELECT payment.*
      FROM payment_records AS payment
      WHERE ${visibleCond('payment_records', 'payment')}
        AND payment.project_id IS NOT NULL
      ORDER BY payment.payment_date DESC, payment.created_at DESC, payment.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor(
        'payment_record_application_allocations',
        'payment_records',
        'payment_applications',
      )}
      SELECT allocation.payment_record_id, allocation.id,
             allocation.allocated_amount
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS payment
        ON payment.id = allocation.payment_record_id
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
      WHERE ${visibleCond('payment_record_application_allocations', 'allocation')}
        AND ${visibleCond('payment_records', 'payment')}
        AND ${visibleCond('payment_applications', 'application')}
      ORDER BY allocation.payment_record_id, allocation.created_at, allocation.id
    `),
  ])

  const allocations = new Map<string, { count: number, amount: number }>()
  for (const row of allocationRows) {
    const paymentId = text(row.payment_record_id)
    const current = allocations.get(paymentId) ?? { count: 0, amount: 0 }
    current.count += 1
    current.amount += number(row.allocated_amount)
    allocations.set(paymentId, current)
  }

  const currentTransactions = currentRows.map(currentRow)
  const paymentRecords = paymentRows.map<ProjectPaymentRecordRow>((row) => {
    const id = text(row.id)
    const amount = number(row.amount)
    const allocation = allocations.get(id) ?? { count: 0, amount: 0 }
    const status = text(row.confirmation_status)
    return {
      id,
      projectId: text(row.project_id),
      paymentNo: text(row.no),
      payee: text(row.payee_name),
      purpose: text(row.purpose),
      paymentDate: text(row.payment_date),
      amount,
      effectiveAmount: status === 'confirmed' ? amount : 0,
      paymentMethod: text(row.payment_method),
      voucherNo: text(row.voucher_no),
      bankSerialNo: text(row.bank_serial_no),
      handler: text(row.handler || row.confirmed_by),
      status,
      source: text(row.source),
      recognitionStatus: text(row.recognition_status),
      allocationCount: allocation.count,
      allocatedAmount: allocation.amount,
      allocationDifference: amount - allocation.amount,
      sourcePath: `/finance/records/${id}`,
    }
  })

  return {
    currentReceipts: currentTransactions.filter(row => row.direction === 'receipt'),
    currentPayments: currentTransactions.filter(row => row.direction === 'payment'),
    paymentRecords,
  }
}
