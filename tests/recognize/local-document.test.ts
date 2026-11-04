import type { OcrResult } from '@paddleocr/paddleocr-js'
import { describe, expect, it, vi } from 'vitest'
import { recognizeInvoiceLocally } from '~/lib/invoice/recognize'
import { localOcrText, recognizeLocalInvoiceDocument } from '~/lib/recognize/local-document'

type ConsumePage = (index: number, image: File, frame: { width: number, height: number }) => Promise<void>

function ocr(text = '发票号码：87654321'): OcrResult {
  return {
    image: { width: 300, height: 200 },
    items: [{ text, score: 0.9, poly: [[10, 10], [200, 10], [200, 30], [10, 30]] }],
    metrics: { detMs: 1, recMs: 1, totalMs: 2, detectedBoxes: 1, recognizedCount: 1 },
    runtime: { requestedBackend: 'wasm', detProvider: 'wasm', recProvider: 'wasm', webgpuAvailable: false },
  }
}

describe('本机发票文件识别', () => {
  it('按行及从左到右整理识别框，忽略没有有效位置的框', () => {
    const result = ocr()
    result.items = [
      { text: '12345678', score: 1, poly: [[110, 10], [200, 10], [200, 30], [110, 30]] },
      { text: '发票号码：', score: 1, poly: [[10, 11], [100, 11], [100, 31], [10, 31]] },
      { text: '下一行', score: 1, poly: [[10, 50], [100, 50], [100, 70], [10, 70]] },
      { text: '无位置', score: 1, poly: [] },
    ]
    expect(localOcrText(result)).toBe('发票号码： 12345678\n下一行')
  })

  it('文字型 PDF 有票面字段时直接采用文字，不调用扫描识别', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: ['发票号码：12345678'], totalPages: 1 })
    const render = vi.fn()
    const recognize = vi.fn()
    const progress: number[] = []
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/crm/', value => progress.push(value), { extract, render, recognize })
    expect(result).toEqual({ pages: ['发票号码：12345678'], unrecognizedPageIndexes: [], geometryPages: [] })
    expect(render).not.toHaveBeenCalled()
    expect(recognize).not.toHaveBeenCalled()
    expect(progress).toEqual([0, 100])
  })

  it('图片只在本机识别，空结果明确标记待处理', async () => {
    const extract = vi.fn()
    const render = vi.fn()
    const recognize = vi.fn().mockResolvedValue({ ...ocr(), items: [] })
    const file = new File(['image'], 'synthetic.png')
    const result = await recognizeLocalInvoiceDocument(file, '/crm/', undefined, { extract, render, recognize })
    expect(result).toEqual({ pages: [''], unrecognizedPageIndexes: [0], geometryPages: [] })
    expect(recognize).toHaveBeenCalledWith(file, '/crm/')
    expect(extract).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('混合 PDF 只识别无票面文字的页并按原页序返回', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: ['发票号码：12345678', ''], totalPages: 2 })
    const render = vi.fn(async (_file: File, indexes: readonly number[], consume: ConsumePage) => {
      expect(indexes).toEqual([1])
      await consume(1, new File(['image'], 'page-2.png'), { width: 300, height: 200 })
    })
    const recognize = vi.fn().mockResolvedValue(ocr())
    const progress: number[] = []
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/', value => progress.push(value), { extract, render, recognize })
    expect(result).toEqual({ pages: ['发票号码：12345678', '发票号码：87654321'], unrecognizedPageIndexes: [], geometryPages: [{ pageIndex: 1, width: 300, height: 200, source: 'pdf-render', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }] })
    expect(recognize).toHaveBeenCalledOnce()
    expect(progress).toEqual([0, 99, 100])
  })

  it('扫描页缺失或识别失败时拒绝返回部分结果', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: [''], totalPages: 1 })
    const recognize = vi.fn().mockRejectedValue(new Error('模型不可用'))
    const file = new File(['pdf'], 'synthetic.pdf')
    await expect(recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render: vi.fn(), recognize })).rejects.toThrow('识别不完整')
    const render = vi.fn(async (_file: File, _indexes: readonly number[], consume: ConsumePage) => consume(0, new File(['image'], 'page.png'), { width: 300, height: 200 }))
    await expect(recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render, recognize })).rejects.toThrow('模型不可用')
  })

  it('没有识别到文字的扫描页明确标记，不能冒充完整结果', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: [''], totalPages: 1 })
    const render = vi.fn(async (_file: File, _indexes: readonly number[], consume: ConsumePage) => consume(0, new File(['image'], 'page.png'), { width: 300, height: 200 }))
    const recognize = vi.fn().mockResolvedValue({ ...ocr(), items: [] })
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/', undefined, { extract, render, recognize })
    expect(result).toEqual({ pages: [''], unrecognizedPageIndexes: [0], geometryPages: [] })
  })

  it('发票候选保留未识别页与未知金额，并要求人工核对', async () => {
    const readDocument = vi.fn().mockResolvedValue({ pages: ['发票号码：12345678', ''], unrecognizedPageIndexes: [1] })
    const candidate = await recognizeInvoiceLocally({ file: new File(['pdf'], 'synthetic.pdf'), basePath: '/crm/' }, { readDocument })
    expect(candidate.fields.invoiceNumber).toBe('12345678')
    expect(candidate.source).toBe('local')
    expect(candidate.fields.amount).toBeNull()
    expect(candidate.fields.taxAmount).toBeNull()
    expect(candidate.fields.totalAmount).toBeNull()
    expect(candidate.textPages).toEqual(['发票号码：12345678', ''])
    expect(candidate.unrecognizedPageIndexes).toEqual([1])
    expect(candidate.requiresReview).toBe(true)
    expect(readDocument).toHaveBeenCalledOnce()
  })

  it('图片定位只保留与独立解码尺寸一致的真实多边形', async () => {
    const file = new File(['image'], 'synthetic.png')
    const dependencies = { extract: vi.fn(), render: vi.fn(), recognize: vi.fn().mockResolvedValue(ocr()), imageFrame: vi.fn().mockResolvedValue({ width: 300, height: 200 }) }
    const result = await recognizeLocalInvoiceDocument(file, '/', undefined, dependencies)
    expect(result.pages).toEqual(['发票号码：87654321'])
    expect(result.geometryPages).toEqual([{ pageIndex: 0, width: 300, height: 200, source: 'image', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }])
    dependencies.imageFrame.mockResolvedValueOnce({ width: 200, height: 300 })
    expect((await recognizeLocalInvoiceDocument(file, '/', undefined, dependencies)).geometryPages).toEqual([])
    dependencies.imageFrame.mockRejectedValueOnce(new Error('无法核对图片尺寸'))
    expect((await recognizeLocalInvoiceDocument(file, '/', undefined, dependencies)).geometryPages).toEqual([])
  })

  it('不合格或越界多边形不生成区域，合法文字结果仍保留', async () => {
    const bad = ocr()
    bad.items = [
      { text: '发票号码：87654321', score: 1, poly: [[-1, 10], [200, 10], [200, 30], [0, 30]] },
      { text: '其他', score: 1, poly: [[1, 1], [1, 1], [1, 1], [1, 1]] },
      { text: '有效', score: 1, poly: [[10, 40], [80, 40], [80, 60], [10, 60]] },
    ]
    const result = await recognizeLocalInvoiceDocument(new File(['image'], 'synthetic.png'), '/', undefined, { extract: vi.fn(), render: vi.fn(), recognize: vi.fn().mockResolvedValue(bad), imageFrame: vi.fn().mockResolvedValue({ width: 300, height: 200 }) })
    expect(result.pages[0]).toContain('发票号码：87654321')
    expect(result.geometryPages[0]?.blocks).toEqual([
      { text: '发票号码：87654321', polygon: null },
      { text: '其他', polygon: null },
      { text: '有效', polygon: [[10, 40], [80, 40], [80, 60], [10, 60]] },
    ])
  })

  it('混合 PDF 只为尺寸核验通过的扫描页保留真实页码与坐标', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: ['发票号码：12345678', ''], totalPages: 2 })
    const render = vi.fn(async (_file: File, _indexes: readonly number[], consume: (index: number, image: File, frame: { width: number, height: number }) => Promise<void>) => {
      await consume(1, new File(['image'], 'page-2.png'), { width: 300, height: 200 })
    })
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/', undefined, { extract, render, recognize: vi.fn().mockResolvedValue(ocr()) })
    expect(result.pages).toEqual(['发票号码：12345678', '发票号码：87654321'])
    expect(result.geometryPages).toEqual([{ pageIndex: 1, width: 300, height: 200, source: 'pdf-render', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }])
  })

  it('扫描图片与 OCR 帧尺寸不一致时保留文字但不定位，重复或错页结果拒绝', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: ['', ''], totalPages: 2 })
    const recognize = vi.fn().mockResolvedValue(ocr())
    const file = new File(['pdf'], 'synthetic.pdf')
    const mismatched = vi.fn(async (_file: File, _indexes: readonly number[], consume: (index: number, image: File, frame: { width: number, height: number }) => Promise<void>) => {
      await consume(0, new File(['a'], 'page-1.png'), { width: 301, height: 200 })
      await consume(1, new File(['b'], 'page-2.png'), { width: 300, height: 201 })
    })
    const result = await recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render: mismatched, recognize })
    expect(result.pages).toEqual(['发票号码：87654321', '发票号码：87654321'])
    expect(result.geometryPages).toEqual([])
    const repeated = vi.fn(async (_file: File, _indexes: readonly number[], consume: (index: number, image: File, frame: { width: number, height: number }) => Promise<void>) => {
      await consume(0, new File(['a'], 'page-1.png'), { width: 300, height: 200 })
      await consume(0, new File(['b'], 'page-1-again.png'), { width: 300, height: 200 })
    })
    await expect(recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render: repeated, recognize })).rejects.toThrow('PDF 扫描页识别结果页码无效')
  })

  it('本机候选按真实块定位并保留源帧', async () => {
    const readDocument = vi.fn().mockResolvedValue({ pages: ['发票号码：87654321'], unrecognizedPageIndexes: [], geometryPages: [{ pageIndex: 0, width: 300, height: 200, source: 'image', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }] })
    const candidate = await recognizeInvoiceLocally({ file: new File(['image'], 'synthetic.png'), basePath: '/' }, { readDocument })
    expect(candidate.fieldRegions?.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: expect.closeTo(1 / 30), y: 0.05, width: expect.closeTo(190 / 300), height: expect.closeTo(0.1) } })
    expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width: 300, height: 200, source: 'image' }])
  })

  it('相同票号另出现在无效框或无几何的文字页时不能误判为唯一', async () => {
    const duplicate = ocr()
    duplicate.items.push({ text: '发票号码：87654321', score: 1, poly: [[-1, 50], [200, 50], [200, 70], [0, 70]] })
    const imageRead = (file: File, basePath: string) => recognizeLocalInvoiceDocument(file, basePath, undefined, { extract: vi.fn(), render: vi.fn(), recognize: vi.fn().mockResolvedValue(duplicate), imageFrame: vi.fn().mockResolvedValue({ width: 300, height: 200 }) })
    const image = await recognizeInvoiceLocally({ file: new File(['image'], 'synthetic.png'), basePath: '/' }, { readDocument: imageRead })
    expect(image.fieldRegions?.invoiceNumber).toBeUndefined()
    const pdfRead = (file: File, basePath: string) => recognizeLocalInvoiceDocument(file, basePath, undefined, {
      extract: vi.fn().mockResolvedValue({ pages: ['发票号码：87654321', ''], totalPages: 2 }),
      render: vi.fn(async (_file: File, _indexes: readonly number[], consume: ConsumePage) => consume(1, new File(['image'], 'page-2.png'), { width: 300, height: 200 })),
      recognize: vi.fn().mockResolvedValue(ocr()),
    })
    const pdf = await recognizeInvoiceLocally({ file: new File(['pdf'], 'synthetic.pdf'), basePath: '/' }, { readDocument: pdfRead })
    expect(pdf.fieldRegions?.invoiceNumber).toBeUndefined()
  })
})
