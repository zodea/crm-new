import type { TransactionDb } from '~/lib/db/coordinator'
import type { QuantityCommand, QuantityContext } from '~/lib/quantity/central-contract'
import type { QuantityHollowAction, QuantityHollowRead } from '~/lib/quantity/central-hollow-contract'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { createQuantityService } from '~/lib/quantity/central-service'
import { blankQuantityTemplateDraft } from '~/lib/quantity/template'
import { createQuantityHollowService } from '../../server/utils/quantity-hollow-service'
import { createMigratedMemoryDb } from './memory-db'

/** 所有位置、模板和原责任由真实公开 quantity 命令建立。 */
export async function createQuantityHollowFixture() {
  const db = await createMigratedMemoryDb()
  const coordinator = createDbCoordinator(async () => db)
  let session: QuantityContext = { workspaceId: 'hollow-work', actorId: 'hollow-actor', capabilities: ['quantity:read', 'quantity:write', 'project:list:read', 'crew:list:read', 'worker:list:read'] }
  const projects = [{ id: 'hollow-project', name: '检查项目', code: 'H', dataOrigin: 'real' as const }]
  const people = [{ id: 'hollow-worker', name: '施工责任人', kind: 'worker' as const, trade: '泥水工', trades: ['泥水工'], itemNames: [], dataOrigin: 'real' as const }]
  const query = { projectId: projects[0]!.id, origin: 'real' as const, includeDemo: false }
  const quantity = createQuantityService({ workspaceId: session.workspaceId, database: coordinator, project: async id => projects.find(row => row.id === id) ?? null, people: async () => structuredClone(people) })
  let sequence = 0
  async function executeQuantity(action: QuantityCommand['action']) {
    const before = await quantity.region(query, session)
    return quantity.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'quantity:write', commandId: `quantity-${++sequence}`, baseVersion: before.sourceVersion, origin: 'real', projectId: query.projectId, action }, session)
  }
  const template = blankQuantityTemplateDraft(query.projectId)
  template.code = 'A'
  template.name = '真实检查户型'
  template.newItems = [{ key: 'wall', code: 'W', name: '墙砖', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
  template.lines = [{ key: 'wall-line', id: null, roomKey: template.rooms[0]!.key, itemId: 'wall', recognizedContractQty: null, contractQty: null, provisionalQty: null, fieldFormula: '2 * 3', fieldQty: 6, note: '', sortOrder: 1 }]
  const savedTemplate = await executeQuantity({ kind: 'save-template', draft: template })
  const building = await executeQuantity({ kind: 'create-building', draft: { code: 'B1', name: '一栋' } })
  const floor = await executeQuantity({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '一层' } })
  const unit = await executeQuantity({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101室', templateId: savedTemplate.id } })
  const scopeOption = (await quantity.assignments(query, session)).data.scopeOptions[0]!
  await executeQuantity({ kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥水工', assigneeKind: 'worker', assigneeId: people[0]!.id, unitIds: [unit.id], expectedAssignments: [{ unitId: unit.id, assignmentId: null, fingerprint: null }], scopes: [{ unitId: unit.id, roomId: scopeOption.roomId, itemId: scopeOption.itemId }], note: '', allowReplacement: false } })
  const options = { session: () => structuredClone(session), projects: () => structuredClone(projects), people: () => structuredClone(people), transaction: <T>(work: (tx: TransactionDb, context: QuantityContext) => Promise<T>) => coordinator.withTransaction(tx => work(tx, structuredClone(session))) }
  const service = createQuantityHollowService(options)
  const scope = { ...query, unitId: unit.id }
  const command = (read: QuantityHollowRead, action: QuantityHollowAction) => ({ workspaceId: read.context.workspaceId, actorId: read.context.actorId, requiredCapability: 'quantity:write' as const, commandId: `hollow-${++sequence}`, baseVersion: read.sourceVersion, origin: 'real' as const, projectId: scope.projectId, action })
  return { db, coordinator, service, quantity, scope, projects, people, command, executeQuantity, reload: () => createQuantityHollowService(options), setSession: (next: QuantityContext) => {
    session = next
  }, session: () => structuredClone(session), close: () => coordinator.close() }
}
