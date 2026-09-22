import { receiptProblem } from '../../app/lib/receipt/contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { receiptCommandTestInstance, receiptReadService } from './receipt-command-service'
import { receiptContractMetrics } from './receipt-contract-metrics'

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
    return receiptContractMetrics(receiptReadService.detail(id, query, this.session(sessionId), sessionId), sessionId)
  },
  async list(query: Record<string, unknown>, sessionId?: string | null) {
    const page = receiptReadService.list(query, this.session(sessionId), sessionId)
    return { ...page, items: await Promise.all(page.items.map(detail => receiptContractMetrics(detail, sessionId))) }
  },
  fileContent(id: string, fileId: string, sessionId?: string | null) {
    return receiptCommandTestInstance.fileContent(id, fileId, this.session(sessionId), sessionId)
  },
}
