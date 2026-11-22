import type { QuantityContext } from '../../app/lib/quantity/central-contract'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { runMigrations } from '../../app/lib/db/migrations'
import { createQuantityService } from '../../app/lib/quantity/central-service'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

/** 仅两栋同层的原身份、责任、实测量和完成事实；检查、整改、工资及采用均无种子。 */
async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出及本次独立空鼓场景身份')
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute('INSERT INTO projects(id,name) VALUES(?,?)', ['hollow-browser', `P6 原户空鼓核验工程 ${runId}`])
    await db.execute('INSERT INTO crews(id,name,trade,default_pay_ratio,rent_subsidy_enabled,rent_subsidy_price,mgmt_fee_enabled,mgmt_fee_price) VALUES(?,?,?,?,?,?,?,?)', ['hollow-crew', '空鼓现场班组', '泥工', 1, 0, 0, 0, 0])
    for (const [id, name] of [['hollow-leader', '原施工责任人'], ['hollow-zero', '零收款成员']])
      await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES(?,?,?,?)', [id, name, 'hollow-crew', 'hollow-browser'])
    for (const [itemId, name] of [['wall', '墙砖'], ['floor', '地砖']]) {
      await db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(?,?,?,?,?,?)', [itemId, 'hollow-browser', itemId, name, '泥工', '㎡'])
      await db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(?,?,?,?,?)', [`${itemId}-stage`, 'hollow-browser', itemId, `${name}完成`, '泥工'])
      await db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(?,?,?,1)', [`${itemId}-stage-item`, `${itemId}-stage`, itemId])
    }
    for (const [side, name, unit] of [['east', '东栋临街外立面长位置责任核对楼栋', '3701'], ['west', '西栋后院设备连廊长位置责任核对楼栋', '3702']]) {
      await db.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(?,?,?,?)', [`${side}-building`, 'hollow-browser', side, name])
      await db.execute('INSERT INTO floors(id,building_id,code,name) VALUES(?,?,?,?)', [`${side}-floor`, `${side}-building`, '37', '三十七层'])
      await db.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES(?,?,?,?)', [`${side}-template`, 'hollow-browser', side, '真实现场户型'])
      await db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(?,?,?,?)', [`${side}-客厅:原墙面`, `${side}-template`, 'living', '客厅与过道交界原墙面'])
      await db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(?,?,?,?)', [`${side}-unit`, `${side}-floor`, `${side}-template`, unit])
      for (const item of ['wall', 'floor']) {
        await db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(?,?,?,?)', [`${side}-${item}-line`, `${side}-客厅:原墙面`, item, item === 'wall' ? 40 : 20])
      }
    }
    const context: QuantityContext = { workspaceId: 'hollow-browser-original', actorId: 'hollow-browser-operator', capabilities: ['quantity:read', 'quantity:write', 'project:list:read', 'worker:list:read', 'crew:list:read'] }
    const coordinator = createDbCoordinator(async () => ({ ...db, close: async () => db.close() }))
    const quantity = createQuantityService({ workspaceId: context.workspaceId, database: coordinator, project: async id => id === 'hollow-browser' ? { id, name: `P6 原户空鼓核验工程 ${runId}`, code: 'P6', dataOrigin: 'real' as const } : null, people: async () => [{ id: 'hollow-crew', name: '空鼓现场班组', kind: 'crew' as const, trade: '泥工', trades: ['泥工'], itemNames: [], dataOrigin: 'real' as const }, ...[['hollow-leader', '原施工责任人'], ['hollow-zero', '零收款成员']].map(([id, name]) => ({ id: id!, name: name!, kind: 'worker' as const, trade: '泥工', trades: ['泥工'], itemNames: [], dataOrigin: 'real' as const }))] })
    const query = { projectId: 'hollow-browser', origin: 'real' as const, includeDemo: false }
    // 原责任由公开命令创建，审计/细分正文随真实来源运输；不手写健康审计。
    for (const side of ['east', 'west']) {
      const unitId = `${side}-unit`
      const read = await quantity.assignments(query, context)
      const unit = read.data.units.find(unit => unit.id === unitId)
      if (!unit)
        throw new Error(`原责任夹具缺少户 ${unitId}`)
      const scopes = read.data.scopeOptions.filter(option => option.templateId === unit.templateId && option.trade === '泥工').map(option => ({ unitId, roomId: option.roomId, itemId: option.itemId }))
      if (!scopes.length)
        throw new Error(`原责任夹具未读到户 ${unitId} 的细分范围`)
      await quantity.execute({ workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'quantity:write', commandId: `hollow-original-assignment-${side}`, baseVersion: read.sourceVersion, origin: 'real', projectId: query.projectId, action: { kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥工', assigneeKind: 'worker', assigneeId: 'hollow-leader', unitIds: [unitId], expectedAssignments: [{ unitId, assignmentId: null, fingerprint: null }], scopes, note: '原生公开责任指派', allowReplacement: false } } }, context)
      const [assignment] = await db.select<{ id: string }>('SELECT id FROM unit_assignments WHERE unit_id=? AND deleted_at IS NULL', [unitId])
      if (!assignment)
        throw new Error('公开指派未建立原责任')
      for (const item of ['wall', 'floor']) {
        if (side === 'west' && item === 'floor')
          continue
        await db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(?,?,?,?,?,?)', [`${side}-${item}-done`, unitId, `${item}-stage`, assignment.id, 'completed', side === 'east' && item === 'wall' ? '2026-07-10' : '2026-08-05'])
      }
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, runId }))
  }
  finally { db.close() }
}
void prepare().catch((cause) => {
  process.stderr.write(cause instanceof Error ? cause.stack ?? cause.message : String(cause))
  process.exitCode = 1
})
