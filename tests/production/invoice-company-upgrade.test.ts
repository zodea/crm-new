import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { PRODUCTION_INVOICE_COMPANY_UPGRADE } from '../../server/utils/production-invoice-company-upgrade'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES } from '../../server/utils/production-storage-schema'

const affected = ['invoices', 'invoice_command_receipts', 'invoice_audits', 'invoice_recognitions', 'invoice_archive_evidence', 'invoice_print_lines', 'invoice_import_sources', 'invoice_legacy_members']

function fixture(version: 28 | 29) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  db.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= version))
    db.exec(upgrade.sql)
  if (version === 28)
    db.exec(PRODUCTION_STORAGE_UPGRADES.find(step => step.to === 29)!.sql)
  db.exec(`
    INSERT INTO projects(id,name,code,draft_json,version,created_at,updated_at) VALUES('p','项目','P','{}',1,'t','t');
    INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES('orig','invoice','i','original.pdf',3,'application/pdf','actor','t');
    INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,owner_kind,project_id,original_file_id,version,created_at,updated_at)
      VALUES('i','scan','done','reviewed','archived','project','p','orig',2,'t','t');
    INSERT INTO invoice_command_receipts VALUES('cmd','w','actor','i','archive','fingerprint  不变','{ "raw" : "原始" }','t');
    INSERT INTO invoice_audits VALUES('audit','i','cmd','actor','archive',NULL,'{"owner":"project"}','t');
    INSERT INTO invoice_recognitions VALUES('rec','i','cmd','actor','{}','t');
    INSERT INTO invoice_archive_evidence VALUES('ev','i','cmd','actor','{}','t');
    INSERT INTO invoice_print_receipts VALUES('print','w','actor','fp','{}','t');
    INSERT INTO invoice_print_lines VALUES('print','i','actor','{}','{}','t');
    INSERT INTO invoice_import_sources VALUES('cmd','i','digest','sheet',4,'{}');
    INSERT INTO invoice_legacy_batches VALUES('batch','digest2','w','actor','fp','{}','hash','{}','t');
    INSERT INTO invoice_legacy_members VALUES('batch','i','cmd','{}','hash');
  `)
  return db
}

function state(db: DatabaseSync) {
  return {
    schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all(),
    rows: affected.map(name => db.prepare(`SELECT rowid AS original_rowid,* FROM ${name} ORDER BY rowid`).all()),
  }
}

function upgrade(db: DatabaseSync, sql = PRODUCTION_INVOICE_COMPANY_UPGRADE) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(sql)
    db.exec('COMMIT')
  }
  catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

it.each([28, 29] as const)('候选升级保全 v%i 发票历史、原行号、回执、原件和不可变保护', (version) => {
  const db = fixture(version)
  try {
    const before = state(db)
    upgrade(db)
    expect(state(db).rows).toEqual(before.rows)
    const protectedObjects = before.schema.filter(row => row.type === 'index' || row.type === 'trigger')
    expect(state(db).schema.filter(row => row.type === 'index' || row.type === 'trigger')).toEqual(protectedObjects)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('SELECT fingerprint,result_json FROM invoice_command_receipts').get()).toEqual({ fingerprint: 'fingerprint  不变', result_json: '{ "raw" : "原始" }' })
    expect(db.prepare('SELECT original_file_id FROM invoices').get()).toEqual({ original_file_id: 'orig' })
    expect(() => db.exec('UPDATE invoice_audits SET after_json=\'{}\'')).toThrow('immutable')
    expect(() => db.exec('DELETE FROM invoice_legacy_members')).toThrow('immutable')
  }
  finally { db.close() }
})

it.each([
  'CREATE TABLE extra_invoice_link(invoice_id TEXT REFERENCES invoices(id))',
  'CREATE TABLE extra_uppercase_link(invoice_id TEXT REFERENCES "INVOICES"(id))',
  'CREATE INDEX extra_invoice_index ON invoices(source_kind)',
  'CREATE TRIGGER extra_invoice_trigger AFTER UPDATE ON invoices BEGIN SELECT 1; END',
  'CREATE VIEW extra_invoice_view AS SELECT id FROM invoices',
  'ALTER TABLE invoices ADD COLUMN unclassified TEXT',
  'ALTER TABLE invoices ADD COLUMN unclassified_generated TEXT GENERATED ALWAYS AS (invoice_number) VIRTUAL',
])('发现未分类依赖整批拒绝：%s', (sql) => {
  const db = fixture(29)
  try {
    db.exec(sql)
    const before = state(db)
    expect(() => upgrade(db)).toThrow()
    expect(state(db)).toEqual(before)
  }
  finally { db.close() }
})

it.each([
  'DROP TABLE invoice_company_upgrade_guard;',
  'DROP TABLE invoice_command_receipts;',
  'INSERT INTO invoice_legacy_members(rowid,batch_id,invoice_id,genesis_command_id,evidence_json,evidence_sha256)',
  'CREATE TRIGGER invoice_legacy_members_no_delete',
])('中途故障恢复原有结构与全部历史：%s', (marker) => {
  const db = fixture(29)
  try {
    const before = state(db)
    expect(PRODUCTION_INVOICE_COMPANY_UPGRADE).toContain(marker)
    const failed = PRODUCTION_INVOICE_COMPANY_UPGRADE.replace(marker, `SELECT * FROM deliberately_missing_table;\n${marker}`)
    expect(() => upgrade(db, failed)).toThrow()
    expect(state(db)).toEqual(before)
  }
  finally { db.close() }
})

it('公司草稿不虚构项目，归档必须使用公司合同并选分供方', () => {
  const db = fixture(29)
  try {
    upgrade(db)
    db.exec('INSERT INTO suppliers(id,draft_json,credential_status,version,updated_at,imported) VALUES(\'s\',\'{}\',\'none\',1,\'t\',0)')
    const insert = db.prepare(`INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,owner_kind,project_id,supplier_id,contract_domain,contract_id,contract_version,version,created_at,updated_at)
      VALUES(?,'manual','pending','unreviewed',?,?,?,?,?,?,?,1,'t','t')`)
    insert.run('draft', 'none', 'company', null, null, null, null, null)
    expect(() => insert.run('project', 'none', 'company', 'p', null, null, null, null)).toThrow()
    expect(() => insert.run('missing-contract', 'archived', 'company', null, 's', null, null, null)).toThrow()
    expect(() => insert.run('missing-supplier', 'archived', 'company', null, null, 'company', 'c', '1')).toThrow()
    expect(() => insert.run('other-domain', 'archived', 'company', null, 's', 'auxiliary', 'c', '1')).toThrow()
    expect(() => insert.run('wrong-owner', 'archived', 'personal', null, 's', 'company', 'c', '1')).toThrow()
    insert.run('company', 'archived', 'company', null, 's', 'company', 'c', '1')
    expect(db.prepare('SELECT owner_kind,project_id,contract_domain,contract_id FROM invoices WHERE id=\'company\'').get()).toEqual({ owner_kind: 'company', project_id: null, contract_domain: 'company', contract_id: 'c' })
  }
  finally { db.close() }
})
