import { describe, expect, it } from 'vitest'
import { routeTitle } from '~/lib/tabs/tab-title'

describe('送货单归档库页签文案', () => {
  it('列表、详情与 OCR 处理区使用不同标题', () => {
    expect(routeTitle('/material/delivery/archive')).toBe('送货单归档库')
    expect(routeTitle('/material/delivery/archive/del_1')).toBe('送货单详情')
    expect(routeTitle('/material/delivery')).toBe('送货单识别')
  })
})
