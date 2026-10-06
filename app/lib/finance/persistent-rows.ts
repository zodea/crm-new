/** Persisted scalar proof shared by formal reads and the verified Native source. */
export const FINANCE_NUMERIC_COLUMNS: Record<string, readonly string[]> = {
  current_transactions: ['amount'],
  expense_reimbursements: ['invoice_count'],
  expense_reimbursement_lines: ['amount', 'sort_order'],
  invoice_applications: ['amount', 'tax_rate', 'tax_amount'],
  payment_applications: ['apply_amount', 'prepay_deduct'],
  payment_records: ['amount'],
  payment_application_settlement_allocations: ['allocated_amount'],
  payment_application_invoice_allocations: ['allocated_amount'],
  payment_record_application_allocations: ['allocated_amount'],
}
export function hasVerifiedFinanceNumbers(table: string, row: Record<string, unknown>): boolean {
  return (FINANCE_NUMERIC_COLUMNS[table] ?? []).every(field => typeof row[field] === 'number' && Number.isFinite(row[field]))
    && (table !== 'payment_applications' || row.approved_amount === null || (typeof row.approved_amount === 'number' && Number.isFinite(row.approved_amount)))
    && (table !== 'expense_reimbursements' || Number.isSafeInteger(row.invoice_count))
    && (table !== 'expense_reimbursement_lines' || Number.isSafeInteger(row.sort_order))
}
export function requireVerifiedFinanceNumbers(table: string, row: Record<string, unknown>): void {
  if (!hasVerifiedFinanceNumbers(table, row))
    throw new Error('财务原金额、数量或税率尚未可靠读取，不能按零采用；请保留原记录并核验。')
}
export function verifiedFinanceNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('财务金额尚未可靠读取，不能按零采用；请保留原记录并核验。')
  return value
}

export class FinanceAmountSourceError extends Error {
  constructor(message = '原财务额度金额尚未可靠核实，不能按零采用或将未知值按零汇总；请保留原记录并核验。') {
    super(message)
  }
}

/** A proven empty set is zero; nullable, text, negative and overflowing source amounts are unknown. */
export function verifiedFinanceSum(values: readonly unknown[]): number {
  let total = 0
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new FinanceAmountSourceError()
    total += value
    if (!Number.isFinite(total))
      throw new FinanceAmountSourceError()
  }
  return total
}
