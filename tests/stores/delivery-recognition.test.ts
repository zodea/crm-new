import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { useDeliveryStore } from '~/stores/delivery'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
}))

const DELIVERY_MARKDOWN = `
# 广州示例建材有限公司送货单
客户名称：广东瑞航建设工程有限公司
送货地址：合和新城项目部
单号：SH-2026-001
日期：2026.07.16
<table>
  <tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
  <tr><td>1</td><td>普通硅酸盐水泥</td><td>P.O 42.5</td><td>袋</td><td>4</td><td>155.50</td><td>622.00</td></tr>
  <tr><td></td><td>合计</td><td></td><td></td><td></td><td></td><td>622.00</td></tr>
</table>
`

const AMOUNT_ONLY_LINE_MARKDOWN = `
# 示例送货单
<table>
  <tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
  <tr><td>1</td><td>耐候密封胶</td><td>590ml</td><td>支</td><td></td><td></td><td>386.00</td></tr>
  <tr><td></td><td>合计</td><td></td><td></td><td></td><td></td><td>386.00</td></tr>
</table>
`

function ocrResponse(markdown: string, status = 200): Response {
  if (status !== 200) {
    return new Response(JSON.stringify({
      statusCode: status,
      data: {
        code: 'service-unavailable',
        message: '在线 OCR 暂时不可用',
        retryable: true,
      },
    }), { status, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify({
    engine: 'paddleocr-official-api',
    model: 'PaddleOCR-VL-1.6',
    jobId: 'job_delivery_1',
    pages: [{ pageIndex: 0, markdown, prunedResult: {}, layoutRegions: [] }],
    markdownPages: [markdown],
    dataInfo: { numPages: 1 },
  }), { headers: { 'content-type': 'application/json' } })
}

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '合和新城')`)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '广州示例建材有限公司')`)
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
  mem.close()
})

describe('delivery store 真实识别与归档管线', () => {
  it('保留实际 File，识别后生成可编辑的单头和材料明细', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(DELIVERY_MARKDOWN))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1, 2, 3])], '旋转送货单.png', { type: 'image/png' })
    const store = useDeliveryStore()

    const [id] = store.uploadFiles([file])
    expect(await store.recognizeFile(id!)).toBe(true)

    expect(store.byId(id!)).toMatchObject({
      name: '旋转送货单.png',
      ocrStatus: 'done',
      supplierText: '广州示例建材有限公司',
    })
    expect(store.byId(id!)?.docs[0]).toMatchObject({
      orderNo: 'SH-2026-001',
      deliveryDate: '2026-07-16',
      siteText: '合和新城项目部',
      balanced: true,
    })
    expect(store.byId(id!)?.docs[0]?.items[0]).toMatchObject({
      name: '普通硅酸盐水泥',
      spec: 'P.O 42.5',
      qty: 4,
      unitPrice: 155.5,
      amount: 622,
    })
    const uploaded = (fetchMock.mock.calls[0]?.[1]?.body as FormData).get('file')
    expect(uploaded).toBe(file)
  })

  it('在线失败后保留原文件和错误，可在当前会话重试', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ocrResponse('', 503))
      .mockResolvedValueOnce(ocrResponse(DELIVERY_MARKDOWN))
    vi.stubGlobal('fetch', fetchMock)
    const store = useDeliveryStore()
    const [id] = store.uploadFiles([new File(['x'], '可重试.pdf')])

    expect(await store.recognizeFile(id!)).toBe(false)
    expect(store.byId(id!)).toMatchObject({ ocrStatus: 'failed', ocrError: '在线 OCR 暂时不可用' })
    expect(await store.recognizeFile(id!)).toBe(true)
    expect(store.byId(id!)?.ocrStatus).toBe('done')
  })

  it('仅有 OCR 金额时不伪造数量和单价，并让金额勾稽保留异常', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(AMOUNT_ONLY_LINE_MARKDOWN)))
    const store = useDeliveryStore()
    const [id] = store.uploadFiles([new File(['x'], '脱敏送货单.pdf')])

    expect(await store.recognizeFile(id!)).toBe(true)
    const doc = store.byId(id!)?.docs[0]
    const item = doc?.items[0]

    expect(item).toMatchObject({
      name: '耐候密封胶',
      qty: 0,
      unitPrice: 0,
      amount: 386,
      amountSource: 'ocr',
    })
    expect(summarizeDeliveryAmounts(doc!.items, doc!.statedTotal)).toMatchObject({
      total: 386,
      mismatchedLineIds: [item!.id],
      statedBalanced: true,
      balanced: false,
    })
  })

  it('核对完成必须归项目，并自动写入归档库与材料明细', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(DELIVERY_MARKDOWN)))
    const store = useDeliveryStore()
    const [fileId] = store.uploadFiles([new File(['x'], '待归档.pdf')])
    await store.recognizeFile(fileId!)
    const doc = store.byId(fileId!)?.docs[0]
    expect(doc).toBeTruthy()

    await expect(store.archiveDocument(fileId!, doc!.id, {
      projectId: '',
      supplierId: null,
      orderNo: doc!.orderNo,
      deliveryDate: doc!.deliveryDate,
      siteText: doc!.siteText,
      docType: doc!.docType,
      note: doc!.note,
      items: doc!.items,
    })).rejects.toThrow('必须选择项目')

    const recordId = await store.archiveDocument(fileId!, doc!.id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: doc!.orderNo,
      deliveryDate: doc!.deliveryDate,
      siteText: doc!.siteText,
      docType: doc!.docType,
      note: doc!.note,
      items: doc!.items,
    })
    const [record] = await mem.select<Record<string, unknown>>(
      'SELECT * FROM delivery_records WHERE id = ?',
      [recordId],
    )
    const lines = await mem.select<Record<string, unknown>>(
      'SELECT * FROM delivery_lines WHERE delivery_record_id = ?',
      [recordId],
    )

    expect(record).toMatchObject({
      project_id: 'p1',
      supplier_id: 's1',
      order_no: 'SH-2026-001',
      ocr_status: 'reviewed',
      archived: 1,
      file_name: '待归档.pdf',
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ material_name: '普通硅酸盐水泥', amount: 622 })
    expect(store.byId(fileId!)).toBeUndefined()
  })
})
