import type { TransactionDb } from '../../app/lib/db/coordinator'
import { loadPayrollC1ReleasedDocuments } from '../../app/lib/payroll/central-c1-provenance'
import { loadPayrollC2ReleasedDocuments } from '../../app/lib/payroll/central-c2-provenance'
import { loadPayrollMigratedHollow } from './payroll-migrated-hollow'

/** 映射仅用于本事务的已证读取，原来源和冻结 JSON 保留原文。 */
export function loadPayrollC1ReleasedWithMigration(tx: TransactionDb, statementId?: string) {
  return loadPayrollC1ReleasedDocuments(tx, statementId, loadPayrollMigratedHollow)
}

export function loadPayrollC2ReleasedWithMigration(tx: TransactionDb, statementId?: string) {
  return loadPayrollC2ReleasedDocuments(tx, statementId, loadPayrollMigratedHollow)
}
