import type { QuantityCommand, QuantityRegionAction } from '../../app/lib/quantity/central-contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionQuantityService, productionQuantityInTransaction, quantityRecoveryDescriptor } from '../../server/utils/production-quantity-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'

async function fixture() {
  const base = resolve('.tmp/opt02-quantity-production')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'quantity-workspace', ownerId: 'quantity-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['quantity:read', 'quantity:write', 'worker:list:read', 'crew:list:read', 'project:list:read'] }
  const now = '2026-10-07T08:00:00.000Z'
  await storage.withTransaction(async (db) => {
    for (const id of ['quantity-project', 'other-project'])
      await db.execute('INSERT INTO projects(id,name,code,draft_json,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', [id, id, id, JSON.stringify({ name: id, code: id }), now, now])
  })
  const owner = createProductionQuantityService(storage)
  const service = owner.forSession(() => actor)
  const query = { projectId: 'quantity-project', origin: 'real' as const, includeDemo: false }
  const command = (baseVersion: string, commandId: string, action: QuantityRegionAction): QuantityCommand => ({ projectId: query.projectId, origin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'quantity:write', commandId, baseVersion, action })
  return { storage, options, actor, owner, service, query, command }
}

it('正式工程量读取不发DDL或同步/复活任何主档，区域写入保持同盘原命令回执', async () => {
  const f = await fixture()
  try {
    await f.storage.withTransaction(async (tx) => {
      const writes: string[] = []
      const local = productionQuantityInTransaction({ select: tx.select, execute: async (sql, params) => {
        writes.push(sql)
        await tx.execute(sql, params)
      } }, () => f.actor)
      await local.region(f.query, f.actor)
      expect(writes).toEqual([])
    })
    const read = await f.service.region(f.query)
    const original = f.command(read.sourceVersion, 'quantity-original-building', { kind: 'create-building', draft: { code: 'A', name: '原楼栋' } })
    const saved = await f.service.execute(original)
    expect(await f.service.execute(original)).toEqual(saved)
    expect((await f.service.region(f.query)).data.buildings).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, name: '原楼栋' })]))
    await f.storage.close()
    const child = await runColdProcess('production-quantity-cold-process', [], { env: { ...process.env, CRM_QUANTITY_COLD_DIRECTORY: f.options.directory, CRM_QUANTITY_COLD_DESCRIPTOR: JSON.stringify(quantityRecoveryDescriptor(original)) } })
    expect(JSON.parse(child.stdout)).toMatchObject({ recovered: { outcome: 'applied', result: saved }, buildings: [expect.objectContaining({ id: saved.id })] })
  }
  finally { await f.storage.close() }
}, 30_000)

it('同项目无关楼栋/阶段和其他项目改名不阻止原楼层，原目标隐藏及同号换正文拒绝', async () => {
  const f = await fixture()
  try {
    const first = await f.service.region(f.query)
    const building = await f.service.execute(f.command(first.sourceVersion, 'quantity-target-building', { kind: 'create-building', draft: { code: 'A', name: '目标楼栋' } }))
    const basis = await f.service.region(f.query)
    const original = f.command(basis.sourceVersion, 'quantity-selected-floor', { kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '一层' } })
    await f.service.execute(f.command(basis.sourceVersion, 'quantity-sibling-building', { kind: 'create-building', draft: { code: 'B', name: '无关楼栋' } }))
    await f.storage.withTransaction(async (db) => {
      await db.execute('UPDATE projects SET name=? WHERE id=?', ['无关合法改名', 'other-project'])
      await db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES (?,?,?,?,?)', ['unrelated-stage', f.query.projectId, 'OTHER', '无关阶段', '木工'])
    })
    const saved = await f.service.execute(original)
    expect((await f.service.region(f.query)).data.floors).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, buildingId: building.id })]))
    await expect(f.service.execute({ ...original, action: { ...original.action, draft: { code: 'F2', name: '另一正文' } } })).rejects.toThrow('原编号')
    const current = await f.service.region(f.query)
    const stale = f.command(current.sourceVersion, 'quantity-hidden-target-floor', { kind: 'create-floor', buildingId: building.id, draft: { code: 'F3', name: '三层' } })
    await f.storage.execute('UPDATE buildings SET deleted_at=? WHERE id=?', ['2026-10-07T10:00:00.000Z', building.id])
    await expect(f.service.execute(stale)).rejects.toThrow()
    const descriptor = quantityRecoveryDescriptor(stale)
    expect(await f.owner.resolve(descriptor, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: stale.commandId })
    expect(await f.owner.resolve(descriptor, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: stale.commandId })
    await expect(f.service.execute(stale)).rejects.toThrow('封存')
    await expect(f.owner.resolve({ ...descriptor, scopeId: 'other-project' }, () => f.actor)).rejects.toThrow('恢复描述')
  }
  finally { await f.storage.close() }
})

it('正式工程量来源与当前权限失败时不回落开发实例，也不生成事实', async () => {
  const f = await fixture()
  try {
    await expect(f.service.region({ ...f.query, origin: 'demo', includeDemo: true })).rejects.toThrow('其他数据来源')
    const current = await f.service.region(f.query)
    f.actor.capabilities = f.actor.capabilities.filter(capability => capability !== 'quantity:write')
    await expect(f.service.execute(f.command(current.sourceVersion, 'quantity-denied-building', { kind: 'create-building', draft: { code: 'NO', name: '无权输入' } }))).rejects.toThrow('无权')
    expect((await f.service.region(f.query)).data.buildings).toEqual([])
  }
  finally { await f.storage.close() }
})

it('责任保存只消费选定户/模板/人员资格，别模板和未选人员变化允许；原责任、模板和资格变化拒绝', async () => {
  const f = await fixture()
  try {
    await f.storage.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO buildings(id,project_id,code,name) VALUES (\'selected-building\',?,\'SEL\',\'目标栋\')', [f.query.projectId])
      await tx.execute('INSERT INTO floors(id,building_id,code,name) VALUES (\'selected-floor\',\'selected-building\',\'F\',\'目标层\')')
      await tx.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES (\'selected-template\',?,\'SEL\',\'目标模板\'),(\'unrelated-template\',?,\'OTHER\',\'别模板\')', [f.query.projectId, f.query.projectId])
      await tx.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES (\'selected-unit\',\'selected-floor\',\'selected-template\',\'101\')')
      await tx.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES (\'selected-item\',?,\'I\',\'腻子\',\'油漆工\',\'㎡\')', [f.query.projectId])
      const [room] = await tx.select<{ id: string }>('SELECT id FROM rooms WHERE template_id=\'selected-template\'')
      await tx.execute('INSERT INTO house_type_template_items(id,room_id,item_id,contract_qty,provisional_qty,field_qty) VALUES (\'selected-line\',?,\'selected-item\',0,6,NULL)', [room!.id])
      for (const id of ['selected-crew', 'unselected-crew']) await tx.execute('INSERT INTO crews(id,record_json) VALUES (?,?)', [id, JSON.stringify({ id, version: 1, updatedAt: '2026-10-07T08:00:00.000Z', draft: { id, name: id, trade: '油漆工' } })])
    })
    const basis = await f.service.assignments(f.query)
    const original: QuantityCommand = { ...f.command(basis.sourceVersion, 'quantity-selected-responsibility', { kind: 'create-building', draft: { code: 'UNUSED', name: 'unused' } }), action: { kind: 'save-assignments', draft: { projectId: f.query.projectId, trade: '油漆工', assigneeKind: 'crew', assigneeId: 'selected-crew', unitIds: ['selected-unit'], expectedAssignments: [{ unitId: 'selected-unit', assignmentId: null, fingerprint: null }], scopes: [], note: '原责任', allowReplacement: false } } }
    await f.storage.withTransaction(async (tx) => {
      await tx.execute('UPDATE house_type_templates SET name=\'别模板新名称\' WHERE id=\'unrelated-template\'')
      const [row] = await tx.select<{ record_json: string }>('SELECT record_json FROM crews WHERE id=\'unselected-crew\'')
      const changed = JSON.parse(row!.record_json)
      changed.draft.trade = '木工'
      await tx.execute('UPDATE crews SET record_json=? WHERE id=\'unselected-crew\'', [JSON.stringify(changed)])
    })
    const saved = await f.service.execute(original)
    expect(saved.assignments?.changedUnitIds).toEqual(['selected-unit'])
    const current = await f.service.assignments(f.query)
    const assignment = current.data.assignments.find(row => row.unitId === 'selected-unit')!
    if (original.action.kind !== 'save-assignments')
      throw new Error('unexpected fixture')
    const changed: QuantityCommand = { ...original, commandId: 'quantity-template-stale-responsibility', baseVersion: current.sourceVersion, action: { kind: 'save-assignments', draft: { ...original.action.draft, expectedAssignments: [{ unitId: 'selected-unit', assignmentId: assignment.id, fingerprint: assignment.fingerprint }], note: '下一版' } } }
    await f.storage.execute('UPDATE house_type_template_items SET provisional_qty=7 WHERE id=\'selected-line\'')
    await expect(f.service.execute(changed)).rejects.toThrow('原目标')
    const next = await f.service.assignments(f.query)
    await f.storage.execute('UPDATE unit_assignments SET note=\'后来原责任\' WHERE id=?', [assignment.id])
    await expect(f.service.execute({ ...changed, commandId: 'quantity-assignment-stale-responsibility', baseVersion: next.sourceVersion })).rejects.toThrow('原目标')
    const latest = await f.service.assignments(f.query)
    await f.storage.withTransaction(async (tx) => {
      const [row] = await tx.select<{ record_json: string }>('SELECT record_json FROM crews WHERE id=\'selected-crew\'')
      const changed = JSON.parse(row!.record_json)
      changed.draft.trade = '木工'
      await tx.execute('UPDATE crews SET record_json=? WHERE id=\'selected-crew\'', [JSON.stringify(changed)])
    })
    await expect(f.service.execute({ ...changed, commandId: 'quantity-qualification-stale-responsibility', baseVersion: latest.sourceVersion })).rejects.toThrow('原目标')
  }
  finally { await f.storage.close() }
}, 30_000)
