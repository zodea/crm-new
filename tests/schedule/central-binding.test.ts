import type { ScheduleBindingRead } from '../../app/lib/schedule/central-binding-contract'
import type { ScheduleSources } from '../../server/utils/schedule-sources'
import type { ScheduleCommand } from '~/lib/schedule/central-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScheduleRepository } from '~/lib/schedule/central-repository'
import { createProcessLibraryService } from '../../server/utils/process-library-service'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { createScheduleService } from '../../server/utils/schedule-service'

const session = { workspaceId: 'binding', actorId: 'actor', capabilities: ['schedule:read', 'schedule:write', 'quantity:read', 'quantity:write', 'project:list:read', 'process-library:read', 'process-library:write'] }
const query = { projectId: 'p', origin: 'real' as const, includeDemo: false, today: '2026-09-12' }
let current = { ...session }
let quantities: ReturnType<typeof createQuantityTestInstance>
let service: ReturnType<typeof createScheduleService>
let sources: ScheduleSources
let groupId = ''

beforeEach(async () => {
  current = { ...session }
  quantities = createQuantityTestInstance({ session: () => current, projects: () => [{ id: 'p', name: '绑定项目', code: 'P', dataOrigin: 'real' }] })
  const libraries = createProcessLibraryService()
  const library = libraries.execute({ workspaceId: session.workspaceId, actorId: session.actorId, action: 'create-version', commandId: 'library', origin: 'real', requiredCapability: 'process-library:write', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'binding', name: '绑定库', description: '', tasks: [
    { key: 'wall', name: '墙面', trade: '', color: '#123456', durationDays: 3, stageCode: 'DONE', itemCodes: ['WALL'], predecessorKey: null },
    { key: 'zero', name: '踢脚', trade: '', color: '#123456', durationDays: 1, stageCode: 'DONE', itemCodes: ['ZERO'], predecessorKey: 'wall' },
  ] } }, session)
  const line = (id: string, unit: string, qty: number, building: string) => ({ id, contractId: 'c', contractName: '施工合同', contractNo: 'C', itemName: id, unit, qty, unitPrice: 1, approvedDeltaQty: 0, effectiveUnitPrice: 1, building, updatedAt: null })
  sources = { version: 'source-1', contracts: [{ id: 'c', projectId: 'p', name: '施工合同', no: 'C' }], boq: { projectId: 'p', lines: [line('wall-line', '㎡', 10, 'B'), line('zero-line', 'm', 0, 'B'), line('extra-line', '㎡', 90, 'E')] }, libraries: [libraries.detail(library.id, 'real', session)] }
  service = createScheduleService({ session: () => current, sources: () => structuredClone(sources), withSchedule: (scope, consume) => quantities.withSchedule(scope, consume) })
  await service.read(query)
  await quantities.withSchedule(query, async (db) => {
    for (const sql of [
      'INSERT INTO buildings(id,project_id,code,name) VALUES (\'b\',\'p\',\'B\',\'一栋\'),(\'extra\',\'p\',\'E\',\'额外栋\')',
      'INSERT INTO floors(id,building_id,code,name) VALUES (\'f\',\'b\',\'F\',\'一层\')',
      'INSERT INTO house_type_templates(id,project_id,code,name) VALUES (\'ta\',\'p\',\'A\',\'甲\'),(\'tb\',\'p\',\'B\',\'乙\')',
      'INSERT INTO rooms(id,template_id,code,name) VALUES (\'ra\',\'ta\',\'R\',\'厅\'),(\'rb\',\'tb\',\'R\',\'厅\')',
      'INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES (\'u1\',\'f\',\'ta\',\'1\'),(\'u2\',\'f\',\'tb\',\'2\')',
      'INSERT INTO items(id,project_id,code,name,unit,trade) VALUES (\'wall\',\'p\',\'WALL\',\'墙面\',\'㎡\',\'\'),(\'zero\',\'p\',\'ZERO\',\'踢脚\',\'m\',\'\')',
      'INSERT INTO house_type_template_items(id,room_id,item_id,provisional_qty,boq_line_id) VALUES (\'a\',\'ra\',\'wall\',8,\'wall-line\'),(\'b\',\'rb\',\'wall\',NULL,\'wall-line\'),(\'z\',\'ra\',\'zero\',0,\'zero-line\')',
      'INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES (\'s\',\'p\',\'DONE\',\'完成\',\'\')',
      'INSERT INTO construction_stage_items(id,stage_id,item_id) VALUES (\'sw\',\'s\',\'wall\'),(\'sz\',\'s\',\'zero\')',
    ]) await db.execute(sql)
  })
  const command: ScheduleCommand = { workspaceId: session.workspaceId, actorId: session.actorId, commandId: 'create', origin: 'real', requiredCapability: 'schedule:write', projectId: 'p', sourceVersion: (await service.read(query)).sourceVersion, action: { kind: 'create-group', draft: { projectId: 'p', scopeBasis: 'provisional', name: '暂估组', processLibraryId: library.id, buildingIds: ['b'], startDate: '2026-09-01', overlapMode: 'seq', tasks: [{ templateKey: 'wall', durationDays: 3, enabled: true, anchorStart: null }, { templateKey: 'zero', durationDays: 1, enabled: true, anchorStart: null }] } } }
  await service.execute(command)
  groupId = (await service.read(query)).snapshot.groups[0]!.id
})
afterEach(async () => quantities.close())

async function bindCommand(commandId = 'bind'): Promise<ScheduleCommand> {
  return { workspaceId: session.workspaceId, actorId: session.actorId, commandId, projectId: 'p', origin: 'real', requiredCapability: 'schedule:write', sourceVersion: (await service.binding(query, groupId, 'c')).sourceVersion, action: { kind: 'bind-contract', groupId, contractId: 'c' } }
}

describe('中央暂估绑定冻结比较与原子确认', () => {
  it('冻结8/null保持缺失、真0可比，当前模板后改不替换冻结量，额外栋不纳入', async () => {
    await quantities.withSchedule(query, db => db.execute('UPDATE house_type_template_items SET provisional_qty = 100'))
    const read = await service.binding(query, groupId, 'c')
    expect(read.preview!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'wall', unit: '㎡', provisional: expect.objectContaining({ value: null, knownValue: 8, missingCount: 1 }), contract: expect.objectContaining({ value: 10 }), differenceQty: null }),
      expect.objectContaining({ id: 'zero', unit: 'm', provisional: expect.objectContaining({ value: 0 }), contract: expect.objectContaining({ value: 0 }), differenceQty: 0 }),
    ]))
    expect(read.preview!.extraContractBuildings.map(row => row.id)).toEqual(['extra'])
    expect(read.preview!.canBind).toBe(true)
    const command = await bindCommand()
    const first = await service.execute(command)
    expect(await service.execute(command)).toEqual(first)
    const cold = await service.binding(query, groupId)
    expect(cold).toMatchObject({ state: 'bound', preview: null, group: { contractId: 'c', scopeBasis: 'contract' }, binding: { sourceVersion: command.sourceVersion, legacyDetailMissing: false } })
    expect(cold.binding!.preview!.items).toEqual(read.preview!.items)
    expect((await service.read(query)).snapshot.groups[0]!.buildingIds).toEqual(['b'])
  })
  it('预览后来源变化、重复另一命令和解绑撤销均不能覆盖已绑定结果', async () => {
    const command = await bindCommand()
    sources.version = 'source-2'
    await expect(service.execute(command)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    const saved = await service.execute(await bindCommand('fresh'))
    const value = saved.value as { logId: string }
    await expect(service.execute(await bindCommand('second'))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(service.execute({ ...(await bindCommand('undo')), action: { kind: 'undo', logIds: [value.logId] } })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
  it('缺覆盖与楼栋编码/名称歧义都阻断，恢复显式证据后才可确认', async () => {
    sources.boq.lines[0]!.building = null
    sources.boq.lines[1]!.building = null
    expect((await service.binding(query, groupId, 'c')).preview).toMatchObject({ canBind: false, buildings: [expect.objectContaining({ covered: false })] })
    await expect(service.execute(await bindCommand())).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    sources.boq.lines[0]!.building = 'B'
    sources.boq.lines[1]!.building = 'B'
    await quantities.withSchedule(query, db => db.execute('UPDATE buildings SET name = ? WHERE id = ?', ['B', 'extra']))
    expect((await service.binding(query, groupId, 'c')).preview!.canBind).toBe(false)
    await quantities.withSchedule(query, db => db.execute('UPDATE buildings SET name = ? WHERE id = ?', ['额外栋', 'extra']))
    expect((await service.binding(query, groupId, 'c')).preview!.canBind).toBe(true)
  })
  it('旧快照缺失或只有旧数值仍明确未知，不回填模板，也不新增数量阻断', async () => {
    await quantities.withSchedule(query, async (db) => {
      await db.execute('UPDATE house_type_template_items SET provisional_qty = 300')
      await db.execute('UPDATE schedule_floor_quantity_snapshots SET snapshot_json = ?, legacy_missing = 1 WHERE id IN (SELECT id FROM schedule_task_floor_plans WHERE item_id = \'wall\')', [JSON.stringify({ value: 8, unit: null, completeness: 'legacy-detail-unavailable' })])
    })
    const read = await service.binding(query, groupId, 'c')
    expect(read.preview!.items).toContainEqual(expect.objectContaining({ id: 'wall', unit: '', provisional: expect.objectContaining({ value: null, knownValue: null, unitMissing: true }), differenceQty: null }))
    expect(read.preview!.canBind).toBe(true)
    await service.execute(await bindCommand())
    expect((await service.binding(query, groupId)).state).toBe('bound')
  })
  it('当前分项与映射软删不吞冻结楼层，真实来源身份FK仍阻止物理删除', async () => {
    const before = (await service.read(query)).snapshot.groups[0]!.tasks[0]!
    await quantities.withSchedule(query, async (db) => {
      await db.execute('UPDATE items SET deleted_at = ? WHERE id = ?', ['2026-09-12', 'wall'])
      await db.execute('UPDATE task_item_map SET deleted_at = ? WHERE task_id = ?', ['2026-09-12', before.id])
    })
    const read = await service.binding(query, groupId, 'c')
    expect(read.preview!.items).toContainEqual(expect.objectContaining({ id: 'wall', unit: '㎡', provisional: expect.objectContaining({ knownValue: 8, missingCount: 1 }), floorPlanIds: before.floorPlans.map(row => row.id) }))
    expect((await service.read(query)).snapshot.groups[0]!.tasks[0]!.floorPlans).toHaveLength(1)
    await expect(quantities.withSchedule(query, db => db.execute('DELETE FROM items WHERE id = ?', ['wall']))).rejects.toThrow()
  })
  it.each(['task', 'floor'] as const)('%s及其祖先隐藏后冻结楼层不再进入当前比较', async (parent) => {
    const first = (await service.read(query)).snapshot.groups[0]!.tasks[0]!
    await quantities.withSchedule(query, db => parent === 'task'
      ? db.execute('UPDATE schedule_tasks SET deleted_at = ? WHERE id = ?', ['2026-09-12', first.id])
      : db.execute('UPDATE floors SET deleted_at = ? WHERE id = ?', ['2026-09-12', 'f']))
    expect((await service.binding(query, groupId, 'c')).preview!.items.flatMap(row => row.floorPlanIds)).not.toContain(first.floorPlans[0]!.id)
  })
  it('合同量缺失不作零；异单位列分别展示且不产生确定差值', async () => {
    sources.boq.lines[0]!.qty = null
    sources.boq.lines[0]!.approvedDeltaQty = 2
    sources.boq.lines[1]!.unit = '㎡'
    const items = (await service.binding(query, groupId, 'c')).preview!.items
    expect(items).toContainEqual(expect.objectContaining({ id: 'wall', contract: expect.objectContaining({ value: null, knownValue: 2, missingCount: 1 }), differenceQty: null }))
    expect(items.filter(row => row.id === 'zero').map(row => [row.unit, row.differenceQty])).toEqual([['m', null], ['㎡', null]])
  })
  it('绑定审计中途失败整笔回滚，两个同版本确认只有一次成功且同键不重复', async () => {
    const command = await bindCommand()
    await quantities.withSchedule(query, db => db.execute('CREATE TRIGGER fail_binding BEFORE INSERT ON operation_logs WHEN NEW.operator = \'schedule:bind-contract\' BEGIN SELECT RAISE(ABORT, \'binding audit failure\'); END'))
    await expect(service.execute(command)).rejects.toThrow()
    expect((await service.binding(query, groupId)).state).toBe('unbound')
    expect(await quantities.withSchedule(query, db => db.select('SELECT command_id FROM schedule_command_receipts WHERE command_id = \'bind\''))).toEqual([])
    await quantities.withSchedule(query, db => db.execute('DROP TRIGGER fail_binding'))
    const results = await Promise.allSettled([service.execute(command), service.execute({ ...command, commandId: 'competitor' })])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await service.execute(command)).toEqual((results[0] as PromiseFulfilledResult<unknown>).value)
    expect(await quantities.withSchedule(query, db => db.select('SELECT id FROM operation_logs WHERE operator = \'schedule:bind-contract\''))).toHaveLength(1)
    await expect(service.execute({ ...command, action: { kind: 'bind-contract', groupId, contractId: 'other' } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it('绑定只追加合同依据及审计，任务楼层依赖基线数量完成和下游账单逐字不变；冷读保原比较', async () => {
    const tables = ['schedule_tasks', 'schedule_group_buildings', 'task_item_map', 'task_dependencies', 'schedule_task_floor_plans', 'schedule_floor_quantity_snapshots', 'house_type_template_items', 'unit_stage_completions', 'monthly_statements', 'wage_statements']
    const facts = () => quantities.withSchedule(query, async db => Object.fromEntries(await Promise.all(tables.map(async table => [table, await db.select(`SELECT * FROM ${table} ORDER BY id`)]))))
    const before = await facts()
    await service.execute(await bindCommand())
    expect(await facts()).toEqual(before)
    sources.boq.lines[0]!.qty = 999
    sources.version = 'after-binding'
    const read = await service.binding(query, groupId)
    expect(read.binding!.preview!.items.find(row => row.id === 'wall')!.contract.value).toBe(10)
  })
  it('已迁入绑定没有比较证据时只读历史缺口，不能用当前清单补造或发起新绑定', async () => {
    await quantities.withSchedule(query, db => db.execute('UPDATE schedule_groups SET contract_id = \'c\', scope_basis = \'contract\', contract_bound_at = \'2026-08-01\' WHERE id = ?', [groupId]))
    const read = await service.binding(query, groupId)
    expect(read).toMatchObject({ state: 'bound', preview: null, binding: { preview: null, legacyDetailMissing: true, boundAt: '2026-08-01' } })
    await expect(service.execute(await bindCommand())).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it('真实HTTP成功后失响应，Repository按原键恢复且冷读返回同一冻结比较', async () => {
    let dropResponse = true
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url!, 'http://localhost')
        const scope = { projectId: url.searchParams.get('projectId')!, origin: url.searchParams.get('origin') as 'real', includeDemo: false }
        let body = ''
        for await (const chunk of request) body += chunk.toString()
        const result = request.method === 'POST' ? await service.execute(JSON.parse(body)) : await service.binding(scope, url.searchParams.get('groupId')!, url.searchParams.get('contractId') ?? '')
        if (request.method === 'POST' && dropResponse) {
          dropResponse = false
          response.destroy()
          return
        }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(result))
      }
      catch (cause) {
        response.statusCode = 400
        response.end(JSON.stringify((cause as { problem: unknown }).problem))
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address() as { port: number }
      const repository = createScheduleRepository(async (path, options) => {
        const url = new URL(path, `http://127.0.0.1:${address.port}`)
        for (const [key, value] of Object.entries(options?.query ?? {})) url.searchParams.set(key, String(value))
        const response = await fetch(url, { method: options?.method ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: options?.body ? JSON.stringify(options.body) : undefined })
        const body = await response.json()
        if (!response.ok)
          throw Object.assign(new Error('绑定请求失败'), { data: body })
        return body
      })
      const preview = await repository.binding(query, groupId, 'c')
      const command = { ...(await bindCommand()), sourceVersion: preview.sourceVersion }
      await expect(repository.execute(command)).rejects.toThrow()
      const recovered = await repository.execute(command)
      const cold = await repository.binding(query, groupId)
      expect(cold.binding).toEqual((recovered.value as { binding: unknown }).binding)
      expect(await quantities.withSchedule(query, db => db.select('SELECT id FROM operation_logs WHERE operator = \'schedule:bind-contract\''))).toHaveLength(1)
    }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
  it.each([
    (wire: ScheduleBindingRead) => { wire.group.id = 'other' },
    (wire: ScheduleBindingRead) => { wire.group.projectId = 'other' },
    (wire: ScheduleBindingRead) => { wire.preview!.items[0]!.differenceQty = 0 },
    (wire: ScheduleBindingRead) => { wire.preview!.items[0]!.unit = '' },
  ])('hTTP解码拒绝错项目组、假确定差值和缺单位伪完整：%#', async (mutate) => {
    const actual = await service.binding(query, groupId, 'c')
    const repository = (wire: unknown) => createScheduleRepository(async () => wire)
    expect((await repository(actual).binding(query, groupId, 'c')).preview!.items.find(row => row.id === 'wall')!.provisional.value).toBeNull()
    const changed = structuredClone(actual)
    mutate(changed)
    await expect(repository(changed).binding(query, groupId, 'c')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it('组内合同独有稳定分项照实显示合同量，缺暂估依据不会补零或新增阻断', async () => {
    sources.boq.lines.push({ ...sources.boq.lines[0]!, id: 'only-line', itemName: '合同独有', qty: 12 })
    await service.read(query)
    await quantities.withSchedule(query, async (db) => {
      await db.execute('INSERT INTO items (id,project_id,code,name,trade,unit) VALUES (\'only\',\'p\',\'ONLY\',\'合同独有\',\'\',\'㎡\')')
      await db.execute('INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id) VALUES (\'only-map\',\'ra\',\'only\',\'only-line\')')
    })
    const read = await service.binding(query, groupId, 'c')
    expect(read.preview!.items).toContainEqual(expect.objectContaining({ id: 'only', unit: '㎡', contract: expect.objectContaining({ value: 12 }), provisional: expect.objectContaining({ value: null }), differenceQty: null }))
    expect(read.preview!.canBind).toBe(true)
  })
  it('已绑定比较证据损坏时仍读取真实合同关系与明确历史缺口，不补造比较', async () => {
    const saved = await service.execute(await bindCommand())
    await quantities.withSchedule(query, db => db.execute('UPDATE operation_logs SET after_data = ? WHERE id = ?', [JSON.stringify({ contract_id: 'c', bindingEvidence: { contractId: 'c', preview: { items: [] } } }), (saved.value as { logId: string }).logId]))
    const repository = createScheduleRepository(async () => service.binding(query, groupId))
    expect(await repository.binding(query, groupId)).toMatchObject({ state: 'bound', group: { contractId: 'c' }, binding: { preview: null, legacyDetailMissing: true } })
  })
  it('冻结来源计数与逐户明细矛盾时保持缺损未知，不把破损快照当完整依据', async () => {
    await quantities.withSchedule(query, async (db) => {
      const [row] = await db.select<{ id: string, snapshot_json: string }>('SELECT evidence.id, evidence.snapshot_json FROM schedule_floor_quantity_snapshots evidence JOIN schedule_task_floor_plans plan ON plan.id = evidence.id WHERE plan.item_id = \'zero\'')
      await db.execute('UPDATE schedule_floor_quantity_snapshots SET snapshot_json = ? WHERE id = ?', [JSON.stringify({ ...JSON.parse(row!.snapshot_json), sourceCount: 9, missingCount: 0 }), row!.id])
    })
    const read = await service.binding(query, groupId, 'c')
    expect(read.preview!.items.filter(row => row.id === 'zero').every(row => row.provisional.value === null && row.differenceQty === null)).toBe(true)
    expect(read.preview!.canBind).toBe(true)
  })
  it('只读身份能核对而不能绑定；演示、错项目分组、外部合同和额外写字段均拒绝', async () => {
    const command = await bindCommand()
    current = { ...session, capabilities: session.capabilities.filter(value => value !== 'schedule:write') }
    expect((await service.binding(query, groupId, 'c')).preview!.canBind).toBe(true)
    await expect(service.execute(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    current = { ...session }
    await expect(service.binding({ ...query, origin: 'demo', includeDemo: true }, groupId, 'c')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(service.binding(query, 'other-project-group', 'c')).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(service.execute({ ...command, action: { kind: 'bind-contract', groupId, contractId: 'other-project-contract' } })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(service.execute({ ...command, action: { ...command.action, scopeBasis: 'contract' } } as unknown as ScheduleCommand)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await service.binding(query, groupId)).state).toBe('unbound')
  })
  it.each(['permission', 'identity', 'source'] as const)('最终来源等待期间%s变化会回滚关系、审计及回执', async (change) => {
    const command = await bindCommand()
    let sourceReads = 0
    let reached!: () => void
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      reached = resolve
    })
    const resumed = new Promise<void>((resolve) => {
      release = resolve
    })
    const racing = createScheduleService({
      session: () => current,
      withSchedule: (scope, consume) => quantities.withSchedule(scope, consume),
      sources: async () => {
        if (++sourceReads === 2) {
          reached()
          await resumed
        }
        return structuredClone(sources)
      },
    })
    const submitted = racing.execute(command)
    await waiting
    if (change === 'permission')
      current = { ...session, capabilities: session.capabilities.filter(value => value !== 'schedule:write') }
    else if (change === 'identity')
      current = { ...session, actorId: 'other-actor' }
    else
      sources.version = 'changed-during-confirmation'
    const rejected = expect(submitted).rejects.toMatchObject({ problem: { code: change === 'source' ? 'stale-source' : 'forbidden' } })
    release()
    await rejected
    current = { ...session }
    expect((await service.binding(query, groupId)).state).toBe('unbound')
    expect(await quantities.withSchedule(query, db => db.select('SELECT id FROM operation_logs WHERE operator = \'schedule:bind-contract\''))).toEqual([])
    expect(await quantities.withSchedule(query, db => db.select('SELECT command_id FROM schedule_command_receipts WHERE command_id = ?', [command.commandId]))).toEqual([])
  })
  it.each(['abort', 'commit'] as const)('迁移候选%s之前绑定排队，释放后重新验证来源', async (finish) => {
    const command = await bindCommand()
    const prepared = await quantities.prepareMigrationSnapshot({ authority: 'central', activeBatchId: 'other-batch', entities: [] })
    let settled = false
    const submitted = service.execute(command).finally(() => {
      settled = true
    })
    const rejected = finish === 'commit' ? expect(submitted).rejects.toMatchObject({ problem: { code: 'stale-source' } }) : null
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    if (finish === 'abort') {
      await prepared.abort()
      await submitted
      expect((await service.binding(query, groupId)).state).toBe('bound')
    }
    else {
      sources.version = 'migration-published-new-source'
      prepared.commit()
      await rejected
      expect((await service.binding(query, groupId)).state).toBe('unbound')
    }
  })
})
