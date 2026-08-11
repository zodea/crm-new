import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  amountHints,
  classifyContent,
  classifyResponseFailure,
  dateHints,
  lineItemCount,
  recognizeSample,
  run,
  summarizeOcrPayload,
} from '../../scripts/ocr-sample-runner.mjs'

const folderInvoice = {
  type: 'invoice',
  confidence: 0.9,
  evidenceKeywords: ['发票'],
  candidates: ['invoice'],
  needsReview: false,
  source: 'folder-and-file-name',
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function createSampleFixture() {
  const root = await mkdtemp(join(tmpdir(), 'crm-new-ocr-runner-test-'))
  const output = await mkdtemp(join(tmpdir(), 'crm-new-ocr-output-test-'))
  const directory = join(root, '发票')
  await mkdir(directory, { recursive: true })
  await mkdir(join(output, 'raw-ocr'), { recursive: true })
  await writeFile(join(directory, '混入：合同.pdf'), 'synthetic-pdf-payload')
  return { root, output }
}

function sampleFor(root: string) {
  return {
    id: 'invoice:pdf:发票/混入：合同.pdf',
    relativePath: '发票/混入：合同.pdf',
    fileName: '混入：合同.pdf',
    documentType: 'invoice',
    folderClassification: folderInvoice,
    format: 'pdf',
    root,
  }
}

describe('ocr 真实样本运行结果摘要', () => {
  it('提取日期与金额提示，不保留原始 OCR 文本', () => {
    expect(dateHints('开票日期：2026年08月11日')).toEqual(['2026-08-11'])
    expect(amountHints('价税合计：1,234.50\n税额：12.00')).toEqual(['1234.50', '12.00'])
  })

  it('统计 Markdown 表格明细行', () => {
    expect(lineItemCount('| 名称 | 数量 |\n| --- | --- |\n| 电线 | 2 |\n| 线管 | 3 |')).toBe(2)
  })

  it('独立按 OCR 内容判断合同、证照与发票，不依赖目录分类', () => {
    expect(classifyContent('增值税专用发票\n发票号码：123\n购买方：甲方\n销售方：乙方\n价税合计：100')).toMatchObject({
      type: 'invoice',
      needsReview: false,
      evidenceKeywords: expect.arrayContaining(['发票号码', '购买方', '销售方', '价税合计']),
      source: 'ocr-content',
    })
    expect(classifyContent('合同编号：HT-001\n甲方：甲公司\n乙方：乙公司\n履行期限：2026年')).toMatchObject({
      type: 'contract',
      evidenceKeywords: expect.arrayContaining(['合同', '合同编号', '甲方', '乙方']),
    })
    expect(classifyContent('营业执照\n统一社会信用代码：9133\n法定代表人：某某')).toMatchObject({
      type: 'certificate',
      needsReview: false,
    })
    expect(classifyContent('项目移交单\n入户门\n接收人：某某')).toMatchObject({
      type: 'other',
      needsReview: true,
      evidenceKeywords: expect.arrayContaining(['移交单', '入户门']),
    })
  })

  it('将 429 明确识别为限流，而不是请求或识别失败', () => {
    expect(classifyResponseFailure(
      jsonResponse({ data: { code: 'rate-limit', message: '请求过于频繁' } }, 429),
      { data: { code: 'rate-limit', message: '请求过于频繁' } },
    )).toMatchObject({
      failureKind: 'rate-limit',
      errorCode: 'rate-limit',
      retryable: true,
    })
    expect(classifyResponseFailure(
      jsonResponse({ data: { code: 'job-failed', message: '图片无法解析' } }, 502),
      { data: { code: 'job-failed', message: '图片无法解析' } },
    )).toMatchObject({ failureKind: 'recognition' })
  })

  it('为成功结果生成字段、明细和差异摘要骨架', () => {
    const summary = summarizeOcrPayload({
      markdownPages: ['购买方：甲方\n开票日期：2026-08-11\n价税合计：100.00\n| 名称 | 数量 |\n| --- | --- |\n| 电线 | 2 |'],
    }, 'invoice')

    expect(summary).toMatchObject({
      recognized: {
        fieldCounts: {
          dates: 1,
          counterparties: 1,
          amounts: 1,
        },
        lineItemCount: 1,
      },
      comparison: {
        status: 'pending',
        lineItems: { sourceCount: null, recognizedCount: 1, status: 'pending' },
        differences: [],
      },
    })
    expect(JSON.stringify(summary)).not.toContain('购买方：甲方')
    expect(summary.contentClassification.type).toBe('invoice')
    expect(summary.localParserComparison).toMatchObject({
      status: 'unavailable',
      parserType: 'invoice',
      sourceModule: 'app/lib/recognize/invoice-parse.ts',
    })
  })

  it('只输出本地解析器的字段存在性差异，不输出解析原值', () => {
    const summary = summarizeOcrPayload({
      markdownPages: ['购买方：甲方\n开票日期：2026-08-11\n价税合计：100.00'],
    }, 'invoice', {
      invoice: {
        parseInvoiceText: () => ({
          invoiceNumber: 'secret-number',
          invoiceDate: '2026-08-11',
          buyer: '甲方',
          seller: '',
          amount: 100,
          taxAmount: null,
          totalAmount: 100,
          items: [],
        }),
      },
    })

    expect(summary.localParserComparison).toMatchObject({
      status: 'available',
      parserType: 'invoice',
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'invoiceDate', status: 'aligned' }),
      ]),
    })
    expect(JSON.stringify(summary)).not.toContain('secret-number')
  })

  it('限流后按退避重试成功，并生成目录/内容冲突安全摘要', async () => {
    const fixture = await createSampleFixture()
    try {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: { code: 'rate-limit', message: '请求过于频繁' } }, 429))
        .mockResolvedValueOnce(jsonResponse({
          engine: 'paddleocr-official-api',
          model: 'PaddleOCR-VL-1.6',
          jobId: 'synthetic-job',
          pages: [{ markdown: '合同编号：HT-001\n甲方：甲公司\n乙方：乙公司\n履行期限：2026年' }],
          markdownPages: ['合同编号：HT-001\n甲方：甲公司\n乙方：乙公司\n履行期限：2026年'],
        }))
      const sleep = vi.fn(async () => {})
      const result = await recognizeSample(
        sampleFor(fixture.root),
        fixture.root,
        'http://localhost:3100',
        join(fixture.output, 'raw-ocr'),
        0,
        {
          fetchImpl: fetchMock,
          sleep,
          maxRateLimitRetries: 1,
          retryBaseMs: 10,
          maxRetryDelayMs: 100,
          beforeAttempt: async () => {},
        },
      )

      expect(result).toMatchObject({
        status: 'succeeded',
        attempts: 2,
        retryCount: 1,
        contentClassification: { type: 'contract' },
        classificationComparison: {
          status: 'conflict',
          kind: 'folder-content-mismatch',
          folderType: 'invoice',
          contentType: 'contract',
        },
      })
      expect(sleep).toHaveBeenCalledWith(10)
      expect(result.classificationComparison.suggestionAction).toContain('不要自动移动原件')
      expect(JSON.stringify(result)).not.toContain('合同编号：HT-001')
      const uploadedFile = (fetchMock.mock.calls[0]?.[1]?.body as FormData).get('file') as File
      expect(uploadedFile.name).toBe('混入_合同.pdf')
    }
    finally {
      await rm(fixture.root, { recursive: true, force: true })
      await rm(fixture.output, { recursive: true, force: true })
    }
  })

  it('目录与内容同类但内容证据不足时仍标记待复核', () => {
    const summary = summarizeOcrPayload({
      markdownPages: ['送货日期：2026-04-29'],
    }, {
      folderClassification: {
        ...folderInvoice,
        type: 'delivery',
        evidenceKeywords: ['送货单'],
      },
    })

    expect(summary.classificationComparison).toMatchObject({
      status: 'needs-review',
      folderType: 'delivery',
      contentType: 'delivery',
      needsReview: true,
    })
  })

  it('限流耗尽本轮重试时标记 pending-retry，并在汇总中单列而非计入失败', async () => {
    const fixture = await createSampleFixture()
    try {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ data: { code: 'rate-limit', message: '请求过于频繁' } }, 429),
      )
      const result = await recognizeSample(
        sampleFor(fixture.root),
        fixture.root,
        'http://localhost:3100',
        join(fixture.output, 'raw-ocr'),
        0,
        {
          fetchImpl: fetchMock,
          sleep: async () => {},
          maxRateLimitRetries: 1,
          retryBaseMs: 0,
          maxRetryDelayMs: 0,
          beforeAttempt: async () => {},
        },
      )
      expect(result).toMatchObject({
        status: 'pending-retry',
        failureKind: 'rate-limit',
        attempts: 2,
        retryCount: 1,
        comparison: { status: 'blocked' },
      })
      expect(result.status).not.toBe('failed')

      const report = await run({
        root: fixture.root,
        mode: 'all',
        perGroup: 1,
        concurrency: 1,
        maxRateLimitRetries: 0,
        retryBaseMs: 0,
        maxRetryDelayMs: 0,
        requestDelayMs: 0,
        baseUrl: 'http://localhost:3100',
        output: fixture.output,
      }, {
        fetchImpl: fetchMock,
        sleep: async () => {},
      })
      expect(report.totals).toMatchObject({
        attempted: 1,
        succeeded: 0,
        failed: 0,
        pendingRetry: 1,
        rateLimited: 1,
      })
      expect(report.pendingRetrySamples).toHaveLength(1)
      const summaryText = await readFile(join(fixture.output, 'summary.json'), 'utf8')
      expect(summaryText).toContain('pending-retry')
      expect(summaryText).not.toContain('accessToken')
    }
    finally {
      await rm(fixture.root, { recursive: true, force: true })
      await rm(fixture.output, { recursive: true, force: true })
    }
  })
})
