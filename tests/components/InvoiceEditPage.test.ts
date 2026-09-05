import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import InvoiceEditPage from '~/pages/finance/invoice/[id].vue'

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

describe('发票编辑页重新识别', () => {
  it.each([true, false])('识别结果为 %s 时仅成功更新字段，失败保留输入', async (succeeded) => {
    const invoice = ref({ id: 'i1', invoiceNumber: 'OLD', invoiceDate: '2026-09-05', seller: '供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '', taxRate: '', projectName: '', remark: '', totalAmount: 113, taxAmount: 13, ownerKind: 'personal', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: 'normal', items: [] })
    let finish!: (success: boolean) => void
    const progress = ref<Record<string, number>>({})
    const store = {
      list: [invoice.value],
      byId: () => invoice.value,
      get recognitionProgress() { return progress.value },
      recognitionError: () => '识别失败',
      startRecognition: vi.fn(async () => {
        progress.value.i1 = 0
        const success = await new Promise<boolean>((resolve) => {
          finish = resolve
        })
        if (success)
          invoice.value = { ...invoice.value, invoiceNumber: 'NEW', totalAmount: 226, taxAmount: 26 }
        delete progress.value.i1
        return success
      }),
      update: vi.fn().mockResolvedValue('saved'),
    }
    vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice/i1', params: { id: 'i1' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useInvoiceStore', () => store)
    vi.stubGlobal('useProjectStore', () => ({ list: [] }))
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn(), undoToast: vi.fn() }))
    const view = render(InvoiceEditPage, { global: { stubs: ['InvoicePreviewSvg', 'NuxtLink'] } })
    await fireEvent.click(view.getByRole('button', { name: '重新识别' }))
    finish(succeeded)
    await flushPromises()
    expect(view.container.querySelector('input')?.value).toBe(succeeded ? 'NEW' : 'OLD')
    await fireEvent.click(view.getByRole('button', { name: '保存', exact: true }))
    expect(store.update).toHaveBeenCalledWith('i1', expect.objectContaining({ invoiceNumber: succeeded ? 'NEW' : 'OLD', totalAmount: succeeded ? 226 : 113 }))
  })
})
