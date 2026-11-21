import { fireEvent, render } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceReviewForm from '~/pages/finance/invoice/_components/InvoiceReviewForm.vue'

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

  it('聚焦/悬停有识别标记的字段时通知父级在原图强调，角标读屏说明是否在原图框出', async () => {
    const view = mount({ draft: true, marks: { seller: { mark: 'recognized', before: '原供应商' }, totalAmount: { mark: 'recognized', before: '113' } }, locatedKeys: ['seller'] })
    const seller = view.getByLabelText('供应商')
    await fireEvent.focus(seller)
    await fireEvent.mouseEnter(view.getByLabelText('价税合计'))
    await fireEvent.mouseLeave(view.getByLabelText('价税合计'))
    await fireEvent.focus(view.getByLabelText('单据编号'))
    expect(view.emitted('locate')).toEqual([['seller']])
    expect(view.emitted('preview')).toEqual([['totalAmount'], [null]])
    expect(document.getElementById(seller.getAttribute('aria-describedby')!)?.textContent).toContain('原图已框出')
    const total = view.getByLabelText('价税合计')
    expect(document.getElementById(total.getAttribute('aria-describedby')!)?.textContent).toContain('原图未定位')
  })

  // 用户 2026-10-14 确认：首次识别也能点字段定位原图；离开焦点即撤框，定位不到在读屏中说明。
  it('首次识别点字段定位：聚焦/悬停任一识别字段都通知父级，失焦撤回；定位不到的字段读屏说明“原图未定位”', async () => {
    const view = mount({ focusLocatedKeys: ['invoiceNumber', 'totalAmount'] })
    const number = view.getByLabelText('单据编号')
    const seller = view.getByLabelText('供应商')
    await fireEvent.focus(number)
    await fireEvent.blur(number)
    await fireEvent.focus(seller)
    await fireEvent.mouseEnter(view.getByLabelText('价税合计'))
    await fireEvent.mouseLeave(view.getByLabelText('价税合计'))
    // 对应项目不是识别字段，不参与定位
    await fireEvent.focus(view.getByLabelText('对应项目'))
    expect(view.emitted('locate')).toEqual([['invoiceNumber'], ['seller']])
    expect(view.emitted('release')).toEqual([['invoiceNumber']])
    expect(view.emitted('preview')).toEqual([['totalAmount'], [null]])

    expect(number.getAttribute('aria-describedby')).toBeNull()
    expect(document.getElementById(seller.getAttribute('aria-describedby')!)?.textContent).toBe('原图未定位')
    expect(view.queryAllByTestId('invoice-recognition-field-mark')).toHaveLength(0)
  })

  it('没有点字段定位时（原文件不在会话中）聚焦字段不通知父级', async () => {
    const view = mount({})
    await fireEvent.focus(view.getByLabelText('单据编号'))
    await fireEvent.blur(view.getByLabelText('单据编号'))
    expect(view.emitted('locate')).toBeUndefined()
    expect(view.emitted('release')).toBeUndefined()
  })
})
