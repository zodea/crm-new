import type { QuantityCommand } from '../../app/lib/quantity/central-contract'
import { Buffer } from 'node:buffer'
import { blankQuantityTemplateDraft } from '../../app/lib/quantity/template'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { createProductionQuantityService } from '../../server/utils/production-quantity-service'
import { installProductionBoqFixture } from './production-boq-fixture'
import { createConstructionScopeFixture } from './production-construction-scope-fixture'

export async function createPayrollAUpstreamFixture() {
  const f = await createConstructionScopeFixture()
  for (const cap of ['payroll:read', 'payroll:write', 'quantity:read', 'quantity:write', 'worker:list:read', 'worker:write', 'crew:list:read', 'crew:write']) {
    if (!f.actor.capabilities.includes(cap))
      f.actor.capabilities.push(cap)
  }
  const boq = await installProductionBoqFixture(f.storage, f.actor, f.project.id, { qty: 100, unitPrice: 37, itemName: '涂料' })
  const master = createProductionCrewWorkerService(f.storage)
  const common = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, baseVersion: null, action: 'draft', attachments: {} }
  const crew = await master.executeCrew({ ...common, commandId: 'upstream-real-crew', requiredCapability: 'crew:write', draft: { name: '实际油漆班组', trade: '油漆工' } }, f.session)
  const leader = await master.executeWorker({ ...common, commandId: 'upstream-real-leader', requiredCapability: 'worker:write', draft: { name: '实际负责人', crewId: crew.id, currentProjectId: f.project.id, dailyWage: 100 } }, f.session)
  const zero = await master.executeWorker({ ...common, commandId: 'upstream-real-zero', requiredCapability: 'worker:write', draft: { name: '固定零成员', crewId: crew.id, currentProjectId: f.otherProject.id, dailyWage: 0 } }, f.session)
  const service = createProductionQuantityService(f.storage).forSession(f.session)
  const query = { projectId: f.project.id, origin: 'real' as const }
  const execute = async (action: QuantityCommand['action'], commandId: string, baseVersion: string) => service.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, projectId: query.projectId, origin: 'real', requiredCapability: 'quantity:write', commandId, baseVersion, action })
  const building = await execute({ kind: 'create-building', draft: { code: 'A', name: '实际楼栋' } }, 'upstream-real-building', (await service.region(query)).sourceVersion)
  const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: '1', name: '实际楼层' } }, 'upstream-real-floor', (await service.region(query)).sourceVersion)
  const source = await service.boq(query)
  const sourceLine = source.data.lines.find(line => line.id === boq.line.id)!
  const draft = blankQuantityTemplateDraft(f.project.id)
  draft.code = 'T'
  draft.name = '实际户型'
  draft.newItems = [{ key: 'paint', code: 'P', name: '涂料', section: '', trade: '油漆工', unit: '㎡', sortOrder: 1 }]
  draft.lines = [{ key: 'paint-line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'paint', boqLineId: sourceLine.id, boqBindingVersion: sourceLine.bindingVersion, recognizedContractQty: sourceLine.qty, contractQty: sourceLine.qty, provisionalQty: null, fieldFormula: '100', fieldQty: 100, note: '实际完成量，工资报价独立', sortOrder: 1 }]
  const template = await execute({ kind: 'save-template', draft }, 'upstream-real-template', (await service.templates(query)).sourceVersion)
  const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '实际施工户', templateId: template.id } }, 'upstream-real-unit', (await service.region(query)).sourceVersion)
  const templates = await service.templates(query)
  const itemId = templates.data.lines.find(line => line.boqLineId === sourceLine.id)!.itemId
  const stage = await execute({ kind: 'save-stage', draft: { id: null, code: 'P', name: '涂料完成', trade: '油漆工', completionMode: 'unit', sortOrder: 1, itemIds: [itemId] }, allowArchivedEdit: false }, 'upstream-real-stage', (await service.stages(query)).sourceVersion)
  await execute({ kind: 'set-reporting-stage', itemId, stageId: stage.id, allowArchivedEdit: false }, 'upstream-real-reporting-stage', (await service.stages(query)).sourceVersion)
  const assignments = await service.assignments(query)
  const assignment = await execute({ kind: 'save-assignments', draft: { projectId: f.project.id, trade: '油漆工', assigneeKind: 'crew', assigneeId: crew.id, unitIds: [unit.id], expectedAssignments: [{ unitId: unit.id, assignmentId: null, fingerprint: null }], scopes: [], note: '已核实原执行班组', allowReplacement: false } }, 'upstream-real-assignment', assignments.sourceVersion)
  const completion = await service.completion({ ...query, unitId: unit.id })
  const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
  await execute({ kind: 'save-completion', draft: { projectId: f.project.id, unitId: unit.id, stageId: stage.id, status: 'completed', completedAt: '2026-10-01', note: '实际现场完成', photos: [{ fileName: '真实验收照片.png', mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }], expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: assignment.assignments!.assignmentIds[0]!, allowArchivedEdit: false } }, 'upstream-real-completion', completion.sourceVersion)
  return { ...f, boq, master, crew, leader, zero, quantity: service, query, itemId, template, unit, stage }
}
