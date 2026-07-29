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

  it('预付可显式选择暂估或现场，最终结算固定使用现场复核量', () => {
    const advance = wageQuantityRequest('advance', 'provisional')
    const final = wageQuantityRequest('final')

    expectTypeOf(advance).toMatchTypeOf<WageQuantityRequest>()
    expectTypeOf(final).toMatchTypeOf<WageQuantityRequest>()
    expect(resolveWageQuantity({
      provisionalQty: 8,
      fieldQty: 9,
    }, advance)).toMatchObject({
      source: 'provisional',
      quantity: 8,
      status: 'ready',
    })
    expect(resolveWageQuantity({
      provisionalQty: 8,
      fieldQty: 9,
    }, final)).toMatchObject({
      source: 'field',
      quantity: 9,
      status: 'ready',
    })
  })

  it('缺量时明确返回 missing，不用合同量或另一口径静默回退', () => {
    expect(resolveWageQuantity({
      provisionalQty: null,
      fieldQty: 15,
    }, wageQuantityRequest('advance', 'provisional'))).toEqual({
      source: 'provisional',
      label: '暂估量',
      quantity: null,
      status: 'missing',
    })

    expect(resolveWageQuantity({
      provisionalQty: 12,
      fieldQty: null,
    }, wageQuantityRequest('final'))).toEqual({
      source: 'field',
      label: '现场复核量',
      quantity: null,
      status: 'missing',
    })
  })
})
