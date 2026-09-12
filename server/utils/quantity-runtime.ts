import { effectiveMasterDataCapabilities } from '../../app/lib/master-data/capabilities'
import { resolveBusinessSession } from './business-session'
import { crewWorkerReadTestInstance } from './crew-worker-read-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { projectReadTestInstance } from './project-read-test-instance'
import { createQuantityTestInstance } from './quantity-test-instance'

export const quantityTestInstance = createQuantityTestInstance({
  session: sessionId => ({ ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }),
  projects: sessionId => projectReadTestInstance.facts(sessionId).rows,
  boq: (projectId, sessionId) => ownerCommercialDocumentCommandTestInstance.quantityBoqFacts(projectId, sessionId),
  people: (sessionId) => {
    const source = crewWorkerReadTestInstance.facts(sessionId)
    return [
      ...source.crews.map(row => ({ id: row.id, name: row.name, trade: row.trade, dataOrigin: row.dataOrigin, kind: 'crew' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
      ...source.workers.filter(row => !row.crewId || source.crews.some(crew => crew.id === row.crewId && crew.dataOrigin === row.dataOrigin))
        .map(row => ({ id: row.id, name: row.name, trade: row.trade, dataOrigin: row.dataOrigin, kind: 'worker' as const, ...effectiveMasterDataCapabilities(row.trade, row.tradeCapabilities, row.itemCapabilities) })),
    ]
  },
})
