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

  it('施工前默认先展示合同量，没有合同量时才就近定位其他已有口径', () => {
    expect(defaultQuantityEntrySource({
      recognizedContractQty: 10,
      contractQty: 11,
      provisionalQty: 12,
      fieldFormula: '3×5',
    })).toBe('contract')
    expect(defaultQuantityEntrySource({
      recognizedContractQty: null,
      contractQty: null,
      provisionalQty: 12,
      fieldFormula: '3×5',
    })).toBe('field')
  })
})
