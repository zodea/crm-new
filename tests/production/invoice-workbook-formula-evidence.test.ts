import type { CentralInvoiceFields, CentralInvoiceImportSource } from '../../app/lib/invoice/central-contract'
import type { InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'
import { assertInvoiceWorkbookFill, assertInvoiceWorkbookImport, verifiedInvoiceSourceRow } from '../../server/utils/production-invoice-workbook'

/** 只用内存中的合成工作表验证证据投影，不绕过或替代生产 XML 安全门禁。 */
async function syntheticWorkbook(anchor: XLSX.CellObject) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['发票号码', '价税合计', '税额', '备注'],
    ['SYN-ANCHOR', 100, null, '合成备注'],
    ['SYN-FOLLOWER', 200, null, '合成备注'],
    [null, null, null, null],
  ])
  sheet['!ref'] = 'A1:D4'
  XLSX.utils.book_append_sheet(workbook, sheet, '合成表')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['发票号码', '价税合计', '税额', '备注'], ['OTHER', 100, 0, '其他表']]), '另一表')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  sheet.C2 = anchor
  sheet.C4 = { t: 'z', f: '2+2', v: 0 }
  sheet['!merges'] = [XLSX.utils.decode_range('C2:C3')]
  return parseInvoiceWorkbookForMapping(bytes, '合成.xlsx', { workbook })
}

function sourceFor(row: Record<string, unknown>): CentralInvoiceImportSource {
  const meta = getInvoiceImportSourceMeta(row)!
  const rawSnapshot = Object.fromEntries(Object.entries(meta.rawValues).map(([key, value]) => [key, value ?? null])) as CentralInvoiceImportSource['rawSnapshot']
  return { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: meta.sourceSheet, rowNumber: meta.sourceRow, rawSnapshot }
}

const blankFields: CentralInvoiceFields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
const baseline: InvoiceCorrectionContent = { fields: blankFields, items: [], ownerKind: 'personal', projectId: null, supplierId: null, supplierVersion: null, buyer: null, contract: null }
const importMapping = { remark: { column: '备注', confidence: 'confirmed' as const } }

describe('中央工作簿共享公式来源证据', () => {
  it.each([
    { label: '空白公式伪零', anchor: { t: 'z', f: '1+1', v: 0 } as XLSX.CellObject, status: 'missing-cache', message: '缺少缓存值' },
    { label: '错误缓存', anchor: { t: 'e', f: '1/0', v: 0x07, w: '#DIV/0!' } as XLSX.CellObject, status: 'invalid', message: '缓存值异常' },
  ])('$label 的起点和合并成员必须整行拒绝，即使只映射安全文本列', async ({ anchor, status, message }) => {
    const parsed = await syntheticWorkbook(anchor)
    const sheet = parsed.sheets[0]!
    const first = sheet.rows.find(row => getInvoiceImportSourceMeta(row)?.sourceRow === 2)!
    const second = sheet.rows.find(row => getInvoiceImportSourceMeta(row)?.sourceRow === 3)!
    const firstCell = sheet.sourceRows.find(row => row.sourceRow === 2)!.cells.find(cell => cell.address === 'C2')!
    const secondCell = sheet.sourceRows.find(row => row.sourceRow === 3)!.cells.find(cell => cell.address === 'C3')!
    expect(firstCell.formulaStatus).toBe(status)
    expect(secondCell.inheritedFormulaIssue).toEqual({ anchor: 'C2', status })
    expect(getInvoiceImportSourceMeta(second)?.reviewReasons).toContain(`税额（C3）：合并来源 C2 的公式${message}`)

    for (const row of [first, second]) {
      const verified = verifiedInvoiceSourceRow(parsed, sourceFor(row))
      expect(verified.unsafeFormulaColumns).toContain('税额')
      const fields = { ...blankFields, remark: '合成备注' }
      expect(() => assertInvoiceWorkbookImport(fields, [], importMapping, verified.row, verified.columns, verified.unsafeFormulaColumns)).toThrow('公式缓存')
      expect(() => assertInvoiceWorkbookFill(baseline, { ...baseline, fields }, { remark: '备注' }, verified.row, verified.columns, verified.unsafeFormulaColumns)).toThrow('公式缓存')
    }

    const other = parsed.sheets[1]!.rows[0]!
    expect(verifiedInvoiceSourceRow(parsed, sourceFor(other)).unsafeFormulaColumns).toEqual([])
    const formulaOnly = sheet.rows.find(row => getInvoiceImportSourceMeta(row)?.sourceRow === 4)!
    expect(verifiedInvoiceSourceRow(parsed, sourceFor(formulaOnly)).unsafeFormulaColumns).toContain('税额')
  })

  it('空白公式伪零来源保留 null，不能冒充真实零', async () => {
    const parsed = await syntheticWorkbook({ t: 'z', f: '1+1', v: 0 })
    const row = parsed.sheets[0]!.rows[0]!
    const source = sourceFor(row)
    expect(source.rawSnapshot['税额']).toBeNull()
    expect(() => verifiedInvoiceSourceRow(parsed, { ...source, rawSnapshot: { ...source.rawSnapshot, 税额: 0 } })).toThrow('快照')
  })

  it.each([
    { label: '真实零', anchor: { t: 'n', f: '0+0', v: 0 } as XLSX.CellObject, expected: '0', raw: 0 },
    { label: '有效非零', anchor: { t: 'n', f: '2+3', v: 5 } as XLSX.CellObject, expected: '5', raw: 5 },
    { label: '普通合并', anchor: { t: 's', v: '普通值' } as XLSX.CellObject, expected: '普通值', raw: '普通值' },
  ])('$label 保留原值及合并显示，允许正常映射', async ({ anchor, expected, raw }) => {
    const parsed = await syntheticWorkbook(anchor)
    const sheet = parsed.sheets[0]!
    const first = sheet.rows.find(row => getInvoiceImportSourceMeta(row)?.sourceRow === 2)!
    const second = sheet.rows.find(row => getInvoiceImportSourceMeta(row)?.sourceRow === 3)!
    expect(sourceFor(first).rawSnapshot['税额']).toBe(raw)
    expect(second['税额']).toBe(expected)
    const verified = verifiedInvoiceSourceRow(parsed, sourceFor(second))
    expect(verified.unsafeFormulaColumns).toEqual([])
    const fields = { ...blankFields, remark: '合成备注' }
    expect(() => assertInvoiceWorkbookImport(fields, [], importMapping, verified.row, verified.columns, verified.unsafeFormulaColumns)).not.toThrow()
    const correctionBaseline = { ...baseline, fields: { ...baseline.fields, invoiceNumber: 'SYN-FOLLOWER' } }
    expect(() => assertInvoiceWorkbookFill(correctionBaseline, { ...correctionBaseline, fields: { ...correctionBaseline.fields, remark: fields.remark } }, { invoiceNumber: '发票号码', remark: '备注' }, verified.row, verified.columns, verified.unsafeFormulaColumns)).not.toThrow()
  })
})
