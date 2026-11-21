import type { ScheduleSources } from '../../server/utils/schedule-sources'
import type { ScheduleCommand } from '~/lib/schedule/central-contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScheduleRepository } from '~/lib/schedule/central-repository'
import { createProcessLibraryService } from '../../server/utils/process-library-service'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { createScheduleService } from '../../server/utils/schedule-service'

const context = { workspaceId: 'wbs-test', actorId: 'actor', capabilities: ['schedule:read', 'schedule:write', 'quantity:read', 'quantity:write', 'project:list:read', 'process-library:read', 'process-library:write'] }
let current = { ...context }
let quantities: ReturnType<typeof createQuantityTestInstance>
let service: ReturnType<typeof createScheduleService>
let sources: ScheduleSources
const query = { projectId: 'p', origin: 'real' as const, includeDemo: false, today: '2026-09-12' }

beforeEach(async () => {
  current = { ...context }
  quantities = createQuantityTestInstance({ session: () => current, projects: () => [{ id: 'p', name: '中央排程项目', code: 'P', dataOrigin: 'real' }, { id: 'other', name: '其他项目', code: 'O', dataOrigin: 'real' }] })
  const libraryService = createProcessLibraryService()
  const library = libraryService.execute({ action: 'create-version', commandId: 'lib', workspaceId: context.workspaceId, actorId: context.actorId, origin: 'real', requiredCapability: 'process-library:write', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'inside', name: '室内工序', description: '', tasks: [
    { key: 'wall', name: '墙面施工', trade: '油漆工', color: '#123456', durationDays: 10, stageCode: 'WALL', itemCodes: ['WALL'], predecessorKey: null },
    { key: 'clean', name: '清洁', trade: '杂工', color: '#223344', durationDays: 2, stageCode: '', itemCodes: [], predecessorKey: 'wall' },
  ] } }, context)
  sources = { version: 'sources-1', contracts: [], boq: { projectId: 'p', lines: [] }, libraries: [libraryService.detail(library.id, 'real', context)] }
  service = createScheduleService({ session: () => current, sources: () => structuredClone(sources), withSchedule: (scope, consume) => quantities.withSchedule(scope, consume) })
  await quantities.withSchedule(query, async (db) => {
    const statements = [
      'INSERT INTO buildings (id,project_id,code,name) VALUES (\'b\',\'p\',\'B\',\'一栋\'),(\'empty\',\'p\',\'E\',\'空栋\')',
      'INSERT INTO floors (id,building_id,code,name) VALUES (\'f\',\'b\',\'F\',\'一层\')',
      'INSERT INTO house_type_templates (id,project_id,code,name) VALUES (\'ta\',\'p\',\'A\',\'户型甲\'),(\'tb\',\'p\',\'B\',\'户型乙\')',
      'INSERT INTO rooms (id,template_id,code,name) VALUES (\'ra\',\'ta\',\'R\',\'客厅\'),(\'rb\',\'tb\',\'R\',\'客厅\')',
      'INSERT INTO units (id,floor_id,house_type_template_id,code,name) VALUES (\'u1\',\'f\',\'ta\',\'1\',\'一户\'),(\'u2\',\'f\',\'tb\',\'2\',\'二户\')',
      'INSERT INTO items (id,project_id,code,name,trade,unit) VALUES (\'i\',\'p\',\'WALL\',\'墙面\',\'油漆工\',\'㎡\'),(\'z\',\'p\',\'ZERO\',\'踢脚\',\'油漆工\',\'m\')',
      'INSERT INTO house_type_template_items (id,room_id,item_id,provisional_qty) VALUES (\'a\',\'ra\',\'i\',8),(\'b-line\',\'rb\',\'i\',NULL),(\'zero\',\'ra\',\'z\',0)',
      'INSERT INTO construction_stages (id,project_id,code,name,trade) VALUES (\'s\',\'p\',\'WALL\',\'墙面完成\',\'油漆工\')',
      'INSERT INTO construction_stage_items (id,stage_id,item_id) VALUES (\'mapping\',\'s\',\'i\')',
    ]
    for (const sql of statements) await db.execute(sql)
  })
})
afterEach(async () => {
  await quantities.close()
})
async function command(action: ScheduleCommand['action'], commandId = 'command'): Promise<ScheduleCommand> {
  return { workspaceId: context.workspaceId, actorId: context.actorId, origin: 'real', requiredCapability: 'schedule:write', projectId: 'p', commandId, sourceVersion: (await service.read(query)).sourceVersion, action }
}
function group() {
  return { kind: 'create-group' as const, draft: { projectId: 'p', scopeBasis: 'provisional' as const, processLibraryId: sources.libraries[0]!.id, name: '内部计划', buildingIds: ['b'], startDate: '2026-09-01', overlapMode: 'seq' as const, tasks: [{ templateKey: 'wall', durationDays: 10, enabled: true, anchorStart: null }, { templateKey: 'clean', durationDays: 2, enabled: true, anchorStart: null }] } }
}

describe('中央 WBS 原子命令与真实数量来源', () => {
  it('正式空项目不种计划，逐单位预览保留8/null及真实0，逐栋缺源独立提示', async () => {
    expect((await service.read(query)).snapshot.groups).toEqual([])
    const result = await service.scope(query, ['b', 'empty'])
    expect(result.preview.quantities).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: '㎡', value: null, knownValue: 8, sourceCount: 2, missingCount: 1 }),
      expect.objectContaining({ unit: 'm', value: 0, knownValue: 0, sourceCount: 1, missingCount: 0 }),
    ]))
    expect(result.preview.buildings.find(row => row.buildingId === 'empty')!.blockers).toContain('缺少楼层')
  })
  it('一次建组同时冻结库、计划和缺量详情，同键重试只返回原图，换内容拒绝', async () => {
    const request = await command(group())
    const saved = await service.execute(request)
    expect(await service.execute(request)).toEqual(saved)
    const read = await service.read(query)
    expect(read.snapshot.groups).toHaveLength(1)
    expect(read.snapshot.groups[0]!.tasks).toHaveLength(2)
    expect(read.snapshot.groups[0]!.tasks[0]!.floorPlans[0]!.provisionalQty).toBeNull()
    const evidence = await quantities.withSchedule(query, db => db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM schedule_floor_quantity_snapshots'))
    expect(JSON.parse(evidence[0]!.snapshot_json)).toMatchObject({ knownValue: 8, value: null, missingCount: 1, unit: '㎡' })
    await expect(service.execute({ ...request, action: { ...group(), draft: { ...group().draft, name: '换内容' } } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it('开发恢复只返回匹配工作区、本人、项目和动作的原回执，缺证明不解除未知状态', async () => {
    const request = await command(group())
    const descriptor = { commandId: request.commandId, workspaceId: request.workspaceId, actorId: request.actorId, family: 'schedule', targetId: request.projectId, action: request.action.kind }
    const saved = await service.execute(request)
    await expect(service.resolve(descriptor)).resolves.toEqual({ outcome: 'applied', result: saved })
    await expect(service.resolve({ ...descriptor, action: 'set-baseline' })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.resolve({ ...descriptor, targetId: 'other' })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.resolve({ ...descriptor, workspaceId: 'foreign' })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(service.resolve({ ...descriptor, commandId: 'missing-command' })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await quantities.withSchedule(query, db => db.execute('UPDATE schedule_command_receipts SET workspace_id = NULL, action = NULL WHERE command_id = ?', [request.commandId]))
    await expect(service.resolve(descriptor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(service.execute(request)).resolves.toEqual(saved)
  })
  it('陈旧量版本、外部来源变化、错项目和无写权均不留下半组', async () => {
    const request = await command(group())
    sources.version = 'sources-2'
    await expect(service.execute(request)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    const fresh = await command({ ...group(), draft: { ...group().draft, projectId: 'other' } })
    await expect(service.execute(fresh)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    const allowed = await command(group())
    current = { ...context, capabilities: context.capabilities.filter(row => row !== 'schedule:write') }
    await expect(service.execute(allowed)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect((await service.read(query)).snapshot.groups).toHaveLength(0)
  })
  it('未确认调期冲突完全回滚；确认软禁用，主动删除不会进入冲突恢复', async () => {
    await service.execute(await command(group()))
    const read = await service.read(query)
    const task = read.snapshot.groups[0]!.tasks[0]!
    const relation = read.snapshot.dependencies[0]!
    const action = { kind: 'reschedule-task' as const, taskId: task.id, patch: { plannedFinish: '2026-09-20' }, dependencyIdsToDisable: [] }
    await expect(service.execute(await command(action, 'cancel'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.read(query)).snapshot.groups[0]!.tasks[0]!.plannedFinish).toBe('2026-09-10')
    await service.execute(await command({ ...action, dependencyIdsToDisable: [relation.id] }, 'confirm'))
    expect((await service.read(query)).snapshot.disabledDependencies[0]!.id).toBe(relation.id)
    await expect(service.execute(await command({ kind: 'restore-dependency', dependencyId: relation.id }, 'too-early'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await service.execute(await command({ ...action, patch: { plannedFinish: '2026-09-10' } }, 'return-date'))
    await service.execute(await command({ kind: 'restore-dependency', dependencyId: relation.id }, 'restore'))
    await service.execute(await command({ kind: 'remove-dependency', dependencyId: relation.id }, 'remove'))
    expect((await service.read(query)).snapshot.disabledDependencies).toHaveLength(0)
  })
  it('人工楼层微调在任务调期后保留，基线、手工进度及删除边界冷读一致', async () => {
    await service.execute(await command(group()))
    const first = (await service.read(query)).snapshot.groups[0]!
    const wall = first.tasks[0]!
    const clean = first.tasks[1]!
    const floor = wall.floorPlans[0]!
    await service.execute(await command({ kind: 'update-floors', taskId: wall.id, patches: [{ id: floor.id, plannedStart: '2026-09-02', plannedFinish: '2026-09-05' }] }, 'floor'))
    await service.execute(await command({ kind: 'update-task', taskId: wall.id, patch: { plannedStart: '2026-08-25' } }, 'shift'))
    await service.execute(await command({ kind: 'update-task', taskId: clean.id, patch: { manualProgress: 0.5 } }, 'manual'))
    await service.execute(await command({ kind: 'set-baseline' }, 'baseline'))
    const updated = (await service.read(query)).snapshot.groups[0]!
    expect(updated.tasks[0]!.floorPlans[0]).toMatchObject({ plannedStart: '2026-09-02', plannedFinish: '2026-09-05', isManual: true })
    expect(updated.tasks[0]!.baselineStart).toBe('2026-08-25')
    expect(updated.tasks[1]!.actualProgress).toBe(0.5)
    const removed = await service.execute(await command({ kind: 'remove-task', taskId: clean.id }, 'delete'))
    const read = await service.read(query)
    expect(read.snapshot.groups[0]!.tasks).toHaveLength(1)
    expect(read.history.removedTasks[0]!.id).toBe(clean.id)
    await service.execute(await command({ kind: 'undo', logIds: [removed.value as string] }, 'undo'))
    expect((await service.read(query)).snapshot.groups[0]!.tasks).toHaveLength(2)
  })
  it('合同只用唯一显式覆盖和当前BOQ身份映射，不用空楼栋或相同分项名补关联', async () => {
    sources.contracts = [{ id: 'contract', projectId: 'p', name: '施工合同', no: 'SG1' }]
    sources.boq.lines = [{ id: 'boq', contractId: 'contract', contractName: '施工合同', contractNo: 'SG1', itemName: '墙面', unit: '㎡', qty: 100, unitPrice: 1, approvedDeltaQty: 0, effectiveUnitPrice: 1, building: '一栋', updatedAt: null }]
    const action = { ...group(), draft: { ...group().draft, scopeBasis: 'contract' as const, contractId: 'contract' } }
    await expect(service.execute(await command(action))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await quantities.withSchedule(query, db => db.execute('UPDATE house_type_template_items SET boq_line_id = \'boq\' WHERE id IN (\'a\',\'b-line\')'))
    await service.execute(await command(action))
    const result = await service.read(query)
    expect(result.snapshot.groups[0]).toMatchObject({ contractId: 'contract', scopeBasis: 'contract' })
    expect(result.snapshot.groups[0]!.tasks[0]!.floorPlans[0]!.boqLineId).toBe('boq')
  })
  it('删掉启用阶段映射不能新建，原冻结缺量不会被当前模板值填补', async () => {
    await quantities.withSchedule(query, db => db.execute('UPDATE construction_stage_items SET deleted_at = \'2026-09-12\' WHERE id = \'mapping\''))
    await expect(service.execute(await command(group()))).rejects.toThrow('阶段启用')
    await quantities.withSchedule(query, db => db.execute('UPDATE construction_stage_items SET deleted_at = NULL WHERE id = \'mapping\''))
    await service.execute(await command(group()))
    await quantities.withSchedule(query, db => db.execute('UPDATE house_type_template_items SET provisional_qty = 30 WHERE id = \'b-line\''))
    const floor = (await service.read(query)).snapshot.groups[0]!.tasks[0]!.floorPlans[0]!
    expect(floor.quantitySnapshot).toMatchObject({ knownValue: 8, value: null, missingCount: 1 })
  })
  it('最终来源回查期间撤销写权限会回滚整个动作，重复并发提交仅生成一组', async () => {
    const request = await command(group())
    let reads = 0
    const gated = createScheduleService({ session: () => current, withSchedule: (scope, consume) => quantities.withSchedule(scope, consume), sources: async () => {
      if (++reads === 2)
        current = { ...context, capabilities: context.capabilities.filter(row => row !== 'schedule:write') }
      return structuredClone(sources)
    } })
    await expect(gated.execute(request)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    current = { ...context }
    expect((await service.read(query)).snapshot.groups).toHaveLength(0)
    const result = await Promise.all([service.execute(request), service.execute(request)])
    expect(result[0]).toEqual(result[1])
    expect((await service.read(query)).snapshot.groups).toHaveLength(1)
  })
  it('不能用通用撤销恢复已经与当前日期冲突的依赖', async () => {
    await service.execute(await command(group()))
    const original = (await service.read(query)).snapshot
    const relation = original.dependencies[0]!
    const removal = await service.execute(await command({ kind: 'remove-dependency', dependencyId: relation.id }, 'remove-link'))
    await service.execute(await command({ kind: 'update-task', taskId: relation.predId, patch: { plannedFinish: '2026-09-25' } }, 'extend'))
    await expect(service.execute(await command({ kind: 'undo', logIds: [removal.value as string] }, 'unsafe-undo'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.read(query)).snapshot.dependencies).toHaveLength(0)
  })
  it.each(['detached-task', 'deleted-group'] as const)('历史依赖的%s不能借通用撤销绕过当前有效分组边界', async (state) => {
    await service.execute(await command(group()))
    const original = (await service.read(query)).snapshot
    const relation = original.dependencies[0]!
    const removal = await service.execute(await command({ kind: 'remove-dependency', dependencyId: relation.id }, 'remove-history-link'))
    await quantities.withSchedule(query, async (db) => {
      if (state === 'detached-task')
        await db.execute('UPDATE schedule_tasks SET group_id = NULL WHERE id = ?', [relation.predId])
      else
        await db.execute('UPDATE schedule_groups SET deleted_at = ? WHERE id = ?', ['2026-09-12', original.groups[0]!.id])
    })
    await expect(service.execute(await command({ kind: 'undo', logIds: [removal.value as string] }, 'unsafe-history-undo'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const [history] = await quantities.withSchedule(query, db => db.select<{ deleted_at: string | null }>('SELECT deleted_at FROM task_dependencies WHERE id = ?', [relation.id]))
    expect(history!.deleted_at).not.toBeNull()
  })
  it('追加合同工序须重新核验每栋当前清单来源，删除清单后不能产生空楼层工序', async () => {
    sources.contracts = [{ id: 'contract', projectId: 'p', name: '施工合同', no: 'SG1' }]
    sources.boq.lines = [{ id: 'boq', contractId: 'contract', contractName: '施工合同', contractNo: 'SG1', itemName: '墙面', unit: '㎡', qty: 100, unitPrice: 1, approvedDeltaQty: 0, effectiveUnitPrice: 1, building: '一栋', updatedAt: null }]
    await service.read(query)
    await quantities.withSchedule(query, db => db.execute('UPDATE house_type_template_items SET boq_line_id = \'boq\' WHERE id IN (\'a\',\'b-line\')'))
    await service.execute(await command({ ...group(), draft: { ...group().draft, scopeBasis: 'contract', contractId: 'contract' } }))
    const created = (await service.read(query)).snapshot.groups[0]!
    await service.execute(await command({ kind: 'remove-task', taskId: created.tasks[0]!.id }, 'remove-wall'))
    sources.boq.lines = []
    sources.version = 'sources-2'
    await expect(service.execute(await command({ kind: 'add-task', groupId: created.id, draft: { templateKey: 'wall', plannedStart: '2026-10-01' } }, 'add-without-source'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.read(query)).snapshot.groups[0]!.tasks).toHaveLength(1)
  })
  it.each(['parent', 'stage'] as const)('%s祖先隐藏的旧依赖不能阻止当前可见工序调期', async (ancestor) => {
    await service.execute(await command(group()))
    const created = (await service.read(query)).snapshot.groups[0]!
    const wall = created.tasks[0]!
    const clean = created.tasks[1]!
    if (ancestor === 'parent') {
      await quantities.withSchedule(query, async (db) => {
        await db.execute('INSERT INTO schedule_tasks (id,project_id,group_id,name,planned_start,planned_finish,has_qty,manual_progress) VALUES (?,?,?,?,?,?,0,0)', ['parent', 'p', created.id, '汇总父任务', '2026-09-01', '2026-09-10'])
        await db.execute('UPDATE schedule_tasks SET parent_id = ? WHERE id = ?', ['parent', wall.id])
      })
      await service.execute(await command({ kind: 'remove-task', taskId: 'parent' }, 'hide-parent'))
    }
    else {
      await quantities.withSchedule(query, db => db.execute('UPDATE construction_stages SET deleted_at = ? WHERE id = ?', ['2026-09-12', 's']))
    }
    expect((await service.read(query)).snapshot.dependencies).toEqual([])
    await service.execute(await command({ kind: 'update-task', taskId: clean.id, patch: { plannedStart: '2026-08-01', plannedFinish: '2026-08-02' } }, 'move-visible'))
    expect((await service.read(query)).snapshot.groups[0]!.tasks.find(row => row.id === clean.id)!.plannedStart).toBe('2026-08-01')
  })
  it.each(['parent', 'stage'] as const)('普通撤销不能恢复位于已隐藏%s下的历史任务', async (ancestor) => {
    await service.execute(await command(group()))
    const created = (await service.read(query)).snapshot.groups[0]!
    const wall = created.tasks[0]!
    if (ancestor === 'parent') {
      await quantities.withSchedule(query, async (db) => {
        await db.execute('INSERT INTO schedule_tasks (id,project_id,group_id,name,planned_start,planned_finish,has_qty,manual_progress) VALUES (?,?,?,?,?,?,0,0)', ['parent', 'p', created.id, '历史父任务', '2026-09-01', '2026-09-10'])
        await db.execute('UPDATE schedule_tasks SET parent_id = ? WHERE id = ?', ['parent', wall.id])
      })
    }
    const removed = await service.execute(await command({ kind: 'remove-task', taskId: wall.id }, 'remove-child'))
    await quantities.withSchedule(query, async (db) => {
      if (ancestor === 'parent') {
        await db.execute('UPDATE schedule_tasks SET deleted_at = ? WHERE id = ?', ['2026-09-12', 'parent'])
      }
      else {
        await db.execute('UPDATE construction_stages SET deleted_at = ? WHERE id = ?', ['2026-09-12', 's'])
      }
    })
    await expect(service.execute(await command({ kind: 'undo', logIds: [removed.value as string] }, 'undo-hidden'))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await quantities.withSchedule(query, db => db.select<{ deleted_at: string | null }>('SELECT deleted_at FROM schedule_tasks WHERE id = ?', [wall.id])))[0]!.deleted_at).not.toBeNull()
  })
  it('已有回执的恢复遇末端来源变化不声称未应用；查无回执的拒绝携原ID证明', async () => {
    const original = await command(group())
    await service.execute(original)
    let reads = 0
    const racing = createScheduleService({ session: () => current, withSchedule: (scope, consume) => quantities.withSchedule(scope, consume), sources: async () => ({ ...structuredClone(sources), version: ++reads === 2 ? 'changed' : sources.version }) })
    const error = await racing.execute(original).catch(cause => cause)
    expect(error.problem.code).toBe('stale-source')
    expect(error.problem.commandOutcome).toBeUndefined()
    const neverApplied = await service.execute({ ...original, commandId: 'new-stale' }).catch(cause => cause)
    expect(neverApplied.problem).toMatchObject({ code: 'stale-source', commandId: 'new-stale', commandOutcome: 'not-applied' })
  })
  it('当前分项映射全部隐藏后仍能经Repository读取冻结楼层，当前应做范围保持空', async () => {
    await service.execute(await command(group()))
    const wall = (await service.read(query)).snapshot.groups[0]!.tasks[0]!
    await quantities.withSchedule(query, db => db.execute('UPDATE task_item_map SET deleted_at = ? WHERE task_id = ?', ['2026-09-12', wall.id]))
    const repository = createScheduleRepository(async () => JSON.parse(JSON.stringify(await service.read(query))))
    const received = await repository.read(query)
    const task = received.snapshot.groups[0]!.tasks[0]!
    expect(task.itemIds).toEqual([])
    expect(task.floorPlans).toHaveLength(1)
    expect(task.applicableUnits).toBe(0)
  })
  it('同日搭接形成的既有合法依赖不阻止仅保存人工进度', async () => {
    await service.execute(await command({ ...group(), draft: { ...group().draft, overlapMode: 'same' } }))
    const original = (await service.read(query)).snapshot
    const clean = original.groups[0]!.tasks[1]!
    const relation = original.dependencies[0]!
    expect(original.groups[0]!.tasks[0]!.plannedStart).toBe(clean.plannedStart)
    await service.execute(await command({ kind: 'save-task-plan', taskId: clean.id, draft: {
      task: { plannedStart: clean.plannedStart, plannedFinish: clean.plannedFinish, manualProgress: 0.4 },
      dependency: { predecessorId: relation.predId, lagDays: relation.lagDays },
      floorPlans: [],
    } }, 'same-day-progress'))
    const current = (await service.read(query)).snapshot
    expect(current.groups[0]!.tasks[1]!.actualProgress).toBe(0.4)
    expect(current.dependencies).toEqual([relation])
  })
  it('普通工序保存未编辑依赖时保持原关系，移除须走专门动作', async () => {
    await service.execute(await command(group()))
    const original = (await service.read(query)).snapshot
    const clean = original.groups[0]!.tasks[1]!
    await service.execute(await command({ kind: 'save-task-plan', taskId: clean.id, draft: {
      task: { plannedStart: clean.plannedStart, plannedFinish: clean.plannedFinish, manualProgress: 0.6 },
      dependency: null,
      floorPlans: [],
    } }, 'ordinary-save'))
    const saved = (await service.read(query)).snapshot
    expect(saved.dependencies).toEqual(original.dependencies)
    expect(saved.groups[0]!.tasks[1]!.actualProgress).toBe(0.6)
    await service.execute(await command({ kind: 'remove-dependency', dependencyId: original.dependencies[0]!.id }, 'explicit-removal'))
    expect((await service.read(query)).snapshot.dependencies).toEqual([])
  })
})
