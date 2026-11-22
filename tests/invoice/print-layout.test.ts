import { describe, expect, it } from 'vitest'
import { buildPrintLayout, checkPrintableInvoice, normalizePrintRotation, rotatePrintItems } from '~/lib/invoice/print-layout'

const invoices = [
  { id: 'inv-1', totalAmount: 100, printRotation: 0 },
  { id: 'inv-2', totalAmount: 200.25, printRotation: 90 },
  { id: 'inv-3', totalAmount: 300.75, printRotation: 0 },
  { id: 'inv-4', totalAmount: 400, printRotation: 0 },
  { id: 'inv-5', totalAmount: 500, printRotation: 0 },
]

describe('发票打印排版', () => {
  it.each([
    [1, 4],
    [2, 2],
    [4, 1],
  ] as const)('按每页 %i 张分页选中票', (perPage, pageCount) => {
    const layout = buildPrintLayout(
      invoices,
      new Set(['inv-1', 'inv-2', 'inv-3', 'inv-5']),
      perPage,
      { 'inv-3': 270 },
    )

    expect(layout.selectedCount).toBe(4)
    expect(layout.pageCount).toBe(pageCount)
    expect(layout.pages.flat().map(slot => slot.invoice.id)).toEqual(['inv-1', 'inv-2', 'inv-3', 'inv-5'])
    expect(layout.pages.flat().map(slot => slot.rotation)).toEqual([0, 90, 270, 0])
    expect(layout.totalAmount).toBe(1101)
  })

  it('没有勾选时仍返回稳定的空排版摘要', () => {
    expect(buildPrintLayout(invoices, new Set(), 2, {})).toEqual({
      pages: [],
      skipped: [],
      selectedCount: 0,
      pageCount: 0,
      totalAmount: 0,
    })
  })

  it('单张与整页旋转都按 90° 归一且不修改旧状态', () => {
    const initial = { 'inv-1': 270, 'inv-2': 90, 'inv-3': 0 }
    const single = rotatePrintItems(initial, ['inv-1'])
    const page = rotatePrintItems(single, ['inv-1', 'inv-2'], 90)

    expect(initial).toEqual({ 'inv-1': 270, 'inv-2': 90, 'inv-3': 0 })
    expect(single).toEqual({ 'inv-1': 0, 'inv-2': 90, 'inv-3': 0 })
    expect(page).toEqual({ 'inv-1': 90, 'inv-2': 180, 'inv-3': 0 })
  })

  it.each([
    { case: '-90', input: -90, expected: 270 },
    { case: '450', input: 450, expected: 90 },
  ])('单张与整页旋转都按 90° 归一且不修改旧状态 / normalizePrintRotation：$case', ({ input, expected }) => {
    expect(normalizePrintRotation(input)).toBe(expected)
  })

  const ready = { totalAmount: 100, printRotation: 0, ocrStatus: 'done', reviewStatus: 'reviewed', dupStatus: 'normal', source: 'scan' }

  it('#257 识别完成、人工确认、未重复且有原件的票可以打印', () => {
    expect(checkPrintableInvoice({ id: 'confirmed', ...ready })).toEqual({ ok: true })
  })

  it('已补原件的 Excel 票还需要明确的识别、核对和去重状态', () => {
    const linked = { ...ready, id: 'linked', source: 'excel', original: { id: 'original-1' } }
    expect(checkPrintableInvoice(linked)).toEqual({ ok: true })
    expect(checkPrintableInvoice({ ...linked, original: { id: ' ' } }).ok).toBe(false)
    expect(checkPrintableInvoice({ ...linked, ocrStatus: undefined }).ok).toBe(false)
    expect(checkPrintableInvoice({ ...linked, reviewStatus: undefined }).ok).toBe(false)
    expect(checkPrintableInvoice({ ...linked, dupStatus: undefined }).ok).toBe(false)
  })

  it.each([
    { label: 'Excel 导入且没有原件', patch: { source: 'excel' }, reason: 'Excel 导入的发票没有原件，不能打印' },
    { label: '识别失败', patch: { ocrStatus: 'failed' }, reason: '识别尚未完成，不能进入打印队列' },
    { label: '尚未人工确认', patch: { reviewStatus: 'unreviewed' }, reason: '当前字段尚未完成人工确认，不能进入打印队列' },
    { label: '重复票已排除', patch: { dupStatus: 'duplicate' }, reason: '重复票据已排除，不能进入打印队列' },
    { label: '价税合计为 0', patch: { totalAmount: 0 }, reason: '价税合计缺失或金额异常，不能进入打印队列' },
    { label: '价税合计为负', patch: { totalAmount: -0.01 }, reason: '价税合计缺失或金额异常，不能进入打印队列' },
  ])('#257 $label 时不进入打印队列', ({ patch, reason }) => {
    expect(checkPrintableInvoice({ id: 'blocked', ...ready, ...patch })).toEqual({ ok: false, reason })
  })

  it('已勾选但不能打印的票不进入排版，并逐张列出原因供提醒', () => {
    const excel = { id: 'excel-row', ...ready, source: 'excel' }
    const layout = buildPrintLayout([
      { id: 'inv-1', ...ready },
      excel,
      { id: 'not-selected', ...ready, source: 'excel' },
    ], new Set(['inv-1', 'excel-row']), 2, {})
    expect(layout.pages.flat().map(slot => slot.invoice.id)).toEqual(['inv-1'])
    expect(layout.skipped).toEqual([{ invoice: excel, reason: 'Excel 导入的发票没有原件，不能打印' }])
    expect(layout.selectedCount).toBe(1)
  })
})
