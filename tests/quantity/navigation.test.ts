import { describe, expect, it } from 'vitest'
import {
  buildQuantityFilterQuery,
  quantityMatrixReturnPath,
  quantityUnitReturnPath,
  readQuantityFilterQuery,
  readQuantityOrigin,
} from '~/lib/quantity/navigation'

describe('quantity route context', () => {
  it('户详情冷刷新返回保留排程来源与完整矩阵筛选，不接纳重复身份', () => {
    const values = { project: 'p1', origin: 'real', group: 'g1', task: 't1', stage: 's1', item: 'i1', buildings: 'b1,b2', building: 'b2', month: '2026-09', view: 'crew', trade: '泥水工', assignee: 'crew:c1', from: 'schedule', taskName: '防水', groupName: '楼栋组' }
    const path = quantityMatrixReturnPath(values)
    const returned = quantityUnitReturnPath('p1', { origin: 'real', returnTo: path })
    expect(Object.fromEntries(new URL(returned, 'https://local.invalid').searchParams)).toEqual(values)
    const invalid = quantityUnitReturnPath('p1', { origin: 'real', returnTo: `${path}&task=other` })
    expect(invalid).toBe('/subcontract/quantity?project=p1&origin=real')
  })
  it.each([
    { case: '\'p1\' / { origin: \'real\' }', input: 'p1', argument2: { origin: 'real' }, expected: '/subcontract/quantity?project=p1&origin=real' },
    { case: '\'p1\' / { origin: \'real\', returnTo: \'/subcontract/quantity?project=p1&view=crew&origin=real\' }', input: 'p1', argument2: { origin: 'real', returnTo: '/subcontract/quantity?project=p1&view=crew&origin=real' }, expected: '/subcontract/quantity?project=p1&view=crew&origin=real' },
    { case: '\'p1\' / { origin: \'real\', project: \'wrong\', returnTo: \'/subcontract/quantity?project=p2&origin=demo\' }', input: 'p1', argument2: { origin: 'real', project: 'wrong', returnTo: '/subcontract/quantity?project=p2&origin=demo' }, expected: '/subcontract/quantity?project=p1&origin=real' },
  ])('直接户链接返回其稳定项目，合法同来源返回范围可保留 / quantityUnitReturnPath：$case', ({ input, argument2, expected }) => {
    expect(quantityUnitReturnPath(input, argument2)).toBe(expected)
  })
  it('明确携带正式或演示来源，非法来源不能回退正式', () => {
    expect(quantityMatrixReturnPath({ project: 'same', origin: 'demo' })).toBe('/subcontract/quantity?project=same&origin=demo')
  })

  it.each([
    { case: '{}', input: {}, expected: 'real' },
    { case: '{ origin: \'demo\' }', input: { origin: 'demo' }, expected: 'demo' },
  ])('明确携带正式或演示来源，非法来源不能回退正式 / readQuantityOrigin：$case', ({ input, expected }) => {
    expect(readQuantityOrigin(input)).toBe(expected)
  })

  it.each([
    { case: '{ origin: [\'real\', \'demo\'] }', input: { origin: ['real', 'demo'] } },
    { case: '{ origin: \'missing\' }', input: { origin: 'missing' } },
  ])('明确携带正式或演示来源，非法来源不能回退正式 / readQuantityOrigin：$case', ({ input }) => {
    expect(readQuantityOrigin(input)).toBeNull()
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
