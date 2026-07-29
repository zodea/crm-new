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

  it('已有事实优先定位现场复核，其次暂估量、合同量', () => {
    expect(defaultQuantityEntrySource({
      recognizedContractQty: 10,
      contractQty: 11,
      provisionalQty: 12,
      fieldFormula: '3×5',
    })).toBe('field')
    expect(defaultQuantityEntrySource({
      recognizedContractQty: 10,
      contractQty: 11,
      provisionalQty: 12,
      fieldFormula: '',
    })).toBe('provisional')
    expect(defaultQuantityEntrySource({
      recognizedContractQty: 10,
      contractQty: 11,
      provisionalQty: null,
      fieldFormula: '',
    })).toBe('contract')
  })
})
