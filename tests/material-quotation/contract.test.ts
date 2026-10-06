import { describe, expect, it } from 'vitest'
import { decodeQuotationDraft, newQuotationDraft } from '~/lib/material-quotation/contract'

const draft = () => ({ ...newQuotationDraft(), partyName: '未建档报价方原文', lines: [{ ...newQuotationDraft().lines[0]!, id: 'original-line-001', name: '材料甲', unit: '吨' }] })
describe('独立报价原文与条件', () => {
  it('未建档方、未知范围/日期/税率/单价不变成分供方或通用报价', () => {
    expect(decodeQuotationDraft(draft())).toMatchObject({ partyName: '未建档报价方原文', supplierId: null, scope: 'unknown', projectId: null, quotationDate: null, lines: [{ id: 'original-line-001', unitPrice: null, quantity: null, taxIncluded: null, taxRate: null, freight: null }] })
  })
  it('真实零价、零数量、零税率与未知值分别保存', () => {
    const value = draft()
    value.lines[0] = { ...value.lines[0]!, unitPrice: 0, quantity: 0, taxRate: 0, taxIncluded: false }
    expect(decodeQuotationDraft(value).lines[0]).toMatchObject({ unitPrice: 0, quantity: 0, taxRate: 0, taxIncluded: false })
  })
  it('项目范围需明确稳定关联，不能把缺项目推成通用或同名身份', () => {
    expect(() => decodeQuotationDraft({ ...draft(), scope: 'project' })).toThrow('适用范围')
    expect(() => decodeQuotationDraft({ ...draft(), projectId: 'project-real' })).toThrow('适用范围')
    expect(decodeQuotationDraft({ ...draft(), scope: 'general' }).scope).toBe('general')
    expect(() => decodeQuotationDraft({ ...draft(), supplierId: '同名公司' })).toThrow('适用范围')
  })
  it.each([NaN, Infinity, -1])('原价不接受非法值 %s', (value) => {
    const record = draft()
    record.lines[0]!.unitPrice = value
    expect(() => decodeQuotationDraft(record)).toThrow('明细')
  })
  it('重复行身份、不存在日期与额外范围字段显式拒绝', () => {
    const record = draft()
    expect(() => decodeQuotationDraft({ ...record, lines: [record.lines[0], record.lines[0]] })).toThrow('身份重复')
    expect(() => decodeQuotationDraft({ ...record, quotationDate: '2026-02-30' })).toThrow('日期')
    expect(() => decodeQuotationDraft({ ...record, supplierName: '不能另立身份' })).toThrow('不完整')
  })
})
