import type { ReceiptDetail } from '../../app/lib/receipt/contract'
import type { ProblemDTO } from '../../app/types/read-model'
import { coreMigrationCentsToMoney, coreMigrationMoneyToCents } from '../../app/lib/migration/core-contract'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { isProblemCodeDTO } from '../../app/types/read-model'
import { withReadMeta } from './read-meta'
import { receiptMetaWithSources } from './receipt-read-evidence'

/** 仅详情投影读取合同聚合；原始收款 facts 不经过此函数，避免双向聚合递归。 */
export async function receiptContractMetrics(detail: ReceiptDetail, sessionId?: string | null): Promise<ReceiptDetail> {
  if (detail.contract.state !== 'resolved')
    return detail
  try {
    const { constructionContractReadTestInstance } = await import('./construction-contract-read-test-instance')
    const contract = constructionContractReadTestInstance.detail(detail.contract.id, { origin: detail.record.dataOrigin, includeDemo: detail.record.dataOrigin === 'demo' }, sessionId)
    if (contract.meta.workspaceId !== detail.meta.workspaceId || contract.meta.actorId !== detail.meta.actorId || contract.meta.dataOrigin !== detail.record.dataOrigin)
      throw receiptProblem('unavailable', '合同读取身份或来源与原收款不一致。', {}, true)
    const values = contract.contract.amounts
    return withReadMeta({
      ...detail,
      amounts: {
        ...detail.amounts,
        contractOriginal: values.contract,
        contractChange: values.changed === null || values.contract === null ? null : coreMigrationCentsToMoney(coreMigrationMoneyToCents(values.changed) - coreMigrationMoneyToCents(values.contract)),
        contract: values.changed,
        cumulativeReceipt: values.received,
        cumulativeReceiptExcludingCurrent: contract.receiptsProblem ? null : detail.amounts.cumulativeReceiptExcludingCurrent,
        receiptRatio: Number(values.changed) > 0 && values.received !== null ? (Number(values.received) / Number(values.changed)).toFixed(6) : null,
        invoicedUnreceived: values.invoicedUnreceived,
      },
      ...(contract.receiptsProblem ? { contractProblem: contract.receiptsProblem } : {}),
    }, receiptMetaWithSources(detail.meta, contract.meta.sources))
  }
  catch (cause) {
    const raw = (cause as { problem?: ProblemDTO })?.problem
    const problem = raw && isProblemCodeDTO(raw.code) ? raw : receiptProblem('unavailable', '合同指标暂不可读取', {}, true).problem
    const forbidden = ['forbidden', 'unauthenticated'].includes(problem.code)
    const contract = forbidden ? { state: 'forbidden' as const, entity: 'contract' as const, id: null, label: null, reason: 'permission-denied' as const } : { state: 'unavailable' as const, entity: 'contract' as const, id: null, label: null, reason: 'source-unavailable' as const }
    return withReadMeta({ ...detail, record: { ...detail.record, draft: { ...detail.record.draft, contractId: null } }, contract, amounts: { contractOriginal: null, contractChange: null, contract: null, cumulativeReceipt: null, cumulativeReceiptExcludingCurrent: null, receiptRatio: null, invoicedUnreceived: null }, contractProblem: problem }, receiptMetaWithSources(detail.meta, [{ key: 'construction-metrics', state: forbidden ? 'forbidden' : 'unavailable', sourceVersion: null, asOf: null }]))
  }
}
