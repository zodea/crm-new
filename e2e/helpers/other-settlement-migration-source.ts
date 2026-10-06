import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { OTHER_SETTLEMENT_SCHEMA } from '../../app/lib/other-settlement/schema'
/** Complete physical Native history created only in this test's isolated synthetic directory. */
export async function createOtherSettlementMigrationSource(directory: string) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'synthetic-native-other.sqlite')
  const db = new DatabaseSync(path)
  const original = Buffer.from([0, 10, 128, 255])
  try {
    db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(60);
CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT);INSERT INTO suppliers VALUES('native-other-supplier','原历史交易方');
CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);
CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),encoding TEXT,content TEXT);
CREATE TABLE operation_logs(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operator TEXT,detail TEXT);
${OTHER_SETTLEMENT_SCHEMA}
INSERT INTO expenditure_settlements(id,name,supplier_id,total_amount,tax_rate,status,created_by,updated_by) VALUES('native-other-zero','原真实零结算','native-other-supplier',0,NULL,'confirmed','原创建人','原更新人');
INSERT INTO expenditure_settlements(id,name,total_amount,status) VALUES('native-other-unknown','原未知结算',NULL,'draft');
INSERT INTO operation_logs VALUES('native-other-audit','expenditure_settlements','native-other-zero','原操作者','原审计原文');`)
    db.prepare('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run('native-other-original', 'expenditure_settlement', 'native-other-zero', '原结算正文.bin', '', original.length, 'application/octet-stream', '原类别', '原上传者', '2026-10-01T00:00:00.000Z')
    db.prepare('INSERT INTO file_payloads VALUES(?,?,?)').run('native-other-original', 'base64', original.toString('base64'))
  }
  finally {
    db.close()
  }
  return { path, bytes: await readFile(path), original }
}
