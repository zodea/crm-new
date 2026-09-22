import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { seedPayrollC1Source } from '../../tests/helpers/payroll-c1-source'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立 C1 验收批次')
  const db = await createMemoryDb()
  try {
    await seedPayrollC1Source(db)
    await db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?)', ['c1-history-missing', 'c1-project', 'c1-crew-current', 'c1-worker', '2026-07', 'C1', 'field', 'released', 100, null])
    await db.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['c1-live', `C1 无工程量验收 ${runId}`])
    await db.execute('INSERT INTO crews(id,name) VALUES (?,?)', ['c1-live-crew', '计时班组'])
    for (const [id, name, daily] of [['c1-live-leader', '日薪481负责人', 481], ['c1-live-worker', '日薪480工人', 480], ['c1-live-zero', '无考勤零收款成员', 0], ['c1-live-missing', '缺日薪工人', null]] as const)
      await db.execute('INSERT INTO workers(id,name,crew_id,current_project_id,daily_wage) VALUES (?,?,?,?,?)', [id, name, 'c1-live-crew', 'c1-live', daily])
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
