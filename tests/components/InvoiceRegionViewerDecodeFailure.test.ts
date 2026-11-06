import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'

const pdf = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('~/lib/invoice/pdf-preview', () => ({ renderPdfPreviewPages: pdf.render }))

beforeEach(() => {
  pdf.render.mockReset()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:synthetic-image'), revokeObjectURL: vi.fn() })
})

async function loadSyntheticImage(image: HTMLElement, width = 1000, height = 700) {
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } })
  await fireEvent.load(image)
}

it('pdf 页图实际尺寸与渲染声明不一致时提示缺口且不得定位', async () => {
  const file = new File(['synthetic'], '尺寸不符.pdf', { type: 'application/pdf' })
  const group = { id: 'buyer', pageIndex: 0, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: ['buyer'], labels: ['购买方'] }
  pdf.render.mockResolvedValue({ pages: [{ pageIndex: 0, url: 'blob:wrong-size', width: 10, height: 10 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'buyer' } })
  await flushPromises()
  await loadSyntheticImage(view.getByRole('img', { name: '尺寸不符.pdf' }))
  expect(view.getByRole('alert').textContent).toContain('尺寸')
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.getByRole('button', { name: '重新加载原图' })).toBeTruthy()
})

it('多页 pdf 只有页图完成加载后才发布该页定位', async () => {
  const file = new File(['synthetic'], '两页.pdf', { type: 'application/pdf' })
  const groups = [0, 1].map(pageIndex => ({ id: `p${pageIndex}`, pageIndex, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: [`field${pageIndex}`], labels: [`字段${pageIndex}`] }))
  pdf.render.mockResolvedValue({ pages: groups.map(({ pageIndex }) => ({ pageIndex, url: `blob:page-${pageIndex}`, width: 1000, height: 700 })), totalPages: 2 })
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'compare', groups } })
  await flushPromises()
  expect(view.queryAllByTestId('invoice-region-box')).toHaveLength(0)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  await loadSyntheticImage(view.getByRole('img', { name: '两页.pdf 第 1 页' }))
  expect(view.getAllByTestId('invoice-region-box')).toHaveLength(1)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0]])
  await loadSyntheticImage(view.getByRole('img', { name: '两页.pdf 第 2 页' }))
  expect(view.getAllByTestId('invoice-region-box')).toHaveLength(2)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[0, 1]])
})

it('pdf 页图解码失败时显示错误和重试，并撤销失效页定位', async () => {
  const file = new File(['synthetic'], '合成.pdf', { type: 'application/pdf' })
  const group = { id: 'buyer', pageIndex: 0, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: ['buyer'], labels: ['购买方'] }
  pdf.render.mockResolvedValue({ pages: [{ pageIndex: 0, url: 'blob:synthetic-page', width: 1000, height: 700 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups: [group], activeKey: 'buyer' } })
  await flushPromises()
  await loadSyntheticImage(view.getByRole('img', { name: '合成.pdf' }))
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
  await fireEvent.error(view.getByRole('img', { name: '合成.pdf' }))
  expect(view.getByRole('alert').textContent).toContain('PDF')
  expect(view.getByRole('button', { name: '重新加载原图' })).toBeTruthy()
  expect(view.queryByTestId('invoice-region-box')).toBeNull()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
  await flushPromises()
  expect(pdf.render).toHaveBeenCalledTimes(2)
  expect(view.queryByRole('alert')).toBeNull()
  await loadSyntheticImage(view.getByRole('img', { name: '合成.pdf' }))
  expect(view.getByTestId('invoice-region-box')).toBeTruthy()
})

it('多页 PDF 任一页图解码失败时明确提示并撤销当前预览的定位', async () => {
  const file = new File(['synthetic'], '两页.pdf', { type: 'application/pdf' })
  const groups = [0, 1].map(pageIndex => ({ id: `p${pageIndex}`, pageIndex, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: [`field${pageIndex}`], labels: [`字段${pageIndex}`] }))
  pdf.render.mockResolvedValue({ pages: groups.map(({ pageIndex }) => ({ pageIndex, url: `blob:page-${pageIndex}`, width: 1000, height: 700 })), totalPages: 2 })
  const view = render(InvoiceRegionViewer, { props: { file, mode: 'compare', groups } })
  await flushPromises()
  await loadSyntheticImage(view.getByRole('img', { name: '两页.pdf 第 1 页' }))
  await loadSyntheticImage(view.getByRole('img', { name: '两页.pdf 第 2 页' }))
  expect(view.getAllByTestId('invoice-region-box')).toHaveLength(2)
  await fireEvent.error(view.getByRole('img', { name: '两页.pdf 第 2 页' }))
  expect(view.getByRole('alert').textContent).toContain('PDF 页图无法显示')
  expect(view.queryAllByTestId('invoice-region-box')).toHaveLength(0)
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
})

it('旧文件的迟到页图错误不能污染当前文件', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  pdf.render.mockResolvedValueOnce({ pages: [{ pageIndex: 0, url: 'blob:old', width: 10, height: 10 }], totalPages: 1 })
    .mockResolvedValueOnce({ pages: [{ pageIndex: 0, url: 'blob:new', width: 10, height: 10 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file: oldFile } })
  await flushPromises()
  const oldImage = view.getByRole('img', { name: '旧.pdf' })
  await view.rerender({ file: newFile })
  await flushPromises()
  await fireEvent.error(oldImage)
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.getByRole('img', { name: '新.pdf' })).toBeTruthy()
})

it('旧重试的迟到页图错误不能污染同一文件的新预览', async () => {
  const file = new File(['synthetic'], '合成.pdf', { type: 'application/pdf' })
  pdf.render.mockResolvedValue({ pages: [{ pageIndex: 0, url: 'blob:reused', width: 10, height: 10 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file } })
  await flushPromises()
  const oldImage = view.getByRole('img', { name: '合成.pdf' })
  await fireEvent.error(oldImage)
  await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
  await flushPromises()
  await fireEvent.error(oldImage)
  await loadSyntheticImage(oldImage)
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.emitted().verifiedPages?.at(-1)).toEqual([[]])
  expect(view.getByRole('img', { name: '合成.pdf' })).toBeTruthy()
})

it('pdf 页图在重试、切换和卸载时分别释放对应 URL', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  for (const url of ['blob:first', 'blob:retry', 'blob:new'])
    pdf.render.mockResolvedValueOnce({ pages: [{ pageIndex: 0, url, width: 10, height: 10 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file: oldFile } })
  await flushPromises()
  const image = view.getByRole('img', { name: '旧.pdf' })
  await loadSyntheticImage(image, 10, 10)
  await fireEvent.error(image)
  await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
  await view.rerender({ file: newFile })
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:retry')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:new')
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new')
  for (const url of ['blob:first', 'blob:retry', 'blob:new'])
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(([value]) => value === url)).toHaveLength(1)
})

it('旧 PDF 渲染迟到时释放旧页且不替换新原件', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  let finish!: (value: { pages: Array<{ pageIndex: number, url: string, width: number, height: number }>, totalPages: number }) => void
  pdf.render.mockReturnValueOnce(new Promise((resolve) => {
    finish = resolve
  }))
    .mockResolvedValueOnce({ pages: [{ pageIndex: 0, url: 'blob:new', width: 10, height: 10 }], totalPages: 1 })
  const view = render(InvoiceRegionViewer, { props: { file: oldFile } })
  await view.rerender({ file: newFile })
  await flushPromises()
  finish({ pages: [{ pageIndex: 0, url: 'blob:late-old', width: 10, height: 10 }], totalPages: 1 })
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-old')
  expect(view.getByRole('img', { name: '新.pdf' }).getAttribute('src')).toBe('blob:new')
})

it('旧 PDF 完成与父组件切换文件在同一轮发生时，不发布旧页定位', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  let finishOld!: (value: { pages: Array<{ pageIndex: number, url: string, width: number, height: number }>, totalPages: number }) => void
  pdf.render.mockReturnValueOnce(new Promise((resolve) => {
    finishOld = resolve
  })).mockReturnValueOnce(new Promise(() => {}))
  const selected = shallowRef(oldFile)
  const verified: number[][] = []
  const Host = defineComponent({ setup: () => () => h(InvoiceRegionViewer, { file: selected.value, onVerifiedPages: (pages: number[]) => verified.push(pages) }) })
  const view = render(Host)
  finishOld({ pages: [{ pageIndex: 0, url: 'blob:old-same-turn', width: 10, height: 10 }], totalPages: 1 })
  selected.value = newFile
  await nextTick()
  await flushPromises()
  expect(verified.every(pages => pages.length === 0)).toBe(true)
  expect(view.queryByRole('img', { name: '新.pdf' })).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-same-turn')
})

it('旧页图完成加载与父组件切换文件同轮发生时，不发布旧页定位', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  pdf.render.mockResolvedValueOnce({ pages: [{ pageIndex: 0, url: 'blob:old-loaded', width: 10, height: 10 }], totalPages: 1 })
    .mockReturnValueOnce(new Promise(() => {}))
  const selected = shallowRef(oldFile)
  const verified: number[][] = []
  const Host = defineComponent({ setup: () => () => h(InvoiceRegionViewer, { file: selected.value, onVerifiedPages: (pages: number[]) => verified.push(pages) }) })
  const view = render(Host)
  await flushPromises()
  const oldImage = view.getByRole('img', { name: '旧.pdf' })
  Object.defineProperties(oldImage, { naturalWidth: { value: 10 }, naturalHeight: { value: 10 } })
  oldImage.dispatchEvent(new Event('load'))
  selected.value = newFile
  await nextTick()
  await flushPromises()
  expect(verified.every(pages => pages.length === 0)).toBe(true)
  expect(view.queryByRole('img', { name: '新.pdf' })).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-loaded')
})

it('重试中的旧 PDF 完成与切换文件同轮发生时，不发布旧页定位', async () => {
  const oldFile = new File(['old'], '旧.pdf', { type: 'application/pdf' })
  const newFile = new File(['new'], '新.pdf', { type: 'application/pdf' })
  let finishRetry!: (value: { pages: Array<{ pageIndex: number, url: string, width: number, height: number }>, totalPages: number }) => void
  pdf.render.mockResolvedValueOnce({ pages: [], totalPages: 1 })
    .mockReturnValueOnce(new Promise((resolve) => {
      finishRetry = resolve
    }))
    .mockReturnValueOnce(new Promise(() => {}))
  const selected = shallowRef(oldFile)
  const verified: number[][] = []
  const Host = defineComponent({ setup: () => () => h(InvoiceRegionViewer, { file: selected.value, onVerifiedPages: (pages: number[]) => verified.push(pages) }) })
  const view = render(Host)
  await flushPromises()
  await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
  expect(pdf.render).toHaveBeenCalledTimes(2)
  finishRetry({ pages: [{ pageIndex: 0, url: 'blob:old-retry', width: 10, height: 10 }], totalPages: 1 })
  selected.value = newFile
  await nextTick()
  await flushPromises()
  expect(verified.every(pages => pages.length === 0)).toBe(true)
  expect(view.queryByRole('img', { name: '新.pdf' })).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-retry')
})

it('旧图片的迟到加载不能覆盖新图片尺寸', async () => {
  const oldFile = new File(['old'], '旧.png', { type: 'image/png' })
  const newFile = new File(['new'], '新.png', { type: 'image/png' })
  vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new')
  const view = render(InvoiceRegionViewer, { props: { file: oldFile } })
  const oldImage = view.getByRole('img', { name: '旧.png' })
  await view.rerender({ file: newFile })
  const newImage = view.getByRole('img', { name: '新.png' })
  Object.defineProperties(newImage, { naturalWidth: { value: 400 }, naturalHeight: { value: 200 } })
  await fireEvent.load(newImage)
  Object.defineProperties(oldImage, { naturalWidth: { value: 100 }, naturalHeight: { value: 500 } })
  await fireEvent.load(oldImage)
  const page = view.container.querySelector<HTMLElement>('[data-page-index="0"]')!
  expect(Number.parseFloat(page.style.aspectRatio)).toBe(2)
})
