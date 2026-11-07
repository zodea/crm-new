import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import InvoiceEditPage from '~/pages/finance/invoice/[id].vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

it('旧票读取失败后可键盘重试，真实缺失只在读取完成后提示', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  let reject!: (reason: Error) => void
  let finish!: () => void
  const first = new Promise<void>((_resolve, fail) => {
    reject = fail
  })
  const second = new Promise<void>((resolve) => {
    finish = resolve
  })
  const load = vi.fn().mockImplementationOnce(() => first).mockImplementationOnce(() => second)
  const store = { list: [], byId: () => undefined, load, recognitionProgress: {}, recognitionFile: () => undefined, recognitionRegions: () => undefined }
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice/a', params: { id: 'a' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [] }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn(), undoToast: vi.fn() }))
  await render(InvoiceEditPage, { global: { stubs: { NuxtLink: true } } })
  await expect.element(page.getByRole('status')).toHaveTextContent('正在读取发票')
  expect(document.body.textContent).not.toContain('该发票不存在或已删除。')
  reject(new Error('合成读取失败'))
  await expect.element(page.getByRole('alert')).toHaveTextContent('发票读取失败')
  const retry = page.getByRole('button', { name: '重新读取' })
  retry.element().focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('status')).toHaveTextContent('正在读取发票')
  expect(load).toHaveBeenCalledTimes(2)
  finish()
  await expect.element(page.getByText('该发票不存在或已删除。')).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
})

it('旧票消失但没有读取请求时显示暂不可用', async () => {
  const invoice = { id: 'a', invoiceNumber: 'OLD-A', invoiceDate: '2026-09-05', seller: '旧供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '', taxRate: '', projectName: '', remark: '', totalAmount: 113, taxAmount: 13, ownerKind: 'personal', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'reviewed', dupStatus: 'normal', items: [] }
  const rows = ref([invoice])
  const store = {
    get list() { return rows.value },
    byId: (id: string) => rows.value.find(row => row.id === id),
    load: vi.fn(),
    recognitionProgress: {},
    recognitionFile: () => undefined,
    recognitionRegions: () => undefined,
  }
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice/a', params: { id: 'a' } }))
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [] }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn(), undoToast: vi.fn() }))
  await render(InvoiceEditPage, { global: { stubs: { NuxtLink: true, InvoiceOriginalMissing: true, InvoiceRecognitionChanges: true, InvoiceRecognitionFieldMark: true, InvoiceRegionViewer: true } } })
  rows.value = []
  await expect.element(page.getByRole('status')).toHaveTextContent('暂不可用')
  expect(store.load).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain('正在读取发票')
  expect(document.body.textContent).not.toContain('该发票不存在或已删除。')
  await expect.element(page.getByRole('button', { name: '返回台账' })).toBeVisible()
})
