import { fireEvent, render } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceReviewForm from '~/components/invoice/InvoiceReviewForm.vue'

const store = { correctField: vi.fn(), confirmField: vi.fn() }

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [] }))
  vi.stubGlobal('useKitUI', () => ({ warning: vi.fn() }))
  store.correctField.mockClear()
  store.confirmField.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

const invoice = { id: 'i1', invoiceNumber: 'NEW', invoiceDate: '2026-09-05', seller: '识别供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '增值税普通发票', taxRate: '', projectName: '', remark: '', amount: 200, totalAmount: 226, taxAmount: 26, ownerKind: null, accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: 'normal', items: [], fieldConfidence: { seller: 0.6 }, ocrConfidence: 0.9 }

function mount(props: Record<string, unknown>) {
  return render(InvoiceReviewForm, { props: { invoice, ...props }, global: { components: { InvoiceRecognitionFieldMark } } })
}

describe('识别校对表单的重新识别草稿模式', () => {
  it('草稿期间字段修改、✓确认与归属只交给父级合并进草稿，不写库', async () => {
    const view = mount({ draft: true, marks: { seller: { mark: 'recognized', before: '原供应商' } } })
    await fireEvent.change(view.getByLabelText('价税合计'), { target: { value: '300' } })
    await fireEvent.click(view.getByTitle('人工确认「供应商」识别无误'))
    await fireEvent.click(view.getByRole('button', { name: '个人开支' }))

    expect(store.correctField).not.toHaveBeenCalled()
    expect(store.confirmField).not.toHaveBeenCalled()
    expect(view.emitted('edit')).toEqual([
      [{ totalAmount: 300, amount: 274 }],
      [{ fieldConfidence: { seller: 1 } }],
      [{ ownerKind: 'personal' }],
    ])
  })

  it('非草稿时沿用即时落库', async () => {
    const view = mount({})
    await fireEvent.change(view.getByLabelText('价税合计'), { target: { value: '300' } })
    expect(store.correctField).toHaveBeenCalledWith('i1', 'totalAmount', 300)
    expect(view.emitted('edit')).toBeUndefined()
  })

  it('变动字段以警示边框 + 图标文字角标标出，并经 aria-describedby 读出识别前原值', () => {
    const view = mount({ draft: true, marks: { seller: { mark: 'recognized', before: '原供应商' }, totalAmount: { mark: 'edited', before: '113' } } })
    const seller = view.getByLabelText('供应商')
    expect(seller.className).toContain('border-warn!')
    const sellerMark = document.getElementById(seller.getAttribute('aria-describedby')!)
    expect(sellerMark?.textContent).toContain('识别变动')
    expect(sellerMark?.textContent).toContain('识别前：原供应商')
    const total = view.getByLabelText('价税合计')
    expect(document.getElementById(total.getAttribute('aria-describedby')!)?.textContent).toContain('已人工修改')
    expect(view.getByLabelText('单据编号').getAttribute('aria-describedby')).toBeNull()
  })
})
