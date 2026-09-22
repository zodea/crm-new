import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { seedPayrollC2MigrationSource } from '../../tests/helpers/payroll-c2-migration-source'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立 C2 验收批次')
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    await db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?)', ['c2-history-missing', 'c2-project', 'c2-crew', 'c2-leader', '2026-07', 'C2', 'field', 'released', 100, null])
    await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c2-live', `C2 无工程量验收 ${runId}`])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', ['c2-live-crew', '零星签工班组'])
    for (const [id, name, daily] of [['c2-live-leader', '签工负责人', 481], ['c2-live-worker', '签工成员', 480], ['c2-live-zero', '无签工零收款成员', 0], ['c2-live-missing', '备用签工成员', null]] as const)
      await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id,daily_wage) VALUES (?,?,?,?,?)', [id, name, 'c2-live-crew', 'c2-live', daily])
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
