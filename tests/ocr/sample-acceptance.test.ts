import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  classifyDocument,
  classifyFormat,
  classifyPath,
  createComparisonSkeleton,
  selectRepresentativeSamples,
} from '../../scripts/ocr-sample-acceptance.mjs'

describe('ocr 本地样本验收清单', () => {
  it('按路径区分发票和送货单，未知资料不猜测', () => {
    expect(classifyDocument('发票/专用发票/供应商.pdf')).toBe('invoice')
    expect(classifyDocument('合和新城送货单/送货单-001.jpg')).toBe('delivery')
    expect(classifyDocument('分供方附件/营业执照.pdf')).toBe('certificate')
  })

  it('目录分类保留证据与待复核状态，不把路径当作业务事实', () => {
    expect(classifyPath('发票/合同-补充协议.pdf')).toMatchObject({
      type: 'unknown',
      needsReview: true,
      evidenceKeywords: expect.arrayContaining(['发票', '合同', '补充协议']),
      source: 'folder-and-file-name',
    })
    expect(classifyPath('分供方附件/营业执照.pdf')).toMatchObject({
      type: 'certificate',
      confidence: expect.any(Number),
      evidenceKeywords: ['营业执照'],
    })
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

  it('扫描本地样本时只输出元数据和对照骨架，不依赖私有样本目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crm-ocr-acceptance-'))
    try {
      const invoiceDirectory = join(root, '发票')
      const deliveryDirectory = join(root, '送货单')
      await mkdir(invoiceDirectory)
      await mkdir(deliveryDirectory)
      await writeFile(join(invoiceDirectory, 'invoice.pdf'), '%PDF-1.4\n')
      await writeFile(join(deliveryDirectory, 'delivery.jpg'), 'synthetic-image-fixture')

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
      expect(report.samples.every(sample => sample.comparison.status === 'pending')).toBe(true)
      expect(JSON.stringify(report)).not.toContain('accessToken')
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
