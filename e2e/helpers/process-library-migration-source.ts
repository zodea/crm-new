import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { LATEST_VERSION, runMigrations } from '../../app/lib/db/migrations'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'
import { createMemoryDb } from '../../tests/helpers/memory-db'

async function unused(): Promise<never> {
  throw new Error('只读取显式测试 SQLite')
}
async function prepare() {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    for (const version of [1, 2]) {
      const id = `http-library-443-v${version}`
      await db.execute(`INSERT INTO schedule_process_libraries(id,code,version,name,description,sort_order,deleted_at) VALUES(?,?,?,?,?,?,?)`, [id, 'HTTP-443', version, '装饰施工标准工序', '迁入既有版本，保全历史映射', -10, version === 2 ? '2026-09-01T00:00:00.000Z' : null])
      for (const [index, name] of ['现场交接', '基层施工', '饰面验收'].entries()) {
        await db.execute(`INSERT INTO schedule_process_library_tasks(id,library_id,task_key,name,trade,color,duration_days,stage_code,item_codes_json,sort_order,predecessor_task_key,predecessor_disabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`, [`${id}-task-${index}`, id, `task-${index}`, name, ['普工', '泥水工', '油漆工'][index], ['#2f73c9', '#8b5cf6', '#10b981'][index], index + 2, `GLOBAL-STAGE-${index}`, '["GLOBAL-ITEM"]', (index + 1) * 10, index ? `task-${index - 1}` : null])
      }
    }
    const source = await createCoreMigrationLocalSource({
      isNative: () => false,
      isDemoActive: () => false,
      currentSchemaVersion: async () => LATEST_VERSION,
      select: sql => db.select(sql),
      closeDatabase: unused,
      loadProductionSnapshot: unused,
      readSnapshotSource: unused,
      createBackup: unused,
      loadBackup: unused,
      restoreBackup: unused,
      activateMigration: unused,
      clearMigration: unused,
      prepareMigration: unused,
      loadMigrationMarker: unused,
      loadPendingMigrationMarker: unused,
      now: () => '2026-09-12T00:00:00.000Z',
    }).readSource()
    const snapshot = db.raw.export()
    return { source, snapshotSha256: createHash('sha256').update(snapshot).digest('hex'), byteLength: snapshot.length }
  }
  finally { db.close() }
}
async function main() {
  const destination = process.argv.at(-1)
  if (!destination?.endsWith('.json'))
    throw new Error('需要明确 JSON 输出路径')
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, JSON.stringify(await prepare()), 'utf8')
}
void main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
