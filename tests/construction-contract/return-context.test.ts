import { describe, expect, it } from 'vitest'
import { validateConstructionContractDetailReturnTo } from '~/lib/construction-contract/return-context'

describe('施工合同详情返回上下文', () => {
  it('显式编辑和保存往返保留合法页签、补充协议聚焦及列表来源', () => {
    const list = '/contract/construction?origin=real&nav=origin_320_detail#construction-contract-row-real%3Acontract-1'
    const target = `/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1&returnTo=${encodeURIComponent(list)}`

    expect(validateConstructionContractDetailReturnTo(target, 'real')).toBe(target)
  })

  it('拒绝在非补充协议页签注入聚焦目标', () => {
    expect(validateConstructionContractDetailReturnTo('/contract/contract-1?origin=real&contractKind=construction&tab=changes&focus=change-1', 'real')).toBeNull()
  })

  it('允许正式详情返回未限定来源的混合列表，但拒绝明确的跨来源列表', () => {
    const mixed = '/contract/construction?search=既有中央&nav=origin_320_mixed#construction-contract-row-real%3Acontract-1'
    const detail = `/contract/contract-1?origin=real&contractKind=construction&tab=receipts&returnTo=${encodeURIComponent(mixed)}`
    expect(validateConstructionContractDetailReturnTo(detail, 'real')).toBe(detail)

    const demoOnly = '/contract/construction?origin=demo&nav=origin_320_demo#construction-contract-row-demo%3Acontract-1'
    expect(validateConstructionContractDetailReturnTo(`/contract/contract-1?origin=real&contractKind=construction&returnTo=${encodeURIComponent(demoOnly)}`, 'real')).toBeNull()
  })
})
