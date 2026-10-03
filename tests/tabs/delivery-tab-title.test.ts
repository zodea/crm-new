import { describe, expect, it } from 'vitest'
import { routeTitle } from '~/lib/tabs/tab-title'

describe('送货单归档库页签文案', () => {
  it.each([
    { case: '\'/material/delivery/archive\'', input: '/material/delivery/archive', expected: '送货单归档库' },
    { case: '\'/material/delivery/archive/del_1\'', input: '/material/delivery/archive/del_1', expected: '送货单详情' },
    { case: '\'/material/delivery/archive/form\'', input: '/material/delivery/archive/form', expected: '送货单归档表单' },
    { case: '\'/material/delivery/archive/form/del_1\'', input: '/material/delivery/archive/form/del_1', expected: '送货单归档表单' },
    { case: '\'/material/delivery\'', input: '/material/delivery', expected: '送货单识别' },
  ])('列表、详情、整页表单与 OCR 处理区使用不同标题 / routeTitle：$case', ({ input, expected }) => {
    expect(routeTitle(input)).toBe(expected)
  })
})
