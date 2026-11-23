import type { TransactionDb } from '../../app/lib/db/coordinator'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { prepareInvoiceWorkbook, validateInvoiceWorkbooks } from '../../server/utils/production-invoice-workbook'

vi.mock('xlsx', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx')>()
  return { ...original, read: vi.fn(original.read) }
})

function syntheticWorkbook() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['发票号码'], ['SYNTHETIC']]), '合成表')
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array)
  const fileDigest = createHash('sha256').update(bytes).digest('hex')
  const source = { fileName: '合成.xlsx', fileDigest, sheetName: '合成表', rowNumber: 2, rawSnapshot: { 发票号码: 'SYNTHETIC' } }
  return { bytes, source, workbook: { fileName: source.fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }
}

describe('工作簿严格 XML 核验未接通时', () => {
  it('原件准备直接拒绝，并且不会调用 SheetJS 读取', async () => {
    const fixture = syntheticWorkbook()
    vi.mocked(XLSX.read).mockClear()
    await expect(prepareInvoiceWorkbook(fixture.workbook, fixture.source)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('安全核验暂不可用') } })
    expect(XLSX.read).not.toHaveBeenCalled()
  })

  it('恢复校验拒绝已有工作簿证据，并且不会调用 SheetJS 读取', async () => {
    const fixture = syntheticWorkbook()
    const book = { id: 'book-one', file_ref_id: 'file-one', sha256: fixture.source.fileDigest, owner_type: 'invoice_workbook', owner_id: 'book-one', file_name: fixture.source.fileName, file_size: fixture.bytes.length, payload_size: fixture.bytes.length, category: 'invoice-import-workbook', deleted_at: null, payload_sha256: fixture.source.fileDigest }
    const row = { command_id: 'command-one', workbook_id: 'book-one', invoice_id: 'invoice-one', command_kind: 'import', sheet_name: fixture.source.sheetName, row_number: fixture.source.rowNumber, source_json: JSON.stringify(fixture.source), mapping_json: '{}' }
    const tx = { async select(sql: string) {
      if (sql.includes('SELECT schema_version'))
        return [{ schema_version: 4 }]
      if (sql.includes('SELECT w.*'))
        return [book]
      if (sql.includes('SELECT * FROM invoice_import_workbook_rows'))
        return [row]
      if (sql.includes('SELECT id FROM file_refs'))
        return [{ id: 'file-one' }]
      if (sql.includes('SELECT content FROM file_payloads'))
        return [{ content: fixture.bytes }]
      if (sql.includes('SELECT action,invoice_id'))
        return [{ action: 'import-workbook', invoice_id: 'invoice-one' }]
      throw new Error(`unexpected SQL: ${sql}`)
    } } as unknown as TransactionDb
    vi.mocked(XLSX.read).mockClear()
    await expect(validateInvoiceWorkbooks(tx)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('安全核验暂不可用') } })
    expect(XLSX.read).not.toHaveBeenCalled()
  })

  it.each([1, 2, 3])('旧版发票来源 v%i 不读取或要求工作簿证据', async (version) => {
    const select = vi.fn(async () => [{ schema_version: version }])
    vi.mocked(XLSX.read).mockClear()
    await expect(validateInvoiceWorkbooks({ select } as unknown as TransactionDb)).resolves.toBeUndefined()
    expect(select).toHaveBeenCalledTimes(1)
    expect(XLSX.read).not.toHaveBeenCalled()
  })
})
