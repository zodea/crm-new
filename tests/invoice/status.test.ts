// 发票文档工作流状态派生(#60 review 修复):文档表与工作台左栏此前各写一套映射且优先级互相矛盾
// (文档表先判 duplicate、工作台先判 pending),收敛为单一权威派生;failed 补上分支(此前落到「待校对」误导)。
import { describe, expect, it } from 'vitest'
import { invoiceDocStatus } from '~/lib/invoice/status'

function inv(patch: Partial<{ ocrStatus: string, dupStatus: string, reviewStatus: string }> = {}) {
  return { ocrStatus: 'done', dupStatus: 'normal', reviewStatus: 'unreviewed', ...patch }
}

describe('invoiceDocStatus:单一权威的状态优先级', () => {
  it('识别中(会话态)压过一切持久状态', () => {
    expect(invoiceDocStatus(inv({ ocrStatus: 'pending' }), true)).toBe('recognizing')
    expect(invoiceDocStatus(inv({ dupStatus: 'duplicate' }), true)).toBe('recognizing')
  })

  it('未产出内容的 pending/failed 优先于 duplicate(此时发票号还没识别出来,谈不上重复)', () => {
    expect(invoiceDocStatus(inv({ ocrStatus: 'pending' }))).toBe('pending')
    expect(invoiceDocStatus(inv({ ocrStatus: 'failed' }))).toBe('failed')
    expect(invoiceDocStatus(inv({ ocrStatus: 'failed', dupStatus: 'duplicate' }))).toBe('failed')
  })

  it('done 后:duplicate > unreviewed > reviewed', () => {
    expect(invoiceDocStatus(inv({ dupStatus: 'duplicate' }))).toBe('duplicate')
    expect(invoiceDocStatus(inv({ dupStatus: 'duplicate', reviewStatus: 'reviewed' }))).toBe('duplicate')
    expect(invoiceDocStatus(inv())).toBe('unreviewed')
    expect(invoiceDocStatus(inv({ reviewStatus: 'reviewed' }))).toBe('reviewed')
  })
})
