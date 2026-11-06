import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'

const pdf = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('~/lib/invoice/pdf-preview', () => ({ renderPdfPreviewPages: pdf.render }))

afterEach(() => pdf.render.mockReset())

it('pdf 页图解码失败时键盘可重试并恢复真实合成图像', async ({ task }) => {
  const width = /^chromium-(390|768|1024|1280|1440)$/.exec(task.file.projectName ?? '')
  expect(window.innerWidth).toBe(Number(width?.[1]))
  const good = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
  const makePage = (bytes: BlobPart) => ({ pageIndex: 0, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), width: 1, height: 1 })
  pdf.render.mockImplementationOnce(async () => ({ pages: [makePage('故意损坏的合成页图')], totalPages: 1 }))
    .mockImplementationOnce(async () => ({ pages: [makePage(good)], totalPages: 1 }))
  const file = new File(['synthetic'], '合成.pdf', { type: 'application/pdf' })
  const groups = [{ id: 'buyer', pageIndex: 0, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: ['buyer'], labels: ['购买方'] }]
  await render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups, activeKey: 'buyer' } })
  await expect.element(page.getByRole('alert')).toHaveTextContent('PDF 页图无法显示')
  expect(document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
  const retry = page.getByRole('button', { name: '重新加载原图' })
  retry.element().focus()
  await expect.element(retry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('img', { name: '合成.pdf' })).toBeVisible()
  await expect.element(page.getByLabelText('发票原图，可滚动查看')).toHaveFocus()
  await expect.poll(() => (page.getByRole('img', { name: '合成.pdf' }).element() as HTMLImageElement).naturalWidth).toBe(1)
  await expect.poll(() => document.querySelectorAll('[data-testid="invoice-region-box"]').length).toBe(1)
  expect(pdf.render).toHaveBeenCalledTimes(2)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
})

it.each(['一致', '不一致'] as const)('真实 canvas 页图与声明尺寸%s时按实际结果显示定位', async (condition) => {
  const canvas = document.createElement('canvas')
  canvas.width = 37
  canvas.height = 19
  const context = canvas.getContext('2d')!
  context.fillStyle = '#486070'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法生成合成页图')), 'image/png'))
  const declaredWidth = condition === '一致' ? canvas.width : canvas.width + 1
  pdf.render.mockResolvedValue({ pages: [{ pageIndex: 0, url: URL.createObjectURL(blob), width: declaredWidth, height: canvas.height }], totalPages: 1 })
  const file = new File(['synthetic'], '合成.pdf', { type: 'application/pdf' })
  const groups = [{ id: 'buyer', pageIndex: 0, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, keys: ['buyer'], labels: ['购买方'] }]
  await render(InvoiceRegionViewer, { props: { file, mode: 'focus', groups, activeKey: 'buyer' } })
  if (condition === '一致') {
    const image = page.getByRole('img', { name: '合成.pdf' })
    await expect.element(image).toBeVisible()
    await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(37)
    await expect.poll(() => document.querySelectorAll('[data-testid="invoice-region-box"]').length).toBe(1)
  }
  else {
    await expect.element(page.getByRole('alert')).toHaveTextContent('尺寸与渲染结果不一致')
    expect(document.querySelector('[data-testid="invoice-region-box"]')).toBeNull()
    await expect.element(page.getByRole('button', { name: '重新加载原图' })).toBeVisible()
  }
})
