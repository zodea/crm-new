/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectDocumentGeometry, prepareDeliveryOcrImage } from '~/lib/recognize/image-preprocess'

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: getDocumentMock,
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({
  WorkerMessageHandler: {},
}))

describe('prepareDeliveryOcrImage', () => {
  beforeEach(() => {
    getDocumentMock.mockReset()

    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      getImageData: vi.fn(() => ({
        width: 2,
        height: 2,
        data: new Uint8ClampedArray(2 * 2 * 4),
      })),
      fillStyle: '#fff',
      filter: 'none',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['derived'], { type: 'image/png' }))
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('将单页 PDF 渲染为图片后再进入图像预处理链路', async () => {
    const render = vi.fn().mockResolvedValue(undefined)
    const cleanup = vi.fn()
    const destroy = vi.fn()
    const getPage = vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 1000, height: 1400 }),
      render: () => ({ promise: render() }),
    })
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage,
        cleanup,
        destroy: vi.fn(),
      }),
      destroy,
    })

    const source = new File(['pdf'], '2026.5.21广州德力.pdf', { type: 'application/pdf' })
    const prepared = await prepareDeliveryOcrImage(source)

    expect(getDocumentMock).toHaveBeenCalledWith(expect.objectContaining({ data: new Uint8Array([112, 100, 102]) }))
    expect(getPage).toHaveBeenCalledWith(1)
    expect(render).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
    expect(prepared.transformed).toBe(true)
    expect(prepared.file.type).toBe('image/png')
    expect(prepared.file.name).toBe('2026.5.21广州德力.ocr.png')
    expect(prepared.useDocOrientationClassify).toBe(true)
  })

  it('多页 PDF 不拆页或渲染，保持原文件交给 VL', async () => {
    const getPage = vi.fn()
    const cleanup = vi.fn()
    const destroy = vi.fn()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage,
        cleanup,
      }),
      destroy,
    })

    const source = new File(['pdf'], 'multi-page.pdf', { type: 'application/pdf' })
    const prepared = await prepareDeliveryOcrImage(source)

    expect(getPage).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
    expect(prepared).toEqual({
      file: source,
      transformed: false,
      useDocOrientationClassify: true,
    })
  })

  it('不会把竖排连通域误当成需要旋转 90° 的票据倾角', () => {
    const width = 200
    const height = 200
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 50; y < 150; y += 1) {
      for (let x = 90; x < 110; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 255
      }
    }

    const geometry = detectDocumentGeometry({ width, height, data })

    expect(geometry).not.toBeNull()
    expect(geometry?.angleRadians).toBeCloseTo(0, 5)
  })
})
