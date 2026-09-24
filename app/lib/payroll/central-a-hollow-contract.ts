import type { PayrollAStatementSourceSnapshotV2 } from './central-a-fees-contract'
import type { PayrollHollowSnapshot } from './central-hollow-deduction-contract'

/** V1/V2 原文不追加字段；接入户级扣款的工资新原件采用显式 V3。 */
export interface PayrollAStatementSourceSnapshotV3 extends Omit<PayrollAStatementSourceSnapshotV2, 'schemaVersion'> {
  schemaVersion: 3
  hollow: PayrollHollowSnapshot
}
