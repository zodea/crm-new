import { describe, expect, it } from 'vitest'
import {
  createCustomerReturnOrigin,
  resolveCustomerReturnContext,
  validateCustomerReturnTo,
} from '~/lib/customer/return-context'

describe('客户列表返回上下文', () => {
  it('只允许客户列表白名单参数并恢复精确锚点', () => {
    const origin = createCustomerReturnOrigin({
      contextId: 'origin_customer_1234',
      anchorId: 'customer-row-real%3Ac-1',
      scrollTop: 240,
      now: 1000,
      state: { search: '合和', status: 'active', sort: 'name-asc', page: 2, pageSize: 20 },
    })
    const resolved = resolveCustomerReturnContext({
      returnTo: origin.returnTo,
      contextId: origin.id,
      now: 2000,
      load: () => origin,
    })

    expect(origin.returnTo).toContain('/base/customer?')
    expect(resolved).toEqual({ to: origin.returnTo, origin })
  })

  it.each([
    'https://evil.example/base/customer',
    '//evil.example/base/customer',
    '/base/customer/../admin',
    '/base/customer?nav=origin_customer_1234#other-row',
  ])('拒绝不安全或不完整的返回地址：%s', (value) => {
    expect(validateCustomerReturnTo(value)).toBeNull()
  })
})
