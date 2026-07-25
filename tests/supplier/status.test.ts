import { describe, expect, it } from 'vitest'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

describe('分供方类别', () => {
  it('与权威七类保持一致并包含检测供应商', () => {
    expect(SUPPLIER_CATEGORIES).toEqual([
      '材料供应商',
      '劳务分包商',
      '专业分包商',
      '设备供应商',
      '检测供应商',
      '个人',
      '其他',
    ])
  })
})
