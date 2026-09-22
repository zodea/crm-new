import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'
import { seedWbsMigrationSource } from '../../tests/helpers/wbs-migration-source'

async function prepare() {
  const output = process.argv[2]
  const runId = process.argv[3]
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('缺少受控测试输出路径或批次')
  const db = await createMemoryDb()
  try {
    await seedWbsMigrationSource(db)
    await db.execute('UPDATE projects SET name = ? WHERE id = ?', [`绑定验收工程 · ${runId}`, 'q-project'])
    await db.execute('UPDATE contracts SET no = ? WHERE id = ?', [`BIND-${runId}`, 'q-contract'])
    await db.execute('UPDATE schedule_process_libraries SET code = ?, name = ? WHERE id = ?', [`binding-${runId}`, `绑定验收工序库 · ${runId}`, 'wbs-library'])
    await db.execute('UPDATE boq_lines SET building = ? WHERE id = ?', ['', 'wbs-contract-boq'])
    await db.execute('INSERT INTO house_type_templates (id,project_id,code,name) VALUES (?,?,?,?)', ['binding-partial-template', 'q-project', 'PARTIAL', '暂估缺量户型'])
    await db.execute('INSERT INTO rooms (id,template_id,code,name) VALUES (?,?,?,?)', ['binding-partial-room', 'binding-partial-template', 'R', '客厅'])
    await db.execute('INSERT INTO units (id,floor_id,house_type_template_id,code) VALUES (?,?,?,?)', ['binding-unit-202', 'wbs-contract-floor', 'binding-partial-template', '202'])
    await db.execute('INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id,contract_qty,provisional_qty) VALUES (?,?,?,?,?,?)', ['binding-partial-wall', 'binding-partial-room', 'q-item', 'wbs-contract-boq', null, null])
    for (const [key, name, quantity, sort] of [['ZERO', '真零踢脚线', 0, 20], ['LENGTH', '按米核对管线', 8, 30]] as const) {
      const itemId = `binding-item-${key}`
      const boqId = `binding-boq-${key}`
      await db.execute('INSERT INTO items (id,project_id,code,name,section,trade,unit,sort_order) VALUES (?,?,?,?,?,?,?,?)', [itemId, 'q-project', key, name, '安装', '油漆工', 'm', sort])
      await db.execute('INSERT INTO construction_stage_items (id,stage_id,item_id) VALUES (?,?,?)', [`binding-stage-${key}`, 'q-stage', itemId])
      await db.execute('INSERT INTO boq_lines (id,boq_file_id,project_id,contract_id,item_id,item_name,unit,qty,unit_price,building,trace_key,source_sheet,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [boqId, 'q-source', 'q-project', 'q-contract', itemId, name, 'm', quantity * 3, 1, '', `清单:${sort}`, '清单', sort])
      for (const room of ['wbs-contract-room', 'binding-partial-room'])
        await db.execute('INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id,contract_qty,provisional_qty) VALUES (?,?,?,?,?,?)', [`binding-line-${key}-${room}`, room, itemId, boqId, quantity, quantity])
      await db.execute('INSERT INTO schedule_process_library_tasks (id,library_id,task_key,name,trade,color,duration_days,stage_code,item_codes_json,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)', [`binding-task-${key}`, 'wbs-library', key.toLowerCase(), name, '油漆工', '#0f766e', 2, 'S', JSON.stringify([key]), sort])
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength }), 'utf8')
  }
  finally { db.close() }
}
void prepare().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
