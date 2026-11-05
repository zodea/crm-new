import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import Candidate from '~/components/invoice/CentralInvoiceWorkspaceScreen.vue'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: () => {} }))
vi.mock('~/composables/useKitUI', () => ({ useKitUI: () => ({ confirm: async () => true, undoToast: () => {} }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

const record: CentralInvoiceRecord = {
  id: 'synthetic-invoice',
  version: '1',
  sourceKind: 'scan',
  fields: { invoiceNumber: 'SYNTHETIC', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' },
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
  original: { id: 'synthetic-original', fileName: '合成.png', fileSize: 1, mimeType: 'image/png', sha256: 'a'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}
const view = defineComponent({
  props: { error: String, originalFile: Object },
  emits: ['retryOriginal', 'review'],
  setup: (props, { emit }) => () => h('div', [
    h('p', { 'data-testid': 'error' }, props.error),
    h('p', { 'data-testid': 'file' }, (props.originalFile as File | null)?.name ?? '无原件'),
    h('button', { 'data-testid': 'retry', 'onClick': () => emit('retryOriginal') }, '重试'),
    h('button', { 'data-testid': 'review', 'onClick': () => emit('review', false) }, '核对'),
  ]),
})
function workspace(verifiedOriginal: () => Promise<Blob>) {
  return { records: shallowRef([record]), readState: shallowRef<'ready' | 'unavailable'>('ready'), loading: shallowRef(false), load: vi.fn(async () => {}), pendingAll: () => [], verifiedOriginal: vi.fn(verifiedOriginal), review: vi.fn(async () => {
    throw new Error('核对命令失败')
  }) }
}

function mounted(source: ReturnType<typeof workspace>) {
  return mount(Candidate, { props: { workspace: source as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }, global: { stubs: { CentralInvoiceWorkspaceView: view, NuxtLink: true } } })
}

it('切换前已发生的旧原件读取错误，不得留在新工作区', async () => {
  const old = workspace(async () => {
    throw new Error('旧工作区原件读取失败')
  })
  const next = workspace(async () => new Blob(['synthetic'], { type: 'image/png' }))
  const source = shallowRef(old)
  const Parent = defineComponent({ setup: () => () => h(Candidate, { workspace: source.value as never, projects: [], suppliers: [], signatories: [], initialSelectedId: record.id }) })
  const wrapper = mount(Parent, { global: { stubs: { CentralInvoiceWorkspaceView: view, NuxtLink: true } } })
  try {
    await vi.waitFor(() => expect(wrapper.find('[data-testid="error"]').text()).toBe('旧工作区原件读取失败'))
    source.value = next
    await nextTick()
    expect(wrapper.findComponent(Candidate).props('workspace') === next).toBe(true)
    await vi.waitFor(() => expect(next.verifiedOriginal).toHaveBeenCalledOnce())
    await flushPromises()
    expect(wrapper.find('[data-testid="file"]').text()).toBe('合成.png')
    expect(wrapper.find('[data-testid="error"]').text()).not.toContain('旧工作区原件读取失败')
  }
  finally { wrapper.unmount() }
})

it('同一来源读取失败时，原件错误仍可见', async () => {
  const source = workspace(async () => {
    throw new Error('当前原件读取失败')
  })
  const wrapper = mounted(source)
  try {
    await vi.waitFor(() => expect(wrapper.find('[data-testid="error"]').text()).toBe('当前原件读取失败'))
    expect(source.verifiedOriginal).toHaveBeenCalledOnce()
  }
  finally { wrapper.unmount() }
})

it('原件读取失败后重试成功，会撤除原件错误并显示原件', async () => {
  const source = workspace(async () => {
    throw new Error('当前原件读取失败')
  })
  // 第一次调用失败，第二次才成功；两次都经过相同原件入口。
  source.verifiedOriginal.mockReset()
  source.verifiedOriginal.mockRejectedValueOnce(new Error('当前原件读取失败')).mockResolvedValueOnce(new Blob(['synthetic'], { type: 'image/png' }))
  const wrapper = mounted(source)
  try {
    await vi.waitFor(() => expect(wrapper.find('[data-testid="error"]').text()).toBe('当前原件读取失败'))
    await wrapper.find('[data-testid="retry"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="file"]').text()).toBe('合成.png'))
    expect(wrapper.find('[data-testid="error"]').text()).toBe('')
    expect(source.verifiedOriginal).toHaveBeenCalledTimes(2)
  }
  finally { wrapper.unmount() }
})

it('原件重新读取和来源状态变化不清除已发生的其他命令错误', async () => {
  const source = workspace(async () => new Blob(['synthetic'], { type: 'image/png' }))
  const wrapper = mounted(source)
  try {
    await vi.waitFor(() => expect(wrapper.find('[data-testid="file"]').text()).toBe('合成.png'))
    await wrapper.find('[data-testid="review"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="error"]').text()).toBe('核对命令失败'))
    await wrapper.find('[data-testid="retry"]').trigger('click')
    await vi.waitFor(() => expect(source.verifiedOriginal).toHaveBeenCalledTimes(2))
    await flushPromises()
    expect(wrapper.find('[data-testid="error"]').text()).toBe('核对命令失败')
    source.readState.value = 'unavailable'
    source.readState.value = 'ready'
    await vi.waitFor(() => expect(source.verifiedOriginal).toHaveBeenCalledTimes(3))
    expect(wrapper.find('[data-testid="error"]').text()).toBe('核对命令失败')
  }
  finally { wrapper.unmount() }
})
