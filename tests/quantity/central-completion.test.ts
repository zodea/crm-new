import type { TestDb } from '../helpers/memory-db'
import type { QuantityCommand } from '~/lib/quantity/central-contract'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { runMigrations } from '~/lib/db/migrations'
import { decodeQuantityCommand } from '~/lib/quantity/central-command-decoder'
import { createQuantityService } from '~/lib/quantity/central-service'
import { decodeQuantityBatchPlan, decodeQuantityCompletion, decodeQuantityWorkspace } from '~/lib/quantity/central-workspace-decoder'
import { createMemoryDb } from '../helpers/memory-db'

let memory: TestDb
const context = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['project:list:read', 'quantity:read', 'quantity:write', 'crew:list:read', 'worker:list:read'] }
const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }
const photo = { fileName: '验收.png', mimeType: 'image/png', fileSize: 3, contentBase64: 'AQID' }

beforeEach(async () => {
  memory = await createMemoryDb()
  await runMigrations(memory)
  await memory.execute('INSERT INTO projects (id, name) VALUES (\'project\', \'正式项目\')')
  await memory.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (\'building\', \'project\', \'B\', \'1栋\')')
  await memory.execute('INSERT INTO floors (id, building_id, code, name) VALUES (\'floor\', \'building\', \'F\', \'1层\')')
  await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (\'template\', \'project\', \'A\', \'A户型\')')
  await memory.execute('INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES (\'unit\', \'floor\', \'template\', \'101\')')
  await memory.execute('INSERT INTO rooms (id, template_id, code, name) VALUES (\'room\', \'template\', \'R\', \'客厅\')')
  await memory.execute('INSERT INTO items (id, project_id, code, name, trade, unit) VALUES (\'item\', \'project\', \'I\', \'腻子\', \'油漆工\', \'㎡\')')
  await memory.execute('INSERT INTO house_type_template_items (id, room_id, item_id, contract_qty, provisional_qty, field_qty) VALUES (\'line\', \'room\', \'item\', 0, 10, NULL)')
  await memory.execute('INSERT INTO construction_stages (id, project_id, code, name, trade, sort_order) VALUES (\'first\', \'project\', \'S1\', \'第一遍\', \'油漆工\', 1), (\'second\', \'project\', \'S2\', \'第二遍\', \'油漆工\', 2)')
  await memory.execute('INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage) VALUES (\'map-1\', \'first\', \'item\', 0), (\'map-2\', \'second\', \'item\', 1)')
})
afterEach(() => memory.close())

async function setup() {
  let currentPeople = ['crew-1', 'crew-2']
  const service = createQuantityService({
    workspaceId: context.workspaceId,
    database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
    project: async id => ({ id, name: '正式项目', code: 'P' }),
    people: async () => currentPeople.map(id => ({ id, kind: 'crew' as const, name: id === 'crew-1' ? '原班组' : '新班组', trade: '油漆工', trades: ['油漆工'], itemNames: [], dataOrigin: 'real' as const })),
  })
  const save = async (action: QuantityCommand['action']) => {
    const before = await service.region(query, context)
    const command: QuantityCommand = { ...context, ...query, requiredCapability: 'quantity:write', commandId: crypto.randomUUID(), baseVersion: before.sourceVersion, action }
    const result = await service.execute(command, context)
    expect(decodeQuantityCommand(result, command)).toEqual(result)
    expect(await service.execute(command, context)).toEqual(result)
    return result
  }
  await save({ kind: 'save-assignments', draft: { projectId: query.projectId, trade: '油漆工', assigneeKind: 'crew', assigneeId: 'crew-1', unitIds: ['unit'], expectedAssignments: [{ unitId: 'unit', assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } })
  const completion = async (stageId: string, status: 'draft' | 'completed', photos = [photo]) => {
    const workspace = await service.completion({ ...query, unitId: 'unit' }, context)
    const stage = workspace.data.stages.find(row => row.id === stageId)!
    return { kind: 'save-completion' as const, draft: { projectId: query.projectId, unitId: 'unit', stageId, status, completedAt: '2026-09-11', note: '现场记录', expectedCompletionId: stage.completion?.id ?? null, expectedCompletionFingerprint: stage.completion?.fingerprint ?? null, expectedAssignmentId: stage.currentAssignment?.id ?? null, photos } }
  }
  return {
    service,
    save,
    completion,
    removeCurrentPerson: () => {
      currentPeople = ['crew-2']
    },
  }
}

it('两阶段独立完成，月度只计指定阶段，未知现场量保留，照片同源且责任替换不重写执行历史', async () => {
  const { service, save, completion } = await setup()
  await save(await completion('first', 'completed'))
  const saved = await save(await completion('second', 'completed'))
  const workspace = await service.workspace(query, context)
  expect(decodeQuantityWorkspace(workspace, query)).toEqual(workspace)
  expect(() => decodeQuantityWorkspace({ ...workspace, data: { ...workspace.data, snapshot: { ...workspace.data.snapshot, units: [] } } }, query)).toThrow()
  const detail = await service.completion({ ...query, unitId: 'unit' }, context)
  expect(decodeQuantityCompletion(detail, { ...query, unitId: 'unit' })).toEqual(detail)
  expect(() => decodeQuantityCompletion(detail, { ...query, unitId: 'other-unit' })).toThrow()
  expect(workspace.data.stageProgress.map(row => row.completedUnits)).toEqual([1, 1])
  expect(workspace.data.monthly).toMatchObject([{ stageId: 'second', contractQty: { value: 0 }, fieldQty: { value: null } }])
  expect(workspace.data.records).toHaveLength(2)
  const content = await service.photo({ ...query, unitId: 'unit', completionId: saved.id, photoId: saved.completion!.photoIds[0]! }, context)
  expect(content.data.contentBase64).toBe(photo.contentBase64)
  expect(await memory.select('SELECT DISTINCT uploader FROM file_refs')).toEqual([{ uploader: context.actorId }])
  const assignment = (await service.assignments(query, context)).data.assignments[0]!
  await save({ kind: 'save-assignments', draft: { projectId: query.projectId, trade: '油漆工', assigneeKind: 'crew', assigneeId: 'crew-2', unitIds: ['unit'], expectedAssignments: [{ unitId: 'unit', assignmentId: assignment.id, fingerprint: assignment.fingerprint }], scopes: [], allowReplacement: true } })
  await save({ ...(await completion('second', 'completed', [])), draft: { ...(await completion('second', 'completed', [])).draft, note: '更正备注' } })
  expect((await service.workspace(query, context)).data.records).toEqual(expect.arrayContaining([expect.objectContaining({ executionAssigneeName: '原班组', currentAssigneeName: '新班组' })]))
})

it('缺照片只能保留草稿，正式请求不能使用历史迁移旁路，损坏照片不产生完成和附件', async () => {
  const { service, save, completion } = await setup()
  const missing = await completion('first', 'completed', [])
  await expect(save(missing)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  await expect(save({ ...missing, draft: { ...missing.draft, allowMissingPhotos: true } } as never)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  await expect(save({ ...missing, draft: { ...missing.draft, photos: [{ ...photo, fileSize: 5 }] } })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  expect(await memory.select('SELECT id FROM unit_stage_completions')).toEqual([])
  expect(await memory.select('SELECT id FROM file_refs')).toEqual([])
  await save(await completion('first', 'draft', []))
  expect((await service.workspace(query, context)).data.snapshot.completions).toMatchObject([{ status: 'draft' }])
})

it('批量按适用阶段逐项降级草稿，不能绕过缺照片或混入其他工种阶段', async () => {
  const { service, save } = await setup()
  const plan = await service.batchPlan({ ...query, trade: '油漆工', unitIds: ['unit'] }, context)
  expect(decodeQuantityBatchPlan(plan, { ...query, trade: '油漆工', unitIds: ['unit'] })).toEqual(plan)
  expect(() => decodeQuantityBatchPlan(plan, { ...query, trade: '油漆工', unitIds: ['other-unit'] })).toThrow()
  expect(plan.data.items).toHaveLength(2)
  const items = plan.data.items.map(({ unitId, stageId, expectedCompletionId, expectedCompletionFingerprint, expectedAssignmentId }) => ({ unitId, stageId, expectedCompletionId, expectedCompletionFingerprint, expectedAssignmentId }))
  const result = await save({ kind: 'save-completion-batch', draft: { projectId: query.projectId, trade: '油漆工', completedAt: '2026-09-11', note: '', items } })
  expect(result.batch?.drafted).toHaveLength(2)
  expect(result.batch?.completed).toEqual([])
  expect((await service.workspace(query, context)).data.monthly).toEqual([])
})

it('当前责任人删除后不能新完成，批量保留草稿，而既有完成更正保留执行责任', async () => {
  const { service, save, completion, removeCurrentPerson } = await setup()
  await save(await completion('first', 'completed'))
  await save(await completion('second', 'draft'))
  removeCurrentPerson()
  const missing = await completion('second', 'completed', [])
  await expect(save(missing)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  const detail = await service.completion({ ...query, unitId: 'unit' }, context)
  expect(detail.data.stages[0]!.currentAssignment).toMatchObject({ assigneeName: '已删除班组', available: false })
  expect(decodeQuantityCompletion(detail, { ...query, unitId: 'unit' })).toEqual(detail)
  const correction = await completion('first', 'completed', [])
  await save({ ...correction, draft: { ...correction.draft, note: '责任失效后更正历史备注' } })
  const plan = await service.batchPlan({ ...query, trade: '油漆工', unitIds: ['unit'] }, context)
  expect(plan.data.items.find(row => row.stageId === 'first')).toMatchObject({ projectedStatus: 'completed', projectedReason: null })
  expect(plan.data.items.find(row => row.stageId === 'second')).toMatchObject({ projectedStatus: 'draft', projectedReason: 'missing-assignment' })
  const items = plan.data.items.map(({ unitId, stageId, expectedCompletionId, expectedCompletionFingerprint, expectedAssignmentId }) => ({ unitId, stageId, expectedCompletionId, expectedCompletionFingerprint, expectedAssignmentId }))
  await save({ kind: 'save-completion-batch', draft: { projectId: query.projectId, trade: '油漆工', completedAt: '2026-09-11', note: '批量核对', items } })
  expect((await service.workspace(query, context)).data.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ stageId: 'first', status: 'completed', executionAssigneeName: '原班组' }),
    expect.objectContaining({ stageId: 'second', status: 'draft' }),
  ]))
})

it('模板后续删明细仅改变当前应做分母，中央回读不拒收超过当前应做户数的历史完成', async () => {
  const { service, save, completion } = await setup()
  await save(await completion('first', 'completed'))
  await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['template-2', 'project', 'B', 'B户型'])
  await memory.execute('INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES (?, ?, ?, ?)', ['unit-2', 'floor', 'template-2', '102'])
  await memory.execute('INSERT INTO rooms (id, template_id, code, name) VALUES (?, ?, ?, ?)', ['room-2', 'template-2', 'R', '客厅'])
  await memory.execute('INSERT INTO house_type_template_items (id, room_id, item_id, contract_qty) VALUES (?, ?, ?, ?)', ['line-2', 'room-2', 'item', 3])
  await memory.execute('INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES (?, ?, ?, ?)', ['assignment-2', 'unit-2', '油漆工', 'crew-1'])
  await memory.execute('INSERT INTO unit_stage_completions (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES (?, ?, ?, ?, ?, ?)', ['completion-2', 'unit-2', 'first', 'assignment-2', 'completed', '2026-09-11'])
  await memory.execute('UPDATE house_type_template_items SET deleted_at = ? WHERE id = ?', ['2026-09-11', 'line-2'])
  const workspace = await service.workspace(query, context)
  expect(workspace.data.stageProgress.find(row => row.stageId === 'first')).toMatchObject({ applicableUnits: 1, completedUnits: 2, completionRate: 2 })
  expect(decodeQuantityWorkspace(workspace, query)).toEqual(workspace)
})
