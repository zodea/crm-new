import { describe, expect, it } from 'vitest'
import { buildPrintLayout, normalizePrintRotation, rotatePrintItems } from '~/lib/invoice/print-layout'

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
    expect(normalizePrintRotation(-90)).toBe(270)
    expect(normalizePrintRotation(450)).toBe(90)
  })
})
