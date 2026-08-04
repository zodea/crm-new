import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { summarizeDeliveryAmounts } from '~/lib/delivery/review'
import { useDeliveryStore } from '~/stores/delivery'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
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

    const [id] = await store.uploadFiles([file])
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
    const [id] = await store.uploadFiles([new File(['x'], '可重试.pdf')])

    expect(await store.recognizeFile(id!)).toBe(false)
    expect(store.byId(id!)).toMatchObject({ ocrStatus: 'failed', ocrError: '在线 OCR 暂时不可用' })
    expect(await store.recognizeFile(id!)).toBe(true)
    expect(store.byId(id!)?.ocrStatus).toBe('done')
  })

  it('仅有 OCR 金额时不伪造数量和单价，也不误报 0×0 金额不平', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(AMOUNT_ONLY_LINE_MARKDOWN)))
    const store = useDeliveryStore()
    const [id] = await store.uploadFiles([new File(['x'], '脱敏送货单.pdf')])

    expect(await store.recognizeFile(id!)).toBe(true)
    const doc = store.byId(id!)?.docs[0]
    const item = doc?.items[0]

    expect(item).toMatchObject({
      name: '耐候密封胶',
      qty: null,
      unitPrice: null,
      amount: 386,
      amountSource: 'ocr',
    })
    expect(summarizeDeliveryAmounts(doc!.items, doc!.statedTotal)).toMatchObject({
      total: 386,
      mismatchedLineIds: [],
      statedBalanced: true,
      balanced: true,
    })
  })

  it('核对完成必须归项目，并自动写入归档库与材料明细', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(DELIVERY_MARKDOWN)))
    const store = useDeliveryStore()
    const sourceBytes = new Uint8Array([0x00, 0x80, 0xFF])
    const [fileId] = await store.uploadFiles([
      new File([sourceBytes], '待归档.pdf', { type: 'application/pdf' }),
    ])
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
    })).rejects.toThrow('必须选择所属项目')

    const recordId = await store.archiveDocument(fileId!, doc!.id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: doc!.orderNo,
      deliveryDate: doc!.deliveryDate,
      siteText: doc!.siteText,
      docType: doc!.docType,
      note: doc!.note,
      items: doc!.items,
      confirmations: {
        humanReviewed: true,
        amountReviewed: true,
        noOrderNoConfirmed: false,
        qualityReviewed: true,
      },
    })
    const [record] = await mem.select<Record<string, unknown>>(
      'SELECT * FROM delivery_records WHERE id = ?',
      [recordId],
    )
    const lines = await mem.select<Record<string, unknown>>(
      'SELECT * FROM delivery_lines WHERE delivery_record_id = ?',
      [recordId],
    )
    const sourceFiles = await mem.select<Record<string, unknown>>(
      `SELECT id, file_name, file_size, mime_type FROM file_refs
       WHERE owner_type = 'delivery_record' AND owner_id = ? AND category = 'source'`,
      [recordId],
    )
    const sourcePayloads = await mem.select<Record<string, unknown>>(
      `SELECT encoding, content FROM file_payloads WHERE file_ref_id = ?`,
      [sourceFiles[0]?.id],
    )

    expect(record).toMatchObject({
      project_id: 'p1',
      supplier_id: 's1',
      order_no: 'SH-2026-001',
      ocr_status: 'reviewed',
      archived: 1,
      stored: 1,
      print_disposition: 'pending',
      printed_at: null,
      file_name: '待归档.pdf',
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ material_name: '普通硅酸盐水泥', amount: 622, amount_source: 'ocr' })
    expect(sourceFiles).toEqual([
      expect.objectContaining({
        file_name: '待归档.pdf',
        file_size: sourceBytes.byteLength,
        mime_type: 'application/pdf',
      }),
    ])
    expect(sourcePayloads).toEqual([{ encoding: 'base64', content: 'AID/' }])

    setActivePinia(createPinia())
    const coldStore = useDeliveryRecordStore()
    await coldStore.load()
    expect(coldStore.byId(recordId)?.hasSourceFile).toBe(true)
    const coldSource = await coldStore.loadSourceFile(recordId)
    expect(coldSource).toMatchObject({
      fileName: '待归档.pdf',
      fileSize: sourceBytes.byteLength,
      mimeType: 'application/pdf',
    })
    expect(coldSource?.bytes).toEqual(sourceBytes)
    expect(store.byId(fileId!)).toMatchObject({
      docs: [],
      archivedRecordIds: [recordId],
      printDisposition: 'pending',
    })

    await store.excludeFileFromPrint(fileId!)
    const [excluded] = await mem.select<Record<string, unknown>>(
      'SELECT print_disposition, printed_at FROM delivery_records WHERE id = ?',
      [recordId],
    )
    expect(excluded).toEqual({
      print_disposition: 'excluded',
      printed_at: null,
    })
    expect(store.byId(fileId!)).toBeUndefined()
  })

  it('只有明确打印成功回执才把归档文件移出待打印队列', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(ocrResponse(DELIVERY_MARKDOWN)))
    const store = useDeliveryStore()
    const [fileId] = await store.uploadFiles([new File(['print'], '待打印回执.pdf', { type: 'application/pdf' })])
    await store.recognizeFile(fileId!)
    const doc = store.byId(fileId!)?.docs[0]

    const recordId = await store.archiveDocument(fileId!, doc!.id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: doc!.orderNo,
      deliveryDate: doc!.deliveryDate,
      siteText: doc!.siteText,
      docType: doc!.docType,
      note: doc!.note,
      items: doc!.items,
      confirmations: {
        humanReviewed: true,
        amountReviewed: true,
        noOrderNoConfirmed: false,
        qualityReviewed: true,
      },
    })
    expect(store.pendingPrintFiles.map(file => file.id)).toEqual([fileId])

    const [beforeReceipt] = await mem.select<Record<string, unknown>>(
      'SELECT print_disposition, printed_at FROM delivery_records WHERE id = ?',
      [recordId],
    )
    expect(beforeReceipt).toEqual({
      print_disposition: 'pending',
      printed_at: null,
    })

    await store.confirmFilePrintReceipt(fileId!)
    const [afterReceipt] = await mem.select<Record<string, unknown>>(
      'SELECT print_disposition, printed_at FROM delivery_records WHERE id = ?',
      [recordId],
    )
    expect(afterReceipt?.print_disposition).toBe('printed')
    expect(afterReceipt?.printed_at).toBeTruthy()
    expect(store.byId(fileId!)).toBeUndefined()
  })

  it('刷新后从归档记录恢复待打印队列，并按需读取原件', async () => {
    const recordStore = useDeliveryRecordStore()
    const sourceBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const recordId = await recordStore.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-PRINT-RESTORE',
      deliveryDate: '2026-07-19',
      note: '',
      lines: [{ materialName: '跨刷新材料', spec: '', unit: '件', qty: 1, unitPrice: 20, note: '' }],
    }, new File([sourceBytes], '跨刷新待打印.pdf', { type: 'application/pdf' }))

    setActivePinia(createPinia())
    const restoredStore = useDeliveryStore()
    await restoredStore.loadPendingPrintQueue()

    expect(restoredStore.pendingPrintFiles).toEqual([
      expect.objectContaining({
        id: `print:${recordId}`,
        name: '跨刷新待打印.pdf',
        printBatchId: recordId,
        archivedRecordIds: [recordId],
        printDisposition: 'pending',
      }),
    ])
    const source = await restoredStore.loadFileForPrint(`print:${recordId}`)
    expect(source.name).toBe('跨刷新待打印.pdf')
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(sourceBytes)
  })

  it('同一上传文件拆成多张送货单时，刷新后仍恢复为一个打印任务', async () => {
    const recordStore = useDeliveryRecordStore()
    const source = new File(['shared-source'], '一份文件两张单.pdf', { type: 'application/pdf' })
    const firstId = await recordStore.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-BATCH-001',
      deliveryDate: '2026-07-19',
      printBatchId: 'shared-print-batch',
      note: '',
      lines: [{ materialName: '第一张材料', spec: '', unit: '件', qty: 1, unitPrice: 20, note: '' }],
    }, source)
    const secondId = await recordStore.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-BATCH-002',
      deliveryDate: '2026-07-19',
      printBatchId: 'shared-print-batch',
      note: '',
      lines: [{ materialName: '第二张材料', spec: '', unit: '件', qty: 2, unitPrice: 30, note: '' }],
    }, source)

    setActivePinia(createPinia())
    const restoredStore = useDeliveryStore()
    await restoredStore.loadPendingPrintQueue()

    expect(restoredStore.pendingPrintFiles).toHaveLength(1)
    expect(restoredStore.pendingPrintFiles[0]).toMatchObject({
      id: 'print:shared-print-batch',
      printBatchId: 'shared-print-batch',
      printDisposition: 'pending',
    })
    expect(restoredStore.pendingPrintFiles[0]?.archivedRecordIds)
      .toEqual(expect.arrayContaining([firstId, secondId]))
  })
})
