import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { cloneQuantityHollowSnapshot } from '../../tests/helpers/quantity-hollow-migration-fixture'
import { readQuantityCoreSource } from '../../tests/helpers/quantity-migration-source'

async function exportSource() {
  const [snapshot, output] = process.argv.slice(2)
  if (!snapshot || !output)
    throw new Error('需要实际工作区快照及有界来源输出路径')
  const bytes = await readFile(snapshot)
  const db = await cloneQuantityHollowSnapshot(bytes)
  try {
    const source = await readQuantityCoreSource(db)
    await writeFile(output, JSON.stringify({ source, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }))
  }
  finally {
    db.close()
  }
}
void exportSource().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
