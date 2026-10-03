import type {
  WageQuantityRequest,
  WageQuantitySource,
} from '~/lib/quantity/wage-source'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  resolveWageQuantity,
  WAGE_QUANTITY_SOURCE_OPTIONS,
  wageQuantityRequest,
} from '~/lib/quantity/wage-source'

describe('wage quantity source', () => {
  it('工资取数类型和选择项只允许暂估量或现场复核量', () => {
    expectTypeOf<WageQuantitySource>().toEqualTypeOf<'provisional' | 'field'>()
    expect(WAGE_QUANTITY_SOURCE_OPTIONS.map(option => option.value))
      .toEqual(['provisional', 'field'])
  })

  function createWageQuantityRequests() {
    const advance = wageQuantityRequest('advance', 'provisional')
    const final = wageQuantityRequest('final')

    expectTypeOf(advance).toMatchTypeOf<WageQuantityRequest>()
    expectTypeOf(final).toMatchTypeOf<WageQuantityRequest>()
    return { advance, final }
  }

  it.each([
    { case: '{ provisionalQty: 8, fieldQty: 9, } / advance', prepare: ({ advance }: ReturnType<typeof createWageQuantityRequests>) => {
      return { input: {
        provisionalQty: 8,
        fieldQty: 9,
      }, argument2: advance, expected: {
        source: 'provisional',
        quantity: 8,
        status: 'ready',
      } } as const
    } },
    { case: '{ provisionalQty: 8, fieldQty: 9, } / final', prepare: ({ final }: ReturnType<typeof createWageQuantityRequests>) => {
      return { input: {
        provisionalQty: 8,
        fieldQty: 9,
      }, argument2: final, expected: {
        source: 'field',
        quantity: 9,
        status: 'ready',
      } } as const
    } },
  ])('预付可显式选择暂估或现场，最终结算固定使用现场复核量 / resolveWageQuantity：$case', ({ prepare }) => {
    const fixture = createWageQuantityRequests()
    const { input, argument2, expected } = prepare(fixture)
    expect(resolveWageQuantity(input, argument2)).toMatchObject(expected)
  })

  it.each([
    { case: '{ provisionalQty: null, fieldQty: 15, } / wageQuantityRequest(\'advance\', \'provisional\')', input: {
      provisionalQty: null,
      fieldQty: 15,
    }, argument2: wageQuantityRequest('advance', 'provisional'), expected: {
      source: 'provisional',
      label: '暂估量',
      quantity: null,
      status: 'missing',
    } },
    { case: '{ provisionalQty: 12, fieldQty: null, } / wageQuantityRequest(\'final\')', input: {
      provisionalQty: 12,
      fieldQty: null,
    }, argument2: wageQuantityRequest('final'), expected: {
      source: 'field',
      label: '现场复核量',
      quantity: null,
      status: 'missing',
    } },
  ])('缺量时明确返回 missing，不用合同量或另一口径静默回退 / resolveWageQuantity：$case', ({ input, argument2, expected }) => {
    expect(resolveWageQuantity(input, argument2)).toEqual(expected)
  })
})
