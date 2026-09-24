import * as XLSX from 'xlsx'

/** 仅用于 Excel 读回测试的合成票据工作簿，不包含本机真实票据。 */
export function createSyntheticInvoiceWorkbook(): ArrayBuffer {
  const detail = XLSX.utils.aoa_to_sheet([
    ['脱敏发票明细'],
    ['发票日期', '发票号码', '供应商', '购买方', '价税合计', '税额', '归属项目', '外部旧ID / 匹配标识'],
    ['2026/08/01', '000000000000000001', '合成供应商', '合成购买方', 100, 13, '合成项目', 'SRC-001'],
    ['2026/08/02', '000000000000000002', undefined, '合成购买方', 200, 26, '合成项目', 'SRC-002'],
    [],
    ['合计', undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  ])
  detail.E6 = { t: 'n', f: 'SUM(E3:E4)', v: 300, w: '300.00' }
  detail['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } },
  ]

  const summary = XLSX.utils.aoa_to_sheet([
    ['来源 Sheet', '票据数量', '价税合计'],
    ['明细', 2, 300],
  ])
  const blank = XLSX.utils.aoa_to_sheet([[]])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, detail, '明细')
  XLSX.utils.book_append_sheet(workbook, summary, '汇总')
  XLSX.utils.book_append_sheet(workbook, blank, '空白预留')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
