import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'
import InvoiceOriginalMissing from '~/components/invoice/InvoiceOriginalMissing.vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'
import InvoiceEditPage from '~/pages/finance/invoice/[id].vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, onMounted, ref, shallowRef, watch }))
    vi.stubGlobal(name, value)
})
afterEach(() => vi.unstubAllGlobals())

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function invoice(id: string, number: string) {
  return { id, invoiceNumber: number, invoiceDate: '2026-09-05', seller: '合成供应商', buyer: '', buyerTaxNo: '', sellerTaxNo: '', invoiceType: '', taxRate: '', projectName: '', remark: '', totalAmount: 113, taxAmount: 13, ownerKind: 'personal', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'reviewed', dupStatus: 'normal', items: [] }
}

function setup(initial = [] as ReturnType<typeof invoice>[]) {
  const route = reactive({ fullPath: '/finance/invoice/a', params: { id: 'a' } })
  const rows = ref(initial)
  const loading = ref(false)
  const queued: Array<ReturnType<typeof deferred<ReturnType<typeof invoice>[]>>> = []
  const load = vi.fn(async () => {
    loading.value = true
    const next = deferred<ReturnType<typeof invoice>[]>()
    queued.push(next)
    try {
      rows.value = await next.promise
    }
    finally { loading.value = false }
  })
  const store = {
    get list() { return rows.value },
    get loading() { return loading.value },
    byId: (id: string) => rows.value.find(row => row.id === id),
    load,
    recognitionProgress: {},
    recognitionError: () => '',
    recognitionFile: () => undefined,
    recognitionRegions: () => undefined,
    recognizeDraft: vi.fn(async () => ({ ...invoice('b', 'OCR-B') })),
    update: vi.fn(),
  }
  const confirm = vi.fn().mockResolvedValue(false)
  const guards: Array<() => boolean | Promise<boolean>> = []
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [] }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: (_key: string, guard: () => boolean | Promise<boolean>) => {
    guards.push(guard)
    return () => {}
  } }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm, undoToast: vi.fn() }))
  const view = render(InvoiceEditPage, { global: { components: { InvoiceOriginalMissing, InvoiceRecognitionChanges, InvoiceRecognitionFieldMark, InvoiceRegionViewer }, stubs: ['NuxtLink'] } })
  return { view, route, rows, queued, load, guards, confirm, store }
}

describe('旧发票单页的真实读取状态（合成内存 store）', () => {
  it('首次渲染未发请求时显示准备读取，不能虚称正在读取或不可用', async () => {
    const load = vi.fn()
    const store = { list: [], byId: () => undefined, load, recognitionProgress: {}, recognitionFile: () => undefined, recognitionRegions: () => undefined }
    vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice/a', params: { id: 'a' } }))
    vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
    vi.stubGlobal('useInvoiceStore', () => store)
    vi.stubGlobal('useProjectStore', () => ({ list: [] }))
    vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: vi.fn(), undoToast: vi.fn() }))
    const html = await renderToString(createSSRApp(InvoiceEditPage))
    expect(html).toContain('准备读取发票')
    expect(html).not.toContain('正在读取发票')
    expect(html).not.toContain('暂不可用')
    expect(load).not.toHaveBeenCalled()
  })

  it('空列表读取尚未完成时不误报不存在，完成后显示旧票', async () => {
    const f = setup()
    expect(f.load).toHaveBeenCalledTimes(1)
    await flushPromises()
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/正在读取/)
    f.queued[0]!.resolve([invoice('a', 'OLD-A')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OLD-A')
  })

  it('读取失败显示可重试缺口，重试成功后显示旧票', async () => {
    const f = setup()
    f.queued[0]!.reject(new Error('合成读取失败'))
    await flushPromises()
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/读取.*失败|暂不可用/)
    await fireEvent.click(screen.getByRole('button', { name: /重新读取|重试/ }))
    expect(f.load).toHaveBeenCalledTimes(2)
    f.queued[1]!.resolve([invoice('a', 'OLD-A')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OLD-A')
  })

  it('非空旧列表未包含目标时仍应读取，而不是断言不存在', async () => {
    const f = setup([invoice('b', 'OLD-B')])
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
    f.queued[0]!.resolve([invoice('a', 'OLD-A'), invoice('b', 'OLD-B')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OLD-A')
  })

  it('完成有效读取且确实没有目标时才显示不存在', async () => {
    const f = setup()
    f.queued[0]!.resolve([invoice('b', 'OLD-B')])
    await flushPromises()
    expect(screen.getByText('该发票不存在或已删除。')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('目标已显示时不自动重读，不覆盖手工输入', async () => {
    const f = setup([invoice('a', 'OLD-A')])
    expect(f.load).not.toHaveBeenCalled()
    await fireEvent.update(screen.getByLabelText('单据编号'), '未保存-A')
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', '未保存-A')
    expect(f.store.update).not.toHaveBeenCalled()
  })

  it('已显示目标消失且未发请求时，提示暂不可用而非正在读取', async () => {
    const f = setup([invoice('a', 'OLD-A')])
    f.rows.value = []
    await flushPromises()
    expect(f.load).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/暂不可用/)
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
    expect(screen.getByRole('button', { name: '返回台账' })).toBeTruthy()
  })

  it('同一实例目标变成缺失 ID 且未发请求时，不虚报读取中或不存在', async () => {
    const f = setup([invoice('a', 'OLD-A')])
    f.route.params.id = 'b'
    f.route.fullPath = '/finance/invoice/b'
    await flushPromises()
    expect(f.load).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/暂不可用/)
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
  })

  it('读取失败后列表出现目标，仍须明确重试读取才能显示', async () => {
    const f = setup()
    f.queued[0]!.reject(new Error('合成读取失败'))
    await flushPromises()
    expect(screen.getByRole('alert')).toBeTruthy()
    f.rows.value = [invoice('a', 'OLD-A')]
    await flushPromises()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByLabelText('单据编号')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    f.queued[1]!.resolve([invoice('a', 'OLD-A')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OLD-A')
  })

  it('可靠读取无票后列表出现目标，不把过期空结果或未知来源当真', async () => {
    const f = setup()
    f.queued[0]!.resolve([])
    await flushPromises()
    expect(screen.getByText('该发票不存在或已删除。')).toBeTruthy()
    f.rows.value = [invoice('a', 'OLD-A')]
    await flushPromises()
    expect(screen.queryByText('该发票不存在或已删除。')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/暂不可用/)
    expect(screen.queryByLabelText('单据编号')).toBeNull()
  })

  it('页面卸载后读取失败被处理，不写入页面或执行保存', async () => {
    const f = setup()
    f.view.unmount()
    f.queued[0]!.reject(new Error('合成迟到读取失败'))
    await flushPromises()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(f.store.update).not.toHaveBeenCalled()
  })

  it('原票读取迟到时不得覆盖已切至另一票的手工输入', async () => {
    const f = setup()
    f.rows.value = [invoice('b', 'OLD-B')]
    f.route.params.id = 'b'
    f.route.fullPath = '/finance/invoice/b'
    await flushPromises()
    await fireEvent.update(screen.getByLabelText('单据编号'), '未保存-B')
    f.queued[0]!.resolve([invoice('a', 'OLD-A'), invoice('b', 'OLD-B')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', '未保存-B')
    expect(f.store.update).not.toHaveBeenCalled()
  })

  it('旧读取迟到不得擦去新票的重识别草稿或放弃保护', async () => {
    const f = setup()
    f.rows.value = [invoice('b', 'OLD-B')]
    f.route.params.id = 'b'
    f.route.fullPath = '/finance/invoice/b'
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '重新识别' }))
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-B')
    expect(await f.guards[0]!()).toBe(false)
    f.queued[0]!.resolve([invoice('a', 'OLD-A'), invoice('b', 'OLD-B')])
    await flushPromises()
    expect(screen.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-B')
    expect(await f.guards[0]!()).toBe(false)
    expect(f.store.update).not.toHaveBeenCalled()
  })
})
