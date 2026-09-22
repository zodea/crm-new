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
    throw new Error('需要有界输出与独立批次验收身份')
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute('INSERT INTO projects(id,name) VALUES(\'batch-project\',?)', [`P7 自动分余工程 ${runId}`])
    await db.execute('INSERT INTO crews(id,name,trade) VALUES(\'batch-crew\',\'批次验收班组\',\'泥工\')')
    await db.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(\'batch-building\',\'batch-project\',\'A\',\'一栋\')')
    await db.execute('INSERT INTO floors(id,building_id,code,name) VALUES(\'batch-floor\',\'batch-building\',\'1\',\'一层\')')
    await db.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES(\'batch-template\',\'batch-project\',\'T\',\'现场户型\')')
    await db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(\'batch-room\',\'batch-template\',\'R\',\'客厅\')')
    await db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'batch-wall\',\'batch-project\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(\'batch-line\',\'batch-room\',\'batch-wall\',1)')
    await db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(\'batch-stage\',\'batch-project\',\'DONE\',\'墙砖完成\',\'泥工\')')
    await db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(\'batch-stage-item\',\'batch-stage\',\'batch-wall\',1)')
    for (const [index, name] of ['甲负责人', '乙负责人', '丙负责人'].entries()) {
      await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES(?,?,\'batch-crew\',\'batch-project\')', [`batch-worker-${index}`, name])
      await db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(?,\'batch-floor\',\'batch-template\',?)', [`batch-unit-${index}`, `10${index + 1}`])
      await db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(?,?,\'泥工\',?)', [`batch-assignment-${index}`, `batch-unit-${index}`, `batch-worker-${index}`])
      await db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,\'batch-room\',\'batch-wall\')', [`batch-scope-${index}`, `batch-assignment-${index}`])
      await db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(?,?,\'batch-stage\',?,\'completed\',\'2026-08-05\')', [`batch-done-${index}`, `batch-unit-${index}`, `batch-assignment-${index}`])
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
