import type { TransactionDb } from '../../app/lib/db/coordinator'
import { emptyPayrollHollowProjection } from '../../app/lib/payroll/central-hollow-deduction-projection'
import { loadPayrollMigratedFees } from './payroll-migrated-fees'
import { loadPayrollMigratedProof } from './payroll-migrated-proof'

/** 无法证明的原件整体拒绝，不把旧 raw JSON 当当前中央身份。 */
export async function loadPayrollMigratedHollow(tx: TransactionDb, projectId: string) {
  const result = emptyPayrollHollowProjection()
  const proof = await loadPayrollMigratedProof(tx, projectId)
  Object.assign(result, proof.hollow)
  result.adjustments = proof.records
  result.originals = proof.originals
  result.fees = await loadPayrollMigratedFees(tx, projectId)
  for (const document of [...proof.aDocuments.values(), ...proof.c1Documents.values(), ...proof.c2Documents.values()]) {
    if (document.hollow)
      result.documents.set(document.id, document.hollow)
  }
  return result
}
