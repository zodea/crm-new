import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { useImportRunner } from '~/composables/useImportRunner'
import { getInvoiceImportSourceMeta, parseInvoiceWorkbookForMapping } from '~/lib/invoice/excel'
import { getImportEntity } from '~/lib/kit/import-entities'
import { buildImportRows } from '~/lib/kit/import-mapping'
import { useInvoiceStore } from '~/stores/invoice'
import { useProjectStore } from '~/stores/project'

const inline = (address: string, value: string) => `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`
const header = `<row r="1">${inline('A1', '发票号码')}${inline('B1', '价税合计')}${inline('C1', '税额')}${inline('D1', '归属项目')}${inline('E1', '备注')}</row>`
const row = (index: number, body: string) => `<row r="${index}">${body}</row>`
const sheetXml = (body: string, merges = '') => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E12"/><sheetData>${header}${body}</sheetData>${merges}</worksheet>`

/** 直接构造 XML 证据，避免新旧 SheetJS 写入器对无缓存公式的差异。 */
function workbookWithSheets(sheets: readonly string[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  sheets.forEach((_, index) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['合成']]), `合成${index + 1}`))
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: false })
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
  sheets.forEach((xml, index) => {
    const item = zip.FileIndex.find(entry => entry.name === `sheet${index + 1}.xml`)
    if (!item)
      throw new Error('缺少合成工作表')
    item.content = new TextEncoder().encode(xml)
    item.size = item.content.length
  })
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip', compression: false })).buffer
}

function fixture() {
  const missing = '<c r="C2"><f>1+1</f></c>'
  const body = [
    row(2, `${inline('A2', 'SYN-001')}<c r="B2"><v>100</v></c>${missing}${inline('D2', '个人开支')}`),
    row(3, `${inline('A3', 'SYN-002')}<c r="B3"><v>100</v></c>${inline('D3', '个人开支')}`),
    row(4, '<c r="B4"><f>2+2</f></c>'),
    row(5, `${inline('A5', 'SYN-005')}<c r="B5"><f>0+0</f><v>0</v></c>`),
    row(6, `${inline('A6', '合计')}<c r="B6"><v>100</v></c>`),
    row(8, `${inline('A8', 'SYN-008')}<c r="B8"><v>100</v></c><c r="C8"><v>7</v></c>`),
    row(9, `${inline('A9', 'SYN-009')}<c r="B9"><v>100</v></c><c r="C9"><f>3+3</f></c>`),
    row(10, `${inline('A10', 'SYN-010')}<c r="B10"><v>100</v></c>${inline('D10', '正常合并')}`),
    row(11, `${inline('A11', 'SYN-011')}<c r="B11"><v>100</v></c>`),
  ].join('')
  const merges = '<mergeCells count="3"><mergeCell ref="C2:C3"/><mergeCell ref="C8:C9"/><mergeCell ref="D10:D11"/></mergeCells>'
  const first = sheetXml(body, merges)
  const second = sheetXml(row(2, `${inline('A2', 'OTHER-002')}<c r="B2"><v>100</v></c><c r="C2"><f>0+0</f><v>0</v></c>`))
  return { bytes: workbookWithSheets([first, second]), missing }
}

function prepareStores() {
  setActivePinia(createPinia())
  vi.stubGlobal('useProjectStore', useProjectStore)
  vi.stubGlobal('useInvoiceStore', useInvoiceStore)
  vi.spyOn(useProjectStore(), 'load').mockResolvedValue()
  vi.spyOn(useInvoiceStore(), 'load').mockResolvedValue()
}

async function validateInvoiceRow(row: Record<string, unknown>) {
  prepareStores()
  return getImportEntity('invoice')!.validateRow!(row)
}

function mapInvoiceRow(row: Record<string, unknown>) {
  return buildImportRows({
    invoiceNumber: { column: '发票号码', confidence: 'confirmed' },
    totalAmount: { column: '价税合计', confidence: 'confirmed' },
    taxAmount: { column: '税额', confidence: 'confirmed' },
    projectName: { column: '归属项目', confidence: 'confirmed' },
    remark: { column: '备注', confidence: 'confirmed' },
  }, [row])[0]!
}

describe('公式占位不伪造缓存值', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('保留来源、空值和复核，并按表隔离真实零、普通合并与忽略行', async () => {
    const { bytes, missing } = fixture()
    const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
    const first = zip.FileIndex.find(entry => entry.name === 'sheet1.xml')
    expect(new TextDecoder().decode(first!.content)).toContain(missing)
    const parsed = await parseInvoiceWorkbookForMapping(bytes, '合成票据.xlsx')
    const sheet = parsed.sheets[0]!
    const at = (sourceRow: number) => sheet.sourceRows.find(item => item.sourceRow === sourceRow)!
    const projected = (sourceRow: number) => sheet.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === sourceRow)!

    expect(at(2).cells.find(cell => cell.address === 'C2')).toMatchObject({ formula: '1+1', rawValue: undefined, cachedValue: undefined, displayValue: '', formulaStatus: 'missing-cache' })
    expect(at(2).rawValues['税额']).toBeUndefined()
    expect(projected(2)['税额']).toBe('')
    expect(getInvoiceImportSourceMeta(projected(2))?.reviewReasons).toContain('税额（C2）：缺少缓存值')
    expect(projected(3)['税额']).toBe('')
    expect(getInvoiceImportSourceMeta(projected(3))?.reviewReasons).toContain('税额（C3）：合并来源 C2 的公式缺少缓存值')
    expect(at(4).rowKind).toBe('data')
    expect(getInvoiceImportSourceMeta(projected(4))).toMatchObject({ sourceSheet: '合成1', sourceRow: 4, reviewReasons: expect.arrayContaining(['价税合计（B4）：缺少缓存值', '缺少发票号码，需逐行复核']) })
    expect(at(5).cells.find(cell => cell.address === 'B5')).toMatchObject({ rawValue: 0, cachedValue: 0, displayValue: '0', formulaStatus: 'resolved' })
    expect(at(6).rowKind).toBe('total')
    expect(at(7).rowKind).toBe('blank')
    expect(projected(8)['税额']).toBe('7')
    expect(projected(9)['税额']).toBe('')
    expect(getInvoiceImportSourceMeta(projected(9))?.reviewReasons).toContain('税额（C9）：缺少缓存值')
    expect(projected(11)['归属项目']).toBe('正常合并')
    expect(parsed.sheets[1]!.sourceRows.find(item => item.sourceRow === 2)!.cells.find(cell => cell.address === 'C2')).toMatchObject({ formula: '0+0', rawValue: 0, cachedValue: 0, displayValue: '0', formulaStatus: 'resolved' })
  })

  it('通用发票导入对受影响的合并成员拒绝，不把未知税额转成零', async () => {
    const parsed = await parseInvoiceWorkbookForMapping(fixture().bytes, '合成票据.xlsx')
    const follower = parsed.sheets[0]!.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === 3)!
    const projected = mapInvoiceRow(follower)
    expect(projected.taxAmount).toBe('')
    expect(getInvoiceImportSourceMeta(projected)?.reviewReasons).toContain('税额（C3）：合并来源 C2 的公式缺少缓存值')
    await expect(validateInvoiceRow(projected)).resolves.toContain('来源复核')
  })

  it('原始 XML 显式数值类型但没有公式缓存时，必须保留公式并拒绝导入', async () => {
    const original = '<c r="C2" t="n"><f>1+1</f></c>'
    const xml = sheetXml(row(2, `${inline('A2', 'SYN-NO-CACHE')}<c r="B2"><v>100</v></c>${original}${inline('D2', '个人开支')}`))
    const bytes = workbookWithSheets([xml])
    const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
    expect(new TextDecoder().decode(zip.FileIndex.find(entry => entry.name === 'sheet1.xml')!.content)).toContain(original)
    const sheet = (await parseInvoiceWorkbookForMapping(bytes, '无缓存.xlsx')).sheets[0]!
    const sourceCell = sheet.sourceRows.find(item => item.sourceRow === 2)!.cells.find(cell => cell.address === 'C2')
    const projected = mapInvoiceRow(sheet.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === 2)!)

    expect.soft(sourceCell).toMatchObject({ formula: '1+1', rawValue: undefined, cachedValue: undefined, displayValue: '', formulaStatus: 'missing-cache' })
    expect.soft(getInvoiceImportSourceMeta(projected)?.reviewReasons.join(' ')).toMatch(/C2.*缺少缓存值/)
    await expect.soft(validateInvoiceRow(projected)).resolves.toContain('来源复核')
  })

  it('原始 XML 公式错误缓存的合并锚点及成员都必须复核并拒绝导入', async () => {
    const original = '<c r="C2" t="e"><f>1/0</f><v>#DIV/0!</v></c>'
    const xml = sheetXml([
      row(2, `${inline('A2', 'SYN-ERROR-ANCHOR')}<c r="B2"><v>100</v></c>${original}${inline('D2', '个人开支')}`),
      row(3, `${inline('A3', 'SYN-ERROR-FOLLOWER')}<c r="B3"><v>100</v></c>${inline('D3', '个人开支')}`),
    ].join(''), '<mergeCells count="1"><mergeCell ref="C2:C3"/></mergeCells>')
    const bytes = workbookWithSheets([xml])
    const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
    expect(new TextDecoder().decode(zip.FileIndex.find(entry => entry.name === 'sheet1.xml')!.content)).toContain(original)
    const sheet = (await parseInvoiceWorkbookForMapping(bytes, '错误缓存.xlsx')).sheets[0]!
    const anchor = sheet.sourceRows.find(item => item.sourceRow === 2)!.cells.find(cell => cell.address === 'C2')
    const projected = mapInvoiceRow(sheet.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === 3)!)
    const reason = getInvoiceImportSourceMeta(projected)?.reviewReasons.join(' ') ?? ''

    expect.soft(anchor).toMatchObject({ formula: '1/0', formulaStatus: 'invalid' })
    expect.soft(reason).toMatch(/C3/)
    expect.soft(reason).toMatch(/C2/)
    expect.soft(reason).toMatch(/缓存/)
    await expect.soft(validateInvoiceRow(projected)).resolves.toContain('来源复核')
  })

  it('错误公式合并到文本备注时，通用发票导入也必须拒绝', async () => {
    const original = '<c r="E2" t="e"><f>1/0</f><v>#DIV/0!</v></c>'
    const xml = sheetXml([
      row(2, `${inline('A2', 'SYN-TEXT-ANCHOR')}<c r="B2"><v>100</v></c><c r="C2"><v>10</v></c>${inline('D2', '个人开支')}${original}`),
      row(3, `${inline('A3', 'SYN-TEXT-FOLLOWER')}<c r="B3"><v>100</v></c><c r="C3"><v>10</v></c>${inline('D3', '个人开支')}`),
    ].join(''), '<mergeCells count="1"><mergeCell ref="E2:E3"/></mergeCells>')
    const bytes = workbookWithSheets([xml])
    const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
    expect(new TextDecoder().decode(zip.FileIndex.find(entry => entry.name === 'sheet1.xml')!.content)).toContain(original)
    const sheet = (await parseInvoiceWorkbookForMapping(bytes, '文本错误缓存.xlsx')).sheets[0]!
    const projected = mapInvoiceRow(sheet.rows.find(item => getInvoiceImportSourceMeta(item)?.sourceRow === 3)!)

    expect(projected.remark).toBe('#DIV/0!')
    expect(getInvoiceImportSourceMeta(projected)?.reviewReasons).toContain('备注（E3）：合并来源 E2 的公式缓存值异常')
    await expect(validateInvoiceRow(projected)).resolves.toContain('来源复核')
  })

  it('执行器逐行拒绝异常公式来源，仍将前后有效票交给合成接收器', async () => {
    const missing = '<c r="C3"><f>1+1</f></c>'
    const invalid = '<c r="E5" t="e"><f>1/0</f><v>#DIV/0!</v></c>'
    const xml = sheetXml([
      row(2, `${inline('A2', 'SYN-GOOD-BEFORE')}<c r="B2"><v>100</v></c><c r="C2"><v>10</v></c>${inline('D2', '个人开支')}`),
      row(3, `${inline('A3', 'SYN-MISSING-ANCHOR')}<c r="B3"><v>100</v></c>${missing}${inline('D3', '个人开支')}`),
      row(4, `${inline('A4', 'SYN-MISSING-FOLLOWER')}<c r="B4"><v>100</v></c>${inline('D4', '个人开支')}`),
      row(5, `${inline('A5', 'SYN-ERROR-ANCHOR')}<c r="B5"><v>100</v></c><c r="C5"><v>10</v></c>${inline('D5', '个人开支')}${invalid}`),
      row(6, `${inline('A6', 'SYN-ERROR-FOLLOWER')}<c r="B6"><v>100</v></c><c r="C6"><v>10</v></c>${inline('D6', '个人开支')}`),
      row(7, '<c r="B7"><f>2+2</f></c>'),
      row(8, `${inline('A8', 'SYN-GOOD-AFTER')}<c r="B8"><v>200</v></c><c r="C8"><v>20</v></c>${inline('D8', '个人开支')}`),
    ].join(''), '<mergeCells count="2"><mergeCell ref="C3:C4"/><mergeCell ref="E5:E6"/></mergeCells>')
    const bytes = workbookWithSheets([xml])
    const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' })
    const rawSheet = new TextDecoder().decode(zip.FileIndex.find(entry => entry.name === 'sheet1.xml')!.content)
    expect(rawSheet).toContain(missing)
    expect(rawSheet).toContain(invalid)
    const sheet = (await parseInvoiceWorkbookForMapping(bytes, '逐行验证.xlsx')).sheets[0]!
    const rows = sheet.rows.map(mapInvoiceRow)
    expect(rows.map(item => getInvoiceImportSourceMeta(item)?.sourceRow)).toEqual([2, 3, 4, 5, 6, 7, 8])

    prepareStores()
    const accepted: Record<string, unknown>[] = []
    const sink = vi.fn(async (item: Record<string, unknown>) => {
      accepted.push(item)
    })
    const runner = useImportRunner({ yieldToView: vi.fn().mockResolvedValue(undefined) })
    const result = await runner.start(rows, sink, getImportEntity('invoice')!.validateRow)

    expect(result.status).toBe('completed')
    if (result.status !== 'completed')
      throw new Error('执行器未完成逐行处理')
    expect(runner.phase.value).toBe('completed')
    expect(runner.done.value).toBe(7)
    expect(runner.total.value).toBe(7)
    expect(accepted.map(item => [getInvoiceImportSourceMeta(item)?.sourceRow, item.invoiceNumber])).toEqual([
      [2, 'SYN-GOOD-BEFORE'],
      [8, 'SYN-GOOD-AFTER'],
    ])
    expect(sink).toHaveBeenCalledTimes(2)
    expect(result.rejected).toHaveLength(5)
    expect(runner.rejected.value).toEqual(result.rejected)
    const rejected = result.rejected!
    expect(rejected.map(item => [item.index, getInvoiceImportSourceMeta(item.row)?.sourceRow])).toEqual([[1, 3], [2, 4], [3, 5], [4, 6], [5, 7]])
    expect(rejected[0]!.reason).toContain('税额（C3）：缺少缓存值')
    expect(rejected[1]!.reason).toContain('税额（C4）：合并来源 C3 的公式缺少缓存值')
    expect(rejected[2]!.reason).toContain('备注（E5）：缓存值异常')
    expect(rejected[3]!.reason).toContain('备注（E6）：合并来源 E5 的公式缓存值异常')
    expect(rejected[4]!.reason).toContain('价税合计（B7）：缺少缓存值')
    for (const item of rejected)
      expect(item.reason).toContain('来源复核')
  })
})
