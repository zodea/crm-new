import type { BoqBuildingQuery } from '../../app/lib/boq/central-building-contract'
import type { createOwnerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import type { createQuantityTestInstance } from './quantity-test-instance'
import { parseBoqBuildingCommand, parseBoqBuildingQuery } from '../../app/lib/boq/central-building-request'
import { selectVisibleSql } from '../../app/lib/db/soft-delete'
import { quantityProblem } from '../../app/lib/quantity/central-contract'

/** BOQ 仍由原来源域发布；量域只提供当前楼栋与提交互斥。 */
export function createBoqBuildingTestInstance(owner: ReturnType<typeof createOwnerCommercialDocumentCommandTestInstance>, quantity: ReturnType<typeof createQuantityTestInstance>) {
  function run<T>(input: BoqBuildingQuery, consume: (session: Parameters<typeof owner.boqBuildingContext>[1], evidence: Parameters<typeof owner.boqBuildingContext>[2]) => T, sessionId?: string | null): Promise<T> {
    const query = parseBoqBuildingQuery(input)
    return quantity.withSourceCommit({ projectId: query.projectId, origin: query.origin, includeDemo: false }, async (db, session, quantityVersion) => {
      const rows = await db.select<{ id: string, code: string, name: string }>(selectVisibleSql('buildings', 'AND project_id = ? ORDER BY code, id'), [query.projectId])
      const buildings = rows.map(row => ({ id: row.id, code: row.code, name: row.name }))
      return (currentSession) => {
        if (currentSession.workspaceId !== session.workspaceId || currentSession.actorId !== session.actorId)
          throw quantityProblem('forbidden', '操作身份已变化，请重新读取清单')
        return consume(currentSession, { quantityVersion, buildings })
      }
    }, sessionId)
  }
  return {
    read(query: BoqBuildingQuery, sessionId?: string | null) {
      const request = parseBoqBuildingQuery(query)
      return run(request, (session, evidence) => owner.boqBuildingContext(request, session, evidence, sessionId), sessionId)
    },
    async execute(input: unknown, sessionId?: string | null) {
      const commandId = input && typeof input === 'object' && 'commandId' in input && typeof input.commandId === 'string' ? input.commandId.trim() : ''
      try {
        const command = parseBoqBuildingCommand(input)
        return await run(command, (session, evidence) => owner.correctBoqBuilding(command, session, evidence, sessionId), sessionId)
      }
      catch (cause) {
        if (commandId && !owner.hasBoqBuildingCommand(commandId, sessionId) && cause && typeof cause === 'object' && 'problem' in cause && cause.problem && typeof cause.problem === 'object'
          && 'code' in cause.problem && ['forbidden', 'not-found', 'relationship-mismatch', 'validation-failed', 'conflict', 'stale-source'].includes(String(cause.problem.code))) {
          Object.assign(cause.problem, { commandId, commandOutcome: 'not-applied' })
        }
        throw cause
      }
    },
  }
}
