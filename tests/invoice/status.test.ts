// 发票文档工作流状态派生(#60 review 修复):文档表与工作台左栏此前各写一套映射且优先级互相矛盾
// (文档表先判 duplicate、工作台先判 pending),收敛为单一权威派生;failed 补上分支(此前落到「待校对」误导)。
import { describe, expect, it } from 'vitest'
import { invoiceDocStatus } from '~/lib/invoice/status'

function inv(patch: Partial<{ ocrStatus: string, dupStatus: string, reviewStatus: string }> = {}) {
  return { ocrStatus: 'done', dupStatus: 'normal', reviewStatus: 'unreviewed', ...patch }
}

describe('invoiceDocStatus:单一权威的状态优先级', () => {
  it.each([
    { case: 'inv({ ocrStatus: \'pending\' }) / true', input: inv({ ocrStatus: 'pending' }), argument2: true, expected: 'recognizing' },
    { case: 'inv({ dupStatus: \'duplicate\' }) / true', input: inv({ dupStatus: 'duplicate' }), argument2: true, expected: 'recognizing' },
  ])('识别中(会话态)压过一切持久状态 / invoiceDocStatus：$case', ({ input, argument2, expected }) => {
    expect(invoiceDocStatus(input, argument2)).toBe(expected)
  })

  it.each([
    { case: 'inv({ ocrStatus: \'pending\' })', input: inv({ ocrStatus: 'pending' }), expected: 'pending' },
    { case: 'inv({ ocrStatus: \'failed\' })', input: inv({ ocrStatus: 'failed' }), expected: 'failed' },
    { case: 'inv({ ocrStatus: \'failed\', dupStatus: \'duplicate\' })', input: inv({ ocrStatus: 'failed', dupStatus: 'duplicate' }), expected: 'failed' },
  ])('未产出内容的 pending/failed 优先于 duplicate(此时发票号还没识别出来,谈不上重复) / invoiceDocStatus：$case', ({ input, expected }) => {
    expect(invoiceDocStatus(input)).toBe(expected)
  })

  it.each([
    { case: 'inv({ dupStatus: \'duplicate\' })', input: inv({ dupStatus: 'duplicate' }), expected: 'duplicate' },
    { case: 'inv({ dupStatus: \'duplicate\', reviewStatus: \'reviewed\' })', input: inv({ dupStatus: 'duplicate', reviewStatus: 'reviewed' }), expected: 'duplicate' },
    { case: 'inv()', input: inv(), expected: 'unreviewed' },
    { case: 'inv({ reviewStatus: \'reviewed\' })', input: inv({ reviewStatus: 'reviewed' }), expected: 'reviewed' },
  ])('done 后:duplicate > unreviewed > reviewed / invoiceDocStatus：$case', ({ input, expected }) => {
    expect(invoiceDocStatus(input)).toBe(expected)
  })
})
