import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import CentralInvoiceWorkspaceScreen from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))
afterEach(cleanup)

const Screen = CentralInvoiceWorkspaceScreen
const record: CentralInvoiceRecord = {
  id: 'invoice-one',
  version: '1',
  sourceKind: 'scan',
  fields: { invoiceNumber: 'SYN-ONE', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
  items: [],
  unrecognizedPageIndexes: [],
  ocrStatus: 'pending',
  completionMethod: null,
  reviewStatus: 'unreviewed',
  accountStatus: 'none',
  duplicateStatus: 'normal',
  printCount: 0,
  printRotation: 0,
  ownerKind: null,
  projectId: null,
  supplierId: null,
  contract: null,
  archivedAt: null,
  original: { id: 'synthetic-original', fileName: '合成.pdf', fileSize: 1, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
const view = defineComponent({
  props: { originalFile: Object, originalLoading: Boolean },
  emits: ['select', 'retryOriginal'],
  setup(props, { emit }) {
    return () => h('div', [
      h('button', { onClick: () => emit('select', record.id) }, '选择合成票'),
      h('button', { onClick: () => emit('retryOriginal') }, '重试原件'),
      h('p', { 'data-testid': 'original-state' }, props.originalLoading ? '读取中' : ((props.originalFile as File | null)?.name ?? '无原件')),
    ])
  },
})
function workspace() {
  return {
    records: shallowRef([record]),
    readState: shallowRef<'ready' | 'loading' | 'unavailable'>('ready'),
    loading: shallowRef(false),
    load: vi.fn(async () => {}),
    pendingAll: () => [],
    verifiedOriginal: vi.fn(async () => new Blob(['x'], { type: 'application/pdf' })),
  }
}
function show(ws: ReturnType<typeof workspace>, initialSelectedId: string | null = null) {
  return render(Screen, {
    props: { workspace: ws as never, projects: [], suppliers: [], signatories: [], initialSelectedId },
    global: { stubs: { CentralInvoiceWorkspaceView: view, NuxtLink: true } },
  })
}

it('已 ready 且挂载加载不改变状态时，预选原件自动核验一次', async () => {
  const ws = workspace()
  show(ws, record.id)
  await waitFor(() => expect(ws.verifiedOriginal).toHaveBeenCalledOnce())
  expect(ws.verifiedOriginal).toHaveBeenCalledWith(expect.objectContaining({ id: record.id, version: record.version, original: record.original }))
  expect(await screen.findByText('合成.pdf')).toBeTruthy()
})

it('挂载加载经过 loading 和 ready 时只核验新的就绪来源一次', async () => {
  const ws = workspace()
  ws.load.mockImplementation(async () => {
    ws.readState.value = 'loading'
    await Promise.resolve()
    ws.readState.value = 'ready'
  })
  show(ws, record.id)
  await waitFor(() => expect(ws.verifiedOriginal).toHaveBeenCalledOnce())
  expect(await screen.findByText('合成.pdf')).toBeTruthy()
})

it('同 tick 失权再恢复时同步撤销旧请求，旧成功不能覆盖新来源', async () => {
  const ws = workspace()
  const old = deferred<Blob>()
  const current = deferred<Blob>()
  ws.verifiedOriginal.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
  show(ws)
  await fireEvent.click(await screen.findByText('选择合成票'))
  await waitFor(() => expect(ws.verifiedOriginal).toHaveBeenCalledTimes(1))
  old.resolve(new Blob(['old']))
  ws.readState.value = 'unavailable'
  ws.readState.value = 'ready'
  expect(ws.verifiedOriginal).toHaveBeenCalledTimes(2)
  await flushPromises()
  expect(screen.getByTestId('original-state').textContent).toBe('读取中')
  current.resolve(new Blob(['new']))
  expect(await screen.findByText('合成.pdf')).toBeTruthy()
})

it.each(['success', 'failure'] as const)('同 ID、同版本更换 workspace 后迟到旧 %s 不影响新来源', async (outcome) => {
  const first = workspace()
  const second = workspace()
  const old = deferred<Blob>()
  const current = deferred<Blob>()
  first.verifiedOriginal.mockImplementation(() => old.promise)
  second.verifiedOriginal.mockImplementation(() => current.promise)
  // VTU setProps 对包含 ref 的初始 props 不能保证替换；改由实际父组件注入新对象。
  const source = shallowRef(first)
  const Parent = defineComponent({ setup: () => () => h(Screen, { workspace: source.value as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }) })
  const wrapper = mount(Parent, { global: { stubs: { CentralInvoiceWorkspaceView: view, NuxtLink: true } } })
  try {
    await waitFor(() => expect(first.verifiedOriginal).toHaveBeenCalledOnce())
    source.value = second
    await nextTick()
    expect(wrapper.findComponent(Screen).props('workspace') === second).toBe(true)
    await waitFor(() => expect(second.verifiedOriginal).toHaveBeenCalledOnce())
    if (outcome === 'success')
      old.resolve(new Blob(['old']))
    else old.reject(new Error('旧工作区敏感失败'))
    await flushPromises()
    expect(wrapper.find('[data-testid="original-state"]').text()).toBe('读取中')
    expect(wrapper.text()).not.toContain('旧工作区敏感失败')
    current.resolve(new Blob(['new']))
    await waitFor(() => expect(wrapper.text()).toContain('合成.pdf'))
  }
  finally {
    wrapper.unmount()
  }
})

it('无原件或来源不可用时不会请求原件', async () => {
  const ws = workspace()
  ws.records.value = [{ ...record, original: null }]
  show(ws, record.id)
  await flushPromises()
  expect(ws.verifiedOriginal).not.toHaveBeenCalled()
  ws.readState.value = 'unavailable'
  await flushPromises()
  expect(ws.verifiedOriginal).not.toHaveBeenCalled()
})

it('卸载后迟到结果不能恢复界面', async () => {
  const ws = workspace()
  const old = deferred<Blob>()
  ws.verifiedOriginal.mockImplementation(() => old.promise)
  const rendered = show(ws, record.id)
  await waitFor(() => expect(ws.verifiedOriginal).toHaveBeenCalledOnce())
  rendered.unmount()
  old.resolve(new Blob(['old']))
  await flushPromises()
  expect(screen.queryByText('合成.pdf')).toBeNull()
})
