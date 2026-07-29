import { describe, expect, it } from 'vitest'
import {
  buildQuantityFilterQuery,
  quantityMatrixReturnPath,
  readQuantityFilterQuery,
} from '~/lib/quantity/navigation'

describe('quantity route context', () => {
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
