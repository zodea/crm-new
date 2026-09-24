import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { seedPayrollMigrationSource, seedReleasedPayrollMigrationSource } from '../../tests/helpers/payroll-migration-source'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立合成批次')
  const db = await createMemoryDb()
  try {
    await seedPayrollMigrationSource(db)
    const healthy = await seedReleasedPayrollMigrationSource(db)
    for (const [id, format, snapshot, month, status] of [['pay-b', 'B', null, '2026-06', 'released'], ['pay-invalid', 'C2', '{坏快照原文', '2026-05', 'released'], ['pay-missing', 'C1', null, '2026-04', 'released'], ['pay-b-draft', 'B', null, '2026-03', 'draft'], ['pay-b-checked', 'B', null, '2026-02', 'checked']] as const) {
      await db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,snapshot_json) VALUES (?,\'pay-project\',\'pay-crew\',\'pay-worker\',?,?,\'field\',?,100,?)', [id, month, format, status, snapshot])
    }
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, runId, healthyStatementId: healthy.statementId, healthySnapshot: healthy.snapshot }))
  }
  finally { db.close() }
}
void prepare().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
