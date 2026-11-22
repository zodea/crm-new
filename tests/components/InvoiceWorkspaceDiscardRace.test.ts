import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceQueuePanel from '~/pages/finance/invoice/_components/InvoiceQueuePanel.vue'
import InvoiceReviewForm from '~/pages/finance/invoice/_components/InvoiceReviewForm.vue'
import InvoiceWorkspaceScreen from '~/pages/finance/invoice/_components/InvoiceWorkspaceScreen.vue'

const routeGuard = vi.hoisted(() => ({ current: null as null | (() => boolean | Promise<boolean>) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: (guard: () => boolean | Promise<boolean>) => {
  routeGuard.current = guard
} }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
  routeGuard.current = null
})
afterEach(() => vi.unstubAllGlobals())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function invoice(id: string) {
  return { id, invoiceNumber: id.toUpperCase(), fileName: `${id}.png`, invoiceDate: '2026-01-01', buyer: '合成购买方', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', invoiceType: '', amount: 90, taxAmount: 10, totalAmount: 100, taxRate: '', remark: '', projectId: null, projectName: '', supplierId: null, ownerKind: null, accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: 'normal', source: 'scan', items: [], fieldConfidence: {}, createdAt: '', updatedAt: '' }
}
async function fixture(createDraft = true) {
  const rows = ref([invoice('a'), invoice('b')])
  const recognized = { ...rows.value[0]!, invoiceNumber: 'OCR-A' }
  const recognizeDraft = vi.fn().mockResolvedValueOnce(recognized).mockResolvedValue({ ...recognized, invoiceNumber: 'OCR-SECOND' })
  const store = { get documents() {
    return rows.value.filter(row => row.source === 'scan')
  }, recognitionProgress: {}, pendingRecognition: [], suggestPass: [], pendingReview: [], byId: (id: string) => rows.value.find(row => row.id === id), recognitionFile: () => undefined, recognitionRegions: () => undefined, recognitionError: () => '', recognizeDraft, correctField: vi.fn(), saveRecognitionDraft: vi.fn(), load: vi.fn() }
  const confirm = vi.fn()
  const kit = { confirm, success: vi.fn(), warning: vi.fn(), info: vi.fn(), undoToast: vi.fn(), promise: async <T>(value: Promise<T>) => value }
  let tabGuard: (() => boolean | Promise<boolean>) | undefined
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [], load: vi.fn() }))
  vi.stubGlobal('useKitUI', () => kit)
  vi.stubGlobal('useFileDialog', () => ({ open: vi.fn(), onChange: vi.fn() }))
  vi.stubGlobal('useDropZone', () => ({ isOverDropZone: shallowRef(false) }))
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice' }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: (_key: string, guard: () => boolean | Promise<boolean>) => {
    tabGuard = guard
    return () => {}
  } }))
  const Workbench = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.queue?.(), slots.review?.()]) })
  const view = render(InvoiceWorkspaceScreen, { global: { components: { AdaptiveWorkbench: Workbench, InvoiceQueuePanel, InvoiceReviewForm, InvoiceRecognitionChanges, InvoiceRecognitionFieldMark }, stubs: { InvoiceWorkspaceToolbar: true, InvoiceManualEntryDialog: true, InvoicePrintDocument: true, InvoiceOriginalPanel: true, InvoicePrintLayout: true } } })
  if (createDraft) {
    await fireEvent.click(view.getByRole('button', { name: '重新识别' }))
    await flushPromises()
    expect(view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-A')
    expect(recognizeDraft).toHaveBeenCalledTimes(1)
  }
  if (!tabGuard || !routeGuard.current)
    throw new Error('真实工作台的离开守卫没有注册')
  return { view, store, confirm, tabGuard, routeGuard: routeGuard.current, rows, recognized }
}

type Action = '切票' | '关闭页签' | '路由离开' | '再次识别' | '放弃按钮'
async function begin(f: Awaited<ReturnType<typeof fixture>>, action: Action) {
  const gate = deferred<boolean>()
  f.confirm.mockReturnValueOnce(gate.promise)
  let result: Promise<boolean> | null = null
  if (action === '切票')
    await fireEvent.click(f.view.getByRole('button', { name: '选择发票 B' }))
  else if (action === '关闭页签')
    result = Promise.resolve(f.tabGuard())
  else if (action === '路由离开')
    result = Promise.resolve(f.routeGuard())
  else if (action === '再次识别')
    await fireEvent.click(f.view.getByRole('button', { name: '重新识别' }))
  else
    await fireEvent.click(f.view.getByRole('button', { name: '放弃识别结果' }))
  expect(f.confirm).toHaveBeenCalledTimes(1)
  return { gate, result }
}

describe('旧工作台放弃确认期间草稿变化（真实页面与表单、合成 store/确认）', () => {
  it.each(['切票', '关闭页签', '路由离开', '再次识别', '放弃按钮'] as const)('%s：迟到确认不得批准已改动的草稿', async (action) => {
    const f = await fixture()
    const { gate, result } = await begin(f, action)
    await fireEvent.change(f.view.getByLabelText('单据编号'), { target: { value: '人工修改-A' } })
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', '人工修改-A')
    gate.resolve(true)
    if (result)
      expect(await result).toBe(false)
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', '人工修改-A')
    expect(f.view.getByTestId('invoice-recognition-changes')).toBeTruthy()
    expect(f.store.recognizeDraft).toHaveBeenCalledTimes(1)
    expect(f.store.correctField).not.toHaveBeenCalled()
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })

  it.each(['切票', '关闭页签', '路由离开', '再次识别', '放弃按钮'] as const)('%s：取消确认保留原草稿', async (action) => {
    const f = await fixture()
    const { gate, result } = await begin(f, action)
    gate.resolve(false)
    if (result)
      expect(await result).toBe(false)
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-A')
    expect(f.view.getByTestId('invoice-recognition-changes')).toBeTruthy()
    expect(f.store.recognizeDraft).toHaveBeenCalledTimes(1)
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })

  it.each(['切票', '关闭页签', '路由离开', '再次识别', '放弃按钮'] as const)('%s：原草稿未变化时确认按原流程继续', async (action) => {
    const f = await fixture()
    const { gate, result } = await begin(f, action)
    gate.resolve(true)
    if (result)
      expect(await result).toBe(true)
    await flushPromises()
    const expected = action === '切票' ? 'B' : action === '再次识别' ? 'OCR-SECOND' : 'A'
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', expected)
    expect(f.store.recognizeDraft).toHaveBeenCalledTimes(action === '再次识别' ? 2 : 1)
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })

  it('确认等待期间人工改动后又改回，旧确认仍不授权切票', async () => {
    const f = await fixture()
    const { gate } = await begin(f, '切票')
    await fireEvent.change(f.view.getByLabelText('单据编号'), { target: { value: '人工修改-A' } })
    await fireEvent.change(f.view.getByLabelText('单据编号'), { target: { value: 'OCR-A' } })
    gate.resolve(true)
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-A')
    expect(f.view.getByTestId('invoice-recognition-changes')).toBeTruthy()
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })

  it('同一草稿对象内的识别值原地变化时，旧确认不授权离开', async () => {
    const f = await fixture()
    const { gate, result } = await begin(f, '路由离开')
    f.recognized.invoiceNumber = '外部原地变化'
    gate.resolve(true)
    expect(await result).toBe(false)
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })

  it('等待确认时所选票 A→B→A，旧确认不授权离开', async () => {
    const f = await fixture()
    const { gate, result } = await begin(f, '路由离开')
    f.rows.value = f.rows.value.map(row => row.id === 'a' ? { ...row, source: 'excel' } : row)
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'B')
    f.rows.value = f.rows.value.map(row => ({ ...row, source: row.id === 'a' ? 'scan' : 'excel' }))
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-A')
    gate.resolve(true)
    expect(await result).toBe(false)
    expect(f.view.getByTestId('invoice-recognition-changes')).toBeTruthy()
  })

  it('受控两次识别回包倒序时，旧回包不覆盖已出现的新草稿', async () => {
    const f = await fixture(false)
    const first = deferred<ReturnType<typeof invoice>>()
    const second = deferred<ReturnType<typeof invoice>>()
    f.store.recognizeDraft.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await fireEvent.click(f.view.getByRole('button', { name: '重新识别' }))
    await fireEvent.click(f.view.getByRole('button', { name: '重新识别' }))
    expect(f.store.recognizeDraft).toHaveBeenCalledTimes(2)
    second.resolve({ ...invoice('a'), invoiceNumber: 'OCR-SECOND' })
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-SECOND')
    first.resolve({ ...invoice('a'), invoiceNumber: 'OCR-FIRST' })
    await flushPromises()
    expect(f.view.getByLabelText('单据编号')).toHaveProperty('value', 'OCR-SECOND')
    expect(f.view.getByTestId('invoice-recognition-changes')).toBeTruthy()
    expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  })
})
