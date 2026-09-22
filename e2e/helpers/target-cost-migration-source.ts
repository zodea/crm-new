import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'
import { seedTargetCostMigrationSource } from '../../tests/helpers/target-cost-migration-source'

async function prepare() {
  const [output, runId] = process.argv.slice(2)
  if (!output || !runId || !/^[a-z0-9-]{1,48}$/i.test(runId))
    throw new Error('需要有界输出与独立合成批次')
  const db = await createMemoryDb()
  try {
    await seedTargetCostMigrationSource(db)
    await db.execute('UPDATE projects SET name=? WHERE id=?', [`预算验收工程 ${runId}`, 'budget-project'])
    await db.execute('UPDATE target_costs SET name=? WHERE id=?', [`原当前预算 ${runId}`, 'budget-a'])
    await db.execute('INSERT INTO suppliers(id,name,supplier_category,approval_status) VALUES (?,?,?,?)', ['budget-supplier', `预算验收分供方 ${runId}`, '专业分包', 'approved'])
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
