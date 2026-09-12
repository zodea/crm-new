import type { TargetCostListRead } from '../../app/lib/target-cost/central-contract'
import type { TargetCostProjectSource } from './target-cost-service'
import { createHash } from 'node:crypto'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { projectReadTestInstance } from './project-read-test-instance'
import { quantityTestInstance } from './quantity-runtime'
import { WorkspaceTransactionSessionChanged } from './quantity-test-instance'
import { loadTargetCostActual } from './target-cost-actual-sources'
import { createTargetCostService } from './target-cost-service'

export function targetCostSession(sessionId?: string | null) {
  return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
}
export function targetCostProjectSource(sessionId?: string | null): TargetCostProjectSource {
  try {
    const facts = projectReadTestInstance.identities(sessionId)
    const projects = facts.rows.filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name, code: row.code ?? '' }))
    let options: TargetCostProjectSource['projects'] = []
    let optionsStatus: TargetCostProjectSource['status'] = 'available'
    try {
      options = projectReadTestInstance.facts(sessionId).rows.filter(row => row.dataOrigin === 'real').map(row => ({ id: row.id, name: row.name, code: row.code ?? '' }))
    }
    catch (cause) {
      optionsStatus = (cause as {
        problem?: {
          code: string
        }
      }).problem?.code === 'forbidden'
        ? 'forbidden'
        : 'unavailable'
    }
    return { projects, options, optionsStatus, status: 'available', version: createHash('sha256').update(JSON.stringify([facts.sourceVersion, projects])).digest('hex') }
  }
  catch (cause) {
    const status = (cause as {
      problem?: {
        code: string
      }
    }).problem?.code === 'forbidden'
      ? 'forbidden'
      : 'unavailable'
    return { projects: [], options: [], optionsStatus: status, status, version: status }
  }
}
export const targetCostService = createTargetCostService({
  session: targetCostSession,
  projects: targetCostProjectSource,
  actual: loadTargetCostActual,
  async transaction(work, sessionId) {
    try {
      return await quantityTestInstance.withWorkspaceTransaction(work, sessionId)
    }
    catch (cause) {
      if (cause instanceof WorkspaceTransactionSessionChanged)
        throw targetCostProblem('forbidden', '预算提交期间会话已变化，请保留原提交编号核对')
      throw cause
    }
  },
})
/** 演示库由浏览器隔离只读适配器提供；此入口只授予明确的演示读取身份。 */
export function targetCostDemoContext(includeDemo: boolean, sessionId?: string | null): TargetCostListRead {
  const session = targetCostSession(sessionId)
  if (!includeDemo || !session.capabilities.includes('demo:read') || !session.capabilities.includes('target-cost:read'))
    throw targetCostProblem('forbidden', '当前身份没有演示预算读取权限')
  return { context: { ...session, capabilities: session.capabilities.filter(value => value !== 'target-cost:write'), origin: 'demo', sourceVersion: 'demo-target-cost-readonly-v1' }, rows: [] }
}
