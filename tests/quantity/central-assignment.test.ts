import type { TestDb } from '../helpers/memory-db'
import type { QuantityCommand } from '~/lib/quantity/central-contract'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { createQuantityService } from '~/lib/quantity/central-service'
import { decodeQuantityAssignments } from '~/lib/quantity/central-workspace-decoder'
import { blankQuantityTemplateDraft } from '~/lib/quantity/template'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let memory: TestDb
const context = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['project:list:read', 'quantity:read', 'quantity:write', 'crew:list:read', 'worker:list:read'] }
const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }
let people = [{ id: 'crew', kind: 'crew' as const, name: '当前班组', trade: '泥水工', trades: ['泥水工'], itemNames: [], dataOrigin: 'real' as 'real' | 'demo' }]

beforeEach(async () => {
  memory = await createMigratedMemoryDb()
  people = [{ id: 'crew', kind: 'crew', name: '当前班组', trade: '泥水工', trades: ['泥水工'], itemNames: [], dataOrigin: 'real' }]
})
afterEach(() => memory.close())

async function setup() {
  const service = createQuantityService({
    workspaceId: context.workspaceId,
    database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
    project: async id => ({ id, name: '正式项目', code: 'P' }),
    people: async () => people,
  })
  const save = async (action: QuantityCommand['action']) => {
    const before = await service.region(query, context)
    return service.execute({ ...context, ...query, requiredCapability: 'quantity:write', commandId: crypto.randomUUID(), baseVersion: before.sourceVersion, action }, context)
  }
  const building = await save({ kind: 'create-building', draft: { code: 'B', name: '1栋' } })
  const floor = await save({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F', name: '1层' } })
  const draft = blankQuantityTemplateDraft(query.projectId)
  draft.code = 'A'
  draft.name = 'A户型'
  draft.newItems = [{ key: 'wall', code: 'W', name: '墙面', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
  draft.lines = [{ key: 'line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'wall', recognizedContractQty: null, contractQty: 0, provisionalQty: null, fieldFormula: '', fieldQty: null, note: '', sortOrder: 1 }]
  const template = await save({ kind: 'save-template', draft })
  const unit = await save({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101室', templateId: template.id } })
  return { service, save, unitId: unit.id }
}

it('责任从当前中央主数据选人，保存后同一工作区回读且重试不重复责任与审计', async () => {
  const { service, unitId } = await setup()
  const before = await service.assignments(query, context)
  expect(decodeQuantityAssignments(before, query)).toEqual(before)
  expect(before.data.assignees).toMatchObject([{ id: 'crew', name: '当前班组' }])
  const command: QuantityCommand = { ...context, ...query, requiredCapability: 'quantity:write', commandId: 'assign', baseVersion: before.sourceVersion, action: { kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥水工', assigneeKind: 'crew', assigneeId: 'crew', unitIds: [unitId], expectedAssignments: [{ unitId, assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } } }
  const saved = await service.execute(command, context)
  expect(await service.execute(command, context)).toEqual(saved)
  expect((await service.assignments(query, context)).data.assignments).toMatchObject([{ unitId, assigneeId: 'crew', assigneeName: '当前班组' }])
  expect(await memory.select('SELECT id FROM unit_assignments')).toHaveLength(1)
  expect(await memory.select('SELECT id FROM operation_logs WHERE table_name = ?', ['unit_assignments'])).toHaveLength(1)
})

it('主数据来源删除或同 ID 只剩演示候选后不能沿旧副本继续分配；撤权不能读出旧责任', async () => {
  const { service, unitId } = await setup()
  const before = await service.assignments(query, context)
  const command: QuantityCommand = { ...context, ...query, requiredCapability: 'quantity:write', commandId: 'assign', baseVersion: before.sourceVersion, action: { kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥水工', assigneeKind: 'crew', assigneeId: 'crew', unitIds: [unitId], expectedAssignments: [{ unitId, assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } } }
  await service.execute(command, context)
  people = [{ ...people[0]!, dataOrigin: 'demo' }]
  await expect(service.execute(command, context)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  expect((await service.assignments(query, context)).data.assignees).toEqual([])
  expect((await service.assignments(query, context)).data.assignments).toMatchObject([{ assigneeId: 'crew', assigneeName: '已删除班组' }])
  await expect(service.assignments(query, { ...context, capabilities: context.capabilities.filter(cap => cap !== 'crew:list:read') })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  expect(await memory.select('SELECT id FROM unit_assignments')).toHaveLength(1)
})

it('当前主数据改工种后，保存时重新校验能力，不能采纳读取时旧候选', async () => {
  const { service, save, unitId } = await setup()
  await service.assignments(query, context)
  people = [{ ...people[0]!, trade: '木工', trades: ['木工'] }]
  await expect(save({ kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥水工', assigneeKind: 'crew', assigneeId: 'crew', unitIds: [unitId], expectedAssignments: [{ unitId, assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } }))
    .rejects
    .toMatchObject({ problem: { code: 'validation-failed' } })
  expect(await memory.select('SELECT id FROM unit_assignments')).toEqual([])
})
