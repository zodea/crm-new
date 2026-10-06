import type { QuotationPriceFact } from '~/lib/material-quotation/price-facts'
import { describe, expect, it } from 'vitest'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { convertedQuotationPrice, quotationDifference } from '~/lib/material-quotation/price-facts'

const source = (): QuotationPriceFact => ({ key: 'head:v1:line', quotationId: 'head-original', lineId: 'line-original', version: '1', partyName: '未关联原报价方', supplierId: null, scope: 'unknown', projectId: null, quotationDate: null, savedAt: '2026-10-05T00:00:00.000Z', fileIds: [], line: { ...newQuotationDraft().lines[0]!, name: '实际材料', unit: '吨', unitPrice: 18000, quantity: 1, taxIncluded: true, taxRate: 0, freight: '不含运费', quantityCondition: '不限数量', paymentCondition: '现款', validity: '仅当日' } })
describe('实际独立报价比较', () => {
  it('显式依据只换算比较视图，原价/单位/数量/未知日期/未关联身份保留', () => {
    const fact = source()
    expect(convertedQuotationPrice(fact, '千克', 1000, '原件1吨=1000千克')).toMatchObject({ unitPrice: 18, quantity: 1000, source: { quotationId: 'head-original', lineId: 'line-original', version: '1', quotationDate: null, supplierId: null } })
    expect(fact.line).toMatchObject({ unitPrice: 18000, quantity: 1, unit: '吨' })
    expect(() => convertedQuotationPrice(fact, '千克', 1000, '')).toThrow('真实依据')
    expect(() => convertedQuotationPrice(fact, '千克', 0, '原件')).toThrow('正换算')
  })
  it('真实零基准可以比较，材料/单位/税/所有条件已核验才计算独立价差', () => {
    const base = source()
    const candidate = source()
    base.line.unitPrice = 0
    candidate.line.unitPrice = 20000
    expect(quotationDifference(base, candidate, { materialBasis: '原件规格等级逐项核对', targetUnit: '吨', factor: 1, conversionBasis: '相同单位吨' }).difference).toBe(20000)
  })
  it.each(['taxRate', 'unitPrice', 'freight', 'quantityCondition', 'paymentCondition', 'validity'] as const)('%s 未知不从合同/别行套值', (field) => {
    const candidate = source()
    Object.assign(candidate.line, { [field]: null })
    expect(quotationDifference(source(), candidate, { materialBasis: '原件核对', targetUnit: '吨', factor: 1, conversionBasis: '相同单位' }).difference).toBeNull()
  })
  it('缺材料依据、税条件不同或运费不同均不输出最低价/价差', () => {
    const base = source()
    const candidate = source()
    const input = { materialBasis: '', targetUnit: '吨', factor: 1, conversionBasis: '相同单位' }
    expect(quotationDifference(base, candidate, input).difference).toBeNull()
    input.materialBasis = '原件规格确认'
    candidate.line.taxIncluded = false
    expect(quotationDifference(base, candidate, input).difference).toBeNull()
    candidate.line.taxIncluded = true
    candidate.line.freight = '包到工地'
    expect(quotationDifference(base, candidate, input).difference).toBeNull()
  })
})
