import type { ReceiptDraft } from '../../app/lib/receipt/contract'
import { receiptProblem } from '../../app/lib/receipt/contract'

export function assertUniqueReceiptBankSerial(records: Iterable<{ draft: ReceiptDraft }>) {
  const serials = new Set<string>()
  for (const { draft } of records) {
    const serial = draft.bankSerialNo.trim()
    if (!serial)
      continue
    if (serials.has(serial))
      throw receiptProblem('conflict', '银行流水号已用于其他收款，请核对后保存', { bankSerialNo: ['银行流水号不能重复'] })
    serials.add(serial)
  }
}
