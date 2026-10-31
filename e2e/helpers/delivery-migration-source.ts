import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { LATEST_VERSION, runMigrations } from '../../app/lib/db/migrations'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { cooperationPdfFixture } from '../../tests/project-supplier/pdf-fixture'

async function unused(): Promise<never> {
  throw new Error('本例只读取显式测试 SQLite')
}
async function prepare() {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute(`INSERT INTO projects(id,name) VALUES('http-delivery-project-441','送货迁移项目')`)
    await db.execute(`INSERT INTO suppliers(id,name) VALUES('http-delivery-supplier-441','送货迁移分供方')`)
    const original = cooperationPdfFixture('Migrated delivery')
    const payloadBase64 = Buffer.from(original).toString('base64')
    for (const id of ['source', 'shared', 'missing']) {
      await db.execute(`INSERT INTO delivery_records(id,project_id,supplier_id,order_no,delivery_date,archived,stored,ocr_status,print_batch_id,print_disposition)
        VALUES(?, 'http-delivery-project-441','http-delivery-supplier-441',?,'2026-09-11',1,1,'reviewed','physical-441','printed')`, [`http-delivery-${id}`, `HTTP-441-${id}`])
      await db.execute(`INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount) VALUES(?,?,'迁入材料','吨',2,10,20)`, [`line-${id}`, `http-delivery-${id}`])
      if (id !== 'missing') {
        await db.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category) VALUES(?,'delivery_record',?,'两页原件.pdf',?,'application/pdf','source')`, [`file-${id}`, `http-delivery-${id}`, original.length])
        await db.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,'base64',?)`, [`file-${id}`, payloadBase64])
      }
    }
    await db.execute(`INSERT INTO project_aliases(id,project_id,alias) VALUES('alias-441','http-delivery-project-441','旧别名保留')`)
    await db.execute(`INSERT INTO operation_logs(id,table_name,record_id,action,before_data,operator) VALUES('audit-441','delivery_records','http-delivery-source','update','旧审计无法解析','历史经办')`)
    const source = await createCoreMigrationLocalSource({
      isDemoActive: () => false,
      currentSchemaVersion: async () => LATEST_VERSION,
      select: (sql, params) => db.select(sql, params),
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
      now: () => '2026-09-11T00:00:00.000Z',
    }).readSource()
    const snapshot = db.raw.export()
    return { source, snapshotSha256: createHash('sha256').update(snapshot).digest('hex'), byteLength: snapshot.length, payloadBase64 }
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
