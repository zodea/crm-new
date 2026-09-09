import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseSheetForMapping, parseWorkbookForMapping } from '~/lib/util/excel'

function workbookBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('导入源解析：原始表头 + 行', () => {
  it('多 sheet 工作簿识别标题下表头，并展开数据区合并值', async () => {
    const first = XLSX.utils.aoa_to_sheet([
      ['费用报销发票'],
      ['发票日期', '发票号码', '公司名称', '金额'],
      ['2026/08/04', '001', '广州建材', 10],
      ['2026/08/05', '002', undefined, 20],
    ])
    first['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } }]
    const summary = XLSX.utils.aoa_to_sheet([['来源 sheet', '总数'], ['Sheet1', 30]])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, first, '百信')
    XLSX.utils.book_append_sheet(workbook, summary, '汇总')

    const parsed = await parseWorkbookForMapping(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const sheet = parsed.sheets[0]!

    expect(parsed.sheets.map(item => item.name)).toEqual(['百信', '汇总'])
    expect(sheet.headerRow).toBe(1)
    expect(sheet.mergeRanges).toEqual(expect.arrayContaining(['A1:D1', 'C3:C4']))
    expect(sheet.columns).toEqual(['发票日期', '发票号码', '公司名称', '金额'])
    expect(sheet.rows[1]).toMatchObject({ 公司名称: '广州建材', 金额: '20' })
  })

  it('第一行作表头，数据行按单元格显示格式转文本（所见即所得）', async () => {
    const sheet = await parseSheetForMapping(workbookBuffer([
      ['分供方名称', '类别', '匹配标识'],
      ['华东建材', '材料', 'HQ-001'],
      ['南方设备', '设备', 2077],
    ]))

    expect(sheet.columns).toEqual(['分供方名称', '类别', '匹配标识'])
    expect(sheet.rows).toEqual([
      { 分供方名称: '华东建材', 类别: '材料', 匹配标识: 'HQ-001' },
      { 分供方名称: '南方设备', 类别: '设备', 匹配标识: '2077' },
    ])
  })

  it('表头带首尾空格时列名与数据行键逐字一致，取值不落空', async () => {
    const sheet = await parseSheetForMapping(workbookBuffer([
      [' 分供方名称 ', '类别'],
      ['华东建材', '材料'],
    ]))

    expect(sheet.columns).toEqual([' 分供方名称 ', '类别'])
    expect(Object.hasOwn(sheet.rows[0]!, ' 分供方名称 ')).toBe(true)
    expect(sheet.rows[0]![' 分供方名称 ']).toBe('华东建材')
  })

  it('重复表头按 SheetJS 规则加 _1 后缀，两列数据都可映射', async () => {
    const sheet = await parseSheetForMapping(workbookBuffer([
      ['金额', '金额', '名称'],
      [100, 200, '华东建材'],
    ]))

    expect(sheet.columns).toEqual(['金额', '金额_1', '名称'])
    expect(sheet.rows).toEqual([
      { 金额: '100', 金额_1: '200', 名称: '华东建材' },
    ])
  })

  it('日期格以显示文本而非 Excel 序列号进入行数据', async () => {
    const sheet = await parseSheetForMapping(workbookBuffer([
      ['名称', '日期'],
      ['华东建材', new Date(Date.UTC(2024, 0, 15))],
    ]))

    const value = sheet.rows[0]!.日期
    expect(typeof value).toBe('string')
    expect(value).not.toMatch(/^45\d{3}/)
  })

  it('gbk 编码的无 BOM csv 自动回退 GB18030 解码', async () => {
    // 「名称,类别\n华东建材,材料\n」的 GBK 字节。
    const gbk = new Uint8Array([
      0xC3,
      0xFB,
      0xB3,
      0xC6,
      0x2C,
      0xC0,
      0xE0,
      0xB1,
      0xF0,
      0x0A,
      0xBB,
      0xAA,
      0xB6,
      0xAB,
      0xBD,
      0xA8,
      0xB2,
      0xC4,
      0x2C,
      0xB2,
      0xC4,
      0xC1,
      0xCF,
      0x0A,
    ])

    const sheet = await parseSheetForMapping(gbk.buffer as ArrayBuffer)

    expect(sheet.columns).toEqual(['名称', '类别'])
    expect(sheet.rows).toEqual([{ 名称: '华东建材', 类别: '材料' }])
  })

  it('数据行缺格时对应键不出现', async () => {
    const sheet = await parseSheetForMapping(workbookBuffer([
      ['名称', '联系人'],
      ['华东建材'],
    ]))

    expect(sheet.rows).toEqual([{ 名称: '华东建材' }])
  })

  it('csv 字节流同样可解析', async () => {
    const csv = new TextEncoder().encode('名称,类别\n华东建材,材料\n')

    const sheet = await parseSheetForMapping(csv.buffer as ArrayBuffer)

    expect(sheet.columns).toEqual(['名称', '类别'])
    expect(sheet.rows).toEqual([{ 名称: '华东建材', 类别: '材料' }])
  })

  it('没有表头的空表报可读错误', async () => {
    await expect(parseSheetForMapping(workbookBuffer([]))).rejects.toThrow('表头')
  })

  it('工作簿允许空白辅助 Sheet，所选数据表保留文件摘要与原始空行后的行号', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), '空白预留')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[], ['项目名称', '客户', '项目经理'], [], ['项目423', '客户423', '经理423']]), '项目')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const parsed = await parseWorkbookForMapping(buffer)
    expect(parsed.sheets[0]?.columns).toEqual([])
    expect(parsed.sheets[1]).toMatchObject({ headerRow: 1, rowNumbers: [4], rows: [{ 项目名称: '项目423', 客户: '客户423', 项目经理: '经理423' }] })
    expect(parsed.sheets[1]?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await parseWorkbookForMapping(buffer)).sheets[1]?.sourceHash).toBe(parsed.sheets[1]?.sourceHash)
  })
})
