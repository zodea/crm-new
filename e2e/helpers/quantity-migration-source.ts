import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { seedQuantityMigrationSource } from '../../tests/helpers/quantity-migration-source'

async function prepare() {
  const output = process.argv[2]
  if (!output)
    throw new Error('缺少受控测试输出路径')
  const db = await createMemoryDb()
  try {
    const source = await seedQuantityMigrationSource(db)
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
