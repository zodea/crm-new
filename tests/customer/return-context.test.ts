import { describe, expect, it } from 'vitest'
import {
  createCustomerDetailReturnTo,
  createCustomerReturnOrigin,
  customerListNavigationStateFromQuery,
  customerProjectReturnTo,
  resolveCustomerProjectReturnOrigin,
  resolveCustomerReturnContext,
  saveCustomerProjectReturnOrigin,
  validateCustomerDetailReturnTo,
  validateCustomerReturnTo,
} from '~/lib/customer/return-context'

describe('客户列表返回上下文', () => {
  it('客户项目往返在同一来源内绑定目标、有效期和滚动，拒绝篡改或失效上下文', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as Storage
    const to = customerProjectReturnTo('/base/customer/customer-a?origin=real&tab=projects', 'origin_relation_424')!
    const origin = { returnTo: to, projectId: 'p-a', anchorId: 'project:p-a', scrollTop: 201, scrollLeft: 110, expiresAt: 2000 }
    saveCustomerProjectReturnOrigin(origin, storage)
    expect(resolveCustomerProjectReturnOrigin(to, { projectId: 'p-a', origin: 'real' }, 1000, storage)).toEqual(origin)
    expect(resolveCustomerProjectReturnOrigin(to, { projectId: 'p-b', origin: 'real' }, 1000, storage)).toBeNull()
    expect(resolveCustomerProjectReturnOrigin(to, { projectId: 'p-a', origin: 'demo' }, 1000, storage)).toBeNull()
    expect(resolveCustomerProjectReturnOrigin(to, {}, 2000, storage)).toBeNull()
    expect(resolveCustomerProjectReturnOrigin(to.replace('customer-a', 'customer-b'), {}, 1000, storage)).toBeNull()
    expect(validateCustomerDetailReturnTo(`${to}&relationContext=duplicate`)).toBeNull()
    expect(customerProjectReturnTo('https://evil.example', 'origin_relation_424')).toBeNull()
  })
  it('多个档案状态随来源返回，兼容单值和重复参数', () => {
    const origin = createCustomerReturnOrigin({ contextId: 'origin_customer_multi', anchorId: 'customer-row-real%3Ac-1', scrollTop: 0, now: 1000, state: { search: '', status: ['inactive', 'active'], sort: 'updated-desc', page: 1, pageSize: 10 } })
    const url = new URL(origin.returnTo, 'https://crm.test')
    expect(customerListNavigationStateFromQuery(Object.fromEntries(url.searchParams)).status).toEqual(['active', 'inactive'])
    expect(validateCustomerReturnTo(origin.returnTo)).toBe(origin.returnTo)
    url.searchParams.delete('status')
    url.searchParams.append('status', 'active')
    url.searchParams.append('status', 'inactive')
    expect(validateCustomerReturnTo(`${url.pathname}${url.search}${url.hash}`)).toBe(origin.returnTo)
    expect(customerListNavigationStateFromQuery({ status: 'active' }).status).toEqual(['active'])
  })

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

  it('客户详情来源只保留稳定 ID、来源、页签与已验证列表上下文', () => {
    const listReturnTo = '/base/customer?search=%E5%90%88%E5%92%8C&page=2&nav=origin_customer_1234#customer-row-demo%3Acustomer%252F1'
    const detailReturnTo = createCustomerDetailReturnTo({
      customerId: 'customer/1',
      origin: 'demo',
      tab: 'receipts',
      returnTo: listReturnTo,
      returnContext: 'origin_customer_1234',
    })

    expect(detailReturnTo).toBe(
      `/base/customer/customer%2F1?origin=demo&tab=receipts&returnTo=${encodeURIComponent(listReturnTo)}&returnContext=origin_customer_1234`,
    )
    expect(validateCustomerDetailReturnTo(detailReturnTo, 'demo')).toBe(detailReturnTo)
    expect(validateCustomerDetailReturnTo(detailReturnTo, 'demo', 'customer/1')).toBe(detailReturnTo)
    expect(validateCustomerDetailReturnTo(detailReturnTo, 'demo', 'customer-2')).toBeNull()
    expect(validateCustomerDetailReturnTo(detailReturnTo, 'real')).toBeNull()
    expect(validateCustomerDetailReturnTo(`${detailReturnTo}&redirect=https://evil.example`, 'demo')).toBeNull()
    expect(validateCustomerDetailReturnTo('/base/customer/customer-1?origin=demo&tab=unknown', 'demo')).toBeNull()
  })
})
