import type { SQLInputValue } from 'node:sqlite'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { PRODUCTION_INVOICE_SCHEMA } from '../../server/utils/production-invoice-schema'
import { bindInvoiceWorkbook } from '../../server/utils/production-invoice-workbook'
import { PRODUCTION_INVOICE_WORKBOOK_SCHEMA } from '../../server/utils/production-invoice-workbook-schema'

const bytes = Buffer.from('synthetic already-prepared workbook bytes')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const source = { fileName: '合成.xlsx', fileDigest: sha256, sheetName: '合成表', rowNumber: 3, rawSnapshot: { 票号: 'SYN-1' } }
const workbook = { fileName: source.fileName, bytes, sha256, row: source.rawSnapshot, columns: ['票号'], unsafeFormulaColumns: [] }
const at = '2026-01-01T00:00:00.000Z'

function fixture(damage: 'none' | 'owner-type' | 'owner-id' | 'category' | 'deleted' | 'size' | 'payload-bytes' | 'payload-sha') {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  db.exec(`CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
    CREATE TABLE projects(id TEXT PRIMARY KEY);
    CREATE TABLE suppliers(id TEXT PRIMARY KEY);
    CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,file_name TEXT NOT NULL,file_size INTEGER NOT NULL,mime_type TEXT NOT NULL,category TEXT NOT NULL,uploader TEXT NOT NULL,uploaded_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),content BLOB NOT NULL,sha256 TEXT NOT NULL);`)
  db.exec(PRODUCTION_INVOICE_SCHEMA)
  db.exec(PRODUCTION_INVOICE_WORKBOOK_SCHEMA)
  const invoice = db.prepare('INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,version,created_at,updated_at) VALUES(?,\'manual\',\'pending\',\'unreviewed\',\'none\',1,?,?)')
  invoice.run('invoice-one', at, at)
  invoice.run('invoice-two', at, at)
  db.prepare('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?)').run('file-one', damage === 'owner-type' ? 'invoice' : 'invoice_workbook', damage === 'owner-id' ? 'book-other' : 'book-one', source.fileName, bytes.length + (damage === 'size' ? 1 : 0), 'application/octet-stream', damage === 'category' ? 'other' : 'invoice-import-workbook', 'synthetic-owner', at, damage === 'deleted' ? at : null)
  db.prepare('INSERT INTO file_payloads VALUES(?,?,?)').run('file-one', damage === 'payload-bytes' ? Buffer.from('wrong synthetic bytes') : bytes, damage === 'payload-sha' ? '0'.repeat(64) : sha256)
  db.prepare('INSERT INTO invoice_import_workbooks VALUES(?,?,?,?)').run('book-one', 'file-one', sha256, at)
  db.prepare('INSERT INTO invoice_import_workbook_rows VALUES(?,?,?,?,?,?,?,?)').run('command-old', 'book-one', 'invoice-one', 'correction', source.sheetName, 2, JSON.stringify({ ...source, rowNumber: 2 }), '{}')
  const coordinator = createDbCoordinator(async () => ({
    async execute(sql, params) {
      if (params)
        db.prepare(sql).run(...params as SQLInputValue[])
      else db.exec(sql)
    },
    async select<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params as SQLInputValue[]) as T[] },
    async close() { db.close() },
  }))
  const original = () => coordinator.select('SELECT f.*,p.content,p.sha256 FROM file_refs f JOIN file_payloads p ON p.file_ref_id=f.id ORDER BY f.id')
  const rows = () => coordinator.select('SELECT * FROM invoice_import_workbook_rows ORDER BY command_id')
  const receipts = () => coordinator.select('SELECT * FROM invoice_command_receipts ORDER BY command_id')
  const commit = (invoiceId = 'invoice-one', sourceRow = source.rowNumber) => coordinator.withTransaction(async (tx) => {
    await tx.execute('INSERT INTO invoice_command_receipts VALUES(?,?,?,?,?,?,?,?)', ['command-new', 'synthetic-workspace', 'synthetic-owner', invoiceId, 'import-workbook', 'synthetic-fingerprint', '{}', at])
    await bindInvoiceWorkbook(tx, { workbook, source: { ...source, rowNumber: sourceRow }, mapping: {}, commandId: 'command-new', invoiceId, kind: 'correction', actorId: 'synthetic-owner', now: at })
  })
  return { coordinator, original, rows, receipts, commit }
}

describe('工作簿同摘要复用的原件归属', () => {
  it.each(['owner-type', 'owner-id', 'category', 'deleted'] as const)('已有文件 %s 损坏时整笔回滚', async (damage) => {
    const f = fixture(damage)
    try {
      const before = { original: await f.original(), rows: await f.rows(), receipts: await f.receipts() }
      await expect(f.commit()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      expect(await f.original()).toEqual(before.original)
      expect(await f.rows()).toEqual(before.rows)
      expect(await f.receipts()).toEqual(before.receipts)
    }
    finally { await f.coordinator.close() }
  })
  it.each(['size', 'payload-bytes', 'payload-sha'] as const)('已有正文 %s 损坏时整笔回滚', async (damage) => {
    const f = fixture(damage)
    try {
      const before = { original: await f.original(), rows: await f.rows(), receipts: await f.receipts() }
      await expect(f.commit()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      expect(await f.original()).toEqual(before.original)
      expect(await f.rows()).toEqual(before.rows)
      expect(await f.receipts()).toEqual(before.receipts)
    }
    finally { await f.coordinator.close() }
  })
  it('合法同摘要复用保留原字节并只增加新来源行', async () => {
    const f = fixture('none')
    try {
      const before = await f.original()
      await f.commit()
      expect(await f.original()).toEqual(before)
      expect(await f.rows()).toMatchObject([{ command_id: 'command-new', workbook_id: 'book-one', invoice_id: 'invoice-one', row_number: 3 }, { command_id: 'command-old', workbook_id: 'book-one', invoice_id: 'invoice-one', row_number: 2 }])
      expect(await f.receipts()).toMatchObject([{ command_id: 'command-new', invoice_id: 'invoice-one' }])
    }
    finally { await f.coordinator.close() }
  })
  it('同一来源行不能重复归属另一张发票，回执行也回滚', async () => {
    const f = fixture('none')
    try {
      const before = { original: await f.original(), rows: await f.rows(), receipts: await f.receipts() }
      await expect(f.commit('invoice-two', 2)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await f.original()).toEqual(before.original)
      expect(await f.rows()).toEqual(before.rows)
      expect(await f.receipts()).toEqual(before.receipts)
    }
    finally { await f.coordinator.close() }
  })
})
