import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceRegionViewer from '~/components/invoice/InvoiceRegionViewer.vue'

const pdf = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('~/lib/invoice/pdf-preview', () => ({ renderPdfPreviewPages: pdf.render }))

const image = new File([new Uint8Array([1])], '原件.png', { type: 'image/png' })
const pdfFile = new File([new Uint8Array([1])], '多页.pdf', { type: 'application/pdf' })

function pdfPages(count: number) {
  return Array.from({ length: count }, (_, pageIndex) => ({ pageIndex, url: `blob:page-${pageIndex}`, width: 1000, height: 700 }))
}

beforeEach(() => {
  pdf.render.mockReset()
  let next = 0
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:image-${next++}`), revokeObjectURL: vi.fn() })
})

function page(view: ReturnType<typeof render>) {
  return view.container.querySelector<HTMLElement>('[data-page-index="0"]')!
}

describe('发票原图预览器（工作台与编辑页平时预览、比对与点字段定位共用）', () => {
  it('无区域时是普通预览：可缩放、左右旋转，不显示比对图例与框', async () => {
    const view = render(InvoiceRegionViewer, { props: { file: image } })
    expect(view.getByRole('region', { name: '发票原图预览' })).toBeTruthy()
    expect(view.queryByText('原图比对')).toBeNull()
    expect(view.queryByTestId('invoice-region-box')).toBeNull()
    expect(view.getByRole('img', { name: '原件.png' })).toBeTruthy()

    await fireEvent.click(view.getByRole('button', { name: '放大原图' }))
    expect(view.getByRole('button', { name: '恢复 100% 缩放' }).textContent).toContain('125%')
    expect(page(view).style.width).toBe('125%')
    await fireEvent.click(view.getByRole('button', { name: '恢复 100% 缩放' }))
    expect(page(view).style.width).toBe('100%')

    const img = view.getByRole('img', { name: '原件.png' })
    Object.defineProperties(img, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } })
    await fireEvent.load(img)
    expect(Number.parseFloat(page(view).style.aspectRatio)).toBe(2)
    await fireEvent.click(view.getByRole('button', { name: '原图向右旋转' }))
    expect(img.style.transform).toContain('rotate(90deg)')
    expect(Number.parseFloat(page(view).style.aspectRatio)).toBe(0.5)
    await fireEvent.click(view.getByRole('button', { name: '原图向左旋转' }))
    await fireEvent.click(view.getByRole('button', { name: '原图向左旋转' }))
    expect(img.style.transform).toContain('rotate(270deg)')
  })

  it('pdf 超过预览页数上限时如实提示未显示的页，不静默截断', async () => {
    pdf.render.mockResolvedValue({ pages: pdfPages(10), totalPages: 23 })
    const view = render(InvoiceRegionViewer, { props: { file: pdfFile } })
    await flushPromises()
    expect(view.getAllByRole('img')).toHaveLength(10)
    expect(view.getByTestId('invoice-preview-page-limit').textContent).toContain('共 23 页，仅显示前 10 页，第 11–23 页未显示')
  })

  it('pdf 未超上限时不提示页数截断', async () => {
    pdf.render.mockResolvedValue({ pages: pdfPages(2), totalPages: 2 })
    const view = render(InvoiceRegionViewer, { props: { file: pdfFile } })
    await flushPromises()
    expect(view.getByRole('img', { name: '多页.pdf 第 2 页' })).toBeTruthy()
    expect(view.queryByTestId('invoice-preview-page-limit')).toBeNull()
  })

  it('pdf 渲染失败给出可解释错误，重试后恢复显示', async () => {
    pdf.render.mockRejectedValueOnce(new Error('Invalid PDF structure')).mockResolvedValueOnce({ pages: pdfPages(1), totalPages: 1 })
    const view = render(InvoiceRegionViewer, { props: { file: pdfFile } })
    await flushPromises()
    const alert = view.getByRole('alert')
    expect(alert.textContent).toContain('PDF 无法在此渲染')
    expect(alert.textContent).toContain('原文件未改动')
    await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
    await flushPromises()
    expect(pdf.render).toHaveBeenCalledTimes(2)
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.getByRole('img', { name: '多页.pdf' })).toBeTruthy()
  })

  it('图片解码失败给出可解释错误，重试重新加载', async () => {
    const view = render(InvoiceRegionViewer, { props: { file: image } })
    await fireEvent.error(view.getByRole('img', { name: '原件.png' }))
    expect(view.getByRole('alert').textContent).toContain('图片无法显示')
    expect(view.queryByRole('img', { name: '原件.png' })).toBeNull()
    await fireEvent.click(view.getByRole('button', { name: '重新加载原图' }))
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.getByRole('img', { name: '原件.png' })).toBeTruthy()
  })

  it('点字段定位模式：只显示当前字段的强调框，定位不到时可见并读屏说明“原图未定位”', async () => {
    const group = { id: 'focus:invoiceNumber', pageIndex: 0, box: { x: 0.5, y: 0.1, width: 0.4, height: 0.1 }, keys: ['invoiceNumber'], labels: ['单据编号'] }
    const unlocated = [{ key: 'seller', label: '供应商' }]
    const view = render(InvoiceRegionViewer, { props: { file: image, mode: 'focus', groups: [], unlocated, activeKey: null } })
    expect(view.getByRole('region', { name: '发票原图预览' })).toBeTruthy()
    expect(view.getByTestId('invoice-region-legend').textContent).toContain('聚焦或悬停字段输入框')
    expect(view.getByTestId('invoice-region-legend').textContent).not.toContain('原图未定位')

    await view.rerender({ file: image, mode: 'focus', groups: [group], unlocated, activeKey: 'invoiceNumber' })
    const boxes = view.getAllByTestId('invoice-region-box')
    expect(boxes.map(box => box.dataset.active)).toEqual(['true'])
    expect(boxes[0]!.textContent).toContain('单据编号')
    expect(view.getByTestId('invoice-region-legend').textContent).toContain('已定位：单据编号')

    await view.rerender({ file: image, mode: 'focus', groups: [], unlocated, activeKey: 'seller' })
    expect(view.queryByTestId('invoice-region-box')).toBeNull()
    expect(view.getByTestId('invoice-region-legend').textContent).toContain('供应商：原图未定位')
  })

  it('比对模式保持 #507 现状：标题“原图比对”，常驻框与“已框出 / 原图未定位”图例', () => {
    const group = { id: 'g', pageIndex: 0, box: { x: 0.5, y: 0.1, width: 0.4, height: 0.1 }, keys: ['invoiceNumber'], labels: ['单据编号'] }
    const view = render(InvoiceRegionViewer, { props: { file: image, mode: 'compare', groups: [group], unlocated: [{ key: 'seller', label: '供应商' }], activeKey: null } })
    expect(view.getByRole('region', { name: '发票原图识别变动比对' })).toBeTruthy()
    expect(view.getByText('原图比对')).toBeTruthy()
    expect(view.getAllByTestId('invoice-region-box').map(box => box.dataset.active)).toEqual(['false'])
    expect(view.getByTestId('invoice-region-legend').textContent).toContain('已框出：单据编号')
    expect(view.getByTestId('invoice-region-legend').textContent).toContain('原图未定位：供应商')
  })
})
