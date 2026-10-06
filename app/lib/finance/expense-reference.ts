import type { TransactionDb } from '../db/coordinator'
import { financeFailure } from './central-contract'
import { FinanceAmountSourceError, verifiedFinanceSum } from './persistent-rows'

export interface FinanceExpenseReference {
  id: string
  headerId: string
  projectId: string | null
  amount: number
  version: string
  sourceRevision: string
  clearedAmount: number
  expenseItem: string
  serviceSupplierId: string
  serviceSupplierNameSnapshot: string
  applicantWorkerId: string | null
  applicantSupplierId: string | null
  applicantNameSnapshot: string
}
/** Read the original cost fact, never a clearance line or an invented same-name identity. */
export async function readVerifiedOriginalExpense(tx: Pick<TransactionDb, 'select'>, id: string): Promise<FinanceExpenseReference | null> {
  const row = (await tx.select<Record<string, unknown>>(`SELECT line.*,head.id AS header_id,head.project_id,head.applicant_worker_id,head.applicant_supplier_id,head.applicant_name_snapshot,head.updated_at AS header_updated_at
    FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id
    WHERE line.id=? AND line.deleted_at IS NULL AND head.deleted_at IS NULL AND head.status='confirmed' AND line.original_expense_line_id IS NULL`, [id]))[0]
  if (!row)
    return null
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 || typeof row.counterparty_supplier_id !== 'string' || !row.counterparty_supplier_id
    || typeof row.counterparty_name_snapshot !== 'string' || !row.counterparty_name_snapshot.trim() || typeof row.applicant_name_snapshot !== 'string' || !row.applicant_name_snapshot.trim()
    || !(row.applicant_worker_id === null || typeof row.applicant_worker_id === 'string') || !(row.applicant_supplier_id === null || typeof row.applicant_supplier_id === 'string')
    || Boolean(row.applicant_worker_id) === Boolean(row.applicant_supplier_id)) {
    financeFailure('unavailable', '原费用金额、实际服务分供方或垫付身份尚未核实；保留历史原文，不能按同名补关联。')
  }
  const clearance = await tx.select<{ amount: unknown }>(`SELECT line.amount FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id
    WHERE line.original_expense_line_id=? AND line.deleted_at IS NULL AND head.deleted_at IS NULL AND head.status='confirmed'`, [id])
  let clearedAmount: number
  try {
    clearedAmount = verifiedFinanceSum(clearance.map(line => line.amount))
  }
  catch (cause) {
    if (cause instanceof FinanceAmountSourceError)
      return financeFailure('unavailable', cause.message)
    throw cause
  }
  if (clearedAmount > row.amount + 0.0001)
    financeFailure('unavailable', '原费用累计清偿金额无法核实，不能将未知余额显示为零。')
  const proof = new TextEncoder().encode(JSON.stringify({ row, clearedAmount }))
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', proof))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return {
    id: String(row.id),
    headerId: String(row.header_id),
    projectId: row.project_id === null ? null : String(row.project_id),
    amount: row.amount,
    version: hash,
    sourceRevision: `native-expense-${hash}`,
    clearedAmount,
    expenseItem: String(row.expense_item),
    serviceSupplierId: row.counterparty_supplier_id,
    serviceSupplierNameSnapshot: row.counterparty_name_snapshot,
    applicantWorkerId: row.applicant_worker_id,
    applicantSupplierId: row.applicant_supplier_id,
    applicantNameSnapshot: row.applicant_name_snapshot,
  }
}
