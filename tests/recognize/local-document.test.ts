import type { OcrResult } from '@paddleocr/paddleocr-js'
import { describe, expect, it, vi } from 'vitest'
import { recognizeInvoiceLocally } from '~/lib/invoice/recognize'
import { localOcrText, recognizeLocalInvoiceDocument } from '~/lib/recognize/local-document'

type ConsumePage = (index: number, image: File) => Promise<void>

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
    expect(result).toEqual({ pages: ['发票号码：12345678'], unrecognizedPageIndexes: [] })
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
    expect(result).toEqual({ pages: [''], unrecognizedPageIndexes: [0] })
    expect(recognize).toHaveBeenCalledWith(file, '/crm/')
    expect(extract).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('混合 PDF 只识别无票面文字的页并按原页序返回', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: ['发票号码：12345678', ''], totalPages: 2 })
    const render = vi.fn(async (_file: File, indexes: readonly number[], consume: ConsumePage) => {
      expect(indexes).toEqual([1])
      await consume(1, new File(['image'], 'page-2.png'))
    })
    const recognize = vi.fn().mockResolvedValue(ocr())
    const progress: number[] = []
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/', value => progress.push(value), { extract, render, recognize })
    expect(result).toEqual({ pages: ['发票号码：12345678', '发票号码：87654321'], unrecognizedPageIndexes: [] })
    expect(recognize).toHaveBeenCalledOnce()
    expect(progress).toEqual([0, 99, 100])
  })

  it('扫描页缺失或识别失败时拒绝返回部分结果', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: [''], totalPages: 1 })
    const recognize = vi.fn().mockRejectedValue(new Error('模型不可用'))
    const file = new File(['pdf'], 'synthetic.pdf')
    await expect(recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render: vi.fn(), recognize })).rejects.toThrow('识别不完整')
    const render = vi.fn(async (_file: File, _indexes: readonly number[], consume: ConsumePage) => consume(0, new File(['image'], 'page.png')))
    await expect(recognizeLocalInvoiceDocument(file, '/', undefined, { extract, render, recognize })).rejects.toThrow('模型不可用')
  })

  it('没有识别到文字的扫描页明确标记，不能冒充完整结果', async () => {
    const extract = vi.fn().mockResolvedValue({ pages: [''], totalPages: 1 })
    const render = vi.fn(async (_file: File, _indexes: readonly number[], consume: ConsumePage) => consume(0, new File(['image'], 'page.png')))
    const recognize = vi.fn().mockResolvedValue({ ...ocr(), items: [] })
    const result = await recognizeLocalInvoiceDocument(new File(['pdf'], 'synthetic.pdf'), '/', undefined, { extract, render, recognize })
    expect(result).toEqual({ pages: [''], unrecognizedPageIndexes: [0] })
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
})
