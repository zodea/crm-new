import type { InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import { describe, expect, it } from 'vitest'
import { assertInvoiceWorkbookFill } from '../../server/utils/production-invoice-workbook'

const before: InvoiceCorrectionContent = {
  fields: { invoiceNumber: 'SYN-A', invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo: 'BUYER', seller: '合成销方', sellerTaxNo: 'SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' },
  items: [],
  ownerKind: 'project',
  projectId: 'project-one',
  supplierId: 'supplier-one',
  supplierVersion: '1',
  buyer: { id: 'buyer-one', version: '1' },
  contract: null,
}
const after: InvoiceCorrectionContent = { ...before, fields: { ...before.fields, amount: 12 } }

it('来源为 B 时不能仅按金额将 A 票补空', () => {
  const row = { 票号: 'SYN-B', 金额: '12' }
  expect(() => assertInvoiceWorkbookFill(before, after, { amount: '金额' }, row, ['票号', '金额'], [])).toThrow('补空必须明确映射工作簿中的发票号码。')
})

describe('补空来源票号与已有原票的绑定', () => {
  const mapping = { invoiceNumber: '票号', amount: '金额' }
  const columns = ['票号', '金额', '税额']
  it.each([
    { label: '不同票号', original: 'SYN-A', source: 'SYN-B' },
    { label: '来源空票号', original: 'SYN-A', source: ' ' },
    { label: '目标空票号', original: '', source: 'SYN-A' },
    { label: '目标全 Unicode 空白', original: '\u00A0', source: 'SYN-A' },
    { label: '目标 Unicode 两端空白不会当 ASCII 空白', original: '\u00A0SYN-A\u00A0', source: 'SYN-A' },
    { label: '大小写不同', original: 'SYN-A', source: 'syn-a' },
    { label: '内部空白不同', original: 'SYN-A', source: 'SYN- A' },
  ])('$label 不能补空', ({ original, source }) => {
    const old = { ...before, fields: { ...before.fields, invoiceNumber: original } }
    const next = { ...old, fields: { ...old.fields, amount: 12 } }
    expect(() => assertInvoiceWorkbookFill(old, next, mapping, { 票号: source, 金额: '12' }, columns, [])).toThrow('工作簿票号与已有发票不一致，不能补空。')
  })
  it.each([
    { label: '目标两端 ASCII 空格', original: ' SYN-A ', source: 'SYN-A' },
    { label: '来源两端 Unicode 空白', original: 'SYN-A', source: '\u00A0SYN-A\u00A0' },
  ])('$label 符合中央预览口径', ({ original, source }) => {
    const old = { ...before, fields: { ...before.fields, invoiceNumber: original } }
    const next = { ...old, fields: { ...old.fields, amount: 12 } }
    expect(() => assertInvoiceWorkbookFill(old, next, mapping, { 票号: source, 金额: '12' }, columns, [])).not.toThrow()
  })
  it('缺失、无效或未提供来源票号映射时拒绝', () => {
    const row = { 票号: 'SYN-A', 金额: '12' }
    expect(() => assertInvoiceWorkbookFill(before, after, { amount: '金额' }, row, columns, [])).toThrow('补空必须明确映射工作簿中的发票号码。')
    expect(() => assertInvoiceWorkbookFill(before, after, { ...mapping, invoiceNumber: '不存在' }, row, columns, [])).toThrow('补空必须明确映射工作簿中的发票号码。')
    expect(() => assertInvoiceWorkbookFill(before, after, mapping, { 金额: '12' }, columns, [])).toThrow('补空必须明确映射工作簿中的发票号码。')
  })
  it('真实零、已填冲突及整行公式保护仍有效', () => {
    const row = { 票号: 'SYN-A', 金额: '12', 税额: '0' }
    expect(() => assertInvoiceWorkbookFill(before, after, { ...mapping, taxAmount: '税额' }, row, columns, [])).not.toThrow()
    expect(() => assertInvoiceWorkbookFill(before, after, { ...mapping, taxAmount: '税额' }, { ...row, 税额: '1' }, columns, [])).toThrow('工作簿与已有字段冲突，请人工处理。')
    expect(() => assertInvoiceWorkbookFill(before, after, mapping, row, columns, ['税额'])).toThrow('公式缓存')
    expect(() => assertInvoiceWorkbookFill(before, { ...after, projectId: 'project-two' }, mapping, row, columns, [])).toThrow('工作簿只能补充原本为空的票面字段。')
    expect(before.fields.amount).toBeNull()
    expect(before.fields.taxAmount).toBe(0)
  })
})
