import type { NavigationIntentDTO } from '../../app/types/read-model'
import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { validateReceiptReturnTo } from '../../app/lib/receipt/return-context'

const intent: NavigationIntentDTO = { kind: 'entity-detail', subject: { state: 'resolved', entity: 'receipt', id: 'draft/a', label: '空客户草稿', no: 'SK-DRAFT' }, variant: 'detail', view: null, filters: { dataOrigin: 'real' } }

describe('普通收款稳定身份与来源往返', () => {
  it('无客户草稿仍按收款自身 ID 与来源进入详情', () => {
    expect(resolveNavigationTarget(intent)).toMatchObject({ state: 'resolved', to: '/finance/receipt/draft%2Fa?origin=real' })
  })

  it.each([
    { name: '客户详情及收款页签', source: '/base/customer/customer-a?origin=real&tab=receipts' },
    { name: '施工合同详情及合同类型', source: '/contract/contract-a?origin=real&contractKind=construction&tab=receipts' },
    { name: '收款列表筛选及分页', source: '/finance/receipt?search=SK&page=2&pageSize=10' },
  ])('保留$name的返回地址，收款仍使用自身身份', ({ source }) => {
    const result = resolveNavigationTarget(intent, { returnTo: source })
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved')
      expect(new URL(result.to, 'https://crm.invalid').searchParams.get('returnTo')).toBe(source)
  })

  it.each([
    { name: '外部绝对地址', value: 'https://outside.invalid/' },
    { name: '协议相对外部地址', value: '//outside.invalid/' },
    { name: '新建页', value: '/finance/receipt/new' },
    { name: '编辑页', value: '/finance/receipt/form/a' },
    { name: '不同来源的收款详情', value: '/finance/receipt/a?origin=demo' },
    { name: '列表未知查询字段', value: '/finance/receipt?unknown=1' },
  ])('拒绝返回$name，并保留合法列表筛选分页', ({ value }) => {
    expect(validateReceiptReturnTo('/finance/receipt?search=SK&page=3&pageSize=20#receipt-real-a', 'real')).toBe('/finance/receipt?search=SK&page=3&pageSize=20#receipt-real-a')
    expect(validateReceiptReturnTo(value, 'real')).toBeNull()
  })
})
