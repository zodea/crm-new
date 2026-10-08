import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceEditPage from '~/pages/finance/invoice/[id].vue'

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

function mountEditPage(recognized: Record<string, unknown>) {
  const invoice = ref({ id: 'i1', invoiceNumber: 'OLD', invoiceDate: '2026-09-05', seller: '供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '', taxRate: '', projectName: '', remark: '', totalAmount: 113, taxAmount: 13, ownerKind: 'personal', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: 'normal', items: [] })
  let finish!: (success: boolean) => void
  const progress = ref<Record<string, number>>({})
  const kit = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn(), undoToast: vi.fn() }
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
        invoice.value = { ...invoice.value, ...recognized }
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
  vi.stubGlobal('useKitUI', () => kit)
  const view = render(InvoiceEditPage, { global: { components: { InvoiceRecognitionChanges }, stubs: ['InvoicePreviewSvg', 'NuxtLink'] } })
  const recognize = async (success: boolean) => {
    await fireEvent.click(view.getByRole('button', { name: '重新识别' }))
    finish(success)
    await flushPromises()
  }
  return { view, store, kit, recognize }
}

describe('发票编辑页重新识别', () => {
  it.each([
    { label: '识别成功时用识别结果覆盖字段', succeeded: true },
    { label: '识别失败时保留当前输入', succeeded: false },
  ])('$label', async ({ succeeded }) => {
    const { view, store, recognize } = mountEditPage({ invoiceNumber: 'NEW', totalAmount: 226, taxAmount: 26 })
    await recognize(succeeded)
    expect(view.container.querySelector('input')?.value).toBe(succeeded ? 'NEW' : 'OLD')
    await fireEvent.click(view.getByRole('button', { name: '保存', exact: true }))
    expect(store.update).toHaveBeenCalledWith('i1', expect.objectContaining({ invoiceNumber: succeeded ? 'NEW' : 'OLD', totalAmount: succeeded ? 226 : 113 }))
  })

  // 用户 2026-10-08 确认：重识别可以覆盖人工稿，但覆盖后的值与识别前不同时须提醒，并能看到哪些字段有变动。
  it('覆盖了未保存的人工修改时逐项提醒变动，关闭后提醒消失', async () => {
    const { view, kit, recognize } = mountEditPage({ seller: '识别供应商', totalAmount: 226 })
    await fireEvent.update(view.getByDisplayValue('供应商'), '人工更正供应商')
    await recognize(true)

    const changes = view.getByTestId('invoice-recognition-changes')
    expect(changes.textContent).toContain('重新识别覆盖了 2 项与识别前不同的内容')
    expect(changes.textContent).toContain('供应商：人工更正供应商 → 识别供应商')
    expect(changes.textContent).toContain('价税合计：113 → 226')
    expect(kit.success).toHaveBeenCalledWith('识别完成，2 项与识别前不同，请核对')

    await fireEvent.click(view.getByRole('button', { name: '关闭识别变动提醒' }))
    expect(view.queryByTestId('invoice-recognition-changes')).toBeNull()
  })

  it('识别结果与当前值一致时不显示变动提醒', async () => {
    const { view, kit, recognize } = mountEditPage({})
    await recognize(true)
    expect(view.queryByTestId('invoice-recognition-changes')).toBeNull()
    expect(kit.success).toHaveBeenCalledWith('识别完成，字段已刷新')
  })
})
