import { describe, expect, it } from 'vitest'
import { defaultQuantityEntrySource } from '~/lib/quantity/entry-source'

describe('quantity entry source', () => {
  it('新建手工明细默认录暂估量', () => {
    expect(defaultQuantityEntrySource({
      recognizedContractQty: null,
      contractQty: null,
      provisionalQty: null,
      fieldFormula: '',
    })).toBe('provisional')
  })

  it.each([
    { case: '{ recognizedContractQty: 10, contractQty: 11, provisionalQty: 12, fieldFormula: \'3×5\', }', input: {
      recognizedContractQty: 10,
      contractQty: 11,
      provisionalQty: 12,
      fieldFormula: '3×5',
    }, expected: 'contract' },
    { case: '{ recognizedContractQty: null, contractQty: null, provisionalQty: 12, fieldFormula: \'3×5\', }', input: {
      recognizedContractQty: null,
      contractQty: null,
      provisionalQty: 12,
      fieldFormula: '3×5',
    }, expected: 'field' },
  ])('施工前默认先展示合同量，没有合同量时才就近定位其他已有口径 / defaultQuantityEntrySource：$case', ({ input, expected }) => {
    expect(defaultQuantityEntrySource(input)).toBe(expected)
  })
})
