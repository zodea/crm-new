import { describe, expect, it } from 'vitest'
import { validateConstructionContractDetailReturnTo, validateConstructionContractProjectReturnTo, validateConstructionContractReturnTo } from '~/lib/construction-contract/return-context'

describe('施工合同详情返回上下文', () => {
  it('项目返回须匹配当前真实project稳定ID和来源，编辑保留同一受限项目来源', () => {
    const project = '/project/project-1?origin=real'
    expect(validateConstructionContractProjectReturnTo(project, 'project-1', 'real')).toBe(project)
    expect(validateConstructionContractProjectReturnTo(project, 'project-2', 'real')).toBeNull()
    expect(validateConstructionContractProjectReturnTo(project, 'project-1', 'demo')).toBeNull()
    expect(validateConstructionContractProjectReturnTo(project, null, 'real')).toBeNull()
    expect(validateConstructionContractProjectReturnTo('https://outside.invalid/project/project-1?origin=real', 'project-1', 'real')).toBeNull()
    const detail = `/contract/main-1?origin=real&contractKind=construction&returnTo=${encodeURIComponent(project)}`
    expect(validateConstructionContractDetailReturnTo(detail, 'real')).toBe(detail)
  })
  it('显式编辑和保存往返保留合法页签、补充协议聚焦及列表来源', () => {
    const list = '/contract/construction?origin=real&noise=ignored&nav=origin_320_detail#construction-contract-row-real%3Acontract-1'
    const canonicalList = '/contract/construction?origin=real&nav=origin_320_detail#construction-contract-row-real%3Acontract-1'
    const target = `/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1&returnTo=${encodeURIComponent(list)}`
    const expected = `/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1&returnTo=${encodeURIComponent(canonicalList)}`

    expect(validateConstructionContractDetailReturnTo(target, 'real')).toBe(expected)
  })

  it('甲方罚扣详情往返保留结算页签与稳定罚扣聚焦', () => {
    const target = '/contract/contract-326?origin=real&contractKind=construction&tab=settlements&focus=owner_penalty-326'
    expect(validateConstructionContractDetailReturnTo(target, 'real')).toBe(target)
  })

  it('拒绝在非补充协议页签注入聚焦目标', () => {
    expect(validateConstructionContractDetailReturnTo('/contract/contract-1?origin=real&contractKind=construction&tab=changes&focus=change-1', 'real')).toBeNull()
  })

  it('验收双事实返回时保留视图区分、稳定锚点与聚焦目标', () => {
    const target = '/contract/contract-1?origin=real&contractKind=construction&tab=acceptance&focus=acceptance-324&focusView=warranty#construction-contract-fact-warranty-acceptance-324'
    expect(validateConstructionContractDetailReturnTo(target, 'real')).toBe(target)
    expect(validateConstructionContractDetailReturnTo(
      '/contract/contract-1?origin=real&contractKind=construction&tab=acceptance&focus=acceptance-324&focusView=other#construction-contract-fact-other-acceptance-324',
      'real',
    )).toBeNull()
  })

  it('允许正式详情返回未限定来源的混合列表，但拒绝明确的跨来源列表', () => {
    const mixed = '/contract/construction?search=既有中央&nav=origin_320_mixed#construction-contract-row-real%3Acontract-1'
    const canonicalMixed = validateConstructionContractReturnTo(mixed, 'real')!
    const detail = `/contract/contract-1?origin=real&contractKind=construction&tab=receipts&returnTo=${encodeURIComponent(mixed)}`
    expect(validateConstructionContractDetailReturnTo(detail, 'real')).toBe(`/contract/contract-1?origin=real&contractKind=construction&tab=receipts&returnTo=${encodeURIComponent(canonicalMixed)}`)

    const demoOnly = '/contract/construction?origin=demo&nav=origin_320_demo#construction-contract-row-demo%3Acontract-1'
    expect(validateConstructionContractDetailReturnTo(`/contract/contract-1?origin=real&contractKind=construction&returnTo=${encodeURIComponent(demoOnly)}`, 'real')).toBeNull()
  })
})
