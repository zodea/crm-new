import type { TestDb } from '../helpers/memory-db'
import type { QuantityCommand } from '~/lib/quantity/central-contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { runMigrations } from '~/lib/db/migrations'
import { createQuantityService } from '~/lib/quantity/central-service'
import { blankQuantityTemplateDraft, borrowedQuantityTemplateDraft, editableQuantityTemplateDraft } from '~/lib/quantity/template'
import { createMemoryDb } from '../helpers/memory-db'

let memory: TestDb
const context = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['quantity:read', 'quantity:write', 'project:list:read'] }
const query = { projectId: 'central-quantity-project', origin: 'real' as const, includeDemo: false }

function currentService() {
  return createQuantityService({
    workspaceId: context.workspaceId,
    database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
    project: async (id: string) => ({ id, name: '中央新项目', code: 'Q-CENTRAL' }),
  })
}

async function save(service: ReturnType<typeof currentService>, action: QuantityCommand['action'], commandId: string, projectId = query.projectId) {
  const before = await service.region({ ...query, projectId }, context)
  return service.execute({ ...context, requiredCapability: 'quantity:write', commandId, baseVersion: before.sourceVersion, origin: 'real', projectId, action }, context)
}

beforeEach(async () => {
  memory = await createMemoryDb()
  await runMigrations(memory)
})
afterEach(() => memory.close())

describe('中央工程量公共服务', () => {
  it('迁移切换只推进受影响项目版本并失效其旧命令重放，其他项目的幂等回执保留', async () => {
    const service = currentService()
    const commandFor = async (projectId: string, commandId: string): Promise<QuantityCommand> => ({
      ...context,
      requiredCapability: 'quantity:write',
      commandId,
      baseVersion: (await service.region({ ...query, projectId }, context)).sourceVersion,
      origin: 'real',
      projectId,
      action: { kind: 'create-building', draft: { code: 'B1', name: '一栋' } },
    })
    const changed = await commandFor(query.projectId, 'changed-project')
    await service.execute(changed, context)
    const independent = await commandFor('independent-project', 'independent-project')
    const kept = await service.execute(independent, context)
    const before = await service.region(query, context)
    service.invalidateProjects([query.projectId, query.projectId])
    expect((await service.region(query, context)).sourceVersion).not.toBe(before.sourceVersion)
    await expect(service.execute(changed, context)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect(await service.execute(independent, context)).toEqual(kept)
    expect((await service.region({ ...query, projectId: 'independent-project' }, context)).sourceVersion).toBe(kept.sourceVersion)
  })

  it('模板、三量、计算公式、借用和撤回均在中央事务回读，客户端显示量不能替代公式重算', async () => {
    const service = currentService()
    const draft = blankQuantityTemplateDraft(query.projectId)
    draft.code = 'A'
    draft.name = 'A户型'
    draft.newItems = [{ key: 'wall', code: 'W', name: '墙面', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
    draft.lines = [{ key: 'line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'wall', recognizedContractQty: null, contractQty: 0, provisionalQty: null, fieldFormula: '2 * 3', fieldQty: 999, note: '', sortOrder: 1 }]
    const saved = await save(service, { kind: 'save-template', draft }, 'save-template')
    const loaded = await service.templates(query, context)
    expect(loaded.data.lines).toEqual([expect.objectContaining({ contractQty: 0, provisionalQty: null, fieldQty: 6, recognizedContractQty: null })])
    expect(saved.logIds.length).toBeGreaterThan(0)
    const borrowed = borrowedQuantityTemplateDraft(loaded.data, saved.id)
    borrowed.code = 'B'
    borrowed.name = 'B户型'
    borrowed.lines[0]!.recognizedContractQty = 999
    await expect(save(service, { kind: 'save-template', draft: borrowed }, 'forged-recognized'))
      .rejects
      .toMatchObject({ problem: { code: 'stale-source' } })
    borrowed.lines[0]!.recognizedContractQty = null
    const copy = await save(service, { kind: 'save-template', draft: borrowed }, 'copy-template')
    expect((await service.templates(query, context)).data.templates).toHaveLength(2)
    const removed = await save(service, { kind: 'delete-template', templateId: copy.id, allowArchivedEdit: false }, 'delete-template')
    expect((await service.templates(query, context)).data.templates.map(row => row.id)).toEqual([saved.id])
    await save(service, { kind: 'undo-template', logIds: removed.logIds, allowArchivedEdit: false }, 'undo-delete')
    expect((await service.templates(query, context)).data.templates).toHaveLength(2)
    const actors = await memory.select<{ operator: string }>('SELECT DISTINCT operator FROM operation_logs')
    expect(actors).toEqual([{ operator: context.actorId }])
  })

  it('已保存的借用副本在来源删除后仍可独立编辑，但不能改写来源或继续新借用', async () => {
    const service = currentService()
    const original = blankQuantityTemplateDraft(query.projectId)
    original.code = 'A'
    original.name = '来源户型'
    const source = await save(service, { kind: 'save-template', draft: original }, 'snapshot-source')
    const borrowed = borrowedQuantityTemplateDraft((await service.templates(query, context)).data, source.id)
    borrowed.code = 'B'
    borrowed.name = '独立副本'
    const copy = await save(service, { kind: 'save-template', draft: borrowed }, 'snapshot-copy')
    await save(service, { kind: 'delete-template', templateId: source.id, allowArchivedEdit: false }, 'snapshot-delete-source')

    const draft = editableQuantityTemplateDraft((await service.templates(query, context)).data, copy.id)
    draft.name = '副本独立更名'
    await save(service, { kind: 'save-template', draft }, 'snapshot-edit-copy')
    const current = (await service.templates(query, context)).data
    expect(current.templates).toEqual([expect.objectContaining({ id: copy.id, name: '副本独立更名', copiedFromTemplateId: source.id })])

    const forged = editableQuantityTemplateDraft(current, copy.id)
    forged.copiedFromTemplateId = null
    await expect(save(service, { kind: 'save-template', draft: forged }, 'snapshot-forged-provenance'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    const repeatedCopy = editableQuantityTemplateDraft(current, copy.id)
    repeatedCopy.rooms[0]!.sourceRoomId = borrowed.rooms[0]!.sourceRoomId
    await expect(save(service, { kind: 'save-template', draft: repeatedCopy }, 'snapshot-forged-room-source'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(save(service, { kind: 'save-template', draft: { ...borrowed, code: 'C', name: '失效来源新副本' } }, 'snapshot-new-after-delete'))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect((await service.templates(query, context)).data.templates).toEqual(current.templates)
  })

  it('归档后的模板撤回要求独立确认，确认意图绑定命令且重放仍重验当前归档门', async () => {
    const service = currentService()
    const draft = blankQuantityTemplateDraft(query.projectId)
    draft.code = 'A'
    draft.name = '归档前模板'
    const saved = await save(service, { kind: 'save-template', draft }, 'archive-template')
    await save(service, { kind: 'set-archived', archived: true }, 'archive-project')
    const before = await service.templates(query, context)
    const command: QuantityCommand = {
      ...context,
      requiredCapability: 'quantity:write',
      commandId: 'archive-undo',
      baseVersion: before.sourceVersion,
      projectId: query.projectId,
      origin: 'real',
      action: { kind: 'undo-template', logIds: saved.logIds, allowArchivedEdit: false } as QuantityCommand['action'],
    }
    await expect(service.execute(command, context)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await service.templates(query, context)).toMatchObject({ sourceVersion: before.sourceVersion, data: before.data })
    const confirmed: QuantityCommand = { ...command, commandId: 'archive-undo-confirmed', action: { ...command.action, allowArchivedEdit: true } as QuantityCommand['action'] }
    const result = await service.execute(confirmed, context)
    expect((await service.templates(query, context)).data.templates).toEqual([])
    expect(await service.execute(confirmed, context)).toEqual(result)
    await expect(service.execute(confirmed, { ...context, capabilities: ['quantity:read', 'project:list:read'] }))
      .rejects
      .toMatchObject({ problem: { code: 'forbidden' } })
    await expect(service.execute({ ...confirmed, action: command.action }, context))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    await save(service, { kind: 'set-archived', archived: false }, 'unarchive-project')
    await expect(service.execute({ ...confirmed, action: command.action }, context))
      .rejects
      .toMatchObject({ problem: { code: 'conflict' } })
  })

  it('模板嵌入的项目不能越过当前命令范围，格式损坏不能进入保存域', async () => {
    const service = currentService()
    const wrong = blankQuantityTemplateDraft('other-project')
    wrong.code = 'X'
    wrong.name = '错误项目'
    await expect(save(service, { kind: 'save-template', draft: wrong }, 'wrong-template-project'))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(save(service, { kind: 'save-template', draft: { ...wrong, projectId: query.projectId, rooms: null as never } }, 'malformed-template'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.templates(query, context)).data.templates).toEqual([])
  })

  it('楼层与户由同一项目的当前楼栋、楼层和模板创建，跨项目关系拒绝且不推进版本', async () => {
    const service = currentService()
    const building = await save(service, { kind: 'create-building', draft: { code: 'B1', name: '1栋' } }, 'building')
    const floor = await save(service, { kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '1层' } }, 'floor')
    await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['template', query.projectId, 'A', 'A户型'])
    const unit = await save(service, { kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101室', templateId: 'template' } }, 'unit')
    expect((await service.region(query, context)).data).toMatchObject({
      floors: [expect.objectContaining({ id: floor.id, buildingId: building.id })],
      units: [expect.objectContaining({ id: unit.id, floorId: floor.id, templateId: 'template' })],
    })
    const other = await service.region({ ...query, projectId: 'other-project' }, context)
    await expect(save(service, { kind: 'create-floor', buildingId: building.id, draft: { code: 'F2', name: '越界楼层' } }, 'wrong-floor', 'other-project'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.region({ ...query, projectId: 'other-project' }, context)).sourceVersion).toBe(other.sourceVersion)
    await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['other-template', 'other-project', 'A', '外项目户型'])
    await expect(save(service, { kind: 'create-unit', floorId: floor.id, draft: { code: '102', name: '越界模板', templateId: 'other-template' } }, 'wrong-template'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.region(query, context)).data.units).toHaveLength(1)
  })

  it('审计写入中断回滚楼栋和版本，重试同一命令只保留一个完整事实', async () => {
    const service = currentService()
    const before = await service.region(query, context)
    const command: QuantityCommand = { ...context, requiredCapability: 'quantity:write', commandId: 'retry-failure', baseVersion: before.sourceVersion, origin: 'real', projectId: query.projectId, action: { kind: 'create-building', draft: { code: 'B1', name: '1栋' } } }
    await memory.execute('CREATE TRIGGER fail_quantity_audit BEFORE UPDATE OF operator ON operation_logs BEGIN SELECT RAISE(ABORT, \'审计故障\'); END')
    await expect(service.execute(command, context)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await service.region(query, context)).sourceVersion).toBe(before.sourceVersion)
    expect(await memory.select('SELECT id FROM buildings')).toEqual([])
    expect(await memory.select('SELECT id FROM operation_logs')).toEqual([])
    await memory.execute('DROP TRIGGER fail_quantity_audit')
    const result = await service.execute(command, context)
    expect(await service.execute(command, context)).toEqual(result)
    expect((await service.region(query, context)).data.buildings).toHaveLength(1)
  })

  it('旧版本不能覆盖新事实，幂等返回前仍重查当前读取权限和项目存在性', async () => {
    let exists = true
    const service = createQuantityService({
      workspaceId: context.workspaceId,
      database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
      project: async id => exists ? { id, name: '当前项目', code: 'Q' } : null,
    })
    const before = await service.region(query, context)
    const command: QuantityCommand = { ...context, requiredCapability: 'quantity:write', commandId: 'original', baseVersion: before.sourceVersion, origin: 'real', projectId: query.projectId, action: { kind: 'create-building', draft: { code: 'B1', name: '1栋' } } }
    await service.execute(command, context)
    await expect(service.execute({ ...command, commandId: 'other' }, context)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await expect(service.execute({ ...command, action: { kind: 'create-building', draft: { code: 'B2', name: '2栋' } } }, context)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.execute(command, { ...context, capabilities: ['quantity:write', 'project:list:read'] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    exists = false
    await expect(service.execute(command, context)).rejects.toMatchObject({ problem: { code: 'not-found' } })
  })

  it('重复编码属于可修正的业务错误，不冒充服务离线且不留下额外记录', async () => {
    const service = currentService()
    await save(service, { kind: 'create-building', draft: { code: 'B1', name: '1栋' } }, 'original-building')
    await expect(save(service, { kind: 'create-building', draft: { code: 'B1', name: '重复' } }, 'duplicate-building'))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed', message: '编码「B1」已存在' } })
    expect((await service.region(query, context)).data.buildings).toHaveLength(1)
  })

  it('未知命令动作拒绝写入，不把任何携带名称的请求默认为创建楼栋', async () => {
    const service = createQuantityService({
      workspaceId: context.workspaceId,
      database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
      project: async (id: string) => ({ id, name: '中央新项目', code: 'Q-CENTRAL' }),
    })
    const before = await service.region(query, context)
    const command = {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: 'quantity:write' as const,
      commandId: 'invalid-action',
      baseVersion: before.sourceVersion,
      origin: 'real' as const,
      projectId: query.projectId,
      action: { kind: 'delete-project', draft: { code: 'B1', name: '不能创建' } },
    }
    await expect(service.execute(command as unknown as Parameters<typeof service.execute>[0], context))
      .rejects
      .toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.region(query, context)).data.buildings).toEqual([])
  })

  it('命令进入队列后，调用方继续输入不会改变本次已受理的楼栋名称', async () => {
    const service = createQuantityService({
      workspaceId: context.workspaceId,
      database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
      project: async (id: string) => ({ id, name: '中央新项目', code: 'Q-CENTRAL' }),
    })
    const before = await service.region(query, context)
    const command = {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: 'quantity:write' as const,
      commandId: 'snapshot-before-queue',
      baseVersion: before.sourceVersion,
      origin: 'real' as const,
      projectId: query.projectId,
      action: { kind: 'create-building' as const, draft: { code: 'B1', name: '原始名称' } },
    }
    const pending = service.execute(command, context)
    command.action.draft.name = '随后输入'
    await pending
    expect((await service.region(query, context)).data.buildings[0]?.name).toBe('原始名称')
  })

  it('工作区不符时在访问中央父源前拒绝读取，不能用相同项目ID取得另一工作区数据', async () => {
    const project = vi.fn(async (id: string) => ({ id, name: '中央新项目', code: 'Q-CENTRAL' }))
    const service = createQuantityService({
      workspaceId: context.workspaceId,
      database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
      project,
    })
    await expect(service.region(query, { ...context, workspaceId: 'other-workspace' }))
      .rejects
      .toMatchObject({ problem: { code: 'forbidden' } })
    expect(project).not.toHaveBeenCalled()
  })

  it('从当前中央项目建楼栋，重读同一事实并让相同命令只产生一次创建', async () => {
    const database = createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() }))
    const service = createQuantityService({
      workspaceId: context.workspaceId,
      database,
      project: async (id: string) => id === query.projectId ? { id, name: '中央新项目', code: 'Q-CENTRAL' } : null,
    })
    const before = await service.region(query, context)
    expect(before.data).toMatchObject({ projectId: query.projectId, projectName: '中央新项目', buildings: [] })
    const command = {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: 'quantity:write' as const,
      commandId: 'create-building-once',
      baseVersion: before.sourceVersion,
      origin: 'real' as const,
      projectId: query.projectId,
      action: { kind: 'create-building' as const, draft: { code: 'B1', name: '1栋' } },
    }
    const first = await service.execute(command, context)
    expect(await service.execute(command, context)).toEqual(first)
    const after = await service.region(query, context)
    expect(after.sourceVersion).not.toBe(before.sourceVersion)
    expect(after.data.buildings).toEqual([expect.objectContaining({ id: first.id, code: 'B1', name: '1栋' })])
    expect(await memory.select('SELECT record_id, operator FROM operation_logs WHERE table_name = ?', ['buildings']))
      .toEqual([{ record_id: first.id, operator: context.actorId }])
  })
})
