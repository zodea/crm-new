import type { ReceiptRecord } from './contract'
import { coreMigrationCentsToMoney, coreMigrationMoneyToCents } from '../migration/core-contract'
import { ownerFinalSettlementReceiptIsActive } from '../owner-document/central-repository'

export function effectiveReceiptAmount(rows: readonly ReceiptRecord[]): string | null {
  const active = rows.filter(row => ownerFinalSettlementReceiptIsActive(row.draft.status))
  if (active.some(row => row.draft.amount === null))
    return null
  const total = active.reduce((sum, row) => sum + coreMigrationMoneyToCents(row.draft.amount!), BigInt(0))
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? null : coreMigrationCentsToMoney(total)
}
