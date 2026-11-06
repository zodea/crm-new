import { fireEvent, render } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
import InvoiceOriginalPanel from '~/components/invoice/InvoiceOriginalPanel.vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'
import InvoiceWorkspaceScreen from '~/components/invoice/InvoiceWorkspaceScreen.vue'

const group = { id: 'invoice-number', pageIndex: 0, box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, keys: ['invoiceNumber'], labels: ['单据编号'] }
const invoice = { id: 'synthetic-invoice', invoiceNumber: '001', fileName: '合成.png', buyer: '合成购买方', seller: '合成销售方', accountStatus: 'none', ocrStatus: 'done', reviewStatus: 'unreviewed', dupStatus: '', fieldConfidence: {} }
const file = new File(['synthetic'], '合成.png', { type: 'image/png' })

beforeEach(() => {
  let next = 0
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:image-${next++}`), revokeObjectURL: vi.fn() })
  for (const [name, value] of Object.entries({ computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch }))
    vi.stubGlobal(name, value)
})

async function decode(image: HTMLElement) {
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 600 } })
  await fireEvent.load(image)
}

it('旧工作台真实原件面板收到字段定位后，图片解码前不声明已定位，解码后才显示真实区域', async () => {
  vi.stubGlobal('useInvoiceStore', () => ({ documents: [invoice], recognitionProgress: {}, pendingRecognition: [], suggestPass: [], pendingReview: [], byId: () => invoice, recognitionFile: () => file, recognitionRegions: () => ({ invoiceNumber: { pageIndex: 0, box: group.box, blockLabel: 'text' } }), load: vi.fn() }))
  vi.stubGlobal('useProjectStore', () => ({ list: [], load: vi.fn() }))
  vi.stubGlobal('useKitUI', () => ({}))
  vi.stubGlobal('useFileDialog', () => ({ open: vi.fn(), onChange: vi.fn() }))
  vi.stubGlobal('useDropZone', () => ({ isOverDropZone: shallowRef(false) }))
  vi.stubGlobal('useRoute', () => ({ fullPath: '/finance/invoice' }))
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  const Workbench = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.source?.(), slots.review?.()]) })
  const Review = defineComponent({ emits: ['locate'], setup: (_, { emit }) => () => h('button', { onClick: () => emit('locate', 'invoiceNumber') }, '定位票号') })
  const view = render(InvoiceWorkspaceScreen, { global: { components: { AdaptiveWorkbench: Workbench, InvoiceOriginalPanel, InvoiceRegionViewer, InvoiceReviewForm: Review }, stubs: { InvoiceWorkspaceToolbar: true, InvoiceManualEntryDialog: true, InvoicePrintDocument: true, InvoicePrintLayout: true, InvoiceRecognitionChanges: true } } })
  const image = view.getByRole('img', { name: '合成.png' })
  await fireEvent.click(view.getByRole('button', { name: '定位票号' }))
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  expect(view.getByTestId('invoice-region-legend').textContent).not.toContain('已定位：单据编号')
  await decode(image)
  expect(view.getByTestId('invoice-region-box').dataset.active).toBe('true')
  expect(view.getByTestId('invoice-region-legend').textContent).toContain('已定位：单据编号')
})

it('无几何帧图片解码前不发布已验证页，失败后不发布，重试解码成功才定位', async () => {
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'invoiceNumber' } })
  await nextTick()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  await fireEvent.error(view.getByRole('img', { name: '合成.png' }))
  expect(view.getByRole('alert').textContent).toContain('图片无法显示')
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  await decode(view.getByRole('img', { name: '合成.png' }))
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
})

it('切换文件时旧图迟到解码不能验证新图', async () => {
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'invoiceNumber' } })
  const oldImage = view.getByRole('img', { name: '合成.png' })
  const replacement = new File(['other'], '新合成.png', { type: 'image/png' })
  await view.rerender({ file: replacement })
  await decode(oldImage)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  await decode(view.getByRole('img', { name: '新合成.png' }))
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
  await fireEvent.error(oldImage)
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
})

it('load 事件后自然尺寸仍为零时不能证明图片已定位', async () => {
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'invoiceNumber' } })
  const image = view.getByRole('img', { name: '合成.png' })
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 0 }, naturalHeight: { configurable: true, value: 0 } })
  await fireEvent.load(image)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  expect(view.getByTestId('invoice-region-legend').textContent).not.toContain('已定位：单据编号')
  await decode(image)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
})

it('切换文件后旧图迟到错误不能污染新图或阻止新图解码定位', async () => {
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'invoiceNumber' } })
  const oldImage = view.getByRole('img', { name: '合成.png' })
  const replacement = new File(['other'], '新合成.png', { type: 'image/png' })
  await view.rerender({ file: replacement })
  await fireEvent.error(oldImage)
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  await decode(view.getByRole('img', { name: '新合成.png' }))
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
})

it('解码成功也不放宽明确传入空几何帧的中央校验', async () => {
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'invoiceNumber', frames: [] } })
  await decode(view.getByRole('img', { name: '合成.png' }))
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  expect(view.getByTestId('invoice-region-legend').textContent).not.toContain('已定位：单据编号')
})
