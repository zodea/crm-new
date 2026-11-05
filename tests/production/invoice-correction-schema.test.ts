import { Buffer } from 'node:buffer'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { PRODUCTION_INVOICE_CORRECTION_SCHEMA } from '../../server/utils/production-invoice-correction-schema'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES } from '../../server/utils/production-storage-schema'

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  db.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 31))
    db.exec(upgrade.sql)
  db.exec(PRODUCTION_INVOICE_CORRECTION_SCHEMA)
  db.exec(`INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,version,created_at,updated_at)
    VALUES('invoice-one','manual','pending','unreviewed','none',4,'t','t')`)
  return db
}

it('更正草稿不改变原票，提交后基准、版本及关联证据不可重写', () => {
  const db = fixture()
  try {
    db.exec(`INSERT INTO invoice_corrections VALUES('correction-one','invoice-one',4,1,'draft','{"version":"4"}','{"reason":"差异"}','t1','t1',NULL,NULL)`)
    expect(db.prepare('SELECT version FROM invoices WHERE id=?').get('invoice-one')).toEqual({ version: 4 })
    expect(() => db.exec(`UPDATE invoice_corrections SET baseline_json='{}',version=2`)).toThrow('immutable')
    expect(() => db.exec(`UPDATE invoice_corrections SET invoice_id='other',version=2`)).toThrow('immutable')
    expect(() => db.exec(`UPDATE invoice_corrections SET version=3`)).toThrow('immutable')
    db.exec(`UPDATE invoice_corrections SET state='submitted',version=2,submitted_at='t2',updated_at='t2',result_invoice_version=5`)
    expect(() => db.exec(`UPDATE invoice_corrections SET record_json='{}',version=3`)).toThrow('immutable')
    expect(() => db.exec('DELETE FROM invoice_corrections')).toThrow('immutable')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }
  finally { db.close() }
})

it('更正命令、版本和附件正文受外键及不可变保护，失败整批回滚', () => {
  const db = fixture()
  try {
    db.exec(`INSERT INTO invoice_corrections VALUES('correction-one','invoice-one',4,1,'draft','{}','{}','t1','t1',NULL,NULL)`)
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO invoice_correction_receipts VALUES(?,?,?,?,?,?,?,?,?)').run('command-one', 'workspace', 'actor', 'correction-one', 'save-draft', 'a'.repeat(64), '{}', '{}', 't1')
    db.exec(`INSERT INTO invoice_correction_versions VALUES('correction-one',1,'command-one','actor','{}','t1')`)
    db.exec(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES('file-one','invoice_correction','correction-one','依据.pdf',3,'application/pdf','actor','t1')`)
    db.prepare('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)').run('file-one', Buffer.from('abc'), 'b'.repeat(64))
    db.prepare('INSERT INTO invoice_correction_files VALUES(?,?,?)').run('file-one', 'correction-one', 'b'.repeat(64))
    db.exec('COMMIT')
    for (const sql of ['UPDATE invoice_correction_versions SET actor_id=actor_id', 'DELETE FROM invoice_correction_receipts', 'DELETE FROM invoice_correction_files', 'UPDATE file_refs SET file_name=file_name', 'DELETE FROM file_payloads'])
      expect(() => db.exec(sql)).toThrow('immutable')
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO invoice_correction_receipts VALUES(?,?,?,?,?,?,?,?,?)').run('command-two', 'workspace', 'actor', 'correction-one', 'submit', 'c'.repeat(64), '{}', '{}', 't2')
    expect(() => db.exec(`INSERT INTO invoice_correction_versions VALUES('missing',2,'command-two','actor','{}','t2')`)).toThrow('FOREIGN KEY constraint failed')
    db.exec('ROLLBACK')
    expect(db.prepare('SELECT command_id FROM invoice_correction_receipts ORDER BY command_id').all()).toEqual([{ command_id: 'command-one' }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }
  finally { db.close() }
})
