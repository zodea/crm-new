import type { OcrRecognitionPage } from '~/lib/recognize/engine'
import { describe, expect, it } from 'vitest'
import { invoiceRegionFocus, invoiceRegionHighlights, locateInvoiceFieldRegions, rotatedFrame, rotateNormalizedBox } from '~/lib/invoice/recognition-regions'

const fields = [
  { key: 'invoiceNumber', label: '单据编号' },
  { key: 'invoiceDate', label: '开票日期' },
  { key: 'buyer', label: '购买方' },
  { key: 'seller', label: '供应商' },
  { key: 'sellerTaxNo', label: '供应商税号' },
  { key: 'totalAmount', label: '价税合计' },
  { key: 'taxAmount', label: '税额' },
  { key: 'taxRate', label: '税率' },
]

function page(layoutRegions: unknown[], prunedResult: Record<string, unknown> = { width: 1000, height: 500 }, pageIndex = 0): OcrRecognitionPage {
  return { pageIndex, markdown: '', prunedResult, layoutRegions }
}

const HEADER = { block_label: 'text', block_bbox: [600, 20, 980, 80], block_content: '发票号码：26442000000000000399\n开票日期：2026年09月05日' }
const PARTIES = { block_label: 'table', block_bbox: [20, 100, 980, 200], block_content: '<table><tr><td>购买方名称：瑞航建设有限公司</td><td>销售方名称：审计回归供应商有限公司</td></tr><tr><td>统一社会信用代码：91440101MA9RH00001</td><td>统一社会信用代码：91440111MAE9TL102Q</td></tr></table>' }
const MONEY = { block_label: 'text', block_bbox: [20, 400, 980, 460], block_content: '合计 ¥200.00 ¥26.00 税率 13%\n价税合计（小写）¥226.00' }

describe('字段值 → OCR 版面块区域', () => {
  it('按识别值在块文本中的匹配定位到块，坐标按页面宽高归一化', () => {
    const regions = locateInvoiceFieldRegions([page([HEADER, PARTIES, MONEY])], {
      invoiceNumber: '26442000000000000399',
      invoiceDate: '2026-09-05',
      buyer: '瑞航建设有限公司',
      seller: '审计回归供应商有限公司',
      sellerTaxNo: '91440111MAE9TL102Q',
      totalAmount: 226,
      taxAmount: 26,
      taxRate: '13%',
    }, fields)
    expect(regions.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: 0.6, y: 0.04, width: 0.38, height: 0.12 } })
    expect(regions.invoiceDate?.box).toEqual(regions.invoiceNumber?.box)
    expect(regions.buyer?.box).toEqual({ x: 0.02, y: 0.2, width: 0.96, height: 0.2 })
    expect(regions.seller?.blockLabel).toBe('table')
    expect(regions.sellerTaxNo?.box).toEqual(regions.seller?.box)
    expect(regions.totalAmount?.box).toEqual({ x: 0.02, y: 0.8, width: 0.96, height: 0.12 })
    expect(regions.taxAmount?.box).toEqual(regions.totalAmount?.box)
    expect(regions.taxRate?.box).toEqual(regions.totalAmount?.box)
  })

  it('金额按数字边界匹配：13.00 不会命中 113.00，千分位与全角符号可识别', () => {
    const blocks = [
      { block_label: 'text', block_bbox: [0, 0, 100, 100], block_content: '价税合计 ￥1,113.00' },
      { block_label: 'text', block_bbox: [0, 200, 100, 300], block_content: '税额 ¥ 13.00' },
    ]
    const regions = locateInvoiceFieldRegions([page(blocks, { width: 100, height: 300 })], { totalAmount: 1113, taxAmount: 13 }, fields)
    expect(regions.totalAmount?.box.y).toBe(0)
    expect(regions.taxAmount?.box.y).toBeCloseTo(2 / 3)
  })

  it('同值出现在多个块时用字段标签消歧，仍不唯一则不定位', () => {
    const twoTotals = [
      { block_label: 'table', block_bbox: [0, 0, 100, 50], block_content: '金额 226.00' },
      { block_label: 'text', block_bbox: [0, 50, 100, 100], block_content: '价税合计（小写）¥226.00' },
    ]
    expect(locateInvoiceFieldRegions([page(twoTotals, { width: 100, height: 100 })], { totalAmount: 226 }, fields).totalAmount?.box.y).toBe(0.5)

    const ambiguous = [
      { block_label: 'text', block_bbox: [0, 0, 100, 50], block_content: '税额 26.00' },
      { block_label: 'text', block_bbox: [0, 50, 100, 100], block_content: '税额合计 26.00' },
    ]
    expect(locateInvoiceFieldRegions([page(ambiguous, { width: 100, height: 100 })], { taxAmount: 26 }, fields).taxAmount).toBeUndefined()
  })

  it('空值、零金额、找不到的值不造框', () => {
    const regions = locateInvoiceFieldRegions([page([HEADER, MONEY])], { seller: '', totalAmount: 0, invoiceNumber: '99999999' }, fields)
    expect(regions).toEqual({})
  })

  it('缺页面宽高、坐标非法或方向分类为 90°/270° 时整页不定位；180° 按原图翻转', () => {
    const values = { invoiceNumber: '26442000000000000399' }
    expect(locateInvoiceFieldRegions([page([HEADER], {})], values, fields)).toEqual({})
    expect(locateInvoiceFieldRegions([page([{ ...HEADER, block_bbox: ['a'] }])], values, fields)).toEqual({})
    expect(locateInvoiceFieldRegions([page([HEADER], { width: 1000, height: 500, doc_preprocessor_res: { angle: 90 } })], values, fields)).toEqual({})
    expect(locateInvoiceFieldRegions([page([HEADER], { width: 1000, height: 500, doc_preprocessor_res: { angle: 180 } })], values, fields).invoiceNumber?.box)
      .toEqual({ x: expect.closeTo(0.02), y: expect.closeTo(0.84), width: expect.closeTo(0.38), height: expect.closeTo(0.12) })
  })

  it('四点坐标取外接矩形，多页保留页码', () => {
    const quad = { block_label: 'text', block_bbox: [[10, 10], [90, 12], [92, 40], [8, 38]], block_content: '发票号码：12345678' }
    const regions = locateInvoiceFieldRegions([page([], { width: 100, height: 100 }), page([quad], { width: 100, height: 100 }, 1)], { invoiceNumber: '12345678' }, fields)
    expect(regions.invoiceNumber).toEqual({ pageIndex: 1, blockLabel: 'text', box: { x: 0.08, y: 0.1, width: expect.closeTo(0.84), height: expect.closeTo(0.3) } })
  })
})

describe('预览旋转/缩放下的叠加坐标', () => {
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }

  it('框随顺时针旋转换算到旋转后画框，0° 不变', () => {
    expect(rotateNormalizedBox(box, 0)).toEqual(box)
    expect(rotateNormalizedBox(box, 90)).toEqual({ x: expect.closeTo(0.4), y: 0.1, width: 0.4, height: 0.3 })
    expect(rotateNormalizedBox(box, 180)).toEqual({ x: expect.closeTo(0.6), y: expect.closeTo(0.4), width: 0.3, height: 0.4 })
    expect(rotateNormalizedBox(box, 270)).toEqual({ x: 0.2, y: expect.closeTo(0.6), width: 0.4, height: 0.3 })
  })

  it('旋转 90° 后画框宽高互换，图片按画框百分比铺满；缩放只改画框宽度，百分比框不变', () => {
    expect(rotatedFrame({ width: 1000, height: 500 }, 0)).toEqual({ aspectRatio: 2, imageWidth: 100, imageHeight: 100 })
    expect(rotatedFrame({ width: 1000, height: 500 }, 90)).toEqual({ aspectRatio: 0.5, imageWidth: 200, imageHeight: 50 })
    expect(rotatedFrame({ width: 1000, height: 500 }, 270)).toEqual(rotatedFrame({ width: 1000, height: 500 }, 90))
  })
})

describe('识别变动的原图高亮清单', () => {
  it('只列出有标记的字段；同一块的多个字段合并成一个框，定位不到的单列', () => {
    const regions = {
      invoiceNumber: { pageIndex: 0, blockLabel: 'text', box: { x: 0.6, y: 0.04, width: 0.38, height: 0.12 } },
      invoiceDate: { pageIndex: 0, blockLabel: 'text', box: { x: 0.6, y: 0.04, width: 0.38, height: 0.12 } },
      totalAmount: { pageIndex: 0, blockLabel: 'text', box: { x: 0.02, y: 0.8, width: 0.96, height: 0.12 } },
    }
    const marks = {
      invoiceNumber: { mark: 'recognized' as const, before: '1' },
      invoiceDate: { mark: 'recognized' as const, before: '' },
      totalAmount: { mark: 'edited' as const, before: '113' },
      seller: { mark: 'recognized' as const, before: '原供应商' },
    }
    const result = invoiceRegionHighlights(fields, marks, regions)
    expect(result.groups).toEqual([
      { id: '0:0.6000:0.0400:0.3800:0.1200', pageIndex: 0, box: regions.invoiceNumber.box, keys: ['invoiceNumber', 'invoiceDate'], labels: ['单据编号', '开票日期'] },
      { id: '0:0.0200:0.8000:0.9600:0.1200', pageIndex: 0, box: regions.totalAmount.box, keys: ['totalAmount'], labels: ['价税合计'] },
    ])
    expect(result.unlocated).toEqual([{ key: 'seller', label: '供应商' }])
  })

  it('没有标记（首次识别 / 无变动）时没有任何框', () => {
    expect(invoiceRegionHighlights(fields, {}, { invoiceNumber: { pageIndex: 0, blockLabel: 'text', box: { x: 0, y: 0, width: 1, height: 1 } } }))
      .toEqual({ groups: [], unlocated: [] })
  })
})

describe('首次识别的点字段定位', () => {
  const regions = {
    invoiceNumber: { pageIndex: 0, blockLabel: 'text', box: { x: 0.6, y: 0.04, width: 0.38, height: 0.12 } },
    invoiceDate: { pageIndex: 0, blockLabel: 'text', box: { x: 0.6, y: 0.04, width: 0.38, height: 0.12 } },
    totalAmount: { pageIndex: 1, blockLabel: 'table', box: { x: 0.02, y: 0.8, width: 0.96, height: 0.12 } },
  }

  it('没有聚焦字段时不常驻任何框；定位不到的字段全部单列', () => {
    const result = invoiceRegionFocus(fields, regions, null)
    expect(result.groups).toEqual([])
    expect(result.unlocated.map(field => field.key)).toEqual(['buyer', 'seller', 'sellerTaxNo', 'taxAmount', 'taxRate'])
  })

  it('只框出聚焦字段所在块，标签只写该字段（同块其他字段不连带）', () => {
    expect(invoiceRegionFocus(fields, regions, 'invoiceDate').groups).toEqual([
      { id: 'focus:invoiceDate', pageIndex: 0, box: regions.invoiceDate.box, keys: ['invoiceDate'], labels: ['开票日期'] },
    ])
    expect(invoiceRegionFocus(fields, regions, 'totalAmount').groups[0]).toMatchObject({ pageIndex: 1, keys: ['totalAmount'] })
  })

  it('聚焦定位不到或不属于识别字段的输入框时不造框', () => {
    expect(invoiceRegionFocus(fields, regions, 'seller').groups).toEqual([])
    expect(invoiceRegionFocus(fields, regions, 'projectName').groups).toEqual([])
    expect(invoiceRegionFocus(fields, undefined, 'invoiceNumber')).toEqual({ groups: [], unlocated: fields })
  })
})
