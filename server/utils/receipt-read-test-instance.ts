import { receiptProblem } from '../../app/lib/receipt/contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { withOriginReadMeta, withReadMeta } from './read-meta'
import { receiptCommandTestInstance, receiptReadService } from './receipt-command-service'
import { receiptConstructionEvidence, sameConstructionEvidence } from './receipt-construction-evidence'
import { receiptContractMetrics } from './receipt-contract-metrics'
import { receiptMetaWithSources, sameReceiptRead } from './receipt-read-evidence'

export type ReceiptReadTestScenario = 'ready' | 'forbidden' | 'unavailable' | 'customer-forbidden' | 'project-contract-forbidden'
const scenarios = new Map<string, ReceiptReadTestScenario>()

/** 权限与故障只在受控测试入口切换，业务收款事实不保存读取权限快照。 */
export const receiptReadTestInstance = {
  reset(scenario: ReceiptReadTestScenario, sessionId?: string | null) {
    const key = sessionId || 'default'
    if (scenario === 'ready')
      scenarios.delete(key)
    else scenarios.set(key, scenario)
  },
  session(sessionId?: string | null) {
    const scenario = scenarios.get(sessionId || 'default') ?? 'ready'
    if (scenario === 'unavailable')
      throw receiptProblem('unavailable', '收款中央服务暂时不可用', {}, true)
    const removed = scenario === 'forbidden' ? ['receipt:read', 'receipt:write'] : scenario === 'customer-forbidden' ? ['customer:list:read'] : scenario === 'project-contract-forbidden' ? ['project:list:read', 'construction-contract:read'] : []
    return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId).filter(capability => !removed.includes(capability)) }
  },
  facts(sessionId?: string | null) {
    return receiptReadService.facts(this.session(sessionId), sessionId)
  },
  context(sessionId?: string | null) {
    return receiptReadService.context(this.session(sessionId), sessionId)
  },
  async detail(id: string, query: Record<string, unknown>, sessionId?: string | null) {
    const session = this.session(sessionId)
    const before = await receiptConstructionEvidence(session, sessionId)
    const original = receiptReadService.detail(id, query, session, sessionId)
    const detail = await receiptContractMetrics(original, sessionId)
    const latest = receiptReadService.detail(id, query, this.session(sessionId), sessionId)
    const after = await receiptConstructionEvidence(this.session(sessionId), sessionId)
    const origin = original.record.dataOrigin
    if (!sameReceiptRead(original.meta, latest.meta) || !sameConstructionEvidence(before[origin], after[origin]))
      throw receiptProblem('unavailable', '收款或合同在读取期间已变化，请重新读取。', {}, true)
    return withReadMeta(detail, { ...receiptMetaWithSources(detail.meta, [after[origin]]), asOf: new Date().toISOString() })
  },
  async list(query: Record<string, unknown>, sessionId?: string | null) {
    const session = this.session(sessionId)
    const before = await receiptConstructionEvidence(session, sessionId)
    const page = receiptReadService.list(query, session, sessionId)
    const items = await Promise.all(page.items.map(detail => receiptContractMetrics(detail, sessionId)))
    const latest = receiptReadService.list(query, this.session(sessionId), sessionId)
    const after = await receiptConstructionEvidence(this.session(sessionId), sessionId)
    if (!(['real', 'demo'] as const).every(origin => sameReceiptRead(page.originMeta[origin], latest.originMeta[origin]) && sameConstructionEvidence(before[origin], after[origin])))
      throw receiptProblem('unavailable', '收款列表或合同在读取期间已变化，请重新读取。', {}, true)
    const asOf = new Date().toISOString()
    const originMeta = Object.fromEntries((['real', 'demo'] as const).map(origin => [origin, {
      ...receiptMetaWithSources(page.originMeta[origin], page.originMeta[origin].authorizedScope.coverage === 'unknown' ? [] : [after[origin]]),
      asOf,
    }])) as typeof page.originMeta
    return withOriginReadMeta({ ...page, items }, originMeta, page.meta.dataOrigin)
  },
  fileContent(id: string, fileId: string, sessionId?: string | null) {
    return receiptCommandTestInstance.fileContent(id, fileId, this.session(sessionId), sessionId)
  },
}
