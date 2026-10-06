import type { TransactionDb } from '../db/coordinator'

export type FinanceReferenceTable = 'projects' | 'customers' | 'suppliers' | 'workers' | 'contracts' | 'expenditure_settlements' | 'invoices'

/** Reads the real owner in the calling transaction; it never imports a second master. */
export interface FinanceReferenceResolver {
  read: <T>(table: FinanceReferenceTable, id: string) => Promise<T | null>
}

export interface FinanceDomainTx extends TransactionDb {
  references?: FinanceReferenceResolver
  paymentVerification?: { confirmationCap: (applicationId: string) => Promise<number> }
}

export function isFinanceReferenceTable(table: string): table is FinanceReferenceTable {
  return ['projects', 'customers', 'suppliers', 'workers', 'contracts', 'expenditure_settlements', 'invoices'].includes(table)
}
