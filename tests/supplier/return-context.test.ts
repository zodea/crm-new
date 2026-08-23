import { describe, expect, it } from 'vitest'
import {
  createSupplierReturnTo,
  validateSupplierReturnTo,
} from '~/lib/supplier/return-context'

describe('分供方列表返回上下文', () => {
  it('包含来源身份的锚点经过多层页面透传仍保持规范且幂等', () => {
    const returnTo = createSupplierReturnTo('real:supplier-1', {
      search: '中央',
      category: 'all',
      credentialStatus: 'all',
      sort: 'updated-desc',
      page: 1,
      pageSize: 10,
    })

    expect(validateSupplierReturnTo(returnTo)).toBe(returnTo)
    expect(validateSupplierReturnTo(validateSupplierReturnTo(returnTo))).toBe(returnTo)
  })
})
