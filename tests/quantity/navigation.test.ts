import { describe, expect, it } from 'vitest'
import {
  buildQuantityFilterQuery,
  quantityMatrixReturnPath,
  quantityUnitReturnPath,
  readQuantityFilterQuery,
  readQuantityOrigin,
} from '~/lib/quantity/navigation'

describe('quantity route context', () => {
  it('直接户链接返回其稳定项目，合法同来源返回范围可保留', () => {
    expect(quantityUnitReturnPath('p1', { origin: 'real' })).toBe('/subcontract/quantity?project=p1&origin=real')
    expect(quantityUnitReturnPath('p1', { origin: 'real', returnTo: '/subcontract/quantity?project=p1&view=crew&origin=real' })).toBe('/subcontract/quantity?project=p1&view=crew&origin=real')
    expect(quantityUnitReturnPath('p1', { origin: 'real', project: 'wrong', returnTo: '/subcontract/quantity?project=p2&origin=demo' })).toBe('/subcontract/quantity?project=p1&origin=real')
  })
  it('明确携带正式或演示来源，非法来源不能回退正式', () => {
    expect(readQuantityOrigin({})).toBe('real')
    expect(readQuantityOrigin({ origin: 'demo' })).toBe('demo')
    expect(readQuantityOrigin({ origin: ['real', 'demo'] })).toBeNull()
    expect(readQuantityOrigin({ origin: 'missing' })).toBeNull()
    expect(quantityMatrixReturnPath({ project: 'same', origin: 'demo' })).toBe('/subcontract/quantity?project=same&origin=demo')
  })
  it('round-trips matrix filters through detail and template routes', () => {
    const query = buildQuantityFilterQuery({
      project: 'p 1',
      building: 'b1',
      month: '2026-05',
      view: 'crew',
      trade: '泥水工',
      assignee: 'crew:c1',
    })

    expect(readQuantityFilterQuery(query)).toEqual(query)
    expect(quantityMatrixReturnPath(query)).toBe(
      '/subcontract/quantity?project=p+1&building=b1&month=2026-05&view=crew&trade=%E6%B3%A5%E6%B0%B4%E5%B7%A5&assignee=crew%3Ac1',
    )
  })

  it('ignores unrelated or repeated query values', () => {
    expect(quantityMatrixReturnPath({
      project: ['p1', 'p2'],
      external: 'https://example.com',
    })).toBe('/subcontract/quantity')
  })
})
