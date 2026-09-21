import type { TransactionDb } from '../../app/lib/db/coordinator'
import { loadPayrollAReleasedDocuments } from '../../app/lib/payroll/central-a-provenance'
import { loadPayrollMigratedFees } from './payroll-migrated-fees'
import { loadPayrollMigratedHollow } from './payroll-migrated-hollow'

/** 新原生发放可以引用已迁入费用；投影按当前事务提供，原 SQL/JSON 不改。 */
export function loadPayrollAReleasedWithMigration(tx: TransactionDb, statementId?: string) {
  return loadPayrollAReleasedDocuments(tx, statementId, projectId => loadPayrollMigratedFees(tx, projectId), loadPayrollMigratedHollow)
}
