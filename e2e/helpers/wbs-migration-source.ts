import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'
import { seedWbsMigrationSource } from '../../tests/helpers/wbs-migration-source'

async function prepare() {
  const output = process.argv[2]
  if (!output)
    throw new Error('缺少受控测试输出路径')
  const db = await createMemoryDb()
  try {
    let source = await seedWbsMigrationSource(db)
    const runId = process.argv[3]
    if (runId) {
      if (!/^[a-z0-9-]{1,48}$/i.test(runId))
        throw new Error('合成验收批次标识无效')
      // 在真实测试 SQLite 中生成独立来源，再通过正式读取器重算 DTO 与哈希。
      await db.execute('UPDATE projects SET name = ? WHERE id = ?', [`迁入工程 · ${runId}`, 'q-project'])
      await db.execute('UPDATE contracts SET no = ? WHERE id = ?', [`SG-${runId}`, 'q-contract'])
      await db.execute('UPDATE schedule_process_libraries SET code = ?, name = ? WHERE id = ?', [`wbs-${runId}`, `历史排程库 · ${runId}`, 'wbs-library'])
      source = await readQuantityCoreSource(db)
    }
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
