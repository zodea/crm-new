import { describe, expect, it } from 'vitest'
import {
  createCustomerDetailReturnTo,
  createCustomerReturnOrigin,
  customerListNavigationStateFromQuery,
  customerRelationReturnTo,
  resolveCustomerRelationReturnOrigin,
  resolveCustomerReturnContext,
  saveCustomerRelationReturnOrigin,
  validateCustomerDetailReturnTo,
  validateCustomerReturnTo,
} from '~/lib/customer/return-context'

describe('客户列表返回上下文', () => {
  it.each([
    { case: '未完成百分号编码', anchor: 'customer-row-%', valid: false },
    { case: '非法十六进制编码', anchor: 'customer-row-%ZZ', valid: false },
    { case: '嵌套未完成百分号编码', anchor: 'customer-row-%25', valid: false },
    { case: '单层来源身份编码', anchor: 'customer-row-real%3Acustomer-1', valid: true },
    { case: '双层来源身份编码', anchor: 'customer-row-real%253Acustomer-1', valid: true },
    { case: '单层百分号实体身份', anchor: 'customer-row-real%3Acustomer%25id', valid: true },
    { case: '双层百分号实体身份', anchor: 'customer-row-real%253Acustomer%2525id', valid: true },
  ])('返回锚点安全解码：$case', ({ anchor, valid }) => {
    const returnTo = `/base/customer?nav=origin_314#${anchor}`
    expect(validateCustomerReturnTo(returnTo)).toBe(valid ? returnTo : null)
  })
  describe.each(['project', 'contract'] as const)('客户 %s 关联来源', (targetEntity) => {
    it.each([
      { case: '匹配目标', otherEntity: false, targetId: 'p-a', dataOrigin: 'real', now: 1000, customerId: 'customer-a', restored: true },
      { case: '其他实体', otherEntity: true, targetId: 'p-a', dataOrigin: 'real', now: 1000, customerId: 'customer-a', restored: false },
      { case: '其他目标 ID', otherEntity: false, targetId: 'p-b', dataOrigin: 'real', now: 1000, customerId: 'customer-a', restored: false },
      { case: '跨数据来源', otherEntity: false, targetId: 'p-a', dataOrigin: 'demo', now: 1000, customerId: 'customer-a', restored: false },
      { case: '有效期边界', otherEntity: false, targetId: 'p-a', dataOrigin: 'real', now: 2000, customerId: 'customer-a', restored: false },
      { case: '其他客户', otherEntity: false, targetId: 'p-a', dataOrigin: 'real', now: 1000, customerId: 'customer-b', restored: false },
    ] as const)('来源绑定目标、有效期与滚动位置：$case', ({ otherEntity, targetId, dataOrigin, now, customerId, restored }) => {
      const values = new Map<string, string>()
      const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as Storage
      const to = customerRelationReturnTo('/base/customer/customer-a?origin=real&tab=projects', 'origin_relation_424')!
      const origin = { returnTo: to, targetEntity, targetId: 'p-a', anchorId: `${targetEntity}:p-a`, scrollTop: 201, scrollLeft: 110, expiresAt: 2000 }
      saveCustomerRelationReturnOrigin(origin, storage)
      expect(resolveCustomerRelationReturnOrigin(to.replace('customer-a', customerId), {
        targetEntity: otherEntity ? targetEntity === 'project' ? 'contract' : 'project' : targetEntity,
        targetId,
        origin: dataOrigin,
      }, now, storage)).toEqual(restored ? origin : null)
    })
  })

  it('客户详情拒绝重复关联上下文', () => {
    const to = customerRelationReturnTo('/base/customer/customer-a?origin=real&tab=projects', 'origin_relation_424')!
    expect(validateCustomerDetailReturnTo(`${to}&relationContext=duplicate`)).toBeNull()
  })

  it('客户关联返回拒绝外链', () => {
    expect(customerRelationReturnTo('https://evil.example', 'origin_relation_424')).toBeNull()
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

  describe('客户详情来源只保留稳定 ID、来源、页签与已验证列表上下文', () => {
    const listReturnTo = '/base/customer?search=%E5%90%88%E5%92%8C&page=2&nav=origin_customer_1234#customer-row-demo%3Acustomer%252F1'
    const detailReturnTo = createCustomerDetailReturnTo({
      customerId: 'customer/1',
      origin: 'demo',
      tab: 'receipts',
      returnTo: listReturnTo,
      returnContext: 'origin_customer_1234',
    })
    it('关联事实保持原契约', () => {
      expect(detailReturnTo).toBe(
        `/base/customer/customer%2F1?origin=demo&tab=receipts&returnTo=${encodeURIComponent(listReturnTo)}&returnContext=origin_customer_1234`,
      )
    })

    it.each([
      { case: 'detailReturnTo / \'demo\'', input: detailReturnTo, argument2: 'demo', argument3: undefined, expected: detailReturnTo },
      { case: 'detailReturnTo / \'demo\' / \'customer/1\'', input: detailReturnTo, argument2: 'demo', argument3: 'customer/1', expected: detailReturnTo },
    ])('validateCustomerDetailReturnTo：$case', ({ input, argument2, argument3, expected }) => {
      expect(validateCustomerDetailReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })

    it.each([
      { case: 'detailReturnTo / \'demo\' / \'customer-2\'', input: detailReturnTo, argument2: 'demo', argument3: 'customer-2' },
      { case: 'detailReturnTo / \'real\'', input: detailReturnTo, argument2: 'real', argument3: undefined },
      { case: '`{detailReturnTo}&redirect=https://evil.example` / \'demo\'', input: `${detailReturnTo}&redirect=https://evil.example`, argument2: 'demo', argument3: undefined },
      { case: '\'/base/customer/customer-1?origin=demo&tab=unknown\' / \'demo\'', input: '/base/customer/customer-1?origin=demo&tab=unknown', argument2: 'demo', argument3: undefined },
    ])('validateCustomerDetailReturnTo：$case', ({ input, argument2, argument3 }) => {
      expect(validateCustomerDetailReturnTo(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBeNull()
    })
  })
})
