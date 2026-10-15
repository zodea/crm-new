import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { LATEST_VERSION, runMigrations } from '../../app/lib/db/migrations'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'
import { createMemoryDb } from '../../tests/helpers/memory-db'
import { cooperationPdfFixture } from '../../tests/project-supplier/pdf-fixture'

const at = '2026-09-12T00:00:00.000Z'
const pdf = Buffer.from(cooperationPdfFixture('Synthetic credential 446'))

async function unused(): Promise<never> {
  throw new Error('只读取显式测试 SQLite')
}
async function prepare() {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    await db.execute(`INSERT INTO suppliers (
      id, name, unique_code, tax_no, aliases, credential_status, credential_reviewed_at, credential_review_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'qualified', ?, ?, ?, ?)`, ['http-supplier-446', '完整迁入证照分供方', 'HTTP-INTERNAL-446', 'HTTP-TAX-446', '["完整迁入旧名称"]', at, '迁入前已逐件人工核对', at, at])
    await db.execute(`INSERT INTO suppliers (id, name, unique_code, credential_status, credential_reviewed_at, created_at, updated_at)
      VALUES ('http-supplier-446-missing', '旧路径缺少正文分供方', 'ONLY-INTERNAL-446', 'qualified', ?, ?, ?)`, [at, at, at])
    for (const [index, category] of ['营业执照', '法人身份证', '银行账户资料', '其他'].entries()) {
      const credentialId = `http-credential-446-${index}`
      const fileId = `http-file-446-${index}`
      const deletedAt = index === 3 ? at : null
      await db.execute(`INSERT INTO supplier_credentials (
        id, supplier_id, category, file_name, file_path, ocr_result, ocr_confidence, ocr_confirmed_result, ocr_confirmed_at, ocr_review_status, verified_at, added_at, deleted_at
      ) VALUES (?, 'http-supplier-446', ?, ?, ?, ?, 0.85, ?, ?, 'pending', ?, ?, ?)`, [credentialId, category, `${category}迁入原件.pdf`, `C:/legacy-446/${credentialId}.pdf`, '{"rawText":"迁入原始 OCR 保留"}', '{"name":"原人工已确认候选"}', at, at, at, deletedAt])
      await db.execute(`INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_path, file_size, mime_type, category, uploaded_at, deleted_at)
        VALUES (?, 'supplier_credential', ?, ?, ?, ?, 'application/pdf', ?, ?, ?)`, [fileId, credentialId, `${category}迁入原件.pdf`, `C:/legacy-446/${credentialId}.pdf`, pdf.length, category, at, deletedAt])
      await db.execute('UPDATE supplier_credentials SET file_ref_id = ? WHERE id = ?', [fileId, credentialId])
      await db.execute('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, \'base64\', ?)', [fileId, pdf.toString('base64')])
    }
    await db.execute(`INSERT INTO supplier_credential_requirements (id, supplier_id, category, requirement, reason, updated_at)
      VALUES ('http-requirement-446', 'http-supplier-446', '品牌授权书', 'optional', '旧业务明确按需提供', ?)`, [at])
    await db.execute(`INSERT INTO supplier_credential_audits (id, supplier_id, credential_id, action, category_before, category_after, changed_fields, created_at)
      VALUES ('http-delete-audit-446', 'http-supplier-446', 'http-credential-446-3', 'credential_delete', '其他', '其他', '["deleted_at"]', ?)`, [at])
    await db.execute(`INSERT INTO supplier_audits (id, supplier_id, action, outcome, source_category, changed_fields, note_present, created_at)
      VALUES ('http-review-audit-446', 'http-supplier-446', 'credential_review', 'qualified', 'manual', '["credentialStatus"]', 1, ?)`, [at])
    await db.execute(`INSERT INTO supplier_credentials (id, supplier_id, category, file_name, file_path, added_at)
      VALUES ('http-credential-446-path-only', 'http-supplier-446-missing', '营业执照', '只有旧路径.pdf', 'C:/legacy-446/unavailable.pdf', ?)`, [at])
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
      now: () => at,
    }).readSource()
    const snapshot = db.raw.export()
    return { source, snapshotSha256: createHash('sha256').update(snapshot).digest('hex'), byteLength: snapshot.length }
  }
  finally {
    db.close()
  }
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
