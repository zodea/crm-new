import type { NavigationIntentDTO } from '../../app/types/read-model'
import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { validateReceiptReturnTo } from '../../app/lib/receipt/return-context'

const intent: NavigationIntentDTO = { kind: 'entity-detail', subject: { state: 'resolved', entity: 'receipt', id: 'draft/a', label: '空客户草稿', no: 'SK-DRAFT' }, variant: 'detail', view: null, filters: { dataOrigin: 'real' } }

describe('普通收款稳定身份与来源往返', () => {
  it('无客户草稿仍按收款自身 ID 与来源进入详情', () => {
    expect(resolveNavigationTarget(intent)).toMatchObject({ state: 'resolved', to: '/finance/receipt/draft%2Fa?origin=real' })
  })

  it.each((['/base/customer/customer-a?origin=real&tab=receipts', '/contract/contract-a?origin=real&contractKind=construction&tab=receipts', '/finance/receipt?search=SK&page=2&pageSize=10']).map(input => ({ input })))('客户、施工合同和收款列表来源均由统一入口保存，查询不承担收款身份：输入案例 %#', ({ input: source }) => {
    const result = resolveNavigationTarget(intent, { returnTo: source })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved')
      expect(new URL(result.to, 'https://crm.invalid').searchParams.get('returnTo')).toBe(source)
  })

  it.each((['https://outside.invalid/', '//outside.invalid/', '/finance/receipt/new', '/finance/receipt/form/a', '/finance/receipt/a?origin=demo', '/finance/receipt?unknown=1']).map(input => ({ input })))('返回仅接受相同来源的已知业务路径，保留列表筛选分页并拒绝外部或写态目标：输入案例 %#', ({ input: value }) => {
    expect(validateReceiptReturnTo('/finance/receipt?search=SK&page=3&pageSize=20#receipt-real-a', 'real')).toBe('/finance/receipt?search=SK&page=3&pageSize=20#receipt-real-a')
    expect(validateReceiptReturnTo(value, 'real')).toBeNull()
  })
})
