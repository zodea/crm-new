import type { CentralInvoiceFields, CentralInvoiceImportSource } from '../../app/lib/invoice/central-contract'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '../../app/lib/invoice/excel'
import { assertInvoiceWorkbookImport, verifiedInvoiceSourceRow } from '../../server/utils/production-invoice-workbook'

/** 普通内存合成投影；不调用或替代生产工作簿安全门禁。 */
async function fixture() {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['发票号码', 'a', 'a,1', '__proto__', '空值', '真零', '公式'],
    ['SYN-1', '1,2', '2', 'synthetic-proto', null, 0, null],
  ])
  sheet.G2 = { t: 'z', f: '1+1', v: 0 }
  sheet['!ref'] = 'A1:G2'
  XLSX.utils.book_append_sheet(workbook, sheet, '合成表')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = await parseInvoiceWorkbookForMapping(bytes, '合成.xlsx', { workbook })
  const row = parsed.sheets[0]!.rows[0]!
  const meta = getInvoiceImportSourceMeta(row)!
  const pairs = Object.entries(meta.rawValues).map(([key, value]) => [key, value ?? null] as const)
  const rawSnapshot = Object.fromEntries(pairs) as CentralInvoiceImportSource['rawSnapshot']
  const reversed = Object.fromEntries([...pairs].reverse()) as CentralInvoiceImportSource['rawSnapshot']
  const source = { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: meta.sourceSheet, rowNumber: meta.sourceRow, rawSnapshot }
  return { parsed, source, reversed }
}

it('碰撞列的原始值相同而对象顺序相反时仍可核验', async () => {
  const { parsed, source, reversed } = await fixture()
  expect(source.rawSnapshot.a).toBe('1,2')
  expect(source.rawSnapshot['a,1']).toBe('2')
  expect(String(['a', '1,2'])).toBe(String(['a,1', '2']))
  expect(Object.keys(source.rawSnapshot)).toEqual([...Object.keys(reversed)].reverse())
  expect(() => verifiedInvoiceSourceRow(parsed, { ...source, rawSnapshot: reversed })).not.toThrow()
})

it('逆序比较仍保留特殊键、未知与真实零，并拒绝篡改或缺失', async () => {
  const { parsed, source, reversed } = await fixture()
  expect(Object.hasOwn(reversed, '__proto__')).toBe(true)
  expect(Object.getOwnPropertyDescriptor(reversed, '__proto__')?.value).toBe('synthetic-proto')
  expect(reversed.空值).toBeNull()
  expect(reversed.真零).toBe(0)
  expect(() => verifiedInvoiceSourceRow(parsed, { ...source, rawSnapshot: reversed })).not.toThrow()
  for (const changed of [
    { ...reversed, a: 'different' },
    { ...reversed, 真零: null },
    { ...reversed, 空值: 0 },
    Object.fromEntries(Object.entries(reversed).filter(([key]) => key !== '__proto__')),
  ])
    expect(() => verifiedInvoiceSourceRow(parsed, { ...source, rawSnapshot: changed })).toThrow('快照')
})

it('逆序等价不放宽无缓存公式整行拒绝', async () => {
  const { parsed, source, reversed } = await fixture()
  const result = verifiedInvoiceSourceRow(parsed, { ...source, rawSnapshot: reversed })
  expect(result.unsafeFormulaColumns).toContain('公式')
  const fields: CentralInvoiceFields = { invoiceNumber: 'SYN-1', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: null, taxRate: '', remark: '' }
  expect(() => assertInvoiceWorkbookImport(fields, [], { invoiceNumber: { column: '发票号码', confidence: 'confirmed' } }, result.row, result.columns, result.unsafeFormulaColumns)).toThrow('公式缓存')
})
