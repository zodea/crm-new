import type { ScheduleCatalog, ScheduleReadQuery } from '../../app/lib/schedule/central-contract'
import { createHash } from 'node:crypto'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { resolveBusinessSession } from './business-session'
import { constructionContractReadTestInstance } from './construction-contract-read-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { processLibraryService } from './process-library-runtime'
import { projectReadTestInstance } from './project-read-test-instance'
import { quantityTestInstance } from './quantity-runtime'
import { createScheduleService } from './schedule-service'

export function scheduleSession(sessionId?: string | null) {
  return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
}
export const scheduleService = createScheduleService({
  session: scheduleSession,
  withSchedule: (query, consume, sessionId) => quantityTestInstance.withSchedule(query, consume, sessionId),
  sources(projectId, sessionId) {
    const context = scheduleSession(sessionId)
    if (!['construction-contract:read', 'owner-document:read', 'process-library:read'].every(capability => context.capabilities.includes(capability)))
      throw scheduleProblem('forbidden', '当前身份无权读取排程依赖的合同清单或工序库')
    const projectFacts = projectReadTestInstance.facts(sessionId)
    const project = projectFacts.rows.find(row => row.id === projectId && row.dataOrigin === 'real')
    if (!project)
      throw scheduleProblem('not-found', '当前真实项目不存在或已删除')
    const catalog = processLibraryService.catalog('real', context, sessionId)
    const libraries = catalog.libraries.map(row => processLibraryService.detail(row.id, 'real', context, sessionId))
    const contracts = constructionContractReadTestInstance.facts(sessionId).contracts.filter(row => row.dataOrigin === 'real' && row.projectId === projectId).map(row => ({ id: row.id, projectId, name: row.name, no: row.no }))
    const boq = ownerCommercialDocumentCommandTestInstance.quantityBoqFacts(projectId, sessionId)
    const version = createHash('sha256').update(JSON.stringify([projectFacts.sourceVersion, project, contracts, boq.sourceVersion, catalog.sourceVersion])).digest('hex')
    return { version, contracts, boq, libraries }
  },
})

export async function scheduleCatalog(origin: 'real' | 'demo', includeDemo: boolean, sessionId?: string | null): Promise<ScheduleCatalog> {
  const context = scheduleSession(sessionId)
  if (!context.capabilities.includes('schedule:read') || !context.capabilities.includes('project:list:read') || (origin === 'demo' && (!includeDemo || !context.capabilities.includes('demo:read'))))
    throw scheduleProblem('forbidden', '当前来源无排程读取权限')
  const facts = projectReadTestInstance.facts(sessionId)
  const projects = await Promise.all(facts.rows.filter(row => row.dataOrigin === origin).map(async (row) => {
    const query: ScheduleReadQuery = { projectId: row.id, origin, includeDemo }
    const groupCount = origin === 'real' ? (await scheduleService.groupUsage(query, sessionId)).groups.reduce((sum, group) => sum + group.groupCount, 0) : 0
    return { id: row.id, name: row.name, code: row.code ?? '', status: row.status ?? '', groupCount, origin }
  }))
  return { ...context, origin, capabilities: context.capabilities.filter(capability => origin === 'real' || capability !== 'schedule:write'), sourceVersion: facts.sourceVersion, projects }
}
