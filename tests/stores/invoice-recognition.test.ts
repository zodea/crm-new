import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { createDefaultOcrRecognitionSettings } from '~/lib/ocr/settings'
import { useInvoiceStore } from '~/stores/invoice'
import { useOcrSettingsStore } from '~/stores/ocr-settings'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async (work: (tx: TestDb) => Promise<unknown>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

function ocrResponse(markdown: string, status = 200): Response {
  if (status !== 200) {
    return new Response(JSON.stringify({
      statusCode: status,
      data: {
        code: 'service-unavailable',
        message: '在线 OCR 暂时不可用，请稍后重试',
        retryable: true,
      },
    }), { status, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({
    engine: 'paddleocr-official-api',
    model: 'PaddleOCR-VL-1.6',
    jobId: 'job_store_1',
    pages: [{ pageIndex: 0, markdown, prunedResult: {}, layoutRegions: [] }],
    markdownPages: [markdown],
    dataInfo: { numPages: 1 },
  }), { headers: { 'content-type': 'application/json' } })
}

const MARKDOWN = `
电子发票（普通发票）
发票号码：26442000000008248621
开票日期：2026年01月01日
购买方名称：广东瑞航建设工程有限公司
统一社会信用代码：91440101MA9RH00001
销售方名称：广州示例建材有限公司
统一社会信用代码：91440111MAE9TL102Q
*建筑材料*水泥 袋 4 155.515 622.06 9% 55.98
合计 ¥622.06 ¥55.98
价税合计（小写）¥678.04
`

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  mem.close()
})

describe('invoice store 真实识别管线', () => {
  it('删除撤回窗口保留原文件，窗口结束释放文件且恢复记录不伪装仍有原件', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => ocrResponse(MARKDOWN))
    vi.stubGlobal('fetch', fetchMock)
    const store = useInvoiceStore()
    const [first, second] = await store.uploadInvoices([
      new File(['first'], '撤回窗口.pdf'),
      new File(['second'], '超过窗口.pdf'),
    ])
    const logId = await store.remove(first!)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await store.undo(logId!)).toBe(true)
    expect(await store.startRecognition(first!)).toBe(true)

    await store.remove(second!)
    await vi.advanceTimersByTimeAsync(10_000)
    await store.restore(second!)
    expect(await store.startRecognition(second!)).toBe(false)
    expect(store.recognitionError(second!)).toContain('原文件')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('上传保留实际 File，识别完成后把解析字段一次性写入数据库', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(MARKDOWN))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1, 2, 3])], '一季度发票.pdf', { type: 'application/pdf' })
    await useOcrSettingsStore().save({
      ...createDefaultOcrRecognitionSettings(),
      useDocUnwarping: false,
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
    }, mem)
    const store = useInvoiceStore()

    const [id] = await store.uploadInvoices([file])
    expect(id).toBeTruthy()
    expect(await store.startRecognition(id!)).toBe(true)

    expect(store.byId(id!)).toMatchObject({
      fileName: '一季度发票.pdf',
      ocrStatus: 'done',
      reviewStatus: 'unreviewed',
      invoiceNumber: '26442000000008248621',
      seller: '广州示例建材有限公司',
      totalAmount: 678.04,
    })
    const uploaded = (fetchMock.mock.calls[0]?.[1]?.body as FormData).get('file')
    expect(uploaded).toBe(file)
    expect(JSON.parse(String(
      (fetchMock.mock.calls[0]?.[1]?.body as FormData).get('options'),
    ))).toMatchObject({
      useDocUnwarping: false,
      useChartRecognition: true,
      requestTimeoutMs: 45_000,
    })
    expect(store.recognitionError(id!)).toBe('')
  })

  it('在线服务失败时落失败态并保留可操作错误，允许原文件在本会话内重试', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ocrResponse('', 503))
      .mockResolvedValueOnce(ocrResponse(MARKDOWN))
    vi.stubGlobal('fetch', fetchMock)
    const store = useInvoiceStore()
    const [id] = await store.uploadInvoices([new File(['x'], '可重试.pdf')])

    expect(await store.startRecognition(id!)).toBe(false)
    expect(store.byId(id!)?.ocrStatus).toBe('failed')
    expect(store.recognitionError(id!)).toContain('在线 OCR 暂时不可用')

    expect(await store.startRecognition(id!)).toBe(true)
    expect(store.byId(id!)?.ocrStatus).toBe('done')
    expect(store.recognitionError(id!)).toBe('')
  })

  it('应用刷新后不假装仍持有文件字节，明确要求重新上传', async () => {
    const firstStore = useInvoiceStore()
    const [id] = await firstStore.uploadInvoices([new File(['x'], '刷新前.pdf')])

    setActivePinia(createPinia())
    const reloadedStore = useInvoiceStore()
    await reloadedStore.load()

    expect(await reloadedStore.startRecognition(id!)).toBe(false)
    expect(reloadedStore.recognitionError(id!)).toContain('原文件')
  })

  it('二次机器识别覆盖原始 OCR 基线，归档只把最后识别后的人工修改记为修订', async () => {
    const secondRecognition = MARKDOWN.replace('¥678.04', '¥800.00')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ocrResponse(MARKDOWN))
      .mockResolvedValueOnce(ocrResponse(secondRecognition)))
    const store = useInvoiceStore()
    const [id] = await store.uploadInvoices([new File(['x'], '重识别票据.pdf')])

    expect(await store.startRecognition(id!)).toBe(true)
    await store.correctField(id!, 'totalAmount', 700)
    expect(await store.startRecognition(id!)).toBe(true)
    expect(store.byId(id!)?.totalAmount).toBe(800)
    await store.correctField(id!, 'totalAmount', 810)
    await store.confirmInvoice(id!)
    await expect(store.archiveInvoice(id!, 'personal')).resolves.toEqual({ ok: true })

    const audit = await store.loadInvoiceArchiveAudit(id!)
    expect(audit?.provenance.originalOcr).toMatchObject({ totalAmount: 800 })
    expect(audit?.provenance.revisions.filter(item => item.field === 'totalAmount')).toEqual([
      expect.objectContaining({ from: 800, to: 810, reason: '人工校对' }),
    ])
  })
})
