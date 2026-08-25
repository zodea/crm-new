import { describe, expect, it } from 'vitest'
import { resolveSubcontractContractReturnContext, validateSubcontractContractDetailReturnTo, validateSubcontractContractReturnTo } from '../../app/lib/subcontract-contract/return-context'

describe('subcontract contract return context', () => {
  it('allows a mixed-origin list return while rejecting an explicit different origin', () => {
    const mixedOrigin = '/contract/subcontract?search=%E6%B3%A5%E6%B0%B4&nav=origin_12345678#subcontract-contract-row-demo%3Acon_demo_fb01'
    const differentOrigin = '/contract/subcontract?search=%E6%B3%A5%E6%B0%B4&origin=real&nav=origin_12345678#subcontract-contract-row-demo%3Acon_demo_fb01'

    expect(validateSubcontractContractReturnTo(mixedOrigin, 'demo')).toBe(mixedOrigin)
    expect(validateSubcontractContractReturnTo(differentOrigin, 'demo')).toBeNull()
  })

  it('restores a trusted context from the same route without exposing its hash to native scrolling', () => {
    const returnTo = '/contract/subcontract?search=%E6%B3%A5%E6%B0%B4&nav=origin_12345678#subcontract-contract-row-demo%3Acon_demo_fb01'
    const origin = { id: 'origin_12345678', returnTo, anchorId: 'subcontract-contract-row-demo:con_demo_fb01', scrollTop: 80, expiresAt: 2_000 }

    expect(resolveSubcontractContractReturnContext({
      returnTo: returnTo.split('#')[0],
      contextId: origin.id,
      now: 1_000,
      load: () => origin,
    })).toEqual({ to: returnTo.split('#')[0], origin })
  })

  it('只接受变更页签上的稳定补充协议聚焦，并将详情 URL 收敛为白名单字段', () => {
    const list = '/contract/subcontract?origin=real&noise=ignored&nav=origin_322_detail#subcontract-contract-row-real%3Acontract-1'
    const canonicalList = '/contract/subcontract?origin=real&nav=origin_322_detail#subcontract-contract-row-real%3Acontract-1'
    const input = `/contract/contract-1?origin=real&contractKind=subcontract&tab=changes&focus=supplement-1&noise=ignored&returnTo=${encodeURIComponent(list)}`
    const expected = `/contract/contract-1?origin=real&contractKind=subcontract&tab=changes&focus=supplement-1&returnTo=${encodeURIComponent(canonicalList)}`

    expect(validateSubcontractContractDetailReturnTo(input, 'real')).toBe(expected)
    expect(validateSubcontractContractDetailReturnTo('/contract/contract-1?origin=real&contractKind=subcontract&tab=payments&focus=supplement-1', 'real')).toBeNull()
    expect(validateSubcontractContractDetailReturnTo('/contract/contract-1?origin=real&contractKind=subcontract&tab=changes&focus=%00', 'real')).toBeNull()
  })
})
