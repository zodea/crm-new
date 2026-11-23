import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'
import { createZip } from '../../app/lib/project/archive'
import { assertInvoiceWorkbookFill, assertInvoiceWorkbookImport, prepareInvoiceWorkbook, validateInvoiceWorkbooks } from '../../server/utils/production-invoice-workbook'

async function mergedWorkbook(kind: 'normal' | 'invalid' | 'missing-cache') {
  const anchor = kind === 'normal' ? '<c r="D2" t="inlineStr"><is><t>合并备注</t></is></c>' : kind === 'invalid' ? '<c r="D2" t="e"><f>1/0</f><v>#DIV/0!</v></c>' : '<c r="D2"><f>1/0</f></c>'
  const inline = (address: string, value: string) => `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`
  const xml: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="合成表" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D3"/><sheetData><row r="1">${inline('A1', '发票号码')}${inline('B1', '发票日期')}${inline('C1', '销售方')}${inline('D1', '备注')}</row><row r="2">${inline('A2', 'SYN-001')}${inline('B2', '2026-10-07')}${inline('C2', '合成公司')}${anchor}</row><row r="3">${inline('A3', 'SYN-002')}${inline('B3', '2026-10-07')}${inline('C3', '合成公司')}</row></sheetData><mergeCells count="1"><mergeCell ref="D2:D3"/></mergeCells></worksheet>`,
  }
  const bytes = Buffer.from(createZip(Object.entries(xml).map(([path, data]) => ({ path, data: new TextEncoder().encode(data) }))))
  const fileName = '合成合并.xlsx'
  const parsed = await parseInvoiceWorkbookForMapping(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, fileName)
  const meta = getInvoiceImportSourceMeta(parsed.sheets[0]!.rows[1]!)!
  const rawSnapshot = Object.fromEntries(Object.entries(meta.rawValues).map(([key, value]) => [key, value ?? null])) as Record<string, string | number | boolean | null>
  const source = { fileName, fileDigest: createHash('sha256').update(bytes).digest('hex'), sheetName: meta.sourceSheet, rowNumber: meta.sourceRow, rawSnapshot }
  return { bytes, source, workbook: { fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }
}

describe('合并单元格的来源公式', () => {
  it.each(['normal', 'invalid', 'missing-cache'] as const)('从真实工作簿追踪起点：%s', async (kind) => {
    const fixture = await mergedWorkbook(kind)
    const prepared = await prepareInvoiceWorkbook(fixture.workbook, fixture.source)
    const fields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: String(prepared.row['备注'] ?? '') }
    const mapping = { remark: { column: '备注', confidence: 'confirmed' as const } }
    const before: InvoiceCorrectionContent = { fields: { ...fields, invoiceNumber: 'SYN-002', remark: '' }, items: [], ownerKind: 'personal', projectId: null, supplierId: null, supplierVersion: null, buyer: null, contract: null }
    if (kind === 'normal') {
      expect(fields.remark).toBe('合并备注')
      expect(prepared.unsafeFormulaColumns).not.toContain('备注')
      expect(() => assertInvoiceWorkbookImport(fields, [], mapping, prepared.row, prepared.columns, prepared.unsafeFormulaColumns)).not.toThrow()
      expect(() => assertInvoiceWorkbookFill(before, { ...before, fields: { ...before.fields, remark: fields.remark } }, { invoiceNumber: '发票号码', remark: '备注' }, prepared.row, prepared.columns, prepared.unsafeFormulaColumns)).not.toThrow()
    }
    else {
      expect(prepared.unsafeFormulaColumns).toContain('备注')
      expect(() => assertInvoiceWorkbookImport(fields, [], mapping, prepared.row, prepared.columns, prepared.unsafeFormulaColumns)).toThrow('来源行存在无法核验的公式缓存')
      expect(() => assertInvoiceWorkbookFill(before, { ...before, fields: { ...fields, remark: '不安全' } }, { remark: '备注' }, prepared.row, prepared.columns, prepared.unsafeFormulaColumns)).toThrow('来源行存在无法核验的公式缓存')
    }
    const book = { id: 'book-one', file_ref_id: 'file-one', sha256: fixture.source.fileDigest, owner_type: 'invoice_workbook', owner_id: 'book-one', file_name: fixture.source.fileName, file_size: fixture.bytes.length, payload_size: fixture.bytes.length, category: 'invoice-import-workbook', deleted_at: null, payload_sha256: fixture.source.fileDigest }
    const row = { command_id: 'command-one', workbook_id: 'book-one', invoice_id: 'invoice-one', command_kind: 'import', sheet_name: fixture.source.sheetName, row_number: fixture.source.rowNumber, source_json: JSON.stringify(fixture.source), mapping_json: JSON.stringify(mapping) }
    const tx = { async select(sql: string) {
      if (sql.includes('SELECT schema_version'))
        return [{ schema_version: 5 }]
      if (sql.includes('SELECT w.*'))
        return [book]
      if (sql.includes('SELECT content FROM file_payloads'))
        return [{ content: fixture.bytes }]
      if (sql.includes('SELECT * FROM invoice_import_workbook_rows'))
        return [row]
      if (sql.includes('SELECT id FROM file_refs'))
        return [{ id: 'file-one' }]
      if (sql.includes('SELECT action,invoice_id'))
        return [{ action: 'import-workbook', invoice_id: 'invoice-one' }]
      if (sql.includes('SELECT invoice_id FROM invoice_import_sources'))
        return [{ invoice_id: 'invoice-one' }]
      if (sql.includes('SELECT * FROM invoice_import_sources'))
        return [{ invoice_id: 'invoice-one', source_json: row.source_json }]
      if (sql.includes('SELECT after_json FROM invoice_audits'))
        return [{ after_json: JSON.stringify({ fields, items: [] }) }]
      if (sql.includes('SELECT command_id FROM invoice_command_receipts'))
        return [{ command_id: 'command-one' }]
      if (sql.includes('SELECT command_id,request_json FROM invoice_correction_receipts'))
        return []
      throw new Error(`unexpected SQL: ${sql}`)
    } } as unknown as TransactionDb
    if (kind === 'normal')
      await expect(validateInvoiceWorkbooks(tx)).resolves.toBeUndefined()
    else
      await expect(validateInvoiceWorkbooks(tx)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
})
