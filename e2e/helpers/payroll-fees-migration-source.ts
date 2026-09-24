import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { runMigrations } from '../../app/lib/db/migrations'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

/** 两个真实工程量项目；仅基础身份/责任/现场量，无预置工资、费用或管理簿。 */
async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立费用验收批次')
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute('INSERT INTO crews(id,name,trade,default_pay_ratio,rent_subsidy_enabled,rent_subsidy_price,mgmt_fee_enabled,mgmt_fee_price) VALUES(\'fee-crew\',\'费用核对班组\',\'泥工\',0.8,0,0,0,NULL)')
    for (const [projectId, name, wall, floor] of [['fee-ordinary', 'P5 补贴核对工程', 100, 50], ['fee-management', 'P5 独立管理工程', 400, 200]] as const) {
      await db.execute('INSERT INTO projects(id,name) VALUES(?,?)', [projectId, `${name} ${runId}`])
      for (const [suffix, workerName] of [['leader', '同人普通工资与管理人'], ['zero', '零收款成员']] as const)
        await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES(?,?,?,?)', [`${projectId}-${suffix}`, workerName, 'fee-crew', projectId])
      await db.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(?,?,?,?)', [`${projectId}-building`, projectId, 'A', '一栋'])
      await db.execute('INSERT INTO floors(id,building_id,code,name) VALUES(?,?,?,?)', [`${projectId}-floor`, `${projectId}-building`, '1', '一层'])
      await db.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES(?,?,?,?)', [`${projectId}-template`, projectId, 'T', '现场户型'])
      await db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(?,?,?,?)', [`${projectId}-room`, `${projectId}-template`, 'R', '客厅及浴室'])
      await db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(?,?,?,?)', [`${projectId}-unit`, `${projectId}-floor`, `${projectId}-template`, '101'])
      await db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(?,?,?,?)', [`${projectId}-assignment`, `${projectId}-unit`, '泥工', `${projectId}-leader`])
      for (const [item, itemName, quantity, unit] of [['wall', '墙砖', wall, '㎡'], ['floor', '地砖', floor, '㎡'], ['shower', '淋浴板', 30, '套'], ['zero', '真实零量墙砖', 0, '㎡']] as const) {
        const itemId = `${projectId}-${item}`
        await db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(?,?,?,?,?,?)', [itemId, projectId, item, itemName, '泥工', unit])
        await db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(?,?,?,?)', [`${itemId}-line`, `${projectId}-room`, itemId, item === 'wall' ? quantity / 4 : quantity])
        await db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', [`${itemId}-scope`, `${projectId}-assignment`, `${projectId}-room`, itemId])
        await db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(?,?,?,?,?)', [`${itemId}-stage`, projectId, item, `${itemName}完成`, '泥工'])
        await db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(?,?,?,1)', [`${itemId}-stage-item`, `${itemId}-stage`, itemId])
        if (item !== 'shower')
          await db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(?,?,?,?,?,?)', [`${itemId}-done`, `${projectId}-unit`, `${itemId}-stage`, `${projectId}-assignment`, 'completed', '2026-07-05'])
      }
      for (const part of ['二', '三', '四']) {
        const roomId = `${projectId}-room-${part}`
        await db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(?,?,?,?)', [roomId, `${projectId}-template`, part, `墙砖部位${part}`])
        await db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(?,?,?,?)', [`${roomId}-line`, roomId, `${projectId}-wall`, wall / 4])
        await db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', [`${roomId}-scope`, `${projectId}-assignment`, roomId, `${projectId}-wall`])
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
  process.stderr.write(String(cause))
  process.exitCode = 1
})
