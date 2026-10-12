import type { Invoice } from '~/stores/invoice'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  annotateInvoiceImportRows,
  createInvoiceImportTemplateXlsx,
  createInvoiceLedgerXlsx,
  getInvoiceImportSourceMeta,
  invoiceLedgerRows,
  parseInvoiceWorkbookForMapping,
  readInvoiceWorkbookStyleReadback,
} from '~/lib/invoice/excel'
import { createSyntheticInvoiceWorkbook } from '../fixtures/invoice-workbook'

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-test',
    fileName: '',
    filePath: '',
    fileSize: '',
    pageCount: 0,
    invoiceType: '增值税普通发票',
    invoiceNumber: '12345678',
    invoiceDate: '2026-08-04',
    buyer: '',
    buyerTaxNo: '',
    seller: '广州建材有限公司',
    sellerTaxNo: '',
    amount: 10,
    taxAmount: 0,
    totalAmount: 10,
    taxRate: '',
    remark: '',
    projectId: 'project-1',
    projectName: '瑞航项目',
    supplierId: null,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    accountStatus: 'archived',
    dupStatus: 'normal',
    source: 'excel',
    printRotation: 0,
    ocrConfidence: null,
    confirmedAt: null,
    ownerKind: 'project',
    contractId: null,
    printCount: 0,
    archivedAt: null,
    items: [],
    fieldConfidence: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('发票台账 Excel 导出', () => {
  it('表头与数据的四边线型和颜色分别写入真实 XLSX，标题合计保留旧边框', async () => {
    const border = {
      top: { style: 'thin', color: 'FF102030' },
      bottom: { style: 'thin', color: 'FF203040' },
      left: { style: 'thin', color: 'FF304050' },
      right: { style: 'thin', color: 'FF405060' },
    }
    const headerBorder = {
      top: { style: 'medium', color: 'FF112233' },
      bottom: { style: 'dashed', color: 'FF223344' },
      left: { style: 'dotted', color: 'FF334455' },
      right: { style: 'thin', color: 'FF445566' },
    }
    const dataBorder = {
      top: { style: 'dotted', color: 'FF556677' },
      bottom: { style: 'thin', color: 'FF667788' },
      left: { style: 'medium', color: 'FF778899' },
      right: { style: 'none', color: 'FF8899AA' },
    }
    const style = { border, headerBorder, dataBorder, mergeRepeatedValues: false }
    const bytes = createInvoiceLedgerXlsx([invoice(), invoice({ id: 'second' })], style)
    const readback = await readInvoiceWorkbookStyleReadback(bytes)
    const cells = readback.sheets[0]!.cells
    expect(readback.issues).toEqual([])
    expect(cells.A2?.border).toEqual(headerBorder)
    expect(cells.B2?.border).toEqual(headerBorder)
    expect(cells.A3?.border).toEqual(dataBorder)
    expect(cells.B4?.border).toEqual(dataBorder)
    expect(cells.A1?.border).toEqual(border)
    expect(cells.A5?.border).toEqual(border)
  })

  it('生成可下载的发票导入模板和填写说明', () => {
    const workbook = XLSX.read(createInvoiceImportTemplateXlsx(), { type: 'array' })
    const worksheet = workbook.Sheets['发票导入']!
    const instructions = workbook.Sheets['填写说明']!

    expect(workbook.SheetNames).toEqual(['发票导入', '填写说明'])
    expect(worksheet.B2?.v).toBe('发票号码')
    expect(worksheet.E2?.v).toBe('价税合计')
    expect(worksheet.H2?.v).toBe('归属项目')
    expect(instructions.A3?.v).toBe('发票号码')
    expect(instructions.C5?.v).toContain('个人开支')
  })

  it('保留业务值并写入标题合并、重复值合并和金额格式', () => {
    const rows = [
      invoice(),
      invoice({ id: 'inv-test-2', invoiceNumber: '87654321', totalAmount: 20 }),
      invoice({ id: 'inv-test-3', invoiceNumber: '11112222', projectName: '个人开支' }),
    ]

    expect(invoiceLedgerRows(rows)[0]).toMatchObject({
      invoiceNumber: '12345678',
      totalAmount: 10,
      source: 'Excel 导入',
    })

    const workbook = XLSX.read(createInvoiceLedgerXlsx(rows), { type: 'array', cellNF: true })
    const worksheet = workbook.Sheets['发票台账']!

    expect(worksheet.A1?.v).toBe('发票台账')
    expect(worksheet.E3?.v).toBe(10)
    expect(worksheet.E3?.z).toBe('0.00_);[Red]\\(0.00\\)')
    expect(worksheet.E6?.v).toBe(40)
    expect(worksheet['!merges']).toEqual(expect.arrayContaining([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 2, c: 2 }, e: { r: 4, c: 2 } },
      { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } },
    ]))
  })

  it('把导出样式设置写入实际 XLSX，并按设置关闭合并', async () => {
    const bytes = createInvoiceLedgerXlsx([
      invoice(),
      invoice({ id: 'inv-test-2', invoiceNumber: '87654321', totalAmount: 20 }),
    ], {
      freezeRows: 1,
      titleRowHeight: 18,
      headerRowHeight: 22,
      dataRowHeight: 26,
      totalRowHeight: 20,
      columnWidths: { seller: 42, remark: 31 },
      dateFormat: 'yyyy-mm-dd',
      moneyFormat: '#,##0.00',
      textFormat: '@ "文本"',
      mergeTitle: false,
      mergeRepeatedValues: false,
      headerFont: { name: '微软雅黑', sz: 11, bold: false },
      border: {
        top: { style: 'medium', color: 'FF112233' },
        bottom: { style: 'dotted', color: 'FF112233' },
        left: { style: 'none' },
        right: { style: 'none' },
      },
    })

    const readback = await readInvoiceWorkbookStyleReadback(bytes)
    const sheet = readback.sheets[0]!
    expect(readback.issues).toEqual([])
    expect(sheet.freezeRows).toBe(1)
    expect(sheet.columns[2]).toMatchObject({ wch: 42 })
    expect(sheet.columns[7]).toMatchObject({ wch: 31 })
    expect(sheet.rows[0]).toMatchObject({ hpt: 18 })
    expect(sheet.rows[1]).toMatchObject({ hpt: 22 })
    expect(sheet.rows[2]).toMatchObject({ hpt: 26 })
    expect(sheet.cells.A2).toMatchObject({
      font: { name: '微软雅黑', sz: 11 },
      border: { top: { style: 'medium' }, bottom: { style: 'dotted' } },
    })
    expect(sheet.cells.A2?.font.bold).toBeUndefined()
    expect(sheet.cells.A3?.numberFormat).toBe('yyyy-mm-dd')
    expect(sheet.cells.B3?.numberFormat).toBe('@ "文本"')
    expect(sheet.cells.E3?.numberFormat).toBe('#,##0.00')
    expect(sheet.mergedCells).toEqual([])
  })
})

describe('发票 Excel 导入/回读来源证据', () => {
  it('保留 sheet、原始行列、显示值、合并区域，并区分业务/合计/汇总/空白行', async () => {
    const parsed = await parseInvoiceWorkbookForMapping(createSyntheticInvoiceWorkbook(), '脱敏票据.xlsx')
    const detail = parsed.sheets[0]!
    const summary = parsed.sheets[1]!
    const blank = parsed.sheets[2]!

    expect(detail.sheetKind).toBe('data')
    expect(detail.rows).toHaveLength(2)
    expect(detail.columns).toContain('发票号码')
    expect(detail.mergeRanges).toEqual(expect.arrayContaining(['A1:H1', 'C3:C4']))
    expect(detail.sourceRows.map(row => row.rowKind)).toEqual(['data', 'data', 'blank', 'total'])
    expect(detail.ignoredRows.map(row => row.sourceRow)).toEqual([5, 6])
    expect(detail.rows[0]).toMatchObject({ 发票号码: '000000000000000001', 价税合计: '100' })
    expect(detail.rows[1]).toMatchObject({ 供应商: '合成供应商' })

    const source = getInvoiceImportSourceMeta(detail.rows[0]!)!
    expect(source).toMatchObject({
      sourceFileName: '脱敏票据.xlsx',
      sourceSheet: '明细',
      sourceRow: 3,
      sourceKey: '脱敏票据.xlsx::明细::3',
      naturalKey: '000000000000000001',
    })
    expect(source.rawColumns).toContain('发票号码')
    expect(source.displayValues['发票号码']).toBe('000000000000000001')
    expect(source.mergeRanges).toEqual(expect.arrayContaining(['C3:C4']))

    const total = detail.sourceRows.find(row => row.rowKind === 'total')!
    expect(total.formulaIssues).toEqual([])
    expect(total.cells.find(cell => cell.address === 'E6')).toMatchObject({
      formula: 'SUM(E3:E4)',
      cachedValue: 300,
      formulaStatus: 'resolved',
    })
    expect(summary.sheetKind).toBe('summary')
    expect(summary.rows).toHaveLength(0)
    expect(blank.sheetKind).toBe('blank')
    expect(blank.sourceRows).toHaveLength(0)
  })

  it.each([
    { rowIndex: 0, expected: { formula: 'SUM(C2:C2)', formulaStatus: 'resolved' } },
    { rowIndex: 1, expected: { formula: 'SUM(C3:C3)', formulaStatus: 'invalid' } },
  ])('公式行 $rowIndex 保留原文和复核状态', async ({ rowIndex, expected }) => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['发票号码', '价税合计'],
      ['000000000000000099', undefined],
      ['000000000000000100', undefined],
    ])
    worksheet.B2 = { t: 'n', f: 'SUM(C2:C2)' }
    worksheet.B3 = { t: 'e', f: 'SUM(C3:C3)', v: '#VALUE!', w: '#VALUE!' }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '公式异常')

    const parsed = await parseInvoiceWorkbookForMapping(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      '公式异常.xlsx',
    )
    const rows = parsed.sheets[0]!.rows
    expect(rows).toHaveLength(2)
    expect(getInvoiceImportSourceMeta(rows[rowIndex]!)?.formulaCells[0]).toMatchObject(expected)
  })

  it('缺少发票号码的真实业务行保留来源键并进入逐行复核，明确合计行才忽略', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['发票号码', '供应商', '价税合计', '归属项目'],
      ['', '缺号供应商', 88, '瑞航项目'],
      ['总计', '', 88, ''],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '明细')

    const parsed = await parseInvoiceWorkbookForMapping(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      '缺号业务行.xlsx',
    )
    const sheet = parsed.sheets[0]!

    expect(sheet.rows).toHaveLength(1)
    expect(sheet.ignoredRows.map(row => row.sourceRow)).toEqual([3])
    expect(sheet.rows[0]).toMatchObject({ 供应商: '缺号供应商', 价税合计: '88' })
    expect(getInvoiceImportSourceMeta(sheet.rows[0]!)).toMatchObject({
      sourceKey: '缺号业务行.xlsx::明细::2',
      naturalKey: '',
      reviewReasons: ['缺少发票号码，需逐行复核'],
    })
  })

  it.each([
    { rowIndex: 0, expected: [] as string[], exact: true },
    { rowIndex: 1, expected: ['发票号码重复，需逐行复核', '来源键重复，需逐行复核'], exact: true },
    { rowIndex: 2, expected: ['来源键重复，需逐行复核', '发票号码重复，需逐行复核'], exact: false },
  ])('重导行 $rowIndex 保留自然键和来源键复核', async ({ rowIndex, expected, exact }) => {
    const workbook = await parseInvoiceWorkbookForMapping(createSyntheticInvoiceWorkbook(), '重导.xlsx')
    const detail = workbook.sheets[0]!
    const rows = detail.rows.map((row) => {
      const projected = {
        invoiceNumber: row['发票号码'],
        externalRef: row['外部旧ID / 匹配标识'],
      }
      const meta = getInvoiceImportSourceMeta(row)!
      Object.defineProperty(projected, '__importSource', { value: meta, enumerable: false })
      return projected
    })
    const sourceDuplicate = { ...rows[1]!, externalRef: rows[0]!.externalRef }
    Object.defineProperty(sourceDuplicate, '__importSource', {
      value: getInvoiceImportSourceMeta(detail.rows[1]!),
      enumerable: false,
    })
    const duplicated = annotateInvoiceImportRows([
      rows[0]!,
      rows[0]!,
      sourceDuplicate,
    ], ['000000000000000002'])

    expect(duplicated).toHaveLength(3)
    expect(getInvoiceImportSourceMeta(duplicated[rowIndex]!)?.reviewReasons).toEqual(exact ? expected : expect.arrayContaining(expected))
    expect(duplicated[1]!).toHaveProperty('invoiceNumber')
  })

  it('导出台账再次读取时只产生业务行，合计行作为来源元数据保留', async () => {
    const bytes = createInvoiceLedgerXlsx([
      invoice({ invoiceNumber: '000000000000000021', totalAmount: 10 }),
      invoice({ id: 'inv-test-2', invoiceNumber: '000000000000000022', totalAmount: 20 }),
    ])
    const parsed = await parseInvoiceWorkbookForMapping(bytes, '发票台账.xlsx')
    const sheet = parsed.sheets[0]!
    expect(sheet.sheetKind).toBe('data')
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.sourceRows.at(-1)?.rowKind).toBe('total')
    expect(sheet.rows.map(row => row['发票号码'])).toEqual([
      '000000000000000021',
      '000000000000000022',
    ])
  })

  it('导出后重新读取仍保留实际 XLSX 样式、行列尺寸、冻结和合并关系', async () => {
    const bytes = createInvoiceLedgerXlsx([
      invoice({ invoiceNumber: '000000000000000021', totalAmount: 10 }),
      invoice({ id: 'inv-test-2', invoiceNumber: '000000000000000022', totalAmount: 20 }),
    ])

    const readback = await readInvoiceWorkbookStyleReadback(bytes)
    const sheet = readback.sheets[0]!

    expect(readback.issues).toEqual([])
    expect(sheet.freezeRows).toBe(2)
    expect(sheet.columns[0]).toMatchObject({ wch: 15 })
    expect(sheet.columns[2]).toMatchObject({ wch: 30 })
    expect(sheet.rows[0]).toMatchObject({ hpt: 24 })
    expect(sheet.rows[1]).toMatchObject({ hpt: 28 })
    expect(sheet.rows[2]).toMatchObject({ hpt: 32 })
    expect(sheet.cells.A1).toMatchObject({
      font: { name: '等线', sz: 16, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    })
    expect(sheet.cells.A2).toMatchObject({
      font: { name: '等线', sz: 14, bold: true },
      border: { top: { style: 'thin' }, bottom: { style: 'thin' } },
    })
    expect(sheet.cells.A3?.numberFormat).toBe('yyyy"年"m"月"d"日";@')
    expect(sheet.cells.E3?.numberFormat).toBe('0.00_);[Red]\\(0.00\\)')
    expect(sheet.mergedCells).toEqual(expect.arrayContaining(['A1:H1', 'C3:C4', 'F3:F4']))
  })

  it('样式包读取失败时保留业务行，但把格式问题写入逐行复核', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['发票号码', '价税合计'],
      ['000000000000000099', 99],
    ]), '明细')
    const xlsBytes = XLSX.write(
      workbook,
      { type: 'array', bookType: 'xls' },
    ) as ArrayBuffer

    const parsed = await parseInvoiceWorkbookForMapping(xlsBytes, '格式异常.xls')
    const sheet = parsed.sheets[0]!

    expect(sheet.styleIssues.length).toBeGreaterThan(0)
    expect(sheet.styleIssues[0]).toMatchObject({ sheetName: sheet.name })
  })
})
