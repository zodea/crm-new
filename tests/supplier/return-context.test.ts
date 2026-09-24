import { describe, expect, it } from 'vitest'
import {
  createSupplierDetailJourneyReturnOrigin,
  createSupplierReturnTo,
  resolveSupplierDetailJourneyReturnOrigin,
  supplierListNavigationStateFromQuery,
  validateSupplierDetailReturnTo,
  validateSupplierReturnTo,
} from '~/lib/supplier/return-context'

describe('分供方列表返回上下文', () => {
  it('多选条件完整返回，重复参数可读，旧单值链接仍保持幂等', () => {
    const state = supplierListNavigationStateFromQuery({ category: ['材料供应商', '劳务分包商'], credentialStatus: '["qualified","reviewing"]', columnFilters: JSON.stringify({ taxpayerType: ['一般纳税人', '小规模纳税人'], contains: { address: '广州' } }), page: '2' })
    const returnTo = createSupplierReturnTo('real:multi-1', state)
    expect(validateSupplierReturnTo(returnTo)).toBe(returnTo)
    expect(supplierListNavigationStateFromQuery(Object.fromEntries(new URL(returnTo, 'https://crm.test').searchParams))).toEqual(state)
    const repeated = '/base/supplier?category=材料供应商&category=劳务分包商&credentialStatus=qualified#supplier-row-real%253Amulti-1'
    const normalized = validateSupplierReturnTo(repeated)!
    expect(supplierListNavigationStateFromQuery(Object.fromEntries(new URL(normalized, 'https://crm.test').searchParams)).category).toHaveLength(2)
    expect(validateSupplierReturnTo(normalized)).toBe(normalized)
    const legacy = createSupplierReturnTo('real:multi-1', { ...state, category: '材料供应商', credentialStatus: 'qualified' })
    expect(new URL(legacy, 'https://crm.test').searchParams.get('category')).toBe('材料供应商')
    expect(validateSupplierReturnTo(legacy)).toBe(legacy)
    expect(supplierListNavigationStateFromQuery({ category: '[broken', credentialStatus: [1] })).toMatchObject({ category: [], credentialStatus: [] })
    expect(validateSupplierReturnTo('//evil.test/base/supplier#supplier-row-test')).toBeNull()
  })

  it.each(['Infinity', '1.5', '-1', '9007199254740992'])('无效页码 %s 归一到第一页', (page) => {
    expect(supplierListNavigationStateFromQuery({ page }).page).toBe(1)
  })
  it('列筛选、数值排序和每页20条随详情返回保留', () => {
    const filters = { contains: { laborScope: '油漆' }, ranges: { paymentAmount: { min: 0, max: 100 } } }
    const returnTo = createSupplierReturnTo('demo:supplier-filtered', {
      search: '',
      category: 'all',
      credentialStatus: 'qualified',
      sort: 'paymentAmount-desc',
      page: 2,
      pageSize: 20,
      columnFilters: filters,
    })
    expect(validateSupplierReturnTo(returnTo)).toBe(returnTo)
    const parsed = supplierListNavigationStateFromQuery(Object.fromEntries(new URL(returnTo, 'https://crm.test').searchParams))
    expect(parsed.columnFilters).toEqual(filters)
    expect(parsed.sort).toBe('paymentAmount-desc')
    expect(parsed.pageSize).toBe(20)
  })
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

  it('分包变洽签来源只接受匹配上下文，并保留分供方入口锚点与滚动位置', () => {
    const returnTo = '/base/supplier/supplier-1?origin=real&subChangeJourney=origin_327_supplier#supplier-subcontract-change-link'
    const origin = createSupplierDetailJourneyReturnOrigin({
      contextId: 'origin_327_supplier',
      returnTo,
      anchorId: 'supplier-subcontract-change-link',
      scrollTop: 480,
      now: 1000,
    })

    expect(validateSupplierDetailReturnTo(returnTo, 'real', 'supplier-1')).toBe(returnTo)
    expect(resolveSupplierDetailJourneyReturnOrigin({
      returnTo,
      contextId: 'origin_327_supplier',
      now: 1500,
      load: () => origin,
    })).toEqual(origin)
    expect(resolveSupplierDetailJourneyReturnOrigin({
      returnTo,
      contextId: 'origin_tampered',
      now: 1500,
      load: () => origin,
    })).toBeNull()
  })
})
