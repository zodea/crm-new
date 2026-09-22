import type { ReceiptDetail } from '../../app/lib/receipt/contract'
import type { ProblemDTO } from '../../app/types/read-model'
import { coreMigrationCentsToMoney, coreMigrationMoneyToCents } from '../../app/lib/migration/core-contract'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { isProblemCodeDTO } from '../../app/types/read-model'

/** 仅详情投影读取合同聚合；原始收款 facts 不经过此函数，避免双向聚合递归。 */
export async function receiptContractMetrics(detail: ReceiptDetail, sessionId?: string | null): Promise<ReceiptDetail> {
  if (detail.contract.state !== 'resolved')
    return detail
  try {
    const { constructionContractReadTestInstance } = await import('./construction-contract-read-test-instance')
    const contract = constructionContractReadTestInstance.detail(detail.contract.id, { origin: detail.record.dataOrigin, includeDemo: detail.record.dataOrigin === 'demo' }, sessionId)
    const values = contract.contract.amounts
    return {
      ...detail,
      amounts: {
        ...detail.amounts,
        contractOriginal: values.contract,
        contractChange: coreMigrationCentsToMoney(coreMigrationMoneyToCents(values.changed) - coreMigrationMoneyToCents(values.contract)),
        contract: values.changed,
        cumulativeReceipt: values.received,
        cumulativeReceiptExcludingCurrent: contract.receiptsProblem ? null : detail.amounts.cumulativeReceiptExcludingCurrent,
        receiptRatio: Number(values.changed) > 0 && values.received !== null ? (Number(values.received) / Number(values.changed)).toFixed(6) : null,
        invoicedUnreceived: values.invoicedUnreceived,
      },
      ...(contract.receiptsProblem ? { contractProblem: contract.receiptsProblem } : {}),
      sourceVersion: [detail.sourceVersion, contract.sourceVersion].filter(Boolean).join('+'),
    }
  }
  catch (cause) {
    const raw = (cause as { problem?: ProblemDTO })?.problem
    const problem = raw && isProblemCodeDTO(raw.code) ? raw : receiptProblem('unavailable', '合同指标暂不可读取', {}, true).problem
    return { ...detail, amounts: { contractOriginal: null, contractChange: null, contract: null, cumulativeReceipt: null, cumulativeReceiptExcludingCurrent: null, receiptRatio: null, invoicedUnreceived: null }, contractProblem: problem }
  }
}
