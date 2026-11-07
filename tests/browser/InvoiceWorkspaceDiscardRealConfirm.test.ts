import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
import InvoiceQueuePanel from '~/components/invoice/InvoiceQueuePanel.vue'
import InvoiceRecognitionChanges from '~/components/invoice/InvoiceRecognitionChanges.vue'
import InvoiceRecognitionFieldMark from '~/components/invoice/InvoiceRecognitionFieldMark.vue'
import InvoiceReviewForm from '~/components/invoice/InvoiceReviewForm.vue'
import InvoiceWorkspaceScreen from '~/components/invoice/InvoiceWorkspaceScreen.vue'
import ConfirmDialog from '~/components/shared/ConfirmDialog.vue'
import KitUIHost from '~/components/shared/KitUIHost.vue'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import { confirm, useKitUIHostState } from '~/composables/useKitUI'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }))

beforeEach(() => {
  for (const [name, value] of Object.entries({ computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch, useKitUIHostState }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useEventListener', vi.fn())
})
afterEach(() => {
  useKitUIHostState().resolveConfirm(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function invoice(id: string) {
  return { id, invoiceNumber: id.toUpperCase(), fileName: `${id}.png`, invoiceDate: '2026-01-01', buyer: '合成购买方', buyerTaxNo: '', seller: '合成销售方', sellerTaxNo: '', invoiceType: '', amount: 90, taxAmount: 10, totalAmount: 100, taxRate: '', remark: '', projectId: null, projectName: '', supplierId: null, ownerKind: null, accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: 'normal', source: 'scan', items: [], fieldConfidence: {}, createdAt: '', updatedAt: '' }
}

async function fixture() {
  const rows = ref([invoice('a'), invoice('b')])
  const recognized = { ...rows.value[0]!, invoiceNumber: 'OCR-A' }
  const store = {
    get documents() { return rows.value.filter(row => row.source === 'scan') },
    recognitionProgress: {},
    pendingRecognition: [],
    suggestPass: [],
    pendingReview: [],
    byId: (id: string) => rows.value.find(row => row.id === id),
    recognitionFile: () => undefined,
    recognitionRegions: () => undefined,
    recognitionError: () => '',
    recognizeDraft: vi.fn().mockResolvedValue(recognized),
    correctField: vi.fn(),
    saveRecognitionDraft: vi.fn(),
    load: vi.fn(),
  }
  vi.stubGlobal('useInvoiceStore', () => store)
  vi.stubGlobal('useProjectStore', () => ({ list: [], load: vi.fn() }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), info: vi.fn(), undoToast: vi.fn(), promise: async <T>(value: Promise<T>) => value }))
  vi.stubGlobal('useFileDialog', () => ({ open: vi.fn(), onChange: vi.fn() }))
  vi.stubGlobal('useDropZone', () => ({ isOverDropZone: shallowRef(false) }))
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice' }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  const workbench = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.queue?.(), slots.review?.()]) })
  const host = defineComponent({ setup: () => () => h('div', [h(InvoiceWorkspaceScreen), h(KitUIHost)]) })
  await render(host, { global: {
    components: { AdaptiveWorkbench: workbench, InvoiceQueuePanel, InvoiceReviewForm, InvoiceRecognitionChanges, InvoiceRecognitionFieldMark, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle },
    stubs: { InvoiceWorkspaceToolbar: true, InvoiceManualEntryDialog: true, InvoicePrintDocument: true, InvoiceOriginalPanel: true, InvoicePrintLayout: true, ToastHost: true, KitFormModal: true, KitTypeSelectDialog: true },
  } })
  const recognition = page.getByRole('button', { name: '重新识别' })
  recognition.element().focus()
  await expect.element(recognition).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByLabelText('单据编号')).toHaveValue('OCR-A')
  return { recognized, store }
}

async function openSwitchConfirmation() {
  const trigger = page.getByRole('button', { name: '选择发票 B' })
  trigger.element().focus()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog', { name: '放弃识别结果' })
  await expect.element(dialog).toBeVisible()
  await expect.element(page.getByRole('button', { name: '取消' })).toHaveFocus()
  return { trigger, dialog }
}

it('真实确认弹窗支持键盘取消、焦点返回及确认切票', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const f = await fixture()
  const { trigger, dialog } = await openSwitchConfirmation()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(page.getByLabelText('单据编号')).toHaveValue('OCR-A')
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).toBeVisible()
  await expect.element(page.getByRole('button', { name: '取消' })).toHaveFocus()
  const accept = page.getByRole('button', { name: '放弃识别结果' })
  accept.element().focus()
  await expect.element(accept).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByLabelText('单据编号')).toHaveValue('B')
  expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  expect(f.store.correctField).not.toHaveBeenCalled()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it('真实确认弹窗等待时受控异步草稿变化不会授权切票', async () => {
  const f = await fixture()
  const { dialog } = await openSwitchConfirmation()
  // 合成异步来源原地改变识别结果；不向被模态对话框遮挡的背景发送用户事件。
  await Promise.resolve().then(() => {
    f.recognized.invoiceNumber = '外部异步变化'
  })
  const accept = page.getByRole('button', { name: '放弃识别结果' })
  accept.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByText(/重新识别结果未保存/)).toBeVisible()
  await expect.element(page.getByLabelText('单据编号')).not.toHaveValue('B')
  expect(f.store.saveRecognitionDraft).not.toHaveBeenCalled()
  expect(f.store.correctField).not.toHaveBeenCalled()
})
