import { describe, expect, it } from 'vitest'
import { invoiceRecognitionChanges } from '~/lib/invoice/recognition-changes'

const fields = [
  { key: 'invoiceNumber', label: '单据编号' },
  { key: 'seller', label: '供应商' },
  { key: 'totalAmount', label: '价税合计' },
  { key: 'remark', label: '票面备注' },
]

describe('重新识别覆盖前后的字段差异', () => {
  it('人工改过的值被识别结果覆盖时逐项列出原值与新值', () => {
    expect(invoiceRecognitionChanges(
      fields,
      { invoiceNumber: '26440001', seller: '人工更正供应商', totalAmount: 700, remark: '' },
      { invoiceNumber: '26440001', seller: '识别供应商', totalAmount: 800, remark: '' },
    )).toEqual([
      { key: 'seller', label: '供应商', before: '人工更正供应商', after: '识别供应商' },
      { key: 'totalAmount', label: '价税合计', before: '700', after: '800' },
    ])
  })

  it('识别结果与当前值一致时没有差异；数值写法不同但值相等不算变化', () => {
    expect(invoiceRecognitionChanges(fields, { invoiceNumber: ' 26440001 ', totalAmount: '800.00' }, { invoiceNumber: '26440001', totalAmount: 800 })).toEqual([])
  })

  it('20 位票号只差末位时按文本比较，不因超出数值精度被判为相同', () => {
    expect(invoiceRecognitionChanges(fields, { invoiceNumber: '26442000000000000398' }, { invoiceNumber: '26442000000000000399' })).toEqual([
      { key: 'invoiceNumber', label: '单据编号', before: '26442000000000000398', after: '26442000000000000399' },
    ])
  })

  it('识别把已有值清空或从空补出值时都列为变化', () => {
    expect(invoiceRecognitionChanges(fields, { remark: '人工备注', seller: '' }, { remark: '', seller: '识别供应商' })).toEqual([
      { key: 'seller', label: '供应商', before: '', after: '识别供应商' },
      { key: 'remark', label: '票面备注', before: '人工备注', after: '' },
    ])
  })
})
