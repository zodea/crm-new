import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildReport,
  classifyDocument,
  classifyFormat,
  classifyPath,
  createComparisonSkeleton,
  selectRepresentativeSamples,
} from '../../scripts/ocr-sample-acceptance.mjs'
import { testTempRoot } from '../helpers/test-temp-root'

describe('ocr 本地样本验收清单', () => {
  it.each([
    { case: '\'发票/专用发票/供应商.pdf\'', input: '发票/专用发票/供应商.pdf', expected: 'invoice' },
    { case: '\'合和新城送货单/送货单-001.jpg\'', input: '合和新城送货单/送货单-001.jpg', expected: 'delivery' },
    { case: '\'分供方附件/营业执照.pdf\'', input: '分供方附件/营业执照.pdf', expected: 'certificate' },
  ])('按路径区分发票和送货单，未知资料不猜测 / classifyDocument：$case', ({ input, expected }) => {
    expect(classifyDocument(input)).toBe(expected)
  })

  it.each([
    { case: '\'发票/合同-补充协议.pdf\'', input: '发票/合同-补充协议.pdf', expected: {
      type: 'unknown',
      needsReview: true,
      evidenceKeywords: expect.arrayContaining(['发票', '合同', '补充协议']),
      source: 'folder-and-file-name',
    } },
    { case: '\'分供方附件/营业执照.pdf\'', input: '分供方附件/营业执照.pdf', expected: {
      type: 'certificate',
      confidence: expect.any(Number),
      evidenceKeywords: ['营业执照'],
    } },
  ])('目录分类保留证据与待复核状态，不把路径当作业务事实 / classifyPath：$case', ({ input, expected }) => {
    expect(classifyPath(input)).toMatchObject(expected)
  })

  it('按扩展名区分 PDF 和图片，不支持格式返回空值', () => {
    expect(classifyFormat('invoice.xlsx')).toBeNull()
  })

  it.each([
    { case: '\'invoice.PDF\'', input: 'invoice.PDF', expected: 'pdf' },
    { case: '\'delivery.jpeg\'', input: 'delivery.jpeg', expected: 'image' },
  ])('按扩展名区分 PDF 和图片，不支持格式返回空值 / classifyFormat：$case', ({ input, expected }) => {
    expect(classifyFormat(input)).toBe(expected)
  })

  it('为未来 AI 对照预留字段、明细行和差异状态', () => {
    expect(createComparisonSkeleton('invoice')).toMatchObject({
      status: 'pending',
      reviewer: 'ai-assisted-manual-review',
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'invoiceNumber', status: 'pending' }),
        expect.objectContaining({ field: 'totalAmount', status: 'pending' }),
      ]),
      lineItems: [],
      differences: [],
    })
  })

  it('代表模式每个单据类型与格式分组稳定抽样，并优先保留带场景标签的样本', () => {
    const samples = [
      { id: 'invoice-pdf-a', documentType: 'invoice', format: 'pdf', scenarioTags: [] },
      { id: 'invoice-pdf-b', documentType: 'invoice', format: 'pdf', scenarioTags: ['scanned'] },
      { id: 'invoice-pdf-c', documentType: 'invoice', format: 'pdf', scenarioTags: [] },
      { id: 'delivery-image-a', documentType: 'delivery', format: 'image', scenarioTags: [] },
    ]

    expect(selectRepresentativeSamples(samples, 2).map(sample => sample.id)).toEqual([
      'delivery-image-a',
      'invoice-pdf-b',
      'invoice-pdf-a',
    ])
  })

  it('扫描本地样本时只输出元数据和对照骨架，不依赖私有样本目录', async () => {
    const root = await mkdtemp(join(testTempRoot(), 'ocr-acceptance-'))
    const invoiceDirectory = join(root, '发票')
    const deliveryDirectory = join(root, '送货单')
    await mkdir(invoiceDirectory)
    await mkdir(deliveryDirectory)
    const invoicePath = join(invoiceDirectory, 'invoice.pdf')
    const deliveryPath = join(deliveryDirectory, 'delivery.jpg')
    const invoiceBytes = Buffer.from('%PDF-1.4\nOCR_INPUT_PRIVATE_INVOICE_7a81\n')
    const deliveryBytes = Buffer.from('SYNTHETIC_IMG_PRIVATE_DELIVERY_b412')
    await writeFile(invoicePath, invoiceBytes)
    await writeFile(deliveryPath, deliveryBytes)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('合成清单不应访问网络')
    })

    try {
      const report = await buildReport({
        root,
        mode: 'representative',
        perGroup: 1,
      })

      expect(report.safety).toEqual({
        callsOcrApi: false,
        includesRawOcr: false,
        includesFileContent: false,
        productDataMutation: false,
      })
      expect(report.totals.supportedFiles).toBe(2)
      expect(report.totals.selectedFiles).toBe(2)
      expect(report.samples).toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: '发票/invoice.pdf', documentType: 'invoice', format: 'pdf', sizeBytes: 40 }),
        expect.objectContaining({ relativePath: '送货单/delivery.jpg', documentType: 'delivery', format: 'image', sizeBytes: 35 }),
      ]))
      expect(report.samples.every(sample => sample.comparison.status === 'pending')).toBe(true)
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain('accessToken')
      expect(serialized).not.toContain('OCR_INPUT_PRIVATE_INVOICE_7a81')
      expect(serialized).not.toContain('SYNTHETIC_IMG_PRIVATE_DELIVERY_b412')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(await readFile(invoicePath)).toEqual(invoiceBytes)
      expect(await readFile(deliveryPath)).toEqual(deliveryBytes)
      expect((await readdir(root)).sort()).toEqual(['发票', '送货单'].sort())
      expect(await readdir(invoiceDirectory)).toEqual(['invoice.pdf'])
      expect(await readdir(deliveryDirectory)).toEqual(['delivery.jpg'])
    }
    finally {
      fetchSpy.mockRestore()
    }
  })
})
