import { effectiveMasterDataCapabilities } from '../../app/lib/master-data/capabilities'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { resolveBusinessSession } from './business-session'
import { crewWorkerReadTestInstance } from './crew-worker-read-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { projectReadTestInstance } from './project-read-test-instance'
import { loadQuantityHollowMigratedProof } from './quantity-hollow-migrated-proof'
import { createQuantityHollowService } from './quantity-hollow-service'
import { createQuantityTestInstance, WorkspaceTransactionSessionChanged } from './quantity-test-instance'

const quantitySession = (sessionId?: string | null) => ({ ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) })
const quantityProjects = (sessionId?: string | null) => projectReadTestInstance.facts(sessionId).rows
function quantityPeople(sessionId?: string | null) {
  const source = crewWorkerReadTestInstance.facts(sessionId)
  return [
    ...source.crews.map(row => ({ id: row.id, name: row.name, trade: row.trade, dataOrigin: row.dataOrigin, kind: 'crew' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
    ...source.workers.filter(row => !row.crewId || source.crews.some(crew => crew.id === row.crewId && crew.dataOrigin === row.dataOrigin))
      .map(row => ({ id: row.id, name: row.name, trade: row.trade, dataOrigin: row.dataOrigin, kind: 'worker' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
  ]
}

export const quantityTestInstance = createQuantityTestInstance({
  session: quantitySession,
  projects: quantityProjects,
  boq: (projectId, sessionId) => ownerCommercialDocumentCommandTestInstance.quantityBoqFacts(projectId, sessionId),
  people: quantityPeople,
})

/** 新空鼓入口复用相同的会话、项目/名册来源及唯一工作区事务。 */
export const quantityHollowTestInstance = createQuantityHollowService({
  session: quantitySession,
  projects: sessionId => quantityProjects(sessionId).map(project => ({ ...project, code: project.code ?? '' })),
  people: quantityPeople,
  migratedProof: loadQuantityHollowMigratedProof,
  async transaction(work, sessionId) {
    try {
      return await quantityTestInstance.withWorkspaceTransaction(work, sessionId)
    }
    catch (cause) {
      if (cause instanceof WorkspaceTransactionSessionChanged)
        throw quantityProblem('forbidden', '读取期间工程量工作区或身份已变化')
      throw cause
    }
  },
})
