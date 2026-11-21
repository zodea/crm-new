import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { LATEST_VERSION, runMigrations } from '../../app/lib/db/migrations'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'
import { createMemoryDb } from '../../tests/helpers/memory-db'

async function unused(): Promise<never> {
  throw new Error('本例仅显式读取测试 SQLite 快照')
}
async function prepare() {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('http-customer-436', '迁移收款甲方')`)
    await db.execute(`INSERT INTO projects (id, name, customer_id) VALUES ('http-project-436', '迁移收款项目', 'http-customer-436')`)
    await db.execute(`INSERT INTO contracts (id, no, name, kind, project_id, customer_id, amount, status, content, sign_date)
      VALUES ('http-contract-436', 'SG-HTTP-436', '迁移收款合同', '施工', 'http-project-436', 'http-customer-436', 1000, '履约中', '迁移测试施工内容', '2026-09-01')`)
    await db.execute(`INSERT INTO receipt_registrations (id, no, receipt_date, project_id, customer_id, contract_id,
      amount, payer_account, payment_method, acceptance_bill_no, bill_due_date, period_no, bank_serial_no, handler,
      review_status, status, note, created_at, updated_at)
      VALUES ('http-receipt-436', 'SK-HTTP-MIGRATE-436', '2026-09-10', 'http-project-436', 'http-customer-436', 'http-contract-436',
        12.35, '6222436', '承兑汇票', 'CD-HTTP-436', '2026-12-10', '二期', 'BANK-HTTP-436', '迁移经办', '待审核',
        'submitted', '完整历史备注', '2026-09-10 01:00:00', '2026-09-10 02:00:00')`)
    await db.execute(`INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_path, file_size, mime_type, category, uploader, uploaded_at)
      VALUES ('http-file-436', 'receipt_registration', 'http-receipt-436', '迁移收款凭证.txt', 'C:/old-private/receipt.txt', 6, 'text/plain', 'voucher', '历史经办', '2026-09-10 01:00:00')`)
    await db.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES ('http-file-436', 'base64', '5pS25qy+')`)
    const source = await createCoreMigrationLocalSource({
      isNative: () => false,
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
    const bytes = db.raw.export()
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
    return { source, snapshotSha256, byteLength: bytes.byteLength }
  }
  finally {
    db.close()
  }
}
async function main() {
  const destination = process.argv.at(-1)
  if (!destination?.endsWith('.json'))
    throw new Error('需要明确的 JSON 测试输出路径')
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, JSON.stringify(await prepare()), 'utf8')
}
void main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
