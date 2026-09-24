import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { seedPayrollAQuantitySource } from '../../tests/helpers/payroll-a-quantity-source'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立工资合成批次')
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    await db.execute('UPDATE projects SET name=? WHERE id=?', [`工资验收工程 ${runId}`, 'pa-project'])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,?,?)', ['pa-worker-zero', '零收款成员', 'pa-crew-current', 'pa-project'])
    await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id) VALUES (?,?,?,?)', ['pa-worker-multi', '跨层完成工人', 'pa-crew-current', 'pa-project'])
    await db.execute('INSERT INTO floors(id,building_id,code,name) VALUES (?,?,?,?)', ['pa-floor-two', 'pa-building', '2', '二层'])
    for (const [suffix, floorId, code] of [['one', 'pa-floor', '103'], ['two', 'pa-floor-two', '203']]) {
      await db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES (?,?,?,?)', [`pa-unit-multi-${suffix}`, floorId, 'pa-template-other', code])
      await db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES (?,?,?,?)', [`pa-asg-multi-${suffix}`, `pa-unit-multi-${suffix}`, '油漆工', 'pa-worker-multi'])
      await db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES (?,?,?,?,?,?)', [`pa-done-multi-${suffix}`, `pa-unit-multi-${suffix}`, 'pa-stage', `pa-asg-multi-${suffix}`, 'completed', '2026-08-10'])
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, runId }))
  }
  finally {
    db.close()
  }
}
void prepare().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
