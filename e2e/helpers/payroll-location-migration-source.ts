import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { runMigrations } from '../../app/lib/db/migrations'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与隔离验收身份')
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute('INSERT INTO projects(id,name) VALUES(\'location-project\',?)', [`冻结楼层输出验收 ${runId}`])
    await db.execute('INSERT INTO workers(id,name,current_project_id) VALUES(\'location-worker\',\'原施工负责人\',\'location-project\')')
    await db.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES(\'location-template\',\'location-project\',\'T\',\'现场户型\')')
    await db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(\'location-room\',\'location-template\',\'R\',\'长房间名：客厅及明确墙砖施工部位\')')
    await db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'location-wall\',\'location-project\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(\'location-line\',\'location-room\',\'location-wall\',1)')
    await db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(\'location-stage\',\'location-project\',\'DONE\',\'墙砖完成\',\'泥工\')')
    await db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(\'location-stage-item\',\'location-stage\',\'location-wall\',1)')
    for (const [building, name] of [['one', '一栋'], ['two', '二栋']]) {
      await db.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(?,\'location-project\',?,?)', [building, building, name])
      const floors = building === 'one' ? Array.from({ length: 29 }, (_, index) => index + 3).filter(floor => ![15, 25].includes(floor)) : [3]
      for (const floor of floors) {
        const id = `${building}-${floor}`
        await db.execute('INSERT INTO floors(id,building_id,code,name) VALUES(?,?,?,?)', [id, building, String(floor), `${floor}楼`])
        await db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(?,?,\'location-template\',?)', [id, id, `${floor}01`])
        await db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(?,?,\'泥工\',\'location-worker\')', [id, id])
        await db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,\'location-room\',\'location-wall\')', [id, id])
        await db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(?,?,\'location-stage\',?,\'completed\',\'2026-08-05\')', [id, id, id])
      }
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength }))
  }
  finally { db.close() }
}
void prepare().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
