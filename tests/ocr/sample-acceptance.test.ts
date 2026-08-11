import { describe, expect, it } from 'vitest'
import {
  buildReport,
  classifyDocument,
  classifyFormat,
  createComparisonSkeleton,
  selectRepresentativeSamples,
} from '../../scripts/ocr-sample-acceptance.mjs'

describe('ocr 本地样本验收清单', () => {
  it('按路径区分发票和送货单，未知资料不猜测', () => {
    expect(classifyDocument('发票/专用发票/供应商.pdf')).toBe('invoice')
    expect(classifyDocument('合和新城送货单/送货单-001.jpg')).toBe('delivery')
    expect(classifyDocument('分供方附件/营业执照.pdf')).toBe('unknown')
  })

  it('按扩展名区分 PDF 和图片，不支持格式返回空值', () => {
    expect(classifyFormat('invoice.PDF')).toBe('pdf')
    expect(classifyFormat('delivery.jpeg')).toBe('image')
    expect(classifyFormat('invoice.xlsx')).toBeNull()
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

  it('扫描真实样本时只输出元数据和对照骨架，不包含 OCR 原文', async () => {
    const report = await buildReport({
      root: '需过滤文件夹',
      mode: 'representative',
      perGroup: 1,
    })

    expect(report.safety).toEqual({
      callsOcrApi: false,
      includesRawOcr: false,
      includesFileContent: false,
      productDataMutation: false,
    })
    expect(report.totals.supportedFiles).toBeGreaterThan(0)
    expect(report.totals.selectedFiles).toBeGreaterThan(0)
    expect(report.samples.every(sample => sample.comparison.status === 'pending')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('accessToken')
  })
})
