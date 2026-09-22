import type { ProjectListSourceRow } from '../../app/lib/project/read-contract'
import { effectiveReceiptAmount } from '../../app/lib/receipt/effective'
import { receiptProblemFromUnknown } from '../../app/lib/receipt/repository'
import { receiptReadTestInstance } from './receipt-read-test-instance'

/** 项目展示层只消费原始收款，不回调项目聚合或合同聚合。 */
export function projectReceiptIncome(rows: readonly ProjectListSourceRow[], sessionId?: string | null) {
  try {
    const source = receiptReadTestInstance.facts(sessionId)
    return { sourceVersion: source.sourceVersion, asOf: source.asOf, rows: rows.map((row) => {
      if (row.dataOrigin !== 'real')
        return row
      const amount = effectiveReceiptAmount(source.rows.filter(receipt => receipt.dataOrigin === row.dataOrigin && receipt.draft.projectId === row.id))
      return { ...row, income: amount === null ? null : Number(amount), incomeMissingSource: amount === null ? 'receipt-registrations:unknown-amount' : undefined }
    }) }
  }
  catch (cause) {
    const code = receiptProblemFromUnknown(cause).problem.code
    return { sourceVersion: `receipt-${code}`, rows: rows.map(row => row.dataOrigin === 'real' ? { ...row, income: null, incomeMissingSource: `receipt-registrations:${code}` } : row) }
  }
}
