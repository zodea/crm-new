import type { PaymentManagementRow } from '~/stores/payment-management'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { storeToRefs } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onActivated, onMounted, onScopeDispose, ref, shallowReactive, shallowRef, toRef, useTemplateRef, watch } from 'vue'
import NotificationDrawer from '~/components/shared/NotificationDrawer.vue'
import InvoiceQueuePanel from '~/pages/finance/invoice/_components/InvoiceQueuePanel.vue'
import InvoiceWorkspaceScreen from '~/pages/finance/invoice/_components/InvoiceWorkspaceScreen.vue'
import PaymentManagementScreen from '~/pages/finance/payment-management/_components/PaymentManagementScreen.vue'
import PaymentManagementTable from '~/pages/finance/payment-management/_components/PaymentManagementTable.vue'

vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: () => undefined }))

vi.mock('~/composables/useOverlayStack', () => ({
  useOwnedOverlayLayerStyle: () => ({ zIndex: 81 }),
  useModalLayerRegistration: () => ({ layerStyle: { zIndex: 80 } }),
}))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, nextTick, onActivated, onMounted, onScopeDispose, shallowReactive, shallowRef, toRef, useTemplateRef, watch, storeToRefs }))
    vi.stubGlobal(name, value)
})

describe('补充列表的同字段多选', () => {
  it('冷回读已无未读但原提交未知时仍有独立恢复入口，不能再发批量新意图', async () => {
    const pending = ref({ commandId: 'notification-original', workspaceId: 'workspace-a', actorId: 'actor-a', action: 'mark-all-read', eventId: null })
    const recoverPending = vi.fn(async () => {
      pending.value = null as never
    })
    const markAllRead = vi.fn()
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
    vi.stubGlobal('useNotificationStore', () => ({ items: ref([]), unreadCount: ref(0), loading: ref(false), error: ref(null), pending, evaluationUnavailable: ref(false), readState: ref({ kind: 'ready' }), markAllRead, recoverPending }))
    render(NotificationDrawer, { props: { open: true } })
    expect(await screen.findByText('消息均已读', { exact: true })).toBeTruthy()
    expect((screen.getByRole('button', { name: '全部标记为已读', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '恢复原已读操作', exact: true }))
    expect(recoverPending).toHaveBeenCalledOnce()
    expect(markAllRead).not.toHaveBeenCalled()
    await nextTick()
    expect(screen.queryByRole('button', { name: '恢复原已读操作', exact: true })).toBeNull()
  })
  it('通知类型取并集并与搜索取交集，切换主视图重置类型，过滤不改变未读', async () => {
    const items = ref([
      { id: 'a', kind: 'todo', type: 'invoice', title: '甲发票', description: '', read: false },
      { id: 'b', kind: 'todo', type: 'payment', title: '甲付款', description: '', read: true },
      { id: 'c', kind: 'todo', type: 'delivery', title: '乙送货', description: '', read: false },
      { id: 'd', kind: 'notice', type: 'cert', title: '证照到期', description: '', read: false },
    ])
    const markAllRead = vi.fn()
    // 此夹具验证演示集合的呈现过滤；来源授权显式提供，过滤仍不调用已读写入。
    vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: true }))
    vi.stubGlobal('useNotificationStore', () => ({ items, unreadCount: ref(3), loading: ref(false), error: ref(null), pending: ref(null), evaluationUnavailable: ref(false), readState: ref({ kind: 'idle' }), markAllRead }))
    render(NotificationDrawer, { props: { open: true } })
    await fireEvent.click(await screen.findByRole('button', { name: '消息类型，已选 0 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '发票校对' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '付款审批' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('甲发票')).toBeTruthy()
    expect(screen.getByText('甲付款')).toBeTruthy()
    await fireEvent.update(screen.getByRole('searchbox'), '发票')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('甲发票')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '消息类型，已选 2 项' }))
    expect(screen.getByRole('checkbox', { name: '送货单识别' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await fireEvent.update(screen.getByRole('searchbox'), '')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await fireEvent.keyDown(screen.getByRole('tab', { name: /通知/ }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: '消息类型，已选 0 项' })).toBeTruthy()
    expect(screen.getByText('证照到期')).toBeTruthy()
    expect(items.value.filter(item => !item.read)).toHaveLength(3)
    expect(markAllRead).not.toHaveBeenCalled()
  })

  it('付款管理保留待支付默认范围，多选并集、搜索交集和清空包含其它付款状态', async () => {
    const rows = ref([
      { id: 'a', name: '甲待付', no: 'A', projectName: '', supplierName: '', bizType: '', dueAmount: 5, paymentStatus: '部分支付' },
      { id: 'b', name: '甲付清', no: 'B', projectName: '', supplierName: '', bizType: '', dueAmount: 0, paymentStatus: '已付清' },
      { id: 'c', name: '乙超付', no: 'C', projectName: '', supplierName: '', bizType: '', dueAmount: 0, paymentStatus: '超额支付' },
    ])
    vi.stubGlobal('usePaymentManagementStore', () => ({ rows, loading: ref(false), hasSnapshot: ref(true), currentRead: ref(true), snapshotOrigin: ref('native'), projectOptions: ref([]), load: vi.fn() }))
    const Table = defineComponent({ props: ['rows'], setup: props => () => h('section', props.rows.map((row: { name: string }) => h('article', row.name))) })
    const Toolbar = defineComponent({ props: ['search'], emits: ['update:search'], setup: (_, { emit }) => () => h('input', { type: 'search', onInput: (event: Event) => emit('update:search', (event.target as HTMLInputElement).value) }) })
    render(PaymentManagementScreen, { global: { stubs: { PaymentManagementTable: Table, PaymentManagementToolbar: Toolbar, PaymentManagementSummary: true, PaymentPayrollSection: true, SegTab: true } } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('甲待付')).toBeTruthy()
    expect(screen.getByText('甲待付').closest('[data-list-shell]')?.classList.contains('list-shell--continuous')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '付款状态，已选 1 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '已付清' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('甲待付')).toBeTruthy()
    expect(screen.getByText('甲付清')).toBeTruthy()
    await fireEvent.update(screen.getByRole('searchbox'), '待付')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('甲待付')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '付款状态，已选 2 项' }))
    expect(screen.getByRole('checkbox', { name: '已付清' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await fireEvent.update(screen.getByRole('searchbox'), '')
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('付款标签保留超额与部分回票的语义，批复历史未知与明确零分开显示', () => {
    const unknown: PaymentManagementRow = { id: 'unknown', no: 'A', name: '历史批复', projectId: null, projectName: '', supplierId: null, workerId: null, supplierName: '', bizType: '', approvedAmount: null, approvedAmountState: 'legacy-unknown', paidAmount: 0, dueAmount: null, paymentStatus: '历史批复待核验', invoiceState: '', invoiceStatus: '部分回票', pendingInvoiceAmount: null, applyDate: '2026-10-01', canRegisterPayment: false }
    const zero: PaymentManagementRow = { ...unknown, id: 'zero', no: 'B', name: '已录入零', approvedAmount: 0, approvedAmountState: 'known', dueAmount: 0, paymentStatus: '已付清', invoiceStatus: '已回票' }
    const overflow: PaymentManagementRow = { ...zero, id: 'overflow', no: 'C', name: '支付超过批复', approvedAmount: 5, paidAmount: 10, paymentStatus: '超额支付' }
    const Table = defineComponent({ props: ['data'], template: '<article v-for="row in data" :key="row.id" :aria-label="row.name"><slot name="approved" :row="row"/><slot name="due" :row="row"/><slot name="invoiceStatus" :row="row"/><slot name="paymentStatus" :row="row"/></article>' })
    render(PaymentManagementTable, { props: { rows: [unknown, zero, overflow], loading: false, page: 1, pageSize: 10, total: 3 }, global: { stubs: { KitTable: Table } } })
    const historical = within(screen.getByRole('article', { name: unknown.name }))
    expect(screen.getByText('超额支付').getAttribute('data-tone')).toBe('danger')
    expect(historical.getByText('部分回票').getAttribute('data-tone')).toBe('brand')
    const historicalApproval = historical.getAllByText('历史批复待核验')
    expect(historicalApproval).toHaveLength(2)
    expect(historicalApproval.some(item => item.getAttribute('data-tone') === 'warn')).toBe(true)
    expect(historical.getAllByText('—')).toHaveLength(2)
    const explicit = within(screen.getByRole('article', { name: zero.name }))
    expect(explicit.getByText('已付清').getAttribute('data-tone')).toBe('ok')
    expect(explicit.getAllByText('¥0.00')).toHaveLength(2)
  })

  it('识别队列按既有状态判定多选，不改变归档边界，搜索和选择仍联动', async () => {
    const documents = [
      { id: 'a', invoiceNumber: 'A', fileName: '甲识别', accountStatus: 'none', ocrStatus: 'pending', reviewStatus: 'unreviewed', dupStatus: '', fieldConfidence: {} },
      { id: 'b', invoiceNumber: 'B', fileName: '乙建议', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: '', fieldConfidence: { amount: 1 } },
      { id: 'c', invoiceNumber: 'C', fileName: '丙校对', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: '', fieldConfidence: { amount: 0.1 } },
      { id: 'd', invoiceNumber: 'D', fileName: '已归档', accountStatus: 'archived', ocrStatus: 'done', reviewStatus: 'reviewed', dupStatus: '', fieldConfidence: { amount: 1 } },
    ]
    vi.stubGlobal('useInvoiceStore', () => ({ documents, recognitionProgress: { a: 40 }, pendingRecognition: [], suggestPass: [], pendingReview: [], byId: (id: string) => documents.find(item => item.id === id), load: vi.fn() }))
    vi.stubGlobal('useProjectStore', () => ({ list: [], load: vi.fn() }))
    vi.stubGlobal('useKitUI', () => ({}))
    vi.stubGlobal('useFileDialog', () => ({ open: vi.fn(), onChange: vi.fn() }))
    vi.stubGlobal('useDropZone', () => ({ isOverDropZone: ref(false) }))
    vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice' }))
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
    const Workbench = defineComponent({ setup: (_, { slots }) => () => h('div', slots.queue?.()) })
    render(InvoiceWorkspaceScreen, { global: { components: { InvoiceQueuePanel, AdaptiveWorkbench: Workbench }, stubs: { InvoiceWorkspaceToolbar: true, InvoiceManualEntryDialog: true, InvoicePrintDocument: true, InvoiceOriginalPanel: true, InvoicePrintLayout: true, InvoiceReviewForm: true } } })
    const queueRows = () => screen.getAllByRole('button', { name: /^选择发票 / })
    expect(queueRows()).toHaveLength(3)
    await fireEvent.click(screen.getByRole('button', { name: '筛选识别队列，已选 0 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '识别中' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '建议通过' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(queueRows()).toHaveLength(2)
    await fireEvent.update(screen.getByRole('searchbox'), '乙')
    expect(queueRows()).toHaveLength(1)
    expect(queueRows()[0]?.textContent).toContain('建议通过')
    await fireEvent.click(screen.getByRole('button', { name: '筛选识别队列，已选 2 项' }))
    expect(screen.getByRole('checkbox', { name: '含低置信' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await fireEvent.update(screen.getByRole('searchbox'), '')
    expect(queueRows()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '选择发票 D' })).toBeNull()
  })
})
