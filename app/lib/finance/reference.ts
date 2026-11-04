import type { TransactionDb } from '../db/coordinator'
import type { PaymentContractReference } from './payment-contract'

export type FinanceReferenceTable = 'projects' | 'customers' | 'suppliers' | 'workers' | 'contracts' | 'expenditure_settlements' | 'invoices'

/** Reads the real owner in the calling transaction; it never imports a second master. */
export interface FinanceReferenceResolver {
  read: <T>(table: FinanceReferenceTable, id: string) => Promise<T | null>
}

export interface FinanceDomainTx extends TransactionDb {
  references?: FinanceReferenceResolver
  paymentVerification?: { confirmationCap: (applicationId: string) => Promise<number> }
  paymentInvoiceGuard?: { check: (applicationId: string) => Promise<void>, evidence: () => unknown[] }
  paymentInvoiceScope?: { check: (applicationId: string) => Promise<void> }
  paymentContract?: { verify: (reference: PaymentContractReference, projectId: string | null, supplierId: string | null, bizType: string) => Promise<void> }
  paymentSettlementEvidence?: { check: (value: unknown, input: { settlementId: string, settlementVersion: unknown, projectId: string | null, supplierId: string | null, contract: PaymentContractReference }) => void, checkNone: (value: unknown, input: { settlementId: string, settlementVersion: unknown }) => void, evidence: () => unknown[] }
}

export function isFinanceReferenceTable(table: string): table is FinanceReferenceTable {
  return ['projects', 'customers', 'suppliers', 'workers', 'contracts', 'expenditure_settlements', 'invoices'].includes(table)
}
